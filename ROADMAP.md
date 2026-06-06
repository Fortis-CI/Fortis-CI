# Fortis-CI — Version Roadmap

![Version](https://img.shields.io/badge/current-v1.0.0--See%20Everything-blueviolet)
![Versions](https://img.shields.io/badge/total-4%20Versions-blue)
![Model](https://img.shields.io/badge/release-Sequential%20Versioned-green)

> **Not your CI. Your CI's brain.**
>
> Deployment graph intelligence + automated recovery + team notification

Fortis-CI is built across **4 major versions**. Each version is a **complete, independently shippable product** with a single value proposition. Versions are released sequentially — each one builds on the previous.

| Version | Tagline | Core Value | Status |
|---|---|---|---|
| **v1.0.0 — See Everything** | Know what's deployed and if it's healthy | Infrastructure foundation | ✅ In Development |
| **v2.0.0 — Fix Faster** | Know what broke and recover in 60 seconds | Intelligence layer | 🔜 Planned |
| **v3.0.0 — Prevent Failures** | Know what's risky before you push | Prevention + graph features | 🔜 Planned |
| **v4.0.0 — Ship at Scale** | Production-ready for teams | Production readiness | 🔜 Planned |

> **Scope note:** v1.0.0 ships **manual redeploy** only (trigger a re-run of a previous workflow). **Automated rollback** (health-triggered, with RCA and notifications) ships in v2.0.0.

---

## v1.0.0 — "See Everything"

> *Know what's deployed and if it's healthy*

**Release goal:** Stand up the full infrastructure, ingest real GitHub Actions webhooks into a Neo4j graph, monitor service health, and display everything in a dashboard. After v1.0.0, a team can register services, receive webhooks, see deployment history, and know if their services are up or down — in real time.

### What Ships

| # | Feature | Description |
|---|---|---|
| 1 | **Docker Compose Stack** | Neo4j 5.x + Redis 7 + Backend API + Next.js Frontend — one-command `docker compose up -d` |
| 2 | **Neo4j Schema** | Constraints (`workflow_run_id` UNIQUE, `sha` UNIQUE) + indexes for fast graph queries |
| 3 | **Webhook Ingestion** | Receive GitHub Actions `workflow_run` events, verify HMAC-SHA256 signature, idempotent processing |
| 4 | **Deployment History Tracking** | Graph model: `Service`, `Deployment`, `Commit` nodes with `DEPLOYED_TO`, `BASED_ON`, `SUCCEEDED_BY` relationships |
| 5 | **Health Monitoring Worker** | 60-second polling cron → `HealthCheck` nodes → Redis cache → 🟢 Healthy / 🟡 Degraded / 🔴 Down |
| 6 | **Next.js Dashboard** | Deployment list, health status indicators, service registry UI (`/services/new`) |
| 7 | **Manual Redeploy** | Trigger GitHub Actions workflow re-run from the dashboard (not automated — user-initiated) |

### Graph Model After v1.0.0

```
(Service) ←─[DEPLOYED_TO]── (Deployment) ──[BASED_ON]──→ (Commit)
                                  │
                             [HAS_HEALTH]
                                  ↓
                            (HealthCheck)

(Deployment #1) ──[SUCCEEDED_BY]──→ (Deployment #2) ──[SUCCEEDED_BY]──→ (Deployment #3)
```

### Key APIs

```
POST /webhooks/github                   Receive GitHub Actions events (idempotent)
GET  /api/services                      List tracked services
POST /api/services                      Register new service
POST /api/services/import               Bulk import from YAML config
GET  /api/deployments                   Deployment history (paginated)
GET  /api/deployments/:id               Deployment detail
POST /api/deployments/:id/redeploy      Trigger manual redeploy
GET  /api/health-status                 Current health per service
GET  /api/health-status/:serviceId      Health history
```

### Exit Criteria

- [ ] Real GitHub Actions webhook received and stored as `Deployment` node (no duplicates on retry)
- [ ] Deployment history visible and traversable in Neo4j graph
- [ ] Health monitoring shows deployment-correlated health state in dashboard
- [ ] Manual redeploy triggers GitHub workflow dispatch successfully
- [ ] `feature → main` merge completed and tagged `v1.0.0`

---

## v2.0.0 — "Fix Faster"

> *Know what broke and recover in 60 seconds*

**Release goal:** When a deployment breaks production, Fortis-CI automatically detects the failure, analyzes root cause from GitHub Actions logs, rolls back to the last healthy deployment, and notifies the team across 3 channels — all within 60 seconds. This is the intelligence layer.

### What Ships

| # | Feature | Description |
|---|---|---|
| 8 | **Async LogFetchJob** | Fetch GitHub Actions workflow logs (zip download → unzip → parse per-job log files). Guardrails: skip entries >5MB, max 10,000 lines/file, 60s timeout |
| 9 | **Rule-Based RCA Engine** | 8 error pattern types (DB Connection, API Timeout, Missing Env Var, Port Conflict, OOM, Auth Failure, DNS Failure, Slow Query) with confidence scoring |
| 10 | **Git Diff Integration** | `CHANGED_FILE` + `RELATED_TO_FILE` relationships — correlate errors to the exact files changed in the deployment |
| 11 | **Deployment Comparison** | Side-by-side view: git diff, health metric delta, error patterns, env snapshot diff between working vs broken deployment |
| 12 | **Automated Rollback Engine** | **Tier 1 (Health-only):** 3 consecutive `down` checks → auto-rollback. **Tier 2 (Error-correlated):** Critical error count >10 within 5 min → rollback with RCA context. Graph query finds last healthy deployment via `SUCCEEDED_BY` chain |
| 13 | **Three-Channel Notifications** | GitHub PR comment + Slack Block Kit message + HTML email — all fired simultaneously on rollback events |
| 14 | **Deployment Risk Scoring** | **Layer 1 (Heuristic, Day 0):** file count, diff size, high-risk paths, time-of-day. Scores labeled `heuristic` on fresh installs |

### Graph Model After v2.0.0

```
(Service) ←─[DEPLOYED_TO]── (Deployment) ──[BASED_ON]──→ (Commit) ──[CHANGED_FILE]──→ (File)
                                  │                                                      │
                             [CAUSED_ERROR]                                      [RELATED_TO_FILE]
                                  ↓                                                      │
                            (ErrorPattern) ←─────────────────────────────────────────────┘
                                  
(Deployment #47) ──[TRIGGERED]──→ (RollbackEvent) ──[ROLLED_BACK_TO]──→ (Deployment #46)
(Deployment #47) ──[REPLACED_BY]──→ (Deployment #46)   // audit trail only
```

### Key APIs (New in v2.0.0)

```
GET  /api/deployments/:id/rca               Root Cause Analysis result
GET  /api/deployments/:id/compare/:prevId   Side-by-side comparison
GET  /api/deployments/:id/rollback-preview  Preview rollback impact
POST /api/deployments/:id/rollback          Trigger manual rollback
GET  /api/deployments/:id/logs              Last 500 log lines
```

### Rollback Safety Rules

| Rule | Behavior |
|---|---|
| **Cooldown** | After auto-rollback, disable auto-rollback for that service for **15 minutes** |
| **Rollback failure** | If re-run itself fails → `needs_manual_intervention` — NO cascading rollback |
| **Max depth** | Maximum rollback depth is **1** — never chain rollbacks |
| **Manual override** | Manual rollback always available, even during cooldown |

### Exit Criteria

- [ ] LogFetchJob fetches and parses GitHub Actions zip logs successfully
- [ ] RCA panel populates within 5 seconds of viewing a failed deployment
- [ ] Automated rollback fires within 5 minutes of health degradation (Tier 1)
- [ ] All 3 notification channels receive rollback alert with correct payload
- [ ] Deployment comparison shows git diff between working and broken versions
- [ ] Risk score displayed on every new deployment (heuristic label on fresh install)

---

## v3.0.0 — "Prevent Failures"

> *Know what's risky before you push*

**Release goal:** Shift from reactive (fix after failure) to proactive (prevent before push). Graph-enhanced risk scoring uses deployment history to flag dangerous commits. Interactive graph visualization lets teams explore the full deployment topology. Environment drift detection catches config mismatches before they cause failures.

### What Ships

| # | Feature | Description |
|---|---|---|
| 15 | **Graph-Enhanced Risk Scoring** | **Layer 2** activates after 10+ deployments. Files with >2 prior failure appearances get +0.10 each (capped at 0.30). Scores labeled `graph-enhanced` with badge in UI |
| 16 | **Environment Drift Detection** | GitHub Secrets key-presence drift — compare key sets between deployments. Added/removed keys highlighted in drift panel. Optional opt-in `GET /env-check` endpoint for value-hash comparison |
| 17 | **Interactive Graph Visualization** | react-force-graph powered deployment chain explorer at `/graph`. Zoom, pan, click nodes to drill into deployment details |
| 18 | **Rollback Impact Preview** | Before confirming rollback, see: what version you're rolling back to, files that will change, health delta, services affected by blast radius |
| 19 | **Service Dependency Graph** | Visual `DEPENDS_ON` relationship map — blast radius analysis. If `postgres` goes down, see all affected downstream services |
| 20 | **PR/Governance Checks** | Automated GitHub PR comments: large diff warnings, critical file alerts (touches `config/`, `database`, `.env`), risk score badge posted to PR |

### Key APIs (New in v3.0.0)

```
GET  /api/services/:id/env-drift            Secret key drift analysis
GET  /api/graph/deployment-chain/:id        Deployment chain for visualization
GET  /api/graph/failure-chain/:id           Failure graph for visualization
GET  /api/graph/service-dependencies        Service dependency graph
GET  /api/analytics/risk                    File-level historical risk scores
```

### Risk Scoring — Full Two-Layer System

```
Layer 1 — Baseline Heuristics (Day 0):
  Files changed:    each file +0.02, capped at 0.30
  Diff size:        >200 lines → +0.15
  High-risk path:   auth/, config/, database, .env → +0.20 each, capped at 0.40
  Friday deploy:    +0.10 | Weekend: +0.05

Layer 2 — Graph-Enhanced (after 10+ deploys):
  File failure history:   >2 failures → +0.10/file, capped at 0.30
  Recent service failure: +0.10
  
Final score: clamped to max 1.0
  🟢 Low (0.0–0.3) | 🟡 Medium (0.3–0.7) | 🔴 High (0.7–1.0)
```

### Exit Criteria

- [ ] Risk score shows `graph-enhanced` label after 10+ deployments
- [ ] Interactive graph visualization renders deployment chain correctly
- [ ] Environment drift panel shows added/removed secret keys
- [ ] Rollback impact preview renders before confirmation step
- [ ] PR governance check posts comment to GitHub PR

---

## v4.0.0 — "Ship at Scale"

> *Production-ready for teams*

**Release goal:** Harden Fortis-CI for real-world production use. Enterprise license gating, Kubernetes deployment via Helm, performance optimization, installation wizard, and the meta-demo — Fortis-CI tracking its own deployments. After v4.0.0, Fortis-CI is ready for any team to self-host with confidence.

### What Ships

| # | Feature | Description |
|---|---|---|
| 21 | **Enterprise License Validation** | `SENTINEL_LICENSE_KEY` env var → validated against `license.fortis-ci.io`. Gates: RBAC, SSO, audit logs, advanced analytics. OSS mode runs with full core features without a key |
| 22 | **Performance Hardening** | Neo4j query optimization, index tuning, Redis cache review. Target: dashboard <3s, API <500ms, graph RCA <1s |
| 23 | **Helm Chart** | Kubernetes self-hosting: `helm install fortis-ci ./charts/fortis-ci`. Configurable via `values.yaml` |
| 24 | **Meta-Demo** | Fortis-CI tracking its own GitHub Actions deployments — the ultimate dogfooding proof. Ships as a pre-configured demo mode |
| 25 | **Installation Wizard** | CLI or web UI for first-run configuration: GitHub token, webhook secret, OAuth credentials, SMTP, Slack — all validated before stack starts |
| 26 | **Full Documentation** | Complete API reference, architecture guide, troubleshooting playbook, contribution guide |

### Service Registration — Full Evolution

| Version | Method | How It Works |
|---|---|---|
| **v1.0.0** | YAML Config Import | `fortis-ci import --file fortis-ci-services.yml` — bulk registration via config file |
| **v1.0.0** | UI Registration | `/services/new` — manual form: name, repo URL, health endpoint, dependencies |
| **v2.0.0–v3.0.0** | GitHub Auto-Discovery | Connect GitHub Org via OAuth → checklist of repos → fill health URLs → Register All |
| **v4.0.0** | Zero-Config Auto-Registration | Unknown webhook → auto-create `unconfirmed` Service → prompt to configure health endpoint |

### Exit Criteria

- [ ] One-command install (`docker compose up -d`) works on a fresh VM
- [ ] Fortis-CI tracking its own deployments (meta-demo live)
- [ ] Enterprise license key gates advanced features (`license.fortis-ci.io` check)
- [ ] Helm chart deploys Fortis-CI to a Kubernetes cluster successfully
- [ ] Installation wizard validates all config before stack starts

---

## Post-v4.0.0 Roadmap

| Feature | Description | Priority |
|---|---|---|
| **External Metrics Integration** | Ingest webhooks from Prometheus / Grafana / Datadog (`POST /webhooks/alerts`) to trigger rollbacks based on infra metrics (CPU, memory, custom rules) | High |
| **LLM-Assisted RCA** | Send error context + git diff to Gemini/OpenAI for natural language root cause explanation | High |
| **SSE (Server-Sent Events)** | Real-time dashboard updates — replace polling. Deferred: non-trivial with Next.js App Router + RSC | Medium |
| **React Native Mobile App** | Push notifications, quick rollback from mobile, health status at a glance | Medium |
| **Fortis-CI Cloud** | Managed hosted offering — Phase 3 of business model. We host it for teams who prefer not to self-host | Medium |
| **GitLab CI Integration** | Extend webhook ingestion beyond GitHub to support GitLab CI/CD pipelines | Medium |
| **RBAC / SSO** | Role-based access control + SAML/OIDC single sign-on — full enterprise edition | Low (v4 Enterprise) |
| **Neo4j GDS** | Graph Data Science library for anomaly detection — **requires Neo4j Enterprise edition** | Low |

---

## Version Progression Summary

```
v1.0.0 — See Everything        v2.0.0 — Fix Faster           v3.0.0 — Prevent Failures     v4.0.0 — Ship at Scale
━━━━━━━━━━━━━━━━━━━━━━━━       ━━━━━━━━━━━━━━━━━━━━━━━━       ━━━━━━━━━━━━━━━━━━━━━━━━       ━━━━━━━━━━━━━━━━━━━━━━━━
✅ Docker Compose stack         ✅ LogFetchJob (async)          ✅ Graph-enhanced risk          ✅ Enterprise license
✅ Neo4j schema                 ✅ RCA engine (8 patterns)      ✅ Environment drift             ✅ Performance hardening
✅ Webhook ingestion            ✅ Git diff integration         ✅ Graph visualization           ✅ Helm chart (K8s)
✅ Deployment tracking          ✅ Deployment comparison        ✅ Rollback impact preview       ✅ Meta-demo
✅ Health monitoring             ✅ Auto-rollback engine         ✅ Service dependency graph      ✅ Installation wizard
✅ Basic dashboard              ✅ 3-channel notifications      ✅ PR governance checks          ✅ Full documentation
✅ Manual redeploy              ✅ Risk scoring (Layer 1)
                                                                                                
"What's deployed?"              "What broke & how to fix?"     "What's risky before push?"     "Ready for production"
```

---

## License

Apache 2.0 — open-source, free to use, modify, and self-host. No copyleft restrictions.
Enterprise features (RBAC, SSO, audit logs) require a valid license key from `license.fortis-ci.io`.
