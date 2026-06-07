# TicketFlow x Fortis-CI Integration Strategy

This document outlines the exact deployment philosophy, operational boundaries, and integration steps for introducing Fortis-CI to monitor the TicketFlow microservice architecture.

## 1. Deployment Philosophy & System Boundaries

**What exactly is Fortis-CI monitoring?**
Fortis-CI operates at the **CI/CD intelligence layer**.
*   **It IS monitoring:** GitHub Actions pipeline executions, the Git commits those pipelines build upon, the specific files changed in those commits, the logs emitted by the pipeline, and the immediate post-deployment HTTP health of the service.
*   **It IS NOT monitoring:** Runtime application metrics (CPU/Memory), traces (like Datadog/Jaeger), or Kubernetes objects (Pods/Deployments). It is not an APM.
*   **Boundaries:** It assumes that your CI (GitHub Actions) actually performs the deployment (CD). Fortis-CI observes the event, polls the black-box HTTP health endpoint, and correlates errors to the git diff.

---

## 2. Service Registration (TicketFlow `services.yml`)

The initial `services.yml` for TicketFlow requires minor modifications to work perfectly with Fortis-CI, specifically regarding **Monorepo path filters** and **HTTP Health endpoints**.

> [!WARNING]
> Fortis-CI's health worker executes an `HTTP GET` request and expects a `200 OK`. You cannot poll raw TCP sockets (like Postgres `5432` or Redis `6379`) directly. You must deploy HTTP exporters (e.g., `redis_exporter`, `postgres_exporter`) or a sidecar that returns HTTP 200 for infrastructure components.

```yaml
services:
  - name: ticketflow-frontend
    repoUrl: ticketflow-microservices/ticketflow-frontend
    healthEndpoint: http://ticketflow-frontend/api/health
    environment: production
    dependencies:
      - ticketflow-auth
      - ticketflow-catalog
      - ticketflow-orders

  - name: ticketflow-auth
    repoUrl: ticketflow-microservices/ticketflow-auth
    healthEndpoint: http://ticketflow-auth/api/health
    environment: production
    dependencies:
      - postgres
      - redis

  - name: ticketflow-catalog
    repoUrl: ticketflow-microservices/ticketflow-catalog
    healthEndpoint: http://ticketflow-catalog/api/health
    environment: production
    dependencies:
      - postgres
      - redis

  - name: ticketflow-orders
    repoUrl: ticketflow-microservices/ticketflow-orders
    healthEndpoint: http://ticketflow-orders/api/health
    environment: production
    dependencies:
      - postgres
      - rabbitmq
      - ticketflow-catalog
      
  - name: ticketflow-payments
    repoUrl: ticketflow-microservices/ticketflow-payments
    healthEndpoint: http://ticketflow-payments/api/health
    environment: production
    dependencies:
      - postgres
      - rabbitmq
      - ticketflow-orders

  # INFRASTRUCTURE MONOREPO - Note the addition of path_filters
  - name: postgres
    repoUrl: ticketflow-microservices/ticketflow-infra
    path_filter: "postgres/**"
    healthEndpoint: http://postgres-exporter:9187/health # Must be HTTP!
    environment: production
    dependencies: []

  - name: redis
    repoUrl: ticketflow-microservices/ticketflow-infra
    path_filter: "redis/**"
    healthEndpoint: http://redis-exporter:9121/health # Must be HTTP!
    environment: production
    dependencies: []

  - name: rabbitmq
    repoUrl: ticketflow-microservices/ticketflow-infra
    path_filter: "rabbitmq/**"
    healthEndpoint: http://rabbitmq-service:15672/api/health/checks/alarms # RabbitMQ Management API
    environment: production
    dependencies: []
```

---

## 3. Deployment Modeling (Graph State Evolution)

As TicketFlow executes CI pipelines, the Neo4j graph evolves:

*   **After 1 Deployment (e.g., `ticketflow-auth`):**
    *   `Service` node (`ticketflow-auth`)
    *   `Deployment` node (`#1`) connected via `DEPLOYED_TO`.
    *   `Commit` node connected via `BASED_ON`.
    *   Several `File` nodes connected via `CHANGED_FILE`.
    *   `HealthCheck` nodes begin aggregating every 60 seconds, linked via `HAS_HEALTH`.
*   **After 10 Deployments:**
    *   A continuous timeline chain emerges: `Deployment #1` -[:`SUCCEEDED_BY`]-> `#2` -> `#3` ... -> `#10`.
*   **After 1 Failure (Deployment `#11`):**
    *   `Deployment #11` is flagged `status: 'failed'`.
    *   `LogFetchJob` creates an `ErrorPattern` node (e.g., `ECONNREFUSED`).
    *   `CAUSED_ERROR` links the deployment to the error.
    *   `RELATED_TO_FILE` links the error directly to a specific modified config file.
