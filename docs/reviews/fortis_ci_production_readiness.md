# Fortis-CI Production Readiness & Architectural Limits

This document addresses the final production readiness concerns for integrating Fortis-CI with a mature, GitOps-driven microservice architecture like TicketFlow.

## 1. Deployment Identity

**What exactly is a `Deployment` node in Fortis-CI?**
In the current V1 architecture, a `Deployment` node is **strictly a GitHub Actions Workflow Run**.

*   It is **NOT** inherently a "Successful Release" (the workflow can fail).
*   It is **NOT** inherently a "Runtime Healthy Version" (it might deploy successfully but crash on boot).
*   It represents the *attempted CI pipeline execution* tied to a specific `workflow_run_id`.

**The Limitation:** Because Fortis-CI currently ties a deployment to the CI completion, there is a gap if your pipeline only builds a Docker image and updates a manifest, while an external tool (like ArgoCD) actually performs the rollout to Kubernetes.

---

## 2. Infrastructure Changes & GitOps Modeling

TicketFlow uses a two-phase GitOps flow: `App Commit -> Image -> Infra Commit -> ArgoCD Sync -> K8s Rollout`.

Fortis-CI currently lacks native support for this split. If deployed today, it would record the deployment as complete the moment the GitHub Action finishes, even if ArgoCD hasn't synced the new image to Kubernetes yet.

**How Fortis-CI *should* model this (Future Architecture):**
We must decouple CI from CD. We need to introduce new node types and ingest ArgoCD webhooks.

*   **New Node Types:** `Artifact` (Docker Image), `InfraCommit` (Manifest repository), `Rollout` (ArgoCD Sync Event).
*   **New Graph Path:**
    ```cypher
    (Commit) -[:BUILDS]-> (Artifact)
    (Artifact) -[:TRIGGERS_UPDATE]-> (InfraCommit)
    (InfraCommit) -[:RESULTS_IN]-> (Rollout)
    (Rollout) -[:DEPLOYED_TO]-> (Service)
    ```
With this model, Fortis-CI tracks the exact code commit all the way through the image registry to the actual Kubernetes Pod lifecycle.

---

## 3. Health Model (Deep Dependency Boundaries)

**How should Fortis detect DB, Redis, RabbitMQ, or Stripe failures without becoming a full APM?**
By maintaining strict system boundaries: **Fortis-CI remains dumb; the microservice remains smart.**

Fortis-CI should never poll Stripe or Postgres directly. Instead, the TicketFlow microservices must implement "Deep Health Checks" on their `/health` endpoints.

*   If `ticketflow-payments` loses connection to Stripe, its *own* `/health` endpoint should return HTTP 503 (or indicate `status: degraded`).
*   If `ticketflow-auth` loses Redis, its `/health` endpoint returns HTTP 503.
*   Fortis-CI simply polls the service's HTTP endpoint. If the service reports itself as unhealthy due to an internal dependency failure, Fortis-CI records the `Down` state and triggers the failure graph.

---

## 4. Rollback Safety (Migration Commits)

**How can Fortis identify a migration commit versus an application commit?**
Auto-rolling back application code when the database schema has migrated forward is catastrophic. Fortis-CI must prevent this.

**The Solution:** File path heuristics at the time of ingest.
1.  When the webhook arrives, Fortis-CI parses the Git diff.
2.  If any file in the `CHANGED_FILE` relationship matches a stateful glob pattern (e.g., `**/migrations/**`, `prisma/schema.prisma`, `**/*.sql`), Fortis-CI adds a property to the Deployment node: `has_stateful_changes: true`.
3.  **Rollback Engine Rule:** When the rollback engine evaluates a target, if the failing deployment has `has_stateful_changes: true`, the engine immediately aborts the auto-rollback, marks the service `needs_manual_intervention`, and alerts the team: *"Stateful changes detected. Safe rollback cannot be guaranteed."*

---

## 5. Graph Evolution

After 100 deployments, 5 failures, and 2 rollbacks, the graph becomes a rich analytical dataset rather than just a timeline.

**Expected Ideal Graph:**
*   A long `SUCCEEDED_BY` chain representing 95 stable states.
*   5 deployments branching off with `status: 'failed'` and dense clusters of `CAUSED_ERROR` and `RELATED_TO_FILE` edges.
*   2 `RollbackEvent` nodes with `REPLACED_BY` edges bypassing the failures back into the main `SUCCEEDED_BY` trunk.

**The Most Valuable Graph Queries:**
1.  **Fragility Index (Layer 2 Risk):** Which specific files (e.g., `auth/utils.ts`) are connected to all 5 failures?
    ```cypher
    MATCH (d:Deployment {status: 'failed'})-[:BASED_ON]->(c:Commit)-[:CHANGED_FILE]->(f:File)
    RETURN f.path, count(d) as failure_count ORDER BY failure_count DESC
    ```
2.  **Mean Time To Recovery (MTTR):** Time delta between a failed `Deployment` node's creation and its corresponding `RollbackEvent` timestamp.
3.  **Cascading Blast Radius:** When Service A failed 5 times, did Service B (which `DEPENDS_ON` A) also show `Down` HealthCheck nodes during those exact 5 time windows?

---

## 6. Future Roadmap (The Top 3 Public Release Priorities)

If only 3 major capabilities can be added before Fortis-CI goes public, they must be these, ranked by impact:

1.  **Stateful Commit Blocking (Migration Safety)**
    *   *Why:* Without this, the auto-rollback engine is a loaded gun. Rolling back a microservice that just applied a breaking database migration will cause a total production outage. This is a non-negotiable safety feature.
2.  **ArgoCD / GitOps Webhook Ingestion**
    *   *Why:* Modern teams do not deploy directly from GitHub Actions (Push-based). They use ArgoCD or Flux (Pull-based). If Fortis-CI only tracks CI, its "deployment timestamp" is fundamentally inaccurate for modern cloud-native architectures.
3.  **Distributed Task Queue (BullMQ) for Health Polling**
    *   *Why:* The current `p-limit` synchronous loop works for 50 services. Public users will register 200 services. The Node.js event loop will block, health checks will exceed the 60s window, and the core detection engine will collapse under its own weight. It must scale horizontally.
