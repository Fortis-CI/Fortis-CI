# The Complete Lifecycle of Fortis-CI (End-to-End)

## Phase 1: Installation (Day 0, ~15 minutes)

**Step 1 — Download & Boot**
The DevOps engineer downloads the release tarball and starts the stack:
```bash
curl -sSL https://get.fortis-ci.io | bash
cd fortis
cp .env.example .env
# Fill in: GitHub Token, Webhook Secret, OAuth credentials, SMTP, Slack URL
docker compose up -d
```
Four containers come up: **Neo4j**, **Redis**, **Backend API**, **Next.js Dashboard**.

**Step 2 — Login**
Engineer opens `http://fortis.internal:3000`, logs in via GitHub OAuth. Dashboard is empty — no services registered yet.

**Step 3 — Register Services**
Engineer creates a `fortis-services.yml`:
```yaml
services:
  - name: payment-service
    repo: https://github.com/acme/payment-service
    health_url: http://payment-svc.internal:8080/health
    environment: production
    dependencies: [auth-service, postgres]

  - name: auth-service
    repo: https://github.com/acme/auth-service
    health_url: http://auth-svc.internal:8081/health
    environment: production
    dependencies: [postgres]
```
Runs: `fortis import --file fortis-services.yml`

Neo4j now has 2 `Service` nodes connected by `DEPENDS_ON` relationships.

**Step 4 — Add GitHub Webhook**
Engineer goes to GitHub Org Settings → Webhooks → adds one webhook:
- URL: `http://fortis.internal:3001/webhooks/github`
- Secret: matches `GITHUB_WEBHOOK_SECRET` in `.env`
- Events: `Workflow runs`

Done. All repos in the org are now connected.

---

## Phase 2: Health Monitoring Starts (T+0 seconds, Automatic)

The moment services are registered, the **Health Worker** wakes up. No deployment needed.

Every **60 seconds**, it does this:
```
For each registered service:
  1. HTTP GET http://payment-svc.internal:8080/health
  2. Measure response time
  3. Create HealthCheck node in Neo4j:
     - status: "healthy" (200, <500ms) / "degraded" (200, >500ms) / "down" (timeout/error)
     - response_ms: 120
     - status_code: 200
  4. Cache result in Redis (key: health:payment-service, TTL: 90s)
```

Dashboard immediately shows: 🟢 payment-service | 🟢 auth-service

---

## Phase 3: A Developer Pushes Code (T+? hours)

A developer modifies `src/config/database.ts` (accidentally breaks the DB connection string) and pushes to `main`. GitHub Actions triggers.

**What GitHub Actions does:**
1. Builds the code
2. Runs tests (which pass — the test uses a mock DB)
3. Deploys to production
4. Marks the workflow as `completed` with conclusion `success`
5. Fires a webhook to Fortis

---

## Phase 4: Webhook Ingestion (T+0 seconds after deploy)

Fortis receives the webhook at `POST /webhooks/github`:

```
Step 1: Verify HMAC-SHA256 signature → ✅ valid
Step 2: Extract repository.full_name → "acme/payment-service"
Step 3: Query Neo4j: MATCH (s:Service {repo_url: "acme/payment-service"}) → found!
Step 4: Check workflow_run_id uniqueness → new, not a duplicate
Step 5: Create nodes in Neo4j:
```

**Neo4j graph after this step:**
```
(payment-service) ←[:DEPLOYED_TO]— (Deployment #47)
                                        │
                                   [:BASED_ON]
                                        ↓
                                   (Commit abc123)
                                        │
                                   [:CHANGED_FILE]
                                        ↓
                                (src/config/database.ts)
```

**Step 6: Calculate Risk Score**
```
Layer 1 (Heuristic):
  - 1 file changed: +0.02
  - File matches "config/" regex: +0.20
  - It's Friday 4pm: +0.10
  - Total: 0.32 → 🟡 Medium Risk
```

**Step 7: Link to previous deployment**
```
(Deployment #46) —[:SUCCEEDED_BY]→ (Deployment #47)
```

**Step 8: Trigger async LogFetchJob** (enqueued immediately after webhook processing; runs asynchronously and independently of rollback — RCA and rollback proceed in parallel)

---

## Phase 5: The App Crashes (T+1 minute)

The new code deploys. The app tries to connect to the database with the broken connection string. It fails.

**Health Worker detects the crash:**
```
T+1 min:  GET /health → 500 Internal Server Error  → HealthCheck { status: "down" }  ← Strike 1
T+2 min:  GET /health → Connection Refused          → HealthCheck { status: "down" }  ← Strike 2
T+3 min:  GET /health → Connection Refused          → HealthCheck { status: "down" }  ← Strike 3 🔴
```

Dashboard shows: 🔴 payment-service DOWN

---

## Phase 6: Auto-Rollback Engine Fires (T+3 minutes)

Three consecutive `down` checks triggers the rollback engine (**Tier 1 — Health-only**).

**Step 1: Find rollback target**
```cypher
MATCH (failing:Deployment {id: "deploy-47"})-[:DEPLOYED_TO]->(svc:Service)
MATCH (prev:Deployment)-[:DEPLOYED_TO]->(svc)
MATCH (prev)-[:SUCCEEDED_BY*]->(failing)   // traverse timeline chain only
WHERE prev.status = 'success'               // excludes rolled_back, failed
WITH prev ORDER BY prev.completed_at DESC LIMIT 1
RETURN prev
→ Returns: Deployment #46 ✅
```

