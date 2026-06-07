# Fortis-CI Operational & Deployment Deep Dive

This document addresses specific operational, deployment, and infrastructure mechanics for Fortis-CI.

## 1. Deployment Registration

**How Services Become Visible**
Fortis-CI operates on a strict whitelist registry. If a webhook arrives from a GitHub repository that isn't registered, it is silently ignored (HTTP 200 OK). Registration occurs via the UI or by injecting a `services.yml` file during boot (parsed by `importYamlServices()`).

**services.yml Schema**
```yaml
services:
  - name: string                  # Internal service name (e.g., ticketflow-auth)
    repoUrl: string               # GitHub repo identifier (e.g., your-org/ticketflow-auth)
    healthEndpoint: string        # HTTP endpoint polled by Health Worker
    environment: string           # e.g., production, staging
    dependencies: string[]        # Names of other registered services (creates DEPENDS_ON)
    path_filter: string           # Optional (Monorepo support): Glob pattern, e.g., "services/auth/**"
    rollback_strategy: string     # Optional: "rerun" (default) or "workflow_dispatch"
```

**Validation & Onboarding Flow**
1.  On backend boot, `services.yml` is parsed.
2.  `Service` nodes are `MERGE`d into Neo4j.
3.  `DEPENDS_ON` edges are created between services based on the `dependencies` array.
4.  When a webhook arrives, the `repository.full_name` is matched against `repoUrl`.
5.  If it's a monorepo, the incoming commit diff is checked against `path_filter`. If matched, a deployment is recorded.

---

## 2. Terraform Integration

The official Terraform module (`terraform-aws-fortis-ci`) supports a strict GitOps workflow targeting AWS ECS Fargate.

**Infrastructure Flow:**
`terraform apply` → Provisions ECS Cluster, Fargate Task Def, IAM Roles → Injects `services.yml` content into container ENV → Fortis-CI backend boots → `importYamlServices()` parses ENV → Neo4j `Service` nodes created → Health worker begins polling.

**Architecture Details:**
*   It deploys all 4 components (`fortis-ci-backend`, `frontend`, `neo4j`, `redis`) inside **a single ECS Task Definition**.
*   This allows the backend to communicate with Neo4j and Redis via `localhost` (zero-latency network).
*   Config injection: It passes the raw YAML as an environment variable (`SERVICES_YAML`) to avoid complex volume mounts on Fargate.

**Outputs Produced:**
*   `cluster_name`
*   `ecs_service_name`
*   `task_definition_arn`

---

## 3. Kubernetes Integration

**Current Implementation: Non-Existent.**
Fortis-CI **does not** query the Kubernetes API. It has no concept of Pods, Deployments, Namespaces, or Ingresses.
Fortis-CI is a **CI-driven** observability tool, not a Kubernetes APM. It tracks GitHub Actions pipeline executions and relies entirely on HTTP `/health` endpoints to determine state.

**Future Implementation:**
A Helm chart is slated for V4, but this is exclusively to *host* Fortis-CI on Kubernetes, not to change its operating model to query K8s clusters.

---

## 4. Health Monitoring

**Exact Polling Lifecycle:**
1.  `startHealthWorker()` initializes a 60-second cron job.
2.  It queries Neo4j for all registered `Service` nodes.
3.  It maps the `healthEndpoint`s and uses `p-limit` (concurrency = 20) to dispatch HTTP GET requests simultaneously.
4.  Each request has a strict **10-second timeout**.

**Handling Edge Cases:**
*   **Timeouts:** Recorded as a `Down` state.
*   **Retries:** There are no mid-cycle retries. A failure is simply recorded for that minute's snapshot.
*   **Congestion:** If the 20-concurrency pool takes longer than 60 seconds to process all services, it logs a `WARN` and skips the next cycle rather than overlapping.

**State Transitions & Storage:**
*   **Healthy:** HTTP 200, < 500ms.
*   **Degraded:** HTTP 200, 500ms - 2000ms.
*   **Down:** Timeout or non-200.
*   Neo4j creates a `HealthCheck` node linked to the current `Deployment` via `HAS_HEALTH`. The time-series data is cached in Redis for dashboard rendering.

---

## 5. Graph Construction (Creation Order)

When a GitHub Action completes, the webhook triggers this exact write sequence:

1.  **Idempotency Check:** Verify `workflow_run_id` does not exist.
2.  **Service Match:** Lookup `Service` by repo.
3.  **Commit Node:**
    ```cypher
    MERGE (c:Commit {sha: $sha})
    ON CREATE SET c.message = $msg, c.author = $author
    ```
4.  **Deployment Node:**
    ```cypher
    CREATE (d:Deployment {id: $uuid, workflow_run_id: $run_id, status: $status})
    ```
5.  **Relate Deployment to Service & Commit:**
    ```cypher
    MATCH (s:Service {repo_url: $repo}), (c:Commit {sha: $sha}), (d:Deployment {id: $uuid})
    CREATE (d)-[:DEPLOYED_TO]->(s)
    CREATE (d)-[:BASED_ON]->(c)
    ```