*   **After 1 Rollback:**
    *   A `RollbackEvent` node is created.
    *   `Deployment #11` -[:`TRIGGERED`]-> `RollbackEvent`.
    *   `RollbackEvent` -[:`ROLLED_BACK_TO`]-> `Deployment #10` (the safe target).
    *   `Deployment #11` -[:`REPLACED_BY`]-> `Deployment #10` (audit trail edge).

---

## 4. Blast Radius (If `ticketflow-auth` fails)

**Scenario:** The health endpoint for `ticketflow-auth` drops to `Down`.

**Graph Traversal (Cypher):**
```cypher
MATCH (root:Service {name: 'ticketflow-auth'})<-[:DEPENDS_ON*1..3]-(affected:Service)
RETURN affected.name
```

**Expected Affected Services:**
Based on the `services.yml`, `ticketflow-frontend` declares a direct dependency on `ticketflow-auth`.
The dashboard will immediately flag `ticketflow-frontend` as **At Risk (Blast Radius)**.

---

## 5. Production Rollout Plan

**Day 1: Passive Observation**
*   Deploy Fortis-CI via Terraform.
*   Inject the `services.yml`.
*   Configure GitHub webhooks at the Organization level.
*   *Goal:* Verify webhooks are received and the graph builds organically without interfering with actual deployments.

**Day 2: Health Verification**
*   Verify the 60s health worker correctly parses `200 OK` from all TicketFlow services.
*   Resolve any networking issues (e.g., Fortis-CI cannot reach `postgres-exporter` inside the VPC).

**Week 1: RCA Tuning & Manual Ops**
*   Introduce deliberate errors in staging.
*   Verify the asynchronous `LogFetchJob` correctly downloads the GitHub Actions Zip and correlates errors to files.
*   Test *Manual Redeployments* via the Next.js Dashboard.

**Week 2: Rollback Simulation**
*   Use the "Preview Rollback" feature to ensure the graph query (`Q1`) accurately identifies the `SUCCEEDED_BY` target.
*   Execute manual rollbacks to verify GitHub Actions re-run API permissions.
*   *Do NOT enable Auto-Rollback yet.*

---

## 6. Auto Rollback Readiness

**When should it remain disabled?**
1.  **Stateful Deployments:** If a commit includes a database migration (e.g., Prisma, Flyway), auto-rolling back the application code will NOT roll back the database schema, causing immediate application crashes.
2.  **Flaky Health Checks:** If your infrastructure experiences random network blips that cause 3 consecutive HTTP timeouts, auto-rollback will fire falsely.

**Metrics to collect before enabling:**
*   **Health Flap Rate:** Monitor Fortis-CI for 14 days. Ensure your services do not naturally flap to `Down` during normal operations.
*   **Log Processing Success Rate:** Ensure the `LogFetchJob` consistently parses your logs without hitting the 60s timeout or 5MB constraints.

---

## 7. Missing Capabilities

**Required before full production trust:**
1.  **Database Migration Awareness:** Fortis-CI currently does not understand database schema state. You must implement CI-level protections to block rollbacks on migration commits, or disable auto-rollback on stateful services.
2.  **HTTP Infra Wrappers:** As noted, raw TCP polling fails.

**Nice-to-Have:**
1.  **Server-Sent Events (SSE):** Current polling makes the dashboard feel slightly latent during live rollbacks.
2.  **Distributed Task Queues (BullMQ):** Required if TicketFlow scales beyond ~50 microservices to prevent the 60s health worker from congesting.

---

## 8. Fortis-CI Self Monitoring

Fortis-CI operates as the watchdog, but "who watches the watcher?"

**How to know it's healthy:**
*   The `/ping` liveness endpoint returns `200 OK`.
*   Neo4j natively exposes health metrics on port `7474`.

**Failure Scenarios:**
*   **Neo4j fails:** Fatal. The Backend API will crash on boot or fail all webhook writes. Needs external alert (e.g., AWS CloudWatch).
*   **Redis fails:** Non-fatal. The health worker will fall back, but dashboard performance degrades as time-series caching is lost.
*   **GitHub API rate limits (5,000 req/hr):** Non-fatal to ingestion. Webhooks still process, but the `LogFetchJob` aborts. RCA will be marked `unavailable`.
*   **Health worker crashes:** The cron stops. Deployments will continue to log, but all services will freeze in their last known health state. No auto-rollbacks will trigger.

**Self-Monitoring Strategy:**
Because Fortis-CI is centralized, it cannot monitor itself effectively. You must use an external APM (like Datadog) or AWS CloudWatch Alarms to monitor the ECS Fargate Task health, specifically the `/ping` endpoint and Neo4j container memory.
