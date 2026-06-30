# Fortis-CI

![Version](https://img.shields.io/badge/version-v1.0.0-blueviolet)
![Database](https://img.shields.io/badge/database-Neo4j%20Graph-blue)
![Type](https://img.shields.io/badge/type-Self--Hosted%20OSS-green)
![Status](https://img.shields.io/badge/status-Released-green)

> **Not your CI. Your CI’s brain.**
>
> Deployment graph intelligence + automated recovery + team notification

Fortis-CI is a **self-hosted, open-source intelligent deployment observability platform** powered by Neo4j. It is deployed as a **single centralized instance** inside your VPC, connects to GitHub Actions via webhooks (supports Organization-level webhooks for multi-repo setups), and gives your team full visibility into what's deployed, what broke, and how to fix it — automatically.

---

## Why Neo4j?

Deployment failures are a graph problem, not a table problem.

```cypher
-- "What caused this failure?" in one traversal
MATCH (d:Deployment {id: $id})-[:CAUSED_ERROR]->(e:ErrorPattern)
MATCH (d)-[:BASED_ON]->(c:Commit)-[:CHANGED_FILE]->(f:File)
WHERE e.severity = 'critical'
RETURN d, e, f, c
```

The entire deployment lifecycle — services, deployments, commits, files, errors, health checks, rollbacks — is modeled as a connected graph. The relationships *are* the intelligence.

---

## What It Solves

| Problem | Fortis-CI's Answer |
|---|---|
| "What broke?" panic after deployment | Graph traversal: error → file → commit → deployment |
| Manual rollback risk | Automated rollback with graph-based last-healthy-deployment query |
| Hours of log analysis | Rule-based error pattern detection with confidence scores |
| Config drift between environments | GitHub Secrets key-presence drift detection |
| Risky rollbacks without preview | Impact preview before rollback confirmation |
| No signal before a risky push | Two-layer risk scoring (heuristic day-0 + graph-enhanced after 10 deploys) |

---

## Features included in v1.0.0

| Feature | Description |
|---|---|
| **See Everything** | Know what's deployed and if it's healthy |
| **Fix Faster** | Know what broke and recover in 60 seconds with automated rollbacks and RCA |
| **Prevent Failures** | Know what's risky before you push with risk scoring |
| **Ship at Scale** | Production-ready for teams with full GitHub Action integration |

All of the above features are shipped in **v1.0.0**.


## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js + Express + TypeScript |
| **Primary Database** | **Neo4j 5.x (Community)** |
| Cache | Redis 7 |
| Frontend | Next.js 14 (App Router) |
| Graph Visualization | react-force-graph |
| Charts | Recharts |
| Auth | NextAuth.js (GitHub OAuth) |
| Notifications | @slack/webhook + Nodemailer |
| Container | Docker + Docker Compose |
| CI/CD Integration | GitHub Actions (Webhooks + REST API) |
| Future Mobile | React Native (Post-V4) |

---

## Architecture

```
GitHub Actions (webhook)
       ↓
Backend API (Node.js + Express + TypeScript)
  ├── Webhook Processor (idempotent — workflow_run_id UNIQUE in Neo4j)
  ├── Async LogFetchJob (GitHub Actions zip → parse → ErrorPattern nodes)
  ├── RCA Engine (rule-based, 8 error pattern types)
  ├── Rollback Engine (Tier 1: health-only | Tier 2: error-correlated)
  ├── Health Worker (60s polling → HealthCheck nodes)
  ├── Notification Service (GitHub PR + Slack + Email)
  └── Git Diff Engine (CHANGED_FILE + RELATED_TO_FILE relationships)
       ↓
Neo4j (Graph) + Redis (Cache)
       ↓
Next.js Dashboard
```

## Architecture

![Fortis-CI Architecture](docs/diagrams/architecture.png)

**Core data model (nodes + relationships):**
```
Service ←─[DEPLOYED_TO]── Deployment ──[BASED_ON]──→ Commit ──[CHANGED_FILE]──→ File
                              │                                                     │
                         [CAUSED_ERROR]                                    [RELATED_TO_FILE]
                              ↓                                                     │
                         ErrorPattern ←──────────────────────────────────────────────
                              │
                         [HAS_HEALTH]
                              ↓
                         HealthCheck
```

---

## Getting Started

### Prerequisites

- Docker + Docker Compose
- GitHub account with a repository
- GitHub Personal Access Token (with `repo`, `workflow`, `read:org` scopes)
- GitHub OAuth App (for dashboard login)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/ganeshak11/Fortis-CI
cd Fortis-CI

# 2. Configure environment    
cp backend/.env.example backend/.env
# Edit backend/.env with your GitHub token, webhook secret, SMTP, Slack

# 3. Start all services
docker compose up -d

# 4. Open dashboard
open http://localhost:3000
# Login with GitHub OAuth
```

### First-Run Setup

1. Login at `http://localhost:3000` with your GitHub account
2. Register your services:
   - **Single service:** Use the UI at `/services/new` (name, repo URL, health endpoint, dependencies)
   - **Bulk import:** Create a `fortis-ci-services.yml` and run `fortis-ci import --file fortis-ci-services.yml`
   - **Auto-discovery:** Connect your GitHub Org and select repos from a checklist
3. Add the GitHub webhook (choose one):
   - **Per-repo:** GitHub repo → Settings → Webhooks → Add webhook
   - **Organization-level (recommended for multi-repo):** GitHub Org → Settings → Webhooks → Add webhook once for all repos
   - Payload URL: `http://your-fortis-ci-host:3001/webhooks/github`
   - Content type: `application/json`
   - Secret: your `GITHUB_WEBHOOK_SECRET` value
   - Events: `Workflow runs`
4. Fortis-CI begins tracking on the next pipeline run (health monitoring starts immediately after registration)

### Environment Variables

```env
# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=fortis-ci_password

# Redis
REDIS_URL=redis://localhost:6379

# GitHub
GITHUB_TOKEN=ghp_your_token
GITHUB_WEBHOOK_SECRET=your_secret
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret

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
NODE_ENV=development

# Enterprise (leave blank for OSS mode)
SENTINEL_LICENSE_KEY=
```

---

## Project Structure

```
FORTIS-CI/
├── backend/
│   ├── src/
│   │   ├── app.ts                    # Express app entry point
│   │   ├── config/                   # Environment config
│   │   ├── db/
│   │   │   ├── index.ts              # Neo4j driver singleton
│   │   │   └── schema.cypher         # Constraints + indexes
│   │   ├── services/
│   │   │   ├── graphService.ts       # Neo4j query layer
│   │   │   ├── webhookService.ts     # GitHub webhook processing
│   │   │   ├── rcaService.ts         # Root Cause Analysis engine
│   │   │   ├── rollbackService.ts    # Auto + manual rollback
│   │   │   ├── healthWorker.ts       # 60s health polling cron
│   │   │   ├── logFetchJob.ts        # GitHub Actions log zip fetch
│   │   │   ├── githubService.ts      # GitHub API abstraction
│   │   │   └── notificationService.ts # PR + Slack + Email
│   │   ├── controllers/              # Route handlers
│   │   ├── routes/                   # Express route definitions
│   │   └── utils/
│   │       ├── errorPatterns.ts      # Regex pattern library
│   │       └── riskScorer.ts         # Risk score calculator
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # Main dashboard
│   │   ├── deployments/              # Deployment history + detail
│   │   ├── graph/                    # Graph visualization
│   │   ├── services/                 # Service registry
│   │   └── rollback/                 # Rollback console
│   ├── components/                   # Reusable UI components
│   └── services/api.ts               # API client
├── docs/
│   ├── PRD.md                        # Product Requirements Document
│   └── architecture.md               # System architecture
├── docker-compose.yml
└── README.md
```

---

## API Reference

```
POST /webhooks/github                       Receive GitHub Actions events (idempotent)

GET  /api/services                          List tracked services
POST /api/services                          Register new service
POST /api/services/import                   Bulk import from YAML config
GET  /api/services/:id/env-drift            Secret key drift analysis

GET  /api/deployments                       Deployment history (paginated)
GET  /api/deployments/:id                   Deployment detail
GET  /api/deployments/:id/rca               Root Cause Analysis result
GET  /api/deployments/:id/compare/:prevId   Side-by-side comparison
GET  /api/deployments/:id/rollback-preview  Preview rollback impact
POST /api/deployments/:id/rollback          Trigger manual rollback
POST /api/deployments/:id/redeploy          Trigger redeploy
GET  /api/deployments/:id/logs              Last 500 log lines

GET  /api/health-status                     Current health per service
GET  /api/health-status/:serviceId          Health history

GET  /api/graph/deployment-chain/:id        Deployment chain for visualization
GET  /api/graph/failure-chain/:id           Failure graph for visualization
GET  /api/graph/service-dependencies        Service dependency graph
GET  /api/analytics/risk                    File-level historical risk scores
```

---

## Development Workflow

### Branch Strategy

```
feature/* → main
```

- `main` — stable, tagged `v1.0`, `v2.0`, etc. on version completion. All PRs merge here.
- `feature/*` — individual work, never pushed to `main` directly without PR.

### Push Scripts

```bash
# Linux/macOS
./push.sh

# Windows
.\push.ps1
```

Scripts enforce: no direct push to `main`, require commit message, run tests.

---

## Business Model

| Phase | Model | Details |
|---|---|---|
| **Now** | Open Source (Apache 2.0) | Full platform free forever |
| **Phase 2** | Enterprise Edition | License key unlocks RBAC, SSO, audit logs |
| **Phase 3** | Fortis-CI Cloud | Managed hosted offering |

Enterprise features are gated via `SENTINEL_LICENSE_KEY`. The core platform always works without it.

---

## Documentation

| Doc | Description |
|---|---|
| **[PRD.md](./docs/PRD.md)** | Full product requirements, graph data model, all 7 gap resolutions |
| **[architecture.md](./docs/architecture.md)** | System architecture, Neo4j queries, rollback algorithm |

---

---

## License

Apache 2.0 — open-source, free to use, modify, and self-host. No copyleft restrictions.
Enterprise features require a valid license key from `license.fortis-ci.io`.
