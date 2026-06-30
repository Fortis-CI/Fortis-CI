# Fortis-CI — Product Requirements Document

![Version](https://img.shields.io/badge/version-v1.0.0-blueviolet)
![Type](https://img.shields.io/badge/type-Self--Hosted%20OSS%20DevOps%20Tool-green)
![Status](https://img.shields.io/badge/status-In%20Development-yellow)
![Database](https://img.shields.io/badge/database-Neo4j%20Graph-blue)

---

## 1. Product Vision

**Fortis-CI** is a **self-hosted, open-source intelligent deployment observability platform** powered by a Neo4j graph database.

It runs alongside a team's existing application stack, connects to GitHub Actions via webhooks, and provides:

- Real-time deployment graph visibility
- Graph-based root cause analysis (RCA)
- Automated rollback with health-triggered detection
- Deployment risk scoring
- Multi-channel alert notifications

> **Core Mental Model:**
> Deployment failures are a graph problem — not a table problem.
> Fortis-CI models the entire deployment lifecycle as a connected graph:
> services, deployments, commits, files, errors, and health checks are nodes.
> The relationships between them are the intelligence.

### What It Is NOT

| Not competing with | Why |
|---|---|
| Datadog / New Relic | Full observability platforms (metrics, traces, APM) |
| ArgoCD / Spinnaker | Kubernetes GitOps / enterprise deployment orchestration |
| Vault / Doppler | Secret management platforms |
| Prometheus / Grafana | General metrics collection and dashboarding |

### What It Solves

| Problem | Fortis-CI's Answer |
|---|---|
| "What broke?" panic after deployment | Graph traversal: error → file → commit → deployment |
| Manual rollback risk | Automated rollback with last-healthy-deployment graph query |
| Hours of log analysis | Rule-based error pattern detection with confidence scores |
| Config drift between environments | Environment snapshot comparison via graph |
| Risky rollbacks without preview | Impact preview before rollback confirmation |
| Deployment risk unknown before push | Historical risk scoring from graph failure patterns |

---

## 2. Deployment Model

**Fortis-CI is self-hosted.** Each team deploys their own private instance inside their own cloud infrastructure.

```
[Customer Cloud]
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ┌─────────────────┐     ┌────────────────────┐     │
│   │  Their Apps /   │     │  Fortis-CI    │     │
│   │  Microservices  │◄────│  (Docker Compose)  │     │
│   └─────────────────┘     │                    │     │
│                           │  Neo4j + Redis     │     │
│   ┌─────────────────┐     │  Backend API       │     │
│   │  GitHub Actions │────►│  Next.js Dashboard │     │
│   │  (Webhooks)     │     └────────────────────┘     │
│   └─────────────────┘                                │
└──────────────────────────────────────────────────────┘
```

### Why Self-Hosted?

- **Data sovereignty** — CI/CD data (commits, secrets snapshots, pipeline history) stays in the customer's cloud
- **Security** — no third party touches CI/CD infrastructure
- **Compliance** — customer manages their own data retention and regulatory requirements
- **Scale** — each instance scales independently; no multi-tenant complexity
- **Trust** — DevOps engineers audit what they run

### Centralized Architecture for Microservices

> **Critical Design Decision:** Fortis-CI is deployed as a **single centralized instance per environment** — NOT as a sidecar per microservice.

In a company running 50 microservices across 50 GitHub repositories, you do NOT deploy 50 Fortis-CI instances. You deploy **one** Fortis-CI that ingests webhooks from all 50 repos into a single Neo4j graph.

**Why centralized?** If each microservice had its own Fortis-CI with its own isolated Neo4j, the `DEPENDS_ON` relationships between services would be impossible to model. The entire blast radius analysis and cross-service RCA would break. A single graph is the whole point.

```
┌─────────────────────────────────────────────────────────────┐
│                     Customer VPC                            │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ auth-svc │  │ pay-svc  │  │ notif-svc│  (50 services)    │
│  │ repo #1  │  │ repo #2  │  │ repo #3  │                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │
│       │             │             │                          │
│       │  GitHub Org-Level Webhook (single URL)               │
│       └─────────────┼─────────────┘                          │
│                     ▼                                        │
│           ┌─────────────────────┐                            │
│           │   Fortis-CI    │                            │
│           │   (One Instance)    │                            │
│           │                     │                            │
│           │  Neo4j: ALL 50      │                            │
│           │  services in ONE    │                            │
│           │  connected graph    │                            │
│           └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

**Webhook-to-Service Matching (Supports Both Microservice & Monorepo):**

Fortis-CI supports two repository architectures:

**Microservice repos (1 repo = 1 service):**
1. Webhook arrives → extract `repository.full_name` (e.g., `your-org/payment-service`)
2. Fortis-CI queries Neo4j: `MATCH (s:Service {repo_url: $repoUrl}) RETURN s`
3. Exactly one `Service` matches → create `Deployment` node for that service
4. If no match → repo is not tracked; return `200 OK`, skip processing

**Monorepo (1 repo = N services):**
1. Webhook arrives → extract `repository.full_name` (e.g., `your-org/main-platform`)
2. Fortis-CI finds **multiple** `Service` nodes registered to that repo
3. Fortis-CI calls GitHub API: `GET /repos/{owner}/{repo}/commits/{sha}` to get the list of files changed in the commit
4. For each registered service, Fortis-CI matches changed file paths against the service's `path_filter` (glob pattern, e.g., `services/payment/**`)
5. Only services whose `path_filter` matches at least one changed file get a new `Deployment` node
6. Services whose paths were NOT touched are skipped — no false deployments

```yaml
# Monorepo registration example
services:
  - name: auth-service
    repo: https://github.com/org/main-platform
    path_filter: "services/auth/**"          # ← only triggers on auth changes
    health_url: http://auth-svc.internal:8080/health

  - name: payment-service
    repo: https://github.com/org/main-platform
    path_filter: "services/payment/**"       # ← only triggers on payment changes
    health_url: http://payment-svc.internal:8081/health
```

> **path_filter behavior:** If `path_filter` is empty or not set, the service matches ALL webhooks from that repo (standard microservice behavior). If set, it acts as a glob filter against the commit's changed files.

**GitHub Organization-Level Webhooks:**

Instead of adding the Fortis-CI webhook URL to each of the 50 repositories individually, DevOps teams can add it **once** at the GitHub Organization level (`Settings → Webhooks`). GitHub will then forward `workflow_run` events from **all** repositories in the organization to Fortis-CI. Fortis-CI filters and processes only the repos that are registered in its Service Registry.

### Business Model (Phased)

| Phase | Model | Features |
|---|---|---|
| **Phase 1** | Open Source Core (Apache 2.0) | Full deployment tracking, health monitoring, RCA, rollback |
| **Phase 2** | Enterprise Edition (License Key) | RBAC, SSO (SAML/OIDC), audit logs, advanced graph analytics |
| **Phase 3** | Fortis-CI Cloud (Managed SaaS) | We host it for teams who prefer not to self-host |

**Enterprise License Enforcement:**
On startup, if `SENTINEL_LICENSE_KEY` is set, the backend validates it against `license.fortis-ci.io`. Enterprise features are gated behind this check. If the key is absent or invalid, the system runs in full OSS mode — no core functionality is disabled.

---

## 3. Problem Statement

Modern Fortis-CI pipelines automate build and deployment but leave engineers blind after the deployment fires:

- **No unified visibility** — logs, metrics, deployment state, and config spread across GitHub, hosting dashboards, and monitoring tools
- **Relational data cannot express failure chains** — traditional SQL requires complex JOINs to answer "what caused this failure?" Neo4j makes this a single graph traversal
- **Manual rollbacks are risky** — engineers manually identify safe rollback targets, often under pressure at 3am
- **MTTR is high** — correlating a code change to a runtime failure requires switching between 4–5 tools
- **No pre-deployment intelligence** — teams have no signal about deployment risk before pushing

---

## 4. Why Neo4j (The Core Technical Decision)

The fundamental insight driving this platform:

> **Deployment failures are a graph problem.**

Consider this failure chain:
```
Deployment #47 (failed)
  └─ Based on Commit abc123
       └─ Changed File: src/config/database.ts
            └─ Caused Error: "Connection refused on port 5432" (15x)
                 └─ Related to: Previous working Deployment #46
```

In PostgreSQL, answering this requires 4 JOINs across 4 tables.
In Neo4j, this is one Cypher traversal:

```cypher
MATCH (d:Deployment {id: $id})-[:CAUSED_ERROR]->(e:ErrorPattern)
MATCH (d)-[:BASED_ON]->(c:Commit)-[:CHANGED_FILE]->(f:File)
WHERE e.severity = 'critical'
RETURN d, e, f, c
```

This enables capabilities impossible to build cleanly in a relational model:

| Capability | Why Graph |
|---|---|
| Automated rollback target | Graph query: last healthy deployment before failure |
| File-level risk scoring | Aggregate: files appearing in failed deployment chains |
| Blast radius analysis | Graph traversal: `DEPENDS_ON` relationships between services |
| Deployment chain timeline | Linked list: `SUCCEEDED_BY` relationships |
| Error-to-code correlation | Direct edge: `ErrorPattern`-[`RELATED_TO_FILE`]→`File` |

---

## 5. Target Users

### Primary Users
- DevOps engineers at small-to-mid engineering teams
- Backend developers who own their deployment pipelines
- Platform engineers building internal tooling
- Student and indie teams deploying production services

### User Characteristics
- Use GitHub for version control and CI/CD (GitHub Actions)
- Deploy via Docker, Render, Railway, Fly.io, or self-managed VMs
- Need fast post-deployment debugging without enterprise budgets
- Willing to self-host in exchange for data ownership and privacy

---

## 6. User Stories

| # | Role | Goal | Benefit |
|---|---|---|---|
| US-01 | Developer | View graph of deployment chain for a failed build | Understand what changed and what it affected |
| US-02 | Developer | See automated RCA for a failed deployment | Identify root cause without log diving |
| US-03 | On-call engineer | Trigger automated rollback to last healthy version | Recover in < 60 seconds at 3am |
| US-04 | Developer | Preview rollback impact before confirming | Avoid rolling back to another broken version |
| US-05 | DevOps engineer | Get alerts (Slack + Email + GitHub PR) when rollback fires | Full visibility without watching dashboard |
| US-06 | Developer | View health trends correlated with deployments | See "deploy at 3pm → latency spiked at 3:01pm" |
| US-07 | Developer | View deployment risk score before a push | Know if a large commit to a critical file is risky |
| US-08 | Developer | Compare working vs broken deployment side by side | Pinpoint the exact change that broke production |
| US-09 | Team lead | View historical file-level failure patterns | Know which parts of the codebase are fragile |
| US-10 | Developer | Check environment drift between GitHub Secrets and running config | Catch config mismatches before they cause failures |

---

## 7. Functional Requirements

### 7.1 Webhook Ingestion (Idempotent)

The system must:
- Receive GitHub Actions `workflow_run` webhook events
- Verify webhook signature (`X-Hub-Signature-256`)
- Check `workflow_run_id` uniqueness **before** writing (idempotency constraint in Neo4j)
- If duplicate webhook arrives → return `200 OK`, skip processing
- On valid new event → create `Deployment` and `Commit` nodes, link to `Service`

**Captured per webhook:**
- `workflow_run_id` (idempotency key)
- `delivery_id` (GitHub header)
- Repository name
- Commit SHA, message, author, branch
- Build status (`success` / `failure` / `in_progress`)
- Deployment timestamp
- Triggered by (GitHub actor)

> **Missed Webhook Recovery (V2+):** GitHub webhooks can fail to deliver (network timeout, Fortis-CI downtime). The idempotency key (`workflow_run_id`) handles duplicates, but missed deliveries result in invisible deployments. A reconciliation job (`ReconcileJob`) is planned for V2+: it runs hourly, polls `GET /repos/{owner}/{repo}/actions/runs`, and backfills any `workflow_run_id` values not present in Neo4j. This is not part of V1 scope.

---

### 7.2 Graph Data Model

#### Nodes

| Node | Key Properties | Description |
|---|---|---|
| `Service` | id, name, repo_url, path_filter, health_endpoint, environment | A tracked microservice or application. `path_filter` is a glob pattern for monorepo support (e.g., `services/payment/**`). If empty, matches all webhooks from the repo. |
| `Deployment` | id, workflow_run_id (UNIQUE), version, commit_sha, status, completed_at, webhook_received_at, risk_score | A pipeline execution. Stores both timestamps — rollback window uses `completed_at`. |
| `Commit` | sha (UNIQUE), message, author, branch, additions, deletions, files_changed | Git commit metadata |
| `File` | path, language, change_type | A file modified in a commit |
| `ErrorPattern` | id, type, message, count, severity, first_seen | Detected failure pattern — created by async LogFetchJob, NOT at webhook ingest time |
| `HealthCheck` | id, status, response_ms, status_code, checked_at | Point-in-time health snapshot |
| `EnvSnapshot` | id, environment, key, synced_at | GitHub Secrets key name only — values are never available via GitHub API |
| `RollbackEvent` | id, triggered_by, trigger_type, reason, timestamp, outcome | Rollback action record |

#### Relationships

| Relationship | Direction | Properties | Meaning |
|---|---|---|---|
| `DEPLOYED_TO` | Deployment → Service | timestamp | Deployment targets a service |
| `BASED_ON` | Deployment → Commit | — | Deployment built from commit |
| `CHANGED_FILE` | Commit → File | additions, deletions | Commit modified file |
| `CAUSED_ERROR` | Deployment → ErrorPattern | confidence (float) | Error detected post-log-fetch (async, not at ingest) |
| `RELATED_TO_FILE` | ErrorPattern → File | — | Error correlated with code change |
| `HAS_HEALTH` | Deployment → HealthCheck | — | Health snapshot linked to deployment |
| `SUCCEEDED_BY` | Deployment → Deployment | — | Normal timeline chain (used in rollback target queries) |
| `ROLLED_BACK_TO` | RollbackEvent → Deployment | reason | Target of rollback |
| `TRIGGERED` | Deployment → RollbackEvent | — | Auto-rollback link |
| `REPLACED_BY` | Deployment → Deployment | — | Audit trail only — post-rollback state. Never traversed in rollback target queries. |
| `BELONGS_TO` | File → Service | — | File is part of service |
| `SNAPSHOT_FOR` | EnvSnapshot → Service | — | Secret key presence record for service |
| `DEPENDS_ON` | Service → Service | — | Service dependency (blast radius) |

> **SUCCEEDED_BY vs REPLACED_BY — Query Rule:**
> Rollback target queries (Q1) traverse only `SUCCEEDED_BY` chains and filter `WHERE prev.status = 'success'`.
> This automatically excludes `rolled_back` status deployments.
> `REPLACED_BY` is write-only — created for audit trail, never read in traversal.

**Rollback Scenario — Edge Distinction:**
```
  Deploy #45 (✅ success)
      │
  [SUCCEEDED_BY]        ← timeline chain (traversed in rollback queries)
      ↓
  Deploy #46 (✅ success)
      │
  [SUCCEEDED_BY]        ← timeline chain (traversed in rollback queries)
      ↓
  Deploy #47 (🔴 failed)  ──[REPLACED_BY]──→  Deploy #46   ← audit only, NEVER traversed
      │
  [TRIGGERED]
      ↓
  RollbackEvent  ──[ROLLED_BACK_TO]──→  Deploy #46
```

> ⚠️ **WARNING:** `REPLACED_BY` is **write-only**. Never traverse `REPLACED_BY` in rollback target queries. Only `SUCCEEDED_BY` chains are followed. Traversing `REPLACED_BY` would include already-rolled-back deployments as candidates, creating infinite rollback loops.

---

### 7.3 Health Monitoring

The system must:
- Run a background worker every **60 seconds**
- Poll `GET /health` for all registered services
- Create a `HealthCheck` node linked to the latest `Deployment` via `HAS_HEALTH`
- Store: status, response_ms, status_code, checked_at
- Cache last N results in Redis for fast dashboard queries
- Update service health state in graph

**Health States:**

| State | Indicator | Condition |
|---|---|---|
| Healthy | 🟢 | `200` response, < 500ms |
| Degraded | 🟡 | `200` response, 500ms – 2s |
| Down | 🔴 | Timeout, non-200, or error |

**Health Check Timing Guarantees:**
- Individual health check timeout: **10 seconds** (per request)
- If the full polling cycle across all services exceeds 60s: log a `WARN`, skip the next cycle rather than overlapping
- At >50 services, the synchronous `p-limit` worker should be replaced with a distributed task queue (BullMQ)

---

### 7.4 Automated Rollback Engine

**Trigger conditions — Two-Tier System:**

| Tier | Trigger | Latency | Reliability |
|---|---|---|---|
| **Tier 1 — Health-only** | 3 consecutive `down` health checks after deployment | ~2 min (60s × 3) | High — no log dependency |
| **Tier 1 — Health-only** | `degraded` persisting > 5 min post-deployment | ~5 min | High |
| **Tier 2 — Error-correlated** | Critical error count > 10 within 5 min of deployment | Depends on log fetch | Lower — requires log pipeline |

Tier 2 is supplemental — it adds error context to the rollback notification but does NOT block Tier 1. If logs haven't been fetched yet, Tier 1 fires independently based on health alone.

> **Timing note:** The rollback window clock starts from `deployment.completed_at` — the timestamp GitHub marks the workflow as `completed`. This is stored separately from `webhook_received_at` (when Fortis-CI received the event). A 5-minute build means these can differ by up to 5 minutes.

**Rollback Algorithm:**
```
1. Detect trigger condition via health worker
2. Graph query → find last healthy deployment before failure:
   MATCH (failing:Deployment {id: $id})-[:DEPLOYED_TO]->(svc:Service)
   MATCH (prev:Deployment)-[:DEPLOYED_TO]->(svc)
   MATCH (prev)-[:SUCCEEDED_BY*]->(failing)   // traverse timeline chain only
   WHERE prev.status = 'success'               // excludes rolled_back, failed
   WITH prev ORDER BY prev.completed_at DESC LIMIT 1
   RETURN prev
3. If found:
   a. Create RollbackEvent node
   b. Link: failing_deployment -[:TRIGGERED]-> RollbackEvent
   c. Link: RollbackEvent -[:ROLLED_BACK_TO]-> target_deployment
   d. Link: failing_deployment -[:REPLACED_BY]-> target_deployment  // audit only
   e. Call GitHub Actions Re-run API: POST /repos/{owner}/{repo}/actions/runs/{prev.workflow_run_id}/rerun
      (This re-runs the exact successful workflow without requiring workflow file changes)
   f. Send notifications (GitHub PR comment + Slack + Email)
   g. Update failing deployment status to "rolled_back"
4. If NOT found (no clean prior deployment):
   a. Alert all channels: "Manual intervention required — no safe rollback target"
   b. Mark service: "needs_manual_intervention"
   c. Do NOT auto-rollback
```

> **Advanced Rollback Mode — `workflow_dispatch` (V3+):**
>
> If teams prefer deploying a specific SHA rather than re-running a past job, they can configure `rollback_strategy: 'workflow_dispatch'` on their service. This requires the target repo to have a workflow file that accepts inputs from Fortis-CI.
>
> **Example workflow file (`.github/workflows/fortis-rollback.yml`):**
> ```yaml
> name: Fortis-CI Rollback Deploy
> on:
>   workflow_dispatch:
>     inputs:
>       commit_sha:
>         description: 'Commit SHA to deploy'
>         required: true
>       triggered_by:
>         description: 'Who triggered this rollback'
>         required: true
>         default: 'fortis-ci-auto'
>       reason:
>         description: 'Rollback reason'
>         required: false
>
> jobs:
>   deploy:
>     runs-on: ubuntu-latest
>     steps:
>       - uses: actions/checkout@v4
>         with:
>           ref: ${{ github.event.inputs.commit_sha }}
>       - name: Deploy
>         run: |
>           echo "Rolling back to ${{ github.event.inputs.commit_sha }}"
>           echo "Triggered by: ${{ github.event.inputs.triggered_by }}"
>           # Your deployment script here
> ```
>
> **Fortis-CI dispatch payload:**
> ```json
> POST /repos/{owner}/{repo}/actions/workflows/fortis-rollback.yml/dispatches
> {
>   "ref": "main",
>   "inputs": {
>     "commit_sha": "abc123def",
>     "triggered_by": "fortis-ci-auto",
>     "reason": "3 consecutive health check failures"
>   }
> }
> ```
>
> Full spec and production-ready workflow examples will be provided in V3 documentation.

**Manual Rollback:**
User can also trigger rollback from the dashboard with a preview step showing what will change.

**Rollback Safety — Circuit Breaker:**

| Rule | Behavior |
|---|---|
| **Cooldown** | After auto-rollback triggers for a service, disable auto-rollback for that service for **15 minutes** |
| **Rollback failure** | If the rollback re-run itself fails, set service status to `needs_manual_intervention` — do NOT trigger another rollback |
| **Max depth** | Maximum rollback depth is **1** — never chain rollbacks (rollback of a rollback is not allowed) |
| **Manual override** | Manual rollback from the dashboard is always available, even during cooldown |

---

### 7.5 Root Cause Analysis Engine (Rule-Based)

The system must analyze deployment logs and correlate errors to code changes using a rule-based pattern engine.

#### Log Fetch Pipeline (Async — Critical Implementation Detail)

`ErrorPattern` nodes are **NOT created at webhook ingest time.** They require GitHub Actions logs, which must be fetched separately.

**Log fetch flow:**
```
1. Webhook received → Deployment node created (status: in_progress / success / failed)
2. Async LogFetchJob triggered (immediately after webhook processing completes)
3. Job calls: GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs
   → GitHub returns 302 redirect to a signed zip URL (not raw text)
4. Job follows redirect → downloads zip file into memory
5. Job unzips → iterates per-job log text files inside the zip
6. Applies guardrails to prevent OOM on large monorepo logs:
   - Skip individual zip entries > 5 MB
   - Process only first 10,000 lines per log file
   - Abort entire fetch job if processing exceeds 60 seconds
7. Job runs regex patterns against each processed log line
8. Matching patterns → CREATE ErrorPattern nodes + CAUSED_ERROR relationships
9. Job stores raw log lines in Neo4j (capped at 500, 7-day retention)
10. RCA status on Deployment node updated: pending → complete
```

**Rate limiting:** GitHub Actions log API counts against the token's 5,000 req/hr limit. Fetch runs once per deployment, not on every dashboard view.

**RCA status field on Deployment:**
- `rca_status: 'pending'` — log fetch not yet complete
- `rca_status: 'complete'` — ErrorPatterns populated
- `rca_status: 'unavailable'` — log fetch failed (API error, rate limit)

**LogFetchJob Error Handling:**

| Error | Action |
|---|---|
| **404** (workflow deleted) | Mark `rca_status: 'unavailable'` immediately, no retry |
| **429** (rate limited) | Exponential backoff: 30s → 60s → 120s, max 3 retries |
| **5xx** (server error) | Retry once after 30s |
| **Timeout** (>60s) | Abort, mark `rca_status: 'unavailable'` |
| **Zip corrupt / unreadable** | Mark `rca_status: 'unavailable'`, log error details |
| **All retries exhausted** | Mark `rca_status: 'unavailable'`, send warning to notification channels |

The dashboard shows a loading state while `rca_status = 'pending'`.

#### Error Pattern Rules

| Pattern Type | Detection Signal | Severity |
|---|---|---|
| DB Connection | `ECONNREFUSED`, `Connection refused`, `connect ETIMEDOUT` | Critical |
| API Timeout | `ETIMEDOUT`, `Request timeout`, `socket hang up` | Critical |
| Missing Env Var | `undefined is not defined`, `getenv.*not set` | Critical |
| Port Conflict | `EADDRINUSE`, `address already in use` | Critical |
| OOM | `JavaScript heap out of memory`, `OOMKilled` | Critical |
| Auth Failure | `401`, `403`, `Invalid credentials`, `Unauthorized` | Warning |
| DNS Failure | `ENOTFOUND`, `getaddrinfo ENOENT` | Warning |
| Slow Query | `slow query`, `query timeout` | Info |

**RCA Output:**
```
Root Cause Analysis — Deployment #47

Status:     complete
Confidence: 87%
Recommendation: ROLLBACK

🔴 Critical (15 occurrences):
  "Connection refused on port 5432"
  First seen: 3:16pm (1 min after deployment)
  Related file: src/config/database.ts  ← changed in this deployment

Git Diff Summary:
  Modified: src/config/database.ts (+3, -1)

Suggested Action:
  Check DATABASE_URL in your deployment environment.
  Rollback target: Deployment #46 (last healthy, 3:05pm)
```

> **Post-MVP:** LLM-assisted RCA (send error context + git diff to Gemini/OpenAI for natural language explanation). Deferred to avoid scope creep in V1.

---

### 7.6 Deployment Comparison

When a deployment fails, the system must show a side-by-side comparison with the last working deployment:

- Git diff: files changed, additions, deletions, line-by-line
- Health metric delta: response time, error rate, status change
- Environment snapshot diff: key/value changes between deployments
- Error patterns that appeared after the failed deployment
- Files that appear in both the diff AND the error correlation

**API:**
```
GET /api/deployments/:id/compare/:prevId
```

---

### 7.7 Deployment Risk Scoring

The system calculates a risk score (0.0 – 1.0) at webhook ingest time using a **two-layer approach** to handle the cold-start problem:

**Layer 1 — Baseline Heuristics (works on Day 0, no history needed):**
- Number of files changed: each file +0.02, **capped at 0.30**
- Diff size: additions + deletions > 200 lines → +0.15
- High-risk file path match (regex): `auth/`, `config/`, `database`, `schema`, `migration`, `.env` → +0.20 each, **capped at 0.40**
- Time of deployment: Friday 16:00–23:59 → +0.10, weekend → +0.05
- **Final Layer 1 score: clamped to max 1.0**

**Layer 2 — Graph-Enhanced (activates after 10+ deployments in history):**
- Historical failure rate of files changed (graph query Q3)
- Each file with > 2 prior failure appearances → +0.10 per file, **capped at 0.30**
- Recent failure pattern on same service → +0.10
- **Final combined score (Layer 1 + Layer 2): clamped to max 1.0**

**Worked Example (Layer 1):**
```
Commit touches 20 config files on a Friday at 5pm:
  File count:    20 × 0.02 = 0.40 → capped at 0.30
  High-risk:     20 × 0.20 = 4.00 → capped at 0.40
  Friday deploy: +0.10
  Layer 1 total: 0.30 + 0.40 + 0.10 = 0.80 → 🔴 High Risk
  (Without caps: 0.40 + 4.00 + 0.10 = 4.50 — well above 1.0)
```

**Cold-start behavior:** On a fresh Fortis-CI install, only Layer 1 runs. Scores are labeled `heuristic`. After 10 deployments, Layer 2 activates and scores are labeled `graph-enhanced`. This is shown as a badge in the UI.

**Risk Levels:**

| Score | Level | Badge |
|---|---|---|
| 0.0 – 0.3 | Low | 🟢 |
| 0.3 – 0.7 | Medium | 🟡 |
| 0.7 – 1.0 | High | 🔴 |

---

### 7.8 Environment Drift Detection

> **GitHub Secrets API Limitation:** The GitHub Secrets API (`GET /repos/{owner}/{repo}/actions/secrets`) returns **secret key names only** — it never returns values, even to authenticated callers. This is by design and cannot be worked around.

**What drift detection CAN detect (key-presence drift):**
- Keys added to GitHub Secrets since last snapshot
- Keys removed from GitHub Secrets since last snapshot

**What it CANNOT detect (value drift):**
- Whether the value of an existing key changed
- Whether the running container is using a stale value

**For value-drift detection (opt-in):** Services can expose a `GET /env-check` endpoint that returns non-sensitive env key names and a hash of their values. Fortis-CI compares hashes without ever seeing values. This is an opt-in contract — not required, not enforced.

**The system must:**
- Fetch GitHub Secrets key list via API after each deployment
- Create `EnvSnapshot` nodes (key names only, no values) linked to the deployment
- Compare key set against previous snapshot via graph query
- Highlight added/removed keys in the drift panel
- Show drift indicator in dashboard when key sets differ

**Security rules:**
- Never store secret values — key names only
- Never log secrets
- Never send secret values to frontend
- All secret values displayed as `***` everywhere
- The `/env-drift` endpoint requires JWT authentication (same as all `/api/*` endpoints)
- Key name exposure is an accepted, documented trade-off — key names (e.g., `STRIPE_PROD_SECRET_KEY`) may reveal which integrations exist, but this is necessary for drift detection to function
- Fine-grained RBAC on the `/env-drift` endpoint is deferred to V4 enterprise edition

---

### 7.9 Notification System (Three Channels)

All automated rollback events and critical alerts are sent to:

**1. GitHub PR Comment**
```
🔴 AUTO-ROLLBACK TRIGGERED — payment-service

Failing: v1.4.2 (commit abc123)
Target:  v1.4.1 (commit def456)
Reason:  3 consecutive health check failures

Root Cause: "Connection refused on port 5432" (15x)
Related:    src/config/database.ts

Dashboard: https://fortis-ci.your-company.com/deployments/abc123
```

**2. Slack Webhook**
Same content, formatted as Slack Block Kit message with color coding.

**3. Email (SMTP)**
HTML-formatted alert to `ALERT_EMAIL` with full RCA summary.

---

### 7.10 Dashboard (Next.js)

**Pages:**

| Page | Description |
|---|---|
| `/` | Main dashboard: active deployments, health status, risk indicators, recent alerts |
| `/deployments` | Full deployment history timeline |
| `/deployments/[id]` | Deployment detail + RCA panel + health correlation chart |
| `/deployments/[id]/compare` | Side-by-side comparison with previous deployment |
| `/graph` | Interactive Neo4j graph visualization of deployment chains |
| `/services` | Service registry: add, view, manage tracked services |
| `/rollback` | Rollback console: select target, preview impact, confirm |

**Key UI Components:**
- `DeploymentCard` — status badge, version, commit, risk score, quick actions
- `RCAPanel` — root cause analysis output with confidence meter
- `GraphVisualization` — interactive force-directed graph (react-force-graph)
- `RollbackConsole` — preview panel + confirm/cancel rollback
- `HealthTimeline` — response time chart correlated with deployment markers
- `EnvDriftBadge` — drift status with expandable diff view
- `ErrorPatternList` — categorized errors with severity and occurrence count
- `RiskIndicator` — color-coded risk badge with contributing factors

---

### 7.11 Logs Viewer

- Display last **500 log lines per deployment** (MVP scope)
- Filter by: timestamp, log level, keyword
- Log source: GitHub Actions workflow logs (fetched via API)
- Stored in Neo4j temporarily; 7-day retention

---

### 7.12 Service Registry & Onboarding Flow

To ensure Fortis-CI can correctly map GitHub webhooks to internal running services, teams must explicitly register their services in the Fortis-CI Dashboard.

**Step-by-Step UI Registration Flow (`/services/new`):**

1. **Service Identification:**
   - **Service Name (String):** User inputs the internal name of the service (e.g., `payment-service`).
   - **Environment (Dropdown):** User selects the environment (`production`, `staging`, `development`).
2. **GitHub Mapping (The Webhook Link):**
   - **Repository URL (String):** User inputs the exact GitHub repository URL (e.g., `https://github.com/your-org/payment-service`). 
   - **Path Filter (String, optional):** For monorepo setups, user inputs a glob pattern to scope this service to a subdirectory (e.g., `services/payment/**`). If left empty, the service matches all webhooks from the repo (standard microservice behavior).

> **⚠️ Default Behavior:** If `path_filter` is empty or not set, the service matches **ALL** webhooks from the repo. This is the correct default for single-service repos. For monorepos, you **must** set a glob pattern (e.g., `services/payment/**`) to avoid creating false deployments for unrelated commits.

   - *Architecture Note:* This is the exact string Fortis-CI will use to match incoming `workflow_run` webhooks to this service. For monorepos, multiple services can share the same repo URL but with different `path_filter` values.
3. **Health Monitoring Configuration:**
   - **Health Endpoint URL (String):** User inputs the internal HTTP/HTTPS URL that Fortis-CI will poll. Because Fortis-CI is self-hosted inside the VPC, this can be a private internal IP or local DNS (e.g., `http://payment-svc.internal:8080/health`).
   - **Polling Interval (Number, optional):** Defaults to 60 seconds.
4. **Dependency Mapping (Blast Radius):**
   - **Dependencies (Multi-select):** User selects other previously registered services that this service depends on (e.g., `postgres-db`, `auth-service`).
   - *Architecture Note:* This creates `DEPENDS_ON` relationships in Neo4j. If `postgres-db` goes down, Fortis-CI can traverse the graph to know `payment-service` is also affected.
5. **Advanced Rollback Config (Optional):**
   - **Rollback Strategy (Radio):** Select between `Re-run previous successful GitHub workflow` (Default) OR `Trigger specific workflow_dispatch event`.

**Post-Registration Action:**
Upon clicking "Register", the backend creates a `Service` node in Neo4j with all provided properties. The UI immediately directs the user to a "Setup Webhook" page containing the exact payload URL and secret they need to copy into their GitHub Repository Settings.

#### Bulk Registration Methods (For Microservice Architectures)

Manually registering 50 services through a UI form is impractical. Fortis-CI supports multiple registration strategies:

**Method 1 — YAML Config Import (V1):**

DevOps teams write a single config file and import it via CLI:

```yaml
# fortis-ci-services.yml
services:
  - name: payment-service
    repo: https://github.com/org/payment-service
    health_url: http://payment-svc.internal:8080/health
    environment: production
    dependencies: [auth-service, postgres]

  - name: auth-service
    repo: https://github.com/org/auth-service
    health_url: http://auth-svc.internal:8081/health
    environment: production
    dependencies: [postgres]

  - name: notification-service
    repo: https://github.com/org/notification-service
    health_url: http://notif-svc.internal:8082/health
    environment: production
    dependencies: [auth-service]
```

```bash
fortis-ci import --file fortis-ci-services.yml
```

All services are created as `Service` nodes in Neo4j with their `DEPENDS_ON` relationships in a single transaction. This aligns with how DevOps teams work — infrastructure-as-code, not UI clicks.

**Method 2 — GitHub API Auto-Discovery (V2/V3):**

When the DevOps engineer connects Fortis-CI to their GitHub Organization via OAuth, Fortis-CI calls `GET /orgs/{org}/repos` to fetch all repositories. The UI presents a checklist:

```
☑️ payment-service       → Fill health URL: ___________
☑️ auth-service           → Fill health URL: ___________
☑️ notification-service   → Fill health URL: ___________
☐ company-handbook        (skip — not a deployable service)
☐ design-assets           (skip — not a deployable service)
```

The engineer checks the services they want to track, fills in health URLs, and clicks "Register All."

**Method 3 — Zero-Config Auto-Registration (V4):**

Fortis-CI requires no pre-registration. When the first webhook arrives from an unknown repo, Fortis-CI automatically creates a `Service` node with status `unconfirmed`. The DevOps engineer sees a notification in the dashboard: *"New service detected: payment-service. Configure health endpoint to activate monitoring."* They fill in the health URL to activate full tracking.

---

## 8. Non-Functional Requirements

### Performance
- Dashboard loads in < 3 seconds
- API responses average < 500ms
- Health check cycle completes across all services in < 10 seconds
- Graph RCA query returns in < 1 second

### Reliability
- Webhook idempotency via `workflow_run_id UNIQUE` constraint in Neo4j
- Automated rollback must not fire if no safe target exists
- Health worker must not block the main API thread (runs as separate cron process)

### Security
- Webhook signature verification (`X-Hub-Signature-256`) on all incoming events
- GitHub secrets never stored — fetched read-only, masked in all UIs
- JWT authentication for dashboard access
- GitHub OAuth (NextAuth.js) for login
- Rate limiting on all public endpoints
- Helmet.js for HTTP security headers

### Scalability (Self-Hosted Instance)
- Neo4j handles graph growth natively without schema migrations; limits are hardware-bound
- Redis cache absorbs repeated health-check dashboard reads
- **Health Worker Concurrency:** To avoid blocking the 60s poll window, the worker uses `Promise.all` with a concurrency limiter (`p-limit`, set to 20 parallel requests).
- **Service Limit:** The MVP recommends a ~50 service limit per instance. Beyond this, the synchronous `p-limit` health worker should be replaced with a distributed task queue (e.g., BullMQ) in V4.

### Data Retention Policy

To prevent unbounded graph growth, the following retention defaults apply:

| Node Type | Retention | Action |
|---|---|---|
| Log lines | 7 days | Auto-delete (cron job) |
| HealthCheck | 30 days | Detach and delete nodes + `HAS_HEALTH` edges |
| ErrorPattern | 90 days | Delete with associated `CAUSED_ERROR` + `RELATED_TO_FILE` edges |
| EnvSnapshot | 60 days | Delete with `SNAPSHOT_FOR` + `CAPTURED_ENV` edges |
| Deployment | 90 days | Archive to stub: remove all relationships except `DEPLOYED_TO`, keep node for timeline continuity |
| Service, Commit, File | Indefinite | Keep — these are the core graph structure |
| RollbackEvent | Indefinite | Keep — audit trail |

> **Projected growth:** A team running 50 services with 20 deploys/day accumulates ~36,500 Deployment nodes/year. Without pruning, the graph will have ~365,000 HealthCheck nodes/year (50 services × 1440 checks/day × 365 days ÷ 2 linked). The 30-day HealthCheck retention keeps this to ~2.16M nodes max.

---

## 9. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Backend API | Node.js + Express + TypeScript | 18 LTS / 4.x / 5.x |
| Primary Database | **Neo4j** | 5.15 (Community) |
| Cache | Redis | 7 (Alpine) |
| Frontend | **Next.js (App Router)** | 14 |
| Graph Visualization | react-force-graph | latest |
| Charts | Recharts | latest |
| Auth | NextAuth.js (GitHub OAuth) | 5.x |
| Notifications | @slack/webhook + Nodemailer | latest |
| Container | Docker + Docker Compose | — |
| CI/CD Integration | GitHub Actions (Webhooks + REST API) | — |
| Future Mobile | React Native | Post-MVP |

---

## 10. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dashboard UI                               │
│                  (Next.js 14 App Router)                        │
│                                                                 │
│  Dashboard │ Deployments │ Graph View │ Rollback Console        │
└─────────────────────────┬───────────────────────────────────────┘
                          │  REST + Polling (MVP)
                          │  SSE deferred to Phase 2
┌─────────────────────────▼────────────────────────────────────────┐
│                      Backend API                                 │
│              (Node.js + Express + TypeScript)                    │
│                                                                  │
│  Webhook Processor (idempotent)   RCA Engine (rule-based)        │
│  Health Worker (60s cron)         Rollback Engine (auto+manual)  │
│  Git Diff Engine (GitHub API)     Notification Service           │
│                                   (GH PR + Slack + Email)        │
└────────────┬───────────────────────────────┬─────────────────────┘
             │                               │
┌────────────▼─────────────┐    ┌────────────▼──────────────────┐
│        Neo4j 5.x         │    │        GitHub API             │
│    (Primary Store)       │    │                               │
│                          │    │  Webhooks (events in)         │
│  Nodes: Service,         │    │  Workflow rerun (rollback)    │
│  Deployment, Commit,     │    │  Git diff fetch               │
│  File, ErrorPattern,     │    │  Actions log fetch            │
│  HealthCheck,            │    │  Secrets read (masked)        │
│  EnvSnapshot,            │    │  PR comments (alerts)         │
│  RollbackEvent           │    └───────────────────────────────┘
│                          │
│  Relationships encode    │    ┌───────────────────────────────┐
│  the entire failure      │    │         Redis 7               │
│  and recovery graph      │    │                               │
└──────────────────────────┘    │  Health time-series cache     │
                                │  Rate limiting                │
                                │  Session store                │
                                └───────────────────────────────┘
```

---

## 11. Installation & Setup

### One-Command Start
```bash
git clone https://github.com/ganeshak11/Fortis-CI
cd Fortis-CI
cp backend/.env.example backend/.env
# Fill in .env with your tokens
docker compose up -d
```

### First-Run Configuration
1. Open `http://localhost:3000` → login with GitHub OAuth
2. Register your first service (name, repo URL, health endpoint)
3. Add GitHub webhook to your repo pointing to `http://your-fortis-ci-host/webhooks/github`
4. Configure SMTP and/or Slack webhook in `.env`
5. Fortis-CI begins tracking immediately on next pipeline run

---

## 12. API Reference (Summary)

```
POST /webhooks/github                       Receive GitHub Actions events

GET  /api/services                          List tracked services
POST /api/services                          Register service
GET  /api/services/:id/env-drift            Environment drift analysis

GET  /api/deployments                       Deployment history
GET  /api/deployments/:id                   Deployment detail
GET  /api/deployments/:id/rca               Root Cause Analysis
GET  /api/deployments/:id/compare/:prevId   Side-by-side comparison
GET  /api/deployments/:id/rollback-preview  Preview rollback impact
POST /api/deployments/:id/rollback          Trigger manual rollback
POST /api/deployments/:id/redeploy          Trigger redeploy
GET  /api/deployments/:id/logs              Last 500 log lines

GET  /api/health-status                     Current health per service
GET  /api/health-status/:serviceId          Health history (time-series)

GET  /api/graph/deployment-chain/:id        Full deployment chain for visualization
GET  /api/graph/failure-chain/:id           Failure graph for visualization
GET  /api/graph/service-dependencies        Service dependency graph
GET  /api/analytics/risk                    File-level historical risk scores
```

---

## 13. Version Roadmap

Fortis-CI is built across **4 versions**. Each version is a **complete, independently shippable product** with a single value proposition.

---

### V1 — "See Everything"
> *Know what's deployed and if it's healthy*

**What ships:**
1. Docker Compose: Neo4j + Redis + Backend + Frontend
2. Neo4j schema (constraints + indexes)
3. Webhook ingestion with idempotency (`workflow_run_id` UNIQUE)
4. Deployment history tracking (graph model — Service, Deployment, Commit nodes)
5. Health monitoring worker (60s polling, HealthCheck nodes)
6. Basic Next.js dashboard (deployment list, health status, service registry)
7. Manual redeploy trigger (GitHub workflow dispatch)

---

### V2 — "Fix Faster"
> *Know what broke and recover in 60 seconds*

**What ships:**
8. Async LogFetchJob (GitHub Actions zip → parse → ErrorPattern nodes)
9. Rule-based RCA engine (8 error pattern types, confidence scoring)
10. Git diff integration (CHANGED_FILE + RELATED_TO_FILE relationships)
11. Deployment comparison view (working vs broken side-by-side)
12. Automated rollback engine (Tier 1: health-only + Tier 2: error-correlated)
13. Three-channel notifications (GitHub PR comment + Slack + Email)
14. Deployment risk scoring (Layer 1 heuristics, Layer 2 graph-enhanced after 10 deploys)

---

### V3 — "Prevent Failures"
> *Know what's risky before you push*

**What ships:**
15. Graph-enhanced risk scoring (Layer 2 activates, `graph-enhanced` badge)
16. Environment drift detection (GitHub Secrets key-presence drift)
17. Interactive deployment graph visualization (react-force-graph)
18. Rollback impact preview (show what changes before confirmation)
19. Service dependency graph (blast radius analysis via `DEPENDS_ON`)
20. PR/governance checks (large diff warning, critical file alert posted to PR)

---

### V4 — "Ship at Scale"
> *Production-ready for teams*

**What ships:**
21. Enterprise license key validation (`license.fortis-ci.io`)
22. Performance hardening (query optimization, index tuning, Redis cache review)
23. Helm chart for Kubernetes self-hosting
24. Self-hosting meta-demo (Fortis-CI tracking its own deployments)
25. Installation wizard (CLI or web UI for first-run configuration)
26. Full documentation + API reference

---

### Post-V4 Roadmap
| Feature | Notes |
|---|---|
| External Metrics Integration | Ingest webhooks from Prometheus / Grafana / Datadog (`POST /webhooks/alerts`) to trigger automated rollbacks based on infra metrics (CPU, memory, custom rules) |
| LLM-assisted RCA | Send error context + diff to Gemini/OpenAI for natural language explanation |
| SSE (Server-Sent Events) | Real-time dashboard updates — replace polling. Deferred: non-trivial with Next.js App Router + RSC. |
| React Native mobile app | Push alerts, quick rollback from mobile |
| Fortis-CI Cloud | Managed hosted offering (Phase 3 of business model) |
| GitLab CI integration | Extend beyond GitHub |
| RBAC / SSO | Full enterprise edition |
| Neo4j GDS | Anomaly detection — **requires Neo4j Enterprise edition upgrade** |

**Dashboard Polling Intervals (V1–V3 MVP):**
- Main dashboard: every 10 seconds
- Deployment detail page (active deploy): every 5 seconds
- RCA panel (`rca_status = pending`): every 3 seconds until complete
- Health status: every 15 seconds

---

## 14. Development Workflow

```
Version start
  ↓
Developers take feature slices
  ↓
Each works on feature/* branch
  ↓
PR to main → integration lead reviews → merge
  ↓
Next version begins
```

**Branch rules:**
- `main` — stable, production-ready. Tagged `v1.0`, `v2.0`, etc. on version completion. All PRs merge here first.
- `feature/*` — individual work. Never pushed to `main` directly without PR.

The repository maintainer owns the `main` branch health, reviews PRs, and makes the merge call.

---

## 15. Out of Scope (All Versions)

| Feature | Reason |
|---|---|
| Editable secrets manager | Becomes Vault competitor — enormous scope |
| Full log aggregation pipeline | Becomes Elasticsearch — enormous scope |
| Artifact storage | Docker registry territory |
| Real-time log streaming | WebSocket infra complexity, not core value |
| Kubernetes integration | ArgoCD territory — out of lane |
| Multi-cloud deployment tracking | Phase 3+ at earliest |
| Complex RBAC | Enterprise edition, Phase 3 |
| Slack alerts without rollback | Not the core loop — add with rollback or not at all |

---

## 16. Success Criteria

### V1 — See Everything
- [ ] Real GitHub Actions webhook received and stored as Deployment node (no duplicates on retry)
- [ ] Deployment history visible and traversable in Neo4j graph
- [ ] Health monitoring shows deployment-correlated health state in dashboard
- [ ] Manual redeploy triggers GitHub workflow dispatch successfully
- [ ] `feature → main` merge made successfully

### V2 — Fix Faster
- [ ] LogFetchJob fetches and parses GitHub Actions zip logs successfully
- [ ] RCA panel populates within 5 seconds of viewing a failed deployment
- [ ] Automated rollback fires within 5 minutes of health degradation (Tier 1)
- [ ] All 3 notification channels receive rollback alert with correct payload
- [ ] Deployment comparison shows git diff between working and broken versions
- [ ] Risk score displayed on every new deployment (heuristic label on fresh install)

### V3 — Prevent Failures
- [ ] Risk score shows `graph-enhanced` label after 10+ deployments
- [ ] Interactive graph visualization renders deployment chain correctly
- [ ] Environment drift panel shows added/removed secret keys
- [ ] Rollback impact preview renders before confirmation step
- [ ] PR governance check posts comment to GitHub PR

### V4 — Ship at Scale
- [ ] One-command install (`docker compose up -d`) works on a fresh VM
- [ ] Fortis-CI tracking its own deployments (meta-demo live)
- [ ] Enterprise license key gates advanced features (license.fortis-ci.io check)
- [ ] Helm chart deploys Fortis-CI to a k8s cluster successfully

---

## 17. Summary

> **Fortis-CI** is a self-hosted, Neo4j-powered intelligent deployment observability platform for engineering teams who care about deployment reliability without enterprise complexity.

| **v1.0.0** | Includes features from previous roadmap phases (visibility, automated rollbacks, RCA, risk scoring, scale features). |

When your deployment breaks at 3am, you don't want 50 dashboards.

You want:
- **What changed?** → Graph traversal: commit → files → deployment chain
- **Why did it break?** → Rule-based error pattern detection correlated with code changes
- **How do I fix it?** → Automated rollback to last healthy deployment, with full audit trail

Fortis-CI answers those 3 questions — and takes action — in under 60 seconds.

**Not a CI/CD platform. Not a full observability stack. Not a secrets manager.**

Just: **deployment graph intelligence + automated recovery + team notification.**
