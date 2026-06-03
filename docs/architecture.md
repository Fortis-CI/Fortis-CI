# Fortis-CI — Architecture Document

![Version](https://img.shields.io/badge/version-V1--See%20Everything-blueviolet)
![Deployment](https://img.shields.io/badge/deployment-Self--Hosted%20OSS-green)
![Status](https://img.shields.io/badge/status-In%20Development-yellow)

---

## 1. Deployment Model

**Fortis-CI is a self-hosted, open-source tool.**

Each team or company deploys **one centralized Fortis-CI instance per environment** inside their own cloud infrastructure. Fortis-CI is NOT deployed as a sidecar per microservice — it is a single control plane that monitors all services via one shared Neo4j graph.

```
[Customer Cloud / VPC]
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ auth-svc │  │ pay-svc  │  │ notif-svc│  (N services)     │
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
│           │  Neo4j + Redis      │                            │
│           │  Backend API        │                            │
│           │  Next.js Dashboard  │                            │
│           └─────────────────────┘                            │
└──────────────────────────────────────────────────────────────┘

                    [Fortis-CI License Server]
                    ┌──────────────────────────┐
                    │  license.fortis-ci.io     │  ← Only call for
                    │  (Enterprise validation) │    enterprise features
                    └──────────────────────────┘
```

### Why Centralized (Not Per-Microservice)?

If each microservice had its own Fortis-CI with an isolated Neo4j, the `DEPENDS_ON` relationships between services would be impossible to model. The entire blast radius analysis and cross-service RCA would break. **A single connected graph across all services is the core value proposition.**

### Webhook-to-Service Matching (Microservice & Monorepo)

All GitHub repos send webhooks to one Fortis-CI endpoint: `POST /webhooks/github`. Fortis-CI identifies which service(s) to attach data to:

**Microservice repos (1 repo = 1 service):**
1. Webhook arrives → extract `repository.full_name` (e.g., `your-org/payment-service`)
2. Query Neo4j: `MATCH (s:Service {repo_url: $repoUrl}) RETURN s`
3. If matched → process the deployment and attach it to that service
4. If not matched → repo is not tracked; return `200 OK`, skip processing

**Monorepo (1 repo = N services):**
1. Webhook arrives → extract `repository.full_name` (e.g., `your-org/main-platform`)
2. Multiple `Service` nodes found for that repo
3. Fortis-CI calls GitHub API: `GET /repos/{owner}/{repo}/commits/{sha}` to get changed files
4. Each service's `path_filter` (glob) is matched against changed files
5. Only services with matching paths get a `Deployment` node
6. If `path_filter` is empty → matches all webhooks from that repo (default microservice behavior)

### GitHub Organization-Level Webhooks

Instead of adding the webhook URL to each repo individually, DevOps teams add it **once** at the GitHub Organization level (`Settings → Webhooks`). GitHub forwards `workflow_run` events from all repos to Fortis-CI. Fortis-CI only processes repos that are registered in its Service Registry.

### Multi-Architecture & Multi-Org Support

Because Fortis-CI identifies services using the absolute `owner/repo` string and silently ignores unregistered repositories, it is completely agnostic to how a company organizes their GitHub:

**Case 1: Single Org, Multiple Architectures (`org/arch1-svc`, `org/arch2-svc`)**
- DevOps adds **one** webhook at the `org` level.
- **Option A (Global Fortis-CI):** Deploy one Fortis-CI instance. The graph will naturally form two disconnected "islands" of nodes. If an `arch1` service goes down, the lack of `DEPENDS_ON` edges proves `arch2` is safe.
- **Option B (Isolated Fortis-CIs):** Deploy two Fortis-CI instances (one per architecture). Because Fortis-CI ignores unregistered repos, Fortis-CI 1 silently drops `arch2` webhooks, and Fortis-CI 2 silently drops `arch1` webhooks.

**Case 2: Multiple Orgs (`org-ecommerce/svc`, `org-payments/svc`)**
- DevOps adds webhooks to **both** GitHub Organizations pointing to the **same** Fortis-CI instance URL, using the same webhook secret.
- Fortis-CI ingests all webhooks seamlessly because it matches against the full `owner/repo` string in its registry regardless of origin.

### Why Self-Hosted?

| Concern | Self-Hosted Answer |
|---|---|
| **Data sovereignty** | Pipeline data (commits, secrets snapshots, deploy history) never leaves customer cloud |
| **Security** | No third party touches CI/CD infrastructure |
| **Compliance** | Customer manages their own data retention, GDPR, SOC2 |
| **Scale** | Each customer scales their own instance independently |
| **Trust** | DevOps engineers inherently trust tools they can audit |

---

## 2. Business Model (Phased)

### Business Phase 1 — Open Source Core (Apache 2.0 License)
- Full deployment tracking, health monitoring, RCA engine, automated rollback
- Maps to product **V1 – V3** features
- Single command install via Docker Compose
- Community builds trust, GitHub adoption grows

### Business Phase 2 — Enterprise Edition (License Key)
- Add-ons: RBAC, SSO (SAML/OIDC), Audit logs, Advanced graph analytics
- Maps to product **V4** hardening
- License key validated against `license.fortis-ci.io` on startup
- Enterprise features disabled gracefully if key invalid — core always works

### Business Phase 3 — Fortis-CI Cloud (Managed SaaS)
- "We host it for you" offering
- Built after product-market fit is proven via self-hosted installs
- Multi-tenant architecture added only at this stage

### License Enforcement Pattern
```
Startup sequence:
  1. Load config (GitHub token, SMTP, Slack, license key)
  2. Connect to Neo4j + Redis
  3. If SENTINEL_LICENSE_KEY set:
       POST https://license.fortis-ci.io/validate
       { key, instance_id: sha256(hostname+installId) }
       → If valid: enable enterprise features
       → If invalid: log warning, run OSS mode
  4. Start health worker, webhook server, API
```

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Dashboard UI                              │
│                  (Next.js 14 App Router)                         │
│                                                                  │
│  Dashboard  │  Deployments  │  Graph View  │  Rollback Console  │
└──────────────────────────┬───────────────────────────────────────┘
                           │  REST + Polling (MVP)
┌──────────────────────────▼───────────────────────────────────────┐
│                      Backend API                                 │
│              (Node.js + Express + TypeScript)                    │
│                                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Webhook      │  │  RCA Engine   │  │   Rollback Engine    │  │
│  │ Processor    │  │ (graph-based) │  │  (auto + manual)     │  │
│  │ (idempotent) │  │               │  │                      │  │
│  └──────────────┘  └───────────────┘  └──────────────────────┘  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Health       │  │  Git Diff     │  │   Notification       │  │
│  │ Worker       │  │  Engine       │  │   Service            │  │
│  │ (60s cron)   │  │ (GitHub API)  │  │  (GH PR + Slack      │  │
│  └──────────────┘  └───────────────┘  │   + Email)           │  │
│                                        └──────────────────────┘  │
└──────┬────────────────────────────────────────┬───────────────────┘
       │                                        │
┌──────▼──────────────┐            ┌────────────▼───────────────────┐
│     Neo4j 5.x       │            │        GitHub API               │
│  (Primary Store)    │            │                                 │
│                     │            │  - Webhook events               │
│  Nodes:             │            │  - Workflow rerun (rollback)    │
│    Service          │            │  - Git diff fetch               │
│    Deployment       │            │  - Actions log fetch            │
│    Commit           │            │  - Secrets read (masked)        │
│    File             │            │  - PR comment (rollback alert)  │
│    ErrorPattern     │            └────────────────────────────────┘
│    HealthCheck      │
│    EnvSnapshot      │            ┌────────────────────────────────┐
│    RollbackEvent    │            │        Redis 7                  │
│                     │            │  (Health time-series cache)     │
│  Relationships:     │            │                                 │
│    DEPLOYED_TO      │            │  - Last N health check results  │
│    BASED_ON         │            │  - Rate limiting for webhooks   │
│    CHANGED_FILE     │            │  - Session store                │
│    CAUSED_ERROR     │            └────────────────────────────────┘
│    HAS_HEALTH       │
│    SUCCEEDED_BY     │
│    ROLLED_BACK_TO   │
│    TRIGGERED        │
│    DEPENDS_ON       │
│    SNAPSHOT_FOR     │
└─────────────────────┘
```

---

## 4. Neo4j Graph Data Model

### Nodes

```cypher
// Service — A tracked microservice or application
(:Service {
  id: String,              // UUID
  name: String,            // "payment-service"
  repo_url: String,        // "https://github.com/org/payment-service"
  path_filter: String,     // Monorepo glob: "services/payment/**" (empty = match all, standard microservice)
  health_endpoint: String, // "https://api.example.com/health"
  environment: String,     // "production" | "staging" | "dev"
  registered_at: DateTime
})

// Deployment — A single pipeline execution
(:Deployment {
  id: String,              // UUID
  workflow_run_id: String, // GitHub workflow_run_id (UNIQUE — idempotency key)
  delivery_id: String,     // GitHub webhook delivery_id
  version: String,         // "v1.4.2"
  commit_sha: String,      // "abc123def"
  environment: String,
  status: String,          // "success" | "failed" | "in_progress" | "rolled_back"
  triggered_by: String,    // GitHub actor
  timestamp: DateTime,
  risk_score: Float        // 0.0 – 1.0, calculated at ingest
})

// Commit — Git commit metadata
(:Commit {
  sha: String,             // UNIQUE
  message: String,
  author: String,
  branch: String,
  additions: Integer,
  deletions: Integer,
  files_changed: Integer,
  diff_summary: String
})

// File — A file modified in a commit
(:File {
  path: String,            // "src/config/database.ts"
  language: String,        // "typescript"
  change_type: String      // "modified" | "added" | "deleted"
})

// ErrorPattern — Detected error from deployment logs
(:ErrorPattern {
  id: String,
  type: String,            // "connection_error" | "timeout" | "auth_failure" | "missing_env" | "port_conflict" | "oom"
  message: String,         // "Connection refused on port 5432"
  count: Integer,
  severity: String,        // "critical" | "warning" | "info"
  first_seen: DateTime
})

// HealthCheck — Point-in-time health snapshot
(:HealthCheck {
  id: String,
  status: String,          // "healthy" | "degraded" | "down"
  response_ms: Integer,
  status_code: Integer,
  checked_at: DateTime
})

// EnvSnapshot — Masked environment variable state
(:EnvSnapshot {
  id: String,
  environment: String,
  key: String,             // "DATABASE_URL"
  is_masked: Boolean,      // always true for secrets
  synced_at: DateTime
})

// RollbackEvent — Record of a rollback action
(:RollbackEvent {
  id: String,
  triggered_by: String,    // "auto" | "user:ganeshak11"
  trigger_type: String,    // "health_degradation" | "manual" | "error_threshold"
  reason: String,
  timestamp: DateTime,
  outcome: String          // "success" | "failed" | "pending"
})
```

### Relationships

```cypher
// Core deployment chain
(Deployment)-[:DEPLOYED_TO]->(Service)
(Deployment)-[:BASED_ON]->(Commit)
(Deployment)-[:SUCCEEDED_BY]->(Deployment)    // timeline chain

// Code change graph
(Commit)-[:CHANGED_FILE {additions: Int, deletions: Int}]->(File)
(File)-[:BELONGS_TO]->(Service)

// Failure graph
(Deployment)-[:CAUSED_ERROR {confidence: Float}]->(ErrorPattern)
(ErrorPattern)-[:RELATED_TO_FILE]->(File)     // correlates error to code change

// Health graph
(Deployment)-[:HAS_HEALTH]->(HealthCheck)
(Service)-[:LAST_CHECKED]->(HealthCheck)

// Rollback graph
(RollbackEvent)-[:ROLLED_BACK_TO]->(Deployment)    // target
(Deployment)-[:TRIGGERED]->(RollbackEvent)          // auto-rollback link
(Deployment)-[:REPLACED_BY]->(Deployment)           // post-rollback state

// Config graph
(EnvSnapshot)-[:SNAPSHOT_FOR]->(Service)
(Deployment)-[:CAPTURED_ENV]->(EnvSnapshot)

// Service dependency (for blast radius analysis)
(Service)-[:DEPENDS_ON]->(Service)
```

### Power Queries

```cypher
-- [Q1] Automated rollback target: last healthy deployment
-- IMPORTANT: Traverse SUCCEEDED_BY chain only. Never traverse REPLACED_BY.
-- REPLACED_BY is a write-only audit edge created after rollback.
-- Traversing it would include rolled-back deployments as candidates.
MATCH (failing:Deployment {id: $id})-[:DEPLOYED_TO]->(svc:Service)
MATCH (prev:Deployment)-[:DEPLOYED_TO]->(svc)
MATCH (prev)-[:SUCCEEDED_BY*]->(failing)   // traverse timeline chain only
WHERE prev.status = 'success'               // excludes rolled_back, failed
WITH prev ORDER BY prev.completed_at DESC LIMIT 1
RETURN prev

-- [Q2] Root cause chain: error → file → commit
MATCH (d:Deployment {id: $id})-[:CAUSED_ERROR]->(e:ErrorPattern)
MATCH (d)-[:BASED_ON]->(c:Commit)-[:CHANGED_FILE]->(f:File)
WHERE e.severity = 'critical'
RETURN d.id, e.type, e.message, f.path, c.sha, e.count
ORDER BY e.count DESC

-- [Q3] Risk scoring: files historically linked to failures
MATCH (f:File)<-[:CHANGED_FILE]-(c:Commit)<-[:BASED_ON]-(d:Deployment {status: 'failed'})
RETURN f.path, COUNT(d) AS failure_count
ORDER BY failure_count DESC LIMIT 10

-- [Q4] Deployment comparison: what changed between working and broken
MATCH (broken:Deployment {id: $brokenId})-[:BASED_ON]->(c1:Commit)-[:CHANGED_FILE]->(f:File)
MATCH (working:Deployment {id: $workingId})-[:BASED_ON]->(c2:Commit)
WHERE NOT (c2)-[:CHANGED_FILE]->(f)
RETURN f.path AS new_file, f.change_type

-- [Q5] Blast radius: which services are affected by a failing service
MATCH (root:Service {id: $id})<-[:DEPENDS_ON*1..3]-(affected:Service)
RETURN DISTINCT affected.name, affected.environment

-- [Q6] Deployment health correlation
MATCH (d:Deployment)-[:DEPLOYED_TO]->(svc:Service)
MATCH (d)-[:HAS_HEALTH]->(h:HealthCheck)
WHERE d.timestamp > datetime() - duration('P7D')
RETURN d.timestamp, d.status, h.response_ms, h.status
ORDER BY d.timestamp ASC
```

---

## 5. Automated Rollback Logic

### Trigger Conditions

The health worker evaluates rollback eligibility after every health check cycle using a **two-tier system**:

```
Tier 1 — Health-only (high reliability, no log dependency):
  - 3 consecutive failed health checks (status: "down")         → ~2 min latency
  - Health check status: "degraded" for > 5 minutes post-deploy → ~5 min latency

Tier 2 — Error-correlated (supplemental, requires log pipeline):
  - Critical error count > 10 within 5 minutes of deployment

Tier 2 adds error context to the rollback notification but does NOT block Tier 1.
If logs haven't been fetched yet, Tier 1 fires independently based on health alone.
```

### Rollback Algorithm

```
1. Detect trigger condition
2. Graph query: find last healthy deployment (Q1 above)
3. If found:
   a. Create RollbackEvent node
   b. Link: failing_deployment -[:TRIGGERED]-> RollbackEvent
   c. Link: RollbackEvent -[:ROLLED_BACK_TO]-> target_deployment
   d. Link: failing_deployment -[:REPLACED_BY]-> target_deployment  // audit only, never traversed
   e. Trigger GitHub Actions Re-run API: POST /repos/{owner}/{repo}/actions/runs/{prev.workflow_run_id}/rerun
   f. Send notifications (GitHub PR comment + Slack + Email)
   g. Update deployment status to "rolled_back"
4. If NOT found (no clean previous deployment):
   a. Alert team via all channels
   b. Mark service as "needs_manual_intervention"
   c. Do NOT auto-rollback (too risky)
```

**Rollback Safety — Circuit Breaker:**
- After auto-rollback triggers, disable auto-rollback for that service for **15-minute cooldown**
- If the rollback re-run itself fails → set service to `needs_manual_intervention` (never chain rollbacks)
- Max rollback depth: **1** — manual rollback from dashboard is always available, even during cooldown

### Notification Payload (All 3 Channels)

```
🔴 AUTO-ROLLBACK TRIGGERED — payment-service

Failing deployment:  v1.4.2 (commit: abc123)
Rollback target:     v1.4.1 (commit: def456)
Trigger reason:      3 failed health checks (3:16pm - 3:18pm)

Root Cause Detected:
  🔴 Critical: "Connection refused on port 5432" (15 occurrences)
  Related file: src/config/database.ts

Rollback status: IN PROGRESS
Dashboard: https://fortis-ci.your-company.com/deployments/abc123
```

---

## 6. Root Cause Analysis Engine

### Rule-Based Pattern Detection

| Pattern Type | Detection Regex | Severity |
|---|---|---|
| DB Connection | `ECONNREFUSED\|Connection refused\|connect ETIMEDOUT` | critical |
| API Timeout | `ETIMEDOUT\|Request timeout\|socket hang up` | critical |
| Auth Failure | `401\|403\|Invalid credentials\|Unauthorized` | warning |
| Missing Env Var | `undefined is not defined\|Cannot read prop.*undefined\|getenv.*not set` | critical |
| Port Conflict | `EADDRINUSE\|address already in use` | critical |
| OOM | `JavaScript heap out of memory\|OOMKilled` | critical |
| DNS Failure | `ENOTFOUND\|getaddrinfo ENOENT` | warning |
| Slow Query | `slow query\|query timeout` | info |

### RCA Output Structure

```typescript
interface RCAResult {
  deploymentId: string;
  analysisTime: Date;
  confidence: number;          // 0.0 - 1.0
  likelyCauses: {
    rank: number;
    errorType: string;
    errorMessage: string;
    occurrences: number;
    relatedFiles: string[];    // from graph correlation
    confidence: number;
    suggestion: string;
  }[];
  gitDiffSummary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    suspiciousFiles: string[]; // files changed AND related to errors
  };
  recommendation: 'rollback' | 'investigate' | 'monitor';
  rollbackTarget?: string;     // deployment ID if rollback recommended
}
```

---

## 7. API Reference

### Webhook Endpoint
```
POST /webhooks/github
Headers: X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery
Body: GitHub Actions workflow_run payload
```

### Services
```
GET    /api/services                    List all tracked services
POST   /api/services                    Register new service
GET    /api/services/:id                Service detail
GET    /api/services/:id/env-drift      Environment drift analysis
DELETE /api/services/:id                Remove service
```

### Deployments
```
GET  /api/deployments                   Deployment history (paginated)
GET  /api/deployments/:id               Deployment detail
GET  /api/deployments/:id/rca           Root Cause Analysis result
GET  /api/deployments/:id/compare/:prevId  Side-by-side comparison
GET  /api/deployments/:id/logs          Last 500 log lines
GET  /api/deployments/:id/rollback-preview  Preview rollback impact
POST /api/deployments/:id/rollback      Trigger manual rollback
POST /api/deployments/:id/redeploy      Trigger redeploy
```

### Health
```
GET /api/health-status                  Current health per service
GET /api/health-status/:serviceId       Health history (time-series)
```

### Graph
```
GET /api/graph/deployment-chain/:id     Full deployment chain graph
GET /api/graph/failure-chain/:id        Failure chain for visualization
GET /api/graph/service-dependencies     Service dependency graph
GET /api/analytics/risk                 File-level historical risk scores
```

---

## 8. Installation Design

### One-Command Install (Docker Compose)

```bash
curl -sSL https://get.fortis-ci.io | bash
# OR
docker compose up -d
```

### Configuration Wizard

On first run, a CLI wizard or web UI collects:

```
1. GitHub OAuth App credentials (Client ID + Secret)
2. GitHub Personal Access Token (for API calls)
3. GitHub Webhook Secret
4. SMTP credentials (for email alerts)
5. Slack webhook URL (optional)
6. Neo4j connection (use bundled or external AuraDB)
7. Enterprise license key (optional)
```

### Service Registration (Bulk Methods)

Manually registering services one-by-one is impractical for microservice architectures. Fortis-CI supports 3 registration strategies:

**Method 1 — YAML Config Import (V1):**
```yaml
# fortis-ci-services.yml
services:
  - name: payment-service
    repo: https://github.com/org/payment-service
    health_url: http://payment-svc.internal:8080/health
    environment: production
    dependencies: [auth-service, postgres]
```
```bash
fortis-ci import --file fortis-ci-services.yml
```

**Method 2 — GitHub API Auto-Discovery (V2/V3):**
Fortis-CI calls `GET /orgs/{org}/repos` to list all repos. DevOps engineer selects which services to track, fills in health URLs, and clicks "Register All."

**Method 3 — Zero-Config Auto-Registration (V4):**
When the first webhook arrives from an unknown repo, Fortis-CI creates a `Service` node with status `unconfirmed`. The engineer activates it by filling in the health URL.

### Environment Variables

```env
# Neo4j
NEO4J_URI=bolt://neo4j:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_secure_password

# Redis
REDIS_URL=redis://redis:6379

# GitHub
GITHUB_TOKEN=ghp_xxxx
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourcompany.com
SMTP_PASS=your_app_password
ALERT_EMAIL=devops@yourcompany.com

# App
PORT=3001
JWT_SECRET=your_jwt_secret
NODE_ENV=production

# Enterprise (optional)
SENTINEL_LICENSE_KEY=ENT-xxxx-xxxx
```

---

## 9. Tech Stack

| Layer | Technology | Version | Reason |
|---|---|---|---|
| Backend | Node.js + Express | 18 LTS + 4.x | Team familiarity, TypeScript support |
| Language | TypeScript | 5.x | Type safety across graph queries |
| Primary DB | Neo4j | 5.15 (Community) | Graph traversal for RCA + deployment chains |
| Cache | Redis | 7 | Health time-series, rate limiting, sessions |
| Frontend | Next.js (App Router) | 14 | Server components, file-based routing |
| Graph Viz | react-force-graph | latest | Interactive deployment graph visualization |
| Charts | Recharts | latest | Health timeline, response time trends |
| Auth | NextAuth.js (GitHub OAuth) | 5.x | GitHub SSO login |
| Container | Docker + Docker Compose | — | Single-command local install |
| CI/CD Integration | GitHub Actions | — | Webhooks + REST API |
| Future mobile | React Native | — | Planned post-V4 |

> **Note on SSE:** The architecture uses REST polling for V1–V3 (not SSE). Dashboard polling intervals: 10s main, 5s active deploy detail, 3s RCA pending, 15s health. SSE is planned for post-V4 — it is non-trivial to implement correctly with Next.js 14 App Router and React Server Components.

---

## 10. Version Roadmap

| Version | Tagline | Ships |
|---|---|---|
| **V1 — See Everything** | Know what's deployed and if it's healthy | Webhook ingestion, deployment graph, health monitoring, basic dashboard, redeploy |
| **V2 — Fix Faster** | Know what broke and recover in 60 seconds | LogFetchJob, RCA engine, git diff, deployment comparison, automated rollback, notifications, risk scoring |
| **V3 — Prevent Failures** | Know what's risky before you push | Graph-enhanced risk scoring, env drift, graph visualization, rollback preview, blast radius, PR governance |
| **V4 — Ship at Scale** | Production-ready for teams | Enterprise license, performance hardening, Helm chart, meta-demo, install wizard |

## 11. Post-V4 Roadmap

| Feature | Notes |
|---|---|
| SSE (Server-Sent Events) | Real-time dashboard — replaces polling. Non-trivial with Next.js App Router + RSC. |
| LLM-assisted RCA | Send error context + diff to Gemini/OpenAI for natural language explanation |
| React Native app | Mobile alerts + quick rollback |
| Fortis-CI Cloud | Managed SaaS offering (Business Phase 3) |
| GitLab CI integration | Extend beyond GitHub Actions |
| Helm chart for Kubernetes | K8s self-hosting (ships in V4) |
| SSO (SAML/OIDC) | Enterprise edition add-on |
| RBAC | Admin/viewer/operator roles — Enterprise |
| Neo4j GDS (Graph Data Science) | Anomaly detection — **requires Neo4j Enterprise edition upgrade from Community** |
| Audit log export | Compliance requirements — Enterprise |

