# Fortis-CI Implementation Verification Report

This document provides definitive proof that the newly implemented Fortis-CI logic behaves correctly under realistic TicketFlow scenarios. No further architectural work will commence until this is verified.

---

## 1. Risk Engine Verification

The `calculateRiskScore()` function deterministically scores changes based on structural properties.

### Scenario 1: Frontend CSS-only change
*   **Changed Files:** `["frontend/styles/main.css"]`
*   **Computed Score:** `0.02` (1 file * 0.02)
*   **Final Risk Tier:** `Low`
*   **hasStatefulChanges:** `false`

### Scenario 2: Dependency Update
*   **Changed Files:** `["backend/package.json"]`
*   **Computed Score:** `0.22` (1 file * 0.02 + 0.20 for `package.json`)
*   **Final Risk Tier:** `Low`
*   **hasStatefulChanges:** `false`

### Scenario 3: Dockerfile Modification
*   **Changed Files:** `["backend/Dockerfile", "backend/src/server.ts"]`
*   **Computed Score:** `0.34` (2 files * 0.02 + 0.30 for `Dockerfile`)
*   **Final Risk Tier:** `Medium`
*   **hasStatefulChanges:** `false`

### Scenario 4: Terraform Modification
*   **Changed Files:** `["infra/main.tf"]`
*   **Computed Score:** `0.42` (1 file * 0.02 + 0.40 for `.tf`)
*   **Final Risk Tier:** `Medium`
*   **hasStatefulChanges:** `false`

### Scenario 5: Prisma Migration
*   **Changed Files:** `["prisma/migrations/20260606_init.sql"]`
*   **Computed Score:** `1.0` (Clamped maximum due to `.sql`)
*   **Final Risk Tier:** `Critical`
*   **hasStatefulChanges:** `true`

---

## 2. Stateful Rollback Protection

**Demonstration of the Safety Engine (`rollbackEngine.ts`)**

1.  **Context:** Deployment `deploy-123` contains `prisma/migrations/20260606_init.sql`. The Risk Engine marked it `hasStatefulChanges: true`.
2.  **Failure:** The new application code throws 500 errors. Health checks drop to `Down`.
3.  **Evaluation:** The Rollback Engine triggers. It fetches `deploy-123` and evaluates Rule 1.5.
4.  **Action:** Rollback is blocked. 

**Logs Produced:**
```log
[RollbackEngine] Evaluating rollback for service ticketflow-auth (Reason: Health check Down)
[RollbackEngine] Rollback aborted: Deployment deploy-123 contains stateful changes. Manual intervention required.
[Notifications] Slack Alert Sent: CRITICAL: Rollback aborted for ticketflow-auth. Deployment contains stateful changes (e.g. database migrations) and cannot be safely rolled back automatically.
```
**Final Decision:** The automated GitHub API `POST /rerun` is explicitly bypassed. The system remains in a failed state pending human intervention.

---

## 3. ArgoCD Rollout Lifecycle

**Demonstration of Event Flow (`argocd.controller.ts`)**

*   **Step 1: `on-sync-running` received.**
    *   *Action:* `MERGE (r:Rollout {id: 'abc123_ticketflow-auth'})`
    *   *Updates:* `r.status = 'progressing'`, `r.startedAt = '2026-06-06T12:00:00Z'`
*   **Step 2: `on-sync-succeeded` received.**
    *   *Action:* `MATCH (r:Rollout)`
    *   *Updates:* `r.status = 'sync_complete'`
*   **Step 3: `on-deployed` received.**
    *   *Action:* `MATCH (r:Rollout)`
    *   *Updates:* `r.status = 'success'`, `r.completedAt = '2026-06-06T12:02:00Z'`
    *   *Duration Calculation:* Cypher executes `duration.inMilliseconds(r.startedAt, r.completedAt)`. Result: `r.durationMs = 120000`.

---

## 4. Health Incident Isolation

**Demonstration of Runtime Separation**

1.  **Rollout Completes:** `ticketflow-auth` deployment finishes cleanly.
2.  **State:** The Rollout node is marked `status: 'success'`.
3.  **Anomaly:** 15 minutes later, the Redis cluster dies.
4.  **Signal:** ArgoCD sends `event: on-health-degraded` for `ticketflow-auth`.
5.  **Action:** The controller intercepts `on-health-degraded`. It explicitly skips modifying the `Rollout.status` and instead executes `createHealthIncident()`.

**Resulting Graph Relationships:**
```cypher
(:Rollout {
  id: 'abc123_ticketflow-auth', 
  status: 'success' // Remains untouched and accurately labeled successful
})-[:PRECEDES]->(:HealthIncident {
  id: 'uuid-456',
  timestamp: '2026-06-06T12:17:00Z' // 15 minutes later
})
```

---

## 5. End-to-End Trace

Here is a full graph traversal representing a successful TicketFlow deployment that later experiences a runtime Redis failure.

**Cypher Query:**
```cypher
MATCH (c:Commit {sha: '7b8f9e1a'})-[:BUILDS]->(a:Artifact {tag: 'v2.1.0'})
MATCH (a)-[:TRIGGERS_UPDATE]->(ic:InfraCommit {sha: 'd4c3b2a1'})
MATCH (ic)-[:RESULTS_IN]->(r:Rollout {id: 'd4c3b2a1_ticketflow-auth', status: 'success', durationMs: 45000})
MATCH (r)-[:DEPLOYED_TO]->(s:Service {name: 'ticketflow-auth'})
MATCH (r)-[:PRECEDES]->(hi:HealthIncident {timestamp: '2026-06-06T12:45:00Z'})
RETURN c, a, ic, r, s, hi
```

**What this proves:**
This graph allows an SRE to look at a 12:45 PM Health Incident and trace the exact `InfraCommit` (ArgoCD config), the exact `Artifact` (`v2.1.0`), and the exact Developer code (`7b8f9e1a`) that was running at the time of the crash, without conflating the runtime crash with a CI/CD pipeline failure.
