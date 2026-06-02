# Fortis-CI Project & Operations Checklist

This checklist tracks the entire lifecycle of the Fortis-CI project from a repository owner's perspective — from local development to open-source distribution.

---

## 1. Repository & Infrastructure Setup (Phase 0)
*Foundation steps to secure the repo and prepare for development.*

- [x] **Branch Protection Rules:** Configure GitHub to protect `main` branch (require PRs, require approvals, prevent force pushes).
- [x] **Issue & PR Templates:** Create `.github/ISSUE_TEMPLATE` and `.github/PULL_REQUEST_TEMPLATE` for standardized contributions.
- [ ] **GitHub Secrets:** Add necessary secrets to the repo for Fortis-CI actions (e.g., `DOCKER_HUB_TOKEN` or `GHCR_TOKEN`).
- [x] **Local Docker Compose:** Finalize the local `docker-compose.yml` so any developer can run `docker compose up` to get Neo4j, Redis, and Node environments instantly.
- [x] **Linting & Formatting:** Enforce ESLint and Prettier across frontend and backend to prevent code style conflicts.

---

## 2. Development Workflow
*How features are built and merged during each version (V1, V2, etc.).*

- [ ] **Branching:** Ensure contributors create branches from `main` (e.g., `feature/webhook-ingest`).
- [ ] **Draft PRs:** Encourage opening PRs early as drafts so maintainers can monitor architecture direction.
- [ ] **Integration Review:** You review PRs against `main` for:
    - Database safety (e.g., missing Neo4j indexes, unoptimized Cypher queries).
    - API contracts (does the frontend expect what the backend sends?).
- [ ] **Merge to Dev:** Squash and merge feature branches into `main` when approved.
- [ ] **Version Stabilization:** Once all V1 features are in `main`, run end-to-end local tests. Fix any integration bugs directly on `main`.

---

## 3. Production Readiness & CI (Continuous Integration)
*Ensuring the code is ready to be built into production artifacts.*

- [ ] **Dockerfiles:** Write optimized, multi-stage Dockerfiles for the Backend (Node) and Frontend (Next.js).
- [x] **CI Pipeline (Build & Test):** Create a GitHub Action (`.github/workflows/ci.yml`) that runs on every PR to `main` and `main` to build the Docker images and run tests (ensures the build isn't broken).
- [ ] **Environment Configuration:** Ensure the production `docker-compose.yml` pulls images from the registry rather than building from local source.

---

## 4. Release & Distribution (The Open-Source Way)
*How to package and distribute Fortis-CI to end-users without making them compile code.*

- [ ] **Version Bump:** Update version numbers in `package.json` and prepare release notes.
- [ ] **Merge to Main:** Ensure `main` is stable.
- [ ] **Create Tag:** Create a Git tag (e.g., `v1.0.0`) on the `main` branch.
- [ ] **Release Automation (CD):** Create a GitHub Action (`.github/workflows/release.yml`) that triggers on tag creation:
    - [ ] Logs into GitHub Container Registry (`ghcr.io`).
    - [ ] Builds production Docker images for Backend and Frontend.
    - [ ] Pushes images with the tag (e.g., `ghcr.io/your-org/fortis-ci-backend:v1.0.0`).
- [ ] **Release Asset Creation:** The action creates a `fortis-ci-v1.0.0.tar.gz` containing only:
    - `docker-compose.yml` (configured to use the remote images).
    - `.env.example`
    - `install.sh`
- [ ] **Publish GitHub Release:** The action attaches the `.tar.gz` to the GitHub Release page automatically.

---

## 5. End-User Installation Validation
*What an end-user experiences when they download Fortis-CI.*

- [ ] **Download Test:** User downloads `.tar.gz` from the GitHub Releases page.
- [ ] **Extraction Test:** User extracts the archive and copies `.env.example` to `.env`.
- [ ] **Boot Test:** User runs `docker compose up -d` and the pre-built images pull and start in under 30 seconds.
- [ ] **First-run Wizard:** The user can access the dashboard, register their first service, and input their GitHub OAuth credentials.
- [ ] **Service Registration — Single:** Register one service via the UI at `/services/new` (name, repo URL, health URL, environment, dependencies).
- [ ] **Service Registration — Bulk Import:** Import a `fortis-ci-services.yml` via `fortis-ci import --file fortis-ci-services.yml` and verify all services appear in the dashboard.
- [ ] **Service Registration — Auto-Discovery (V2+):** Connect GitHub Org via OAuth, see repo list, select services to track.
- [ ] **Webhook Setup — Per-Repo:** Add Fortis-CI webhook to a single GitHub repo and verify webhook events arrive.
- [ ] **Webhook Setup — Org-Level:** Add Fortis-CI webhook once at GitHub Organization level and verify events from multiple repos are correctly routed to their registered services.
- [ ] **Health Monitoring Activation:** Confirm health worker starts polling immediately after service registration (before any deployment).
- [ ] **Unregistered Repo Filtering:** Send a webhook from a repo NOT registered in Fortis-CI and verify it returns `200 OK` without creating any nodes.
- [ ] **Monorepo Registration:** Register 2+ services with the same `repo_url` but different `path_filter` globs (e.g., `services/auth/**` and `services/payment/**`).
- [ ] **Monorepo Webhook Routing:** Push a commit that only changes `services/payment/config.ts` and verify that ONLY `payment-service` gets a new `Deployment` node — `auth-service` must NOT get one.
- [ ] **Monorepo Full-Repo Change:** Push a commit that changes files across multiple service paths and verify ALL matching services get `Deployment` nodes.

---

## 6. Maintenance & Community
*Post-launch activities.*

- [ ] **Documentation:** Ensure `README.md` and a `/docs` directory are fully updated with architecture, deployment guides, and API specs.
- [ ] **License Tracking:** For V4 (Enterprise), ensure the license validation logic (`license.fortis-ci.io`) accurately gates advanced features.
- [ ] **Community Triaging:** Monitor GitHub Issues for bug reports and feature requests, labeling them appropriately.
- [ ] **Next Steps:** Begin planning features for the next version (e.g., V2).