6.  **Timeline Linking:**
    ```cypher
    MATCH (prev:Deployment)-[:DEPLOYED_TO]->(s)
    WHERE prev.id <> $uuid
    WITH prev ORDER BY prev.timestamp DESC LIMIT 1
    CREATE (prev)-[:SUCCEEDED_BY]->(d)
    ```

---

## 6. Rollback Engine

**Exact Sequence:**
1.  Health Worker identifies 3 consecutive `Down` checks.
2.  Rollback Engine executes **Q1**: Traversing the `SUCCEEDED_BY` chain backwards to find the last `success` deployment.
3.  Creates a `RollbackEvent` node.
4.  Calls the **GitHub Actions Re-run API**: `POST /repos/{owner}/{repo}/actions/runs/{prev.workflow_run_id}/rerun`.
5.  Fires notifications to PR, Slack, and Email.
6.  Creates an audit-only `REPLACED_BY` edge.
7.  Enforces a 15-minute cooldown on the service.

**Failure Handling:**
*   **If rollback (re-run) fails:** The service status is flagged `needs_manual_intervention`. The system explicitly prohibits chaining rollbacks (max depth = 1).
*   **If rollback succeeds but health remains degraded:** The 15-minute cooldown prevents immediate re-triggering. Even after 15 minutes, because max depth = 1, it will not auto-rollback again. It requires manual intervention.

---

## 7. Multi-Repo Organizations

**Correlation into one Graph:**
A single Fortis-CI instance receives webhooks from an Org-level GitHub configuration. `ticketflow-auth`, `ticketflow-orders`, etc., hit the same endpoint. The `repository.full_name` routes the deployment to the correct internal node.

**Dependency & Blast Radius:**
Because `services.yml` defines dependencies (`ticketflow-orders` depends on `ticketflow-auth`), Fortis-CI creates `DEPENDS_ON` edges. 

**Blast Radius Calculation (Cypher Q5):**
```cypher
MATCH (root:Service {name: 'ticketflow-auth'})<-[:DEPENDS_ON*1..3]-(affected:Service)
RETURN DISTINCT affected.name
```
If `ticketflow-auth` fails, the dashboard traverses the graph 1 to 3 hops deep to flag `orders` and `payments` as potentially impacted.

---

## 8. Production Deployment

**AWS ECS Fargate (Terraform) Resources:**
*   **Total Task Resources:** 1024 CPU / 2048 Memory.
*   **Neo4j:** 256 CPU / 512 Mem
*   **Redis:** 128 CPU / 256 Mem
*   **Backend:** 512 CPU / 1024 Mem
*   **Frontend:** 256 CPU / 512 Mem

*(Docker Compose locally mirrors this logic. Helm/K8s is not yet available).*

---

## 9. Failure Modes

| Failure Mode | Detection | Graph Impact | Recovery Strategy |
| :--- | :--- | :--- | :--- |
| **GitHub Webhook Missed** | Silent (until V2 ReconcileJob). | Gap in `SUCCEEDED_BY` timeline chain. | V2 Hourly cron job backfills missing `workflow_run_ids` from GitHub API. |
| **LogFetchJob OOM / Timeout** | Aborts if processing > 60s or zip > 5MB. | Missing `CAUSED_ERROR` and `ErrorPattern` nodes. | Marked `rca_status: 'unavailable'`. Tier 1 Health rollback continues to function unaffected. |
| **Rollback Infinite Loop** | Prevented by architecture. | None. | Graph explicitly ignores `REPLACED_BY` edges and enforces max depth = 1. |
| **Health Worker Congestion** | Poll cycle takes > 60s. | Missing minute-by-minute `HealthCheck` nodes. | Logs WARN, skips cycle. Requires V4 BullMQ upgrade for scale > 50 services. |
| **GitHub API Rate Limit** | HTTP 429 received during log fetch. | RCA is delayed. | Exponential backoff (max 3 retries). Fails gracefully to 'unavailable'. |

---

## 10. Production Validation Plan (TicketFlow)

If deploying to `TicketFlow` today, execute the following scenarios to validate:

**Best Scenarios to Validate:**
1.  **Blast Radius Test:** Deploy a breaking change to `ticketflow-auth` and verify that the Fortis-CI dashboard correctly flags `ticketflow-orders` as "At Risk" via the `DEPENDS_ON` edges.
2.  **Monorepo Path Filter:** Commit a change exclusively to a frontend UI folder in a monorepo and verify that backend services do NOT register false deployments.

**Scenarios Likely to Break Fortis-CI (Do Not Run):**
1.  **Massive Log Output:** A deployment that spews 100MB+ of text into GitHub Actions logs will trigger the `LogFetchJob` circuit breakers (aborting RCA).
2.  **Scale Test:** Registering 200+ microservices immediately will crash the `p-limit` synchronous health worker.

**Pre-Requisites for Auto-Rollback Enablement:**
1.  Verify the Fortis-CI GitHub Personal Access Token has adequate `workflow` scopes to actually trigger a re-run via API.
2.  Verify the 15-minute circuit breaker functions by intentionally forcing a rollback to fail, ensuring it doesn't trigger a secondary rollback loop.
