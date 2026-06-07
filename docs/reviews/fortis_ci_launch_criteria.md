# Fortis-CI Launch Criteria & Risk Engine

This document defines the strict requirements for transitioning Fortis-CI through its operational phases, the design of the deployment risk engine, and the onboarding expectations for an initial customer.

## 1. Production Readiness Checklist

Fortis-CI must be phased into production. You cannot turn on Auto-Rollback on Day 1.

### Phase 1: Observer Mode (Read-Only)
*Hard Requirements to Enable:*
*   **Webhook Integrity:** GitHub Organization-level webhook is active and `X-Hub-Signature-256` HMAC validation is strictly enforced.
*   **Registry Complete:** All critical microservices are defined in `services.yml` with accurate `repoUrl` and `path_filter` (for monorepos).
*   **Health Baseline:** The 60-second health worker completes all polls in < 15 seconds. There are zero HTTP 404s or persistent 503s from the configured endpoints.
*   **Rate Limits:** The GitHub Personal Access Token has > 2,000 requests/hour headroom remaining.

### Phase 2: Manual Recovery Mode (RCA + UI Rollback)
*Hard Requirements to Enable:*
*   **Log Processing Verification:** The `LogFetchJob` must consistently download, unzip, and parse GitHub Actions logs in under 30 seconds without OOMing the container.
*   **Permissions:** The GitHub Token used by Fortis-CI must explicitly possess the `repo` and `workflow` write scopes to execute the `POST /repos/{owner}/{repo}/actions/runs/{id}/rerun` API.
*   **Graph Completeness:** At least one continuous `SUCCEEDED_BY` chain of length > 5 exists in the graph to ensure manual rollback targets are available.

### Phase 3: Auto Rollback Mode (The Intelligence Layer)
*Hard Requirements to Enable:*
*   **Stateful Commit Blocking:** Fortis-CI MUST have logic deployed to parse Git diffs and set `has_stateful_changes: true` if `**/migrations/**` or `**/*.sql` are touched.
*   **Zero-Flap Baseline:** The target service must demonstrate a 14-day history with **0% false-positive `Down` states**. If the service occasionally drops for 3 minutes due to natural network blips, auto-rollback will be a disaster.
*   **Cooldown Validation:** The 15-minute post-rollback circuit breaker has been explicitly tested and confirmed working in staging.

---

## 2. Deployment Risk Engine Design

The Risk Engine evaluates the payload before the deployment finishes, assigning a risk tier based on structural changes.

**Inputs:**
*   `Changed Files`: Extracted from the Git Diff.
*   `Dependencies`: Modifications to `package.json`, `go.mod`, etc.
*   `Infrastructure`: Modifications to Helm charts, `Dockerfile`, or Terraform.
*   `Stateful`: Modifications to database schema/migrations.

**Output Tiers:**

| Tier | Score | Trigger Conditions | Action |
| :--- | :--- | :--- | :--- |
| **Low** | `0.0 - 0.3` | UI/CSS changes, Read-only endpoints, markdown files. | Proceed silently. |
| **Medium** | `0.3 - 0.7` | Standard API logic changes, minor/patch dependency bumps. | Log risk score. |
| **High** | `0.7 - 0.9` | Touches `auth/`, `.env`, major dependency bumps, `Dockerfile` changes. | Flag in GitHub PR. Auto-rollback armed. |
| **Critical** | `1.0` | Touches `**/migrations/**`, `.sql`, or core schema logic. | **Disable Auto-Rollback.** Flag as stateful. |

---

## 3. Failure Classification & Graph Representation

Not all failures are code failures. Fortis-CI must classify and represent them correctly in Neo4j.

1.  **Infrastructure Failure:** Kubernetes/ArgoCD fails to schedule the pod, or the container CrashLoopBackOffs.
    *   *Graph Impact:* `Deployment` node marked `status: failed`. However, there will be NO `ErrorPattern` nodes linked via `CAUSED_ERROR` because the application never actually booted to emit application logs.
2.  **Deployment Failure:** The application boots, but a logical bug immediately throws exceptions.
    *   *Graph Impact:* `Deployment` -> `CAUSED_ERROR` -> `ErrorPattern` (e.g., `Timeout`) -> `RELATED_TO_FILE` -> `auth.ts`.
3.  **Dependency Failure:** Service A is perfectly healthy code, but Service B (which A depends on) is down.
    *   *Graph Impact:* Service A's `/health` endpoint returns 503. The graph shows `Service A -[:DEPENDS_ON]-> Service B`. Both services exhibit `Down` `HealthCheck` nodes simultaneously.
4.  **Business Failure:** Infrastructure is up, logs are clean, but Business KPIs drop to zero (e.g., cart checkouts fail silently).
    *   *Graph Impact:* Handled exactly like a Deployment Failure. The microservice's `/health` endpoint is designed to fail if business metrics drop. Fortis-CI records `Down` and initiates rollback.

---

## 4. First Customer Onboarding Strategy

**Target Profile:** 20 microservices, GitHub Actions, ArgoCD, Kubernetes.

**Onboarding Time:** < 1 Hour.

**Information They Must Provide:**
Because Fortis-CI does not natively auto-discover services in V1, the customer must provide a `services.yml` file defining the 20 services, their `repoUrls`, `path_filters` (if monorepo), and HTTP `/health` endpoints. They must also provide a GitHub PAT and Webhook Secret.

**What is Auto-Discovered:**
*   Commit SHAs
*   File Diffs
*   Deployment Timelines
*   Error Patterns (via Logs)
*   Health State (via Polling)

**The ArgoCD "Blindspot" (Critical Warning for Customer 1):**
Because this customer uses ArgoCD, Fortis-CI will experience a timing discrepancy. Fortis-CI will record the deployment as complete when GitHub Actions finishes pushing the image to the registry. ArgoCD might take an additional 3 minutes to pull the image and roll out the pods. The customer must be informed that Fortis-CI's health polling will be validating the *old* version of the app for those 3 minutes until ArgoCD completes the sync. (Full ArgoCD webhook integration is a post-V1 roadmap requirement to close this gap).