**Step 2: Create rollback graph**
```
(Deployment #47) —[:TRIGGERED]→ (RollbackEvent)
                                      │
                               [:ROLLED_BACK_TO]
                                      ↓
                               (Deployment #46)

(Deployment #47) —[:REPLACED_BY]→ (Deployment #46)   // audit trail only
```

**Step 3: Execute rollback**
```
POST https://api.github.com/repos/acme/payment-service/actions/runs/{deploy-46-run-id}/rerun
```
GitHub re-runs the last successful workflow. The old, working code deploys.

**Step 4: Update status**
```
Deployment #47: status → "rolled_back"
```

> **Safety:** Auto-rollback is now on **15-minute cooldown** for `payment-service`. If the re-run of Deployment #46 itself fails, the service is marked `needs_manual_intervention` — Fortis-CI will NOT trigger another rollback.

---

## Phase 7: Root Cause Analysis (T+3 to T+5 minutes, parallel with rollback)

The **LogFetchJob** was enqueued immediately after webhook processing (Phase 4, Step 8) and runs asynchronously, independent of the rollback engine:

```
Step 1: GET /repos/acme/payment-service/actions/runs/{run-id}/logs
Step 2: GitHub returns 302 redirect → signed zip URL
Step 3: Download zip into memory (skip entries >5MB)
Step 4: Unzip → iterate per-job log files (max 10,000 lines each)
Step 5: Run regex patterns against each line:

  Line 4,217: "Error: connect ECONNREFUSED 127.0.0.1:5432"
    → Matches pattern: DB Connection (severity: critical)
    → Count: 15 occurrences

Step 6: Create ErrorPattern node in Neo4j:
  (:ErrorPattern {
    type: "connection_error",
    message: "connect ECONNREFUSED 127.0.0.1:5432",
    count: 15,
    severity: "critical"
  })

Step 7: Link to deployment:
  (Deployment #47) —[:CAUSED_ERROR {confidence: 0.87}]→ (ErrorPattern)

Step 8: Correlate error to code:
  (ErrorPattern) —[:RELATED_TO_FILE]→ (src/config/database.ts)
  ↑ This file was also in the [:CHANGED_FILE] relationship!

Step 9: Update RCA status:
  Deployment #47: rca_status → "complete"
```

**Final RCA Output:**
```
Root Cause Analysis — Deployment #47

Status:      complete
Confidence:  87%
Recommendation: ROLLBACK (already executed)

🔴 Critical (15 occurrences):
  "connect ECONNREFUSED 127.0.0.1:5432"
  First seen: 3:16pm (1 min after deployment)
  Related file: src/config/database.ts  ← CHANGED in this deployment

Git Diff Summary:
  Modified: src/config/database.ts (+3, -1)

Suggested Action:
  Check DATABASE_URL in your deployment environment.
  Rollback target: Deployment #46 (last healthy, 3:05pm) ✅ Already rolled back
```

---

## Phase 8: Notifications Fire (T+3 minutes)

Three channels receive the alert simultaneously:

**1. GitHub PR Comment:**
```
🔴 AUTO-ROLLBACK TRIGGERED — payment-service

Failing: v1.4.2 (commit abc123)
Target:  v1.4.1 (commit def456)
Reason:  3 consecutive health check failures

Root Cause: "connect ECONNREFUSED 127.0.0.1:5432" (15x)
Related:    src/config/database.ts

Dashboard: https://fortis.internal/deployments/47
```

**2. Slack** — Same content, formatted as Block Kit message with 🔴 color coding.

**3. Email** — HTML formatted to `devops@acme.com`.

---

## Phase 9: Recovery Confirmed (T+5 to T+8 minutes)

The re-run of Deployment #46's workflow completes. The old code is deployed.

```
T+6 min: GET /health → 200 OK (120ms) → HealthCheck { status: "healthy" } ✅
T+7 min: GET /health → 200 OK (95ms)  → HealthCheck { status: "healthy" } ✅
T+8 min: GET /health → 200 OK (110ms) → HealthCheck { status: "healthy" } ✅
```

Dashboard shows: 🟢 payment-service HEALTHY

---

## Phase 10: The Morning After (Next Day)

The developer comes in, opens Fortis dashboard, and sees:

1. **Deployment Timeline:** #46 (✅) → #47 (🔴 rolled back) → #46 re-run (✅)
2. **RCA Panel:** "Connection refused on port 5432" linked to `database.ts`
3. **Comparison View:** Side-by-side diff of #46 vs #47 showing exactly what changed
4. **Risk History:** `database.ts` now has a failure count of 1 — future deploys touching this file will have a higher risk score

The developer fixes the connection string, pushes again. This time Fortis scores it 🟡 Medium Risk (because `database.ts` now has failure history). The deploy succeeds. Health stays green. No rollback needed.

---

## The Complete Graph After This Lifecycle:
```
(auth-service) ←[:DEPENDS_ON]— (payment-service) ←[:DEPLOYED_TO]— (Deploy #46) —[:SUCCEEDED_BY]→ (Deploy #47)
                                                                        ↑                              │
                                                                   [:ROLLED_BACK_TO]              [:CAUSED_ERROR]
                                                                        │                              ↓
                                                                  (RollbackEvent) ←[:TRIGGERED]   (ErrorPattern)
                                                                                                       │
                                                                                                [:RELATED_TO_FILE]
                                                                                                       ↓
                                                                      (Commit abc123) —[:CHANGED_FILE]→ (database.ts)
```
