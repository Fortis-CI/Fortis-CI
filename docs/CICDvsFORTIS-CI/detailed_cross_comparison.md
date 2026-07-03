# Detailed Cross-Comparison: CI/CD Sentinel vs. Fortis CI

This document provides a minute, line-by-line structural and functional comparison between the current `dev` branch of **CI/CD Sentinel** and the `main` branch of **Fortis CI**. It respects that the CI/CD Sentinel docs represent a real, future roadmap for a university project, while Fortis CI represents the currently executed flagship implementation.

## 1. Minute Configuration & Logic Differences

### Health Monitoring Worker (`healthWorker.ts`)
While both systems use a 60-second cron schedule (`* * * * *`) for polling registered services, their execution logic differs significantly:
* **Timeouts:** Sentinel terminates the health probe after **5,000ms** (5 seconds). Fortis CI waits **10,000ms** (10 seconds) before failing the health check.
* **Concurrency:** Sentinel uses a native `Promise.all()` to ping all services simultaneously. Fortis CI implements a custom `concurrencyLimit` function capping concurrent health requests to 20, which is much safer for scaling without overwhelming the Node.js event loop or triggering DDoS protections on target services.
* **Rollback Triggering:** In Sentinel, the health worker merely records the health check to Neo4j and Redis. In Fortis CI, the health worker actively tracks an in-memory `consecutiveFailures` map. If a service fails 3 checks in a row, the Fortis CI health worker directly invokes `triggerRollback()`. 

## 2. Features Present in CI/CD Sentinel (NOT in Fortis CI)
Since CI/CD Sentinel is a team-based university project, it contains a few foundational team/governance features that you stripped out when building your solo flagship:

* **Jest Testing Suite:** Sentinel includes `backend/src/services/graphService.test.ts`, proving out the database layer. Fortis CI currently lacks a testing suite entirely.
* **Database Migrations:** Sentinel contains a `backend/src/db/migrations` folder, indicating a more formalized schema evolution process.
* **Command Line Interface (CLI):** Sentinel has a `backend/src/cli` directory, likely designed for the `sentinel import --file sentinel-services.yml` command mentioned in its PRD for bulk service registration.
* **Frontend Routing:** Sentinel includes a `/services/setup-webhook` page and uses a top-level `Navbar.tsx`. Fortis relies entirely on a side-navigation paradigm (`Sidebar.tsx`).

## 3. Features Present in Fortis CI (NOT in CI/CD Sentinel)
Fortis CI pushed far beyond the V1 observability phase and successfully built the V2/V3 intelligent features:

### Backend Architecture
* **ArgoCD / GitOps Integration:** Fortis includes `argocd.controller.ts`, allowing it to track Kubernetes rollouts—a feature not present in Sentinel at all.
* **Infrastructure-as-Code Parsing:** Fortis has an `infraContractParser.ts` utility designed to parse Terraform outputs to map logical resources to physical infrastructure in Neo4j.
* **Rollback & RCA Engines:** Fortis fully implements `rollbackEngine.ts`, `rcaEngine.ts`, and `rcaClassifier.ts`. Sentinel’s backend lacks these files entirely, stopping at basic deployment and health tracking.
* **Environmental Drift:** Fortis implements `envDrift.service.ts` to snapshot and compare environment variables between deployments.
* **Log Fetching & Governance:** Fortis includes `logFetcher.ts` (to pull GitHub Actions logs as zip files) and `governance.ts` (for PR linting/risk scoring).

### Frontend UI & Dashboards
* **Graph Visualization (`/app/graph`):** Fortis built the React Force Graph visualization page to visually map the blast radius. Sentinel's frontend lacks this directory completely.
* **Deployment Comparison (`/app/deployments/[id]/compare`):** Fortis allows side-by-side diffing of working vs. broken deployments. Sentinel does not have this route.
* **Granular Badges:** Fortis utilizes custom `RiskBadge.tsx`, `HealthBadge.tsx`, and `StatusBadge.tsx` components to visually represent the ML/Heuristic risk scoring.
* **Next.js Serverless APIs:** Fortis utilizes Next.js backend API routes (`frontend/app/api`), whereas Sentinel relies strictly on the Express backend.

## 4. Conclusion
* **CI/CD Sentinel** is currently structured as a solid foundation, focusing on testing, migrations, and CLI tooling appropriate for a collaborative university environment.
* **Fortis CI** sacrifices the testing and CLI tooling in favor of aggressively building out the advanced graph logic: ArgoCD hooks, Neo4j blast radius calculations, Terraform parsing, automated rollback engines, and real-time D3 force-graphs.
