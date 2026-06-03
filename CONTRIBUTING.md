# Contributing to Fortis-CI

First off, thank you for considering contributing to Fortis-CI! It's people like you that make open source such a great community.

---

## Table of Contents

- [Local Development Setup](#local-development-setup)
- [Running Tests](#running-tests)
- [Seeding Neo4j with Test Data](#seeding-neo4j-with-test-data)
- [Branching Strategy](#branching-strategy)
- [Making a Pull Request](#making-a-pull-request)
- [Good First Issues](#good-first-issues)
- [Code Style](#code-style)
- [Code of Conduct](#code-of-conduct)

---

## Local Development Setup

### Prerequisites

- **Docker + Docker Compose** (for Neo4j + Redis)
- **Node.js 18 LTS** (for backend)
- **npm** or **yarn**
- **GitHub Personal Access Token** (with `repo`, `workflow`, `read:org` scopes)
- **GitHub OAuth App** (for dashboard login — [create one here](https://github.com/settings/developers))

### Step 1 — Clone and Install

```bash
git clone https://github.com/ganeshak11/Fortis-CI
cd Fortis-CI
```

### Step 2 — Start Infrastructure (Neo4j + Redis)

For local development, you run Neo4j and Redis via Docker Compose but run the backend and frontend natively (with hot reload):

```bash
# Start only the infrastructure containers
docker compose up neo4j redis -d
```

This starts:
- **Neo4j** on `bolt://localhost:7687` (browser at `http://localhost:7474`)
- **Redis** on `redis://localhost:6379`

### Step 3 — Configure Environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your values. For local development, the minimum required variables are:

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=fortis-ci_password
REDIS_URL=redis://localhost:6379
GITHUB_TOKEN=ghp_your_token
GITHUB_WEBHOOK_SECRET=any_local_secret
JWT_SECRET=any_local_secret
NODE_ENV=development
```

### Step 4 — Start the Backend (Hot Reload)

```bash
cd backend
npm install
npm run dev
```

The backend API runs at `http://localhost:3001` with hot reload via `nodemon` or `tsx watch`.

### Step 5 — Start the Frontend (Hot Reload)

```bash
cd frontend
npm install
npm run dev
```

The Next.js dashboard runs at `http://localhost:3000` with hot reload.

### Full Production Mode (Optional)

If you want to test the full Docker Compose stack as it would run in production:

```bash
docker compose up -d
```

This starts all 4 containers: Neo4j, Redis, Backend, Frontend.

---

## Running Tests

### Backend Tests

```bash
cd backend
npm test              # Run all tests
npm run test:watch    # Watch mode (re-runs on file changes)
npm run test:coverage # Run with coverage report
```

### Frontend Tests

```bash
cd frontend
npm test
```

### Linting

```bash
# Backend
cd backend
npm run lint

# Frontend
cd frontend
npm run lint
```

---

## Seeding Neo4j with Test Data

For development, you'll want some sample data in your graph. After starting Neo4j, you can seed it:

### Option 1 — Run the Schema Setup

The backend auto-creates constraints and indexes on startup. If you need to manually run them:

```bash
# Connect to Neo4j browser at http://localhost:7474
# Run the queries from backend/src/db/schema.cypher
```

### Option 2 — Manual Seed Data

Open the Neo4j browser at `http://localhost:7474` and run:

```cypher
// Create sample services
CREATE (s1:Service {
  id: 'svc-001',
  name: 'payment-service',
  repo_url: 'https://github.com/your-org/payment-service',
  path_filter: '',
  health_endpoint: 'http://localhost:8080/health',
  environment: 'development',
  registered_at: datetime()
})
CREATE (s2:Service {
  id: 'svc-002',
  name: 'auth-service',
  repo_url: 'https://github.com/your-org/auth-service',
  path_filter: '',
  health_endpoint: 'http://localhost:8081/health',
  environment: 'development',
  registered_at: datetime()
})
CREATE (s1)-[:DEPENDS_ON]->(s2)

// Create sample deployments
CREATE (d1:Deployment {
  id: 'dep-001',
  workflow_run_id: 'wfr-001',
  version: 'v1.0.0',
  commit_sha: 'abc123',
  status: 'success',
  risk_score: 0.15,
  completed_at: datetime() - duration('P2D')
})
CREATE (d2:Deployment {
  id: 'dep-002',
  workflow_run_id: 'wfr-002',
  version: 'v1.1.0',
  commit_sha: 'def456',
  status: 'failed',
  risk_score: 0.72,
  completed_at: datetime() - duration('P1D')
})
CREATE (d1)-[:DEPLOYED_TO]->(s1)
CREATE (d2)-[:DEPLOYED_TO]->(s1)
CREATE (d1)-[:SUCCEEDED_BY]->(d2)

// Create sample commit and file
CREATE (c:Commit {
  sha: 'def456',
  message: 'Update database config',
  author: 'developer',
  branch: 'main',
  additions: 3,
  deletions: 1,
  files_changed: 1
})
CREATE (f:File {
  path: 'src/config/database.ts',
  language: 'typescript',
  change_type: 'modified'
})
CREATE (d2)-[:BASED_ON]->(c)
CREATE (c)-[:CHANGED_FILE]->(f)
CREATE (f)-[:BELONGS_TO]->(s1)
```

---

## Branching Strategy

We use a simple 2-branch strategy:

- **`main`** — stable, tagged releases (`v1.0`, `v2.0`, etc.). All PRs merge here.
- **`feature/*`** — all work happens here. Never push directly to `main`.

### Branch Naming Convention

```
feature/short-description     # Feature work
feature/fix-health-worker     # Bug fixes
feature/docs-update-prd       # Documentation
```

---

## Making a Pull Request

1. **Fork** the repo and create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes.** Follow the code style guidelines below.

3. **Add tests** if you've added code that should be tested.

4. **Ensure the test suite passes:**
   ```bash
   cd backend && npm test
   cd frontend && npm test
   ```

5. **Ensure your code lints:**
   ```bash
   cd backend && npm run lint
   cd frontend && npm run lint
   ```

6. **Push and open a PR** using the push script:
   ```bash
   # Linux/macOS
   ./push.sh

   # Windows
   .\push.ps1
   ```

   The push scripts enforce: no direct push to `main`, require commit message, run tests.

7. **Describe your changes** in the PR description. Link to any relevant issues.

---

## Good First Issues

If you're looking for a place to start, look for issues labeled [`good first issue`](https://github.com/ganeshak11/Fortis-CI/labels/good%20first%20issue). These are typically:

- **Documentation improvements** — fixing typos, adding examples, improving clarity
- **UI polish** — improving dashboard styling, adding loading states, better error messages
- **Test coverage** — adding unit tests for existing services
- **Small features** — adding a new error pattern to the regex library, improving log parsing

### Areas That Welcome Contributions

| Area | Files | Difficulty |
|---|---|---|
| Error pattern library | `backend/src/utils/errorPatterns.ts` | Easy |
| Risk score calculator | `backend/src/utils/riskScorer.ts` | Easy |
| Dashboard components | `frontend/components/` | Medium |
| Graph queries | `backend/src/services/graphService.ts` | Medium |
| Health worker | `backend/src/services/healthWorker.ts` | Medium |
| RCA engine | `backend/src/services/rcaService.ts` | Hard |
| Rollback engine | `backend/src/services/rollbackService.ts` | Hard |

---

## Code Style

- **TypeScript** for all backend code
- **Prettier** for formatting (config in `.prettierrc`)
- Run `npm run lint` before committing
- Preserve existing comments and docstrings
- Use descriptive variable names — avoid abbreviations

---

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
