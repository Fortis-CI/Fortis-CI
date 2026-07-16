# Identified Technical Issues: Fortis CI

During a comprehensive audit of the **Fortis CI** project, several critical architectural and operational issues were identified. Below is the breakdown of these issues.

---

## 1. Rollback Engine Flaws

### A. The Rerun-Workflow API Fallacy
In [rollbackEngine.ts](file:///home/ganeshak11/dev/Fortis/Fortis-CI/backend/src/services/rollbackEngine.ts#L70), the automated rollback executes by re-running a past GitHub Action workflow run:
```typescript
const result = await rerunWorkflow(parsed.owner, parsed.repo, runId);
```
* **The Problem:** In GitOps-based microservice environments (e.g. ArgoCD, Kubernetes), re-running an old GitHub action run does *not* roll back the running state of the clusters if your infrastructure configuration repo is still pointing to the failed commit SHA. 
* **The Log Expiry Risk:** GitHub Actions purges workflow runs and artifacts automatically after 90 days. If the last healthy deployment of a service is older than 90 days, calling the rerun API on its `runId` will throw an HTTP 404, breaking the automated recovery mechanism completely.
* **The Fix:** Transition to a GitOps-safe rollback strategy that commits a git revert or commits a configuration update to your infrastructure repository, rather than relying on workflow run reruns.

### B. In-Memory Cooldown Cache
In [rollbackEngine.ts](file:///home/ganeshak11/dev/Fortis/Fortis-CI/backend/src/services/rollbackEngine.ts#L11), service rollback cooldowns are tracked in an in-memory `Map`:
```typescript
const rollbackCooldowns = new Map<string, number>();
```
* **The Problem:** In production, if the backend container crashes, restarts, or runs behind a load balancer with multiple replicas, the in-memory cooldown state is instantly lost. This could allow multiple concurrent rollbacks to execute on the same service, causing system instability.
* **The Fix:** Persist cooldown states in the shared Redis cache layer.

---

## 2. Telemetry Ingestion Flaws
For services like `ticketflow` that send health logs to Fortis-CI, the server processes them synchronously:
* **The Problem:** If a large number of microservices report their health simultaneously, the 60-second health worker could encounter connection congestion or database lock contention in Neo4j.
* **The Fix:** Transition to a background job queue (e.g. BullMQ using Redis) to decouple incoming health webhooks from database writes.
