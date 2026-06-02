# Fortis-CI API Reference (Contract)

This document serves as the strict API contract for the Frontend and Backend. 
**Do not deviate from these paths or payloads without discussion.**

---

## 1. Webhooks (Ingestion)

### `POST /webhooks/github`
Receives webhook events from GitHub Actions.
- **Headers:** `X-Hub-Signature-256` required for validation.
- **Payload:** GitHub `workflow_job` or `workflow_run` JSON.
- **Response:** `202 Accepted` (processing is asynchronous).
- **Note:** Supports both per-repo and GitHub Organization-level webhooks. Fortis-CI matches `repository.full_name` from the payload against registered services. Unregistered repos are silently skipped with `200 OK`.

---

## 2. Deployments

### `GET /api/deployments`
List deployment history across all services.
- **Query Params:** `?page=1&limit=50&serviceId=abc` (optional)
- **Response:**
  ```json
  {
    "data": [
      {
        "id": "run-12345",
        "service_name": "payment-service",
        "version": "v1.4.2",
        "status": "success",
        "completed_at": "2026-05-27T10:00:00Z"
      }
    ],
    "pagination": { "total": 1, "page": 1 }
  }
  ```

### `GET /api/deployments/:id`
Get full details of a specific deployment.

### `GET /api/deployments/:id/rca`
Get the Root Cause Analysis for a failed deployment.
- **Response:**
  ```json
  {
    "status": "complete",
    "confidence_score": 87,
    "errors": [
      { "type": "DB Connection", "message": "Connection refused", "occurrences": 15 }
    ]
  }
  ```

### `GET /api/deployments/:id/compare/:prevId`
Get a side-by-side comparison of two deployments (Diff + Metrics).

### `GET /api/deployments/:id/logs`
Get the raw GitHub Actions log lines for a deployment.

---

## 3. Rollbacks & Actions

### `GET /api/deployments/:id/rollback-preview`
Preview what will happen if a rollback is triggered.
- **Response:** Returns the target fallback deployment ID and the affected services.

### `POST /api/deployments/:id/rollback`
Trigger a manual rollback via GitHub Re-run API.
- **Response:** `200 OK`
  ```json
  { "message": "Rollback triggered", "target_run_id": "98765" }
  ```

### `POST /api/deployments/:id/redeploy`
Trigger a manual redeploy of the exact same deployment.

---

## 4. Services Registry

### `GET /api/services`
List all tracked services.

### `POST /api/services`
Register a new service to track.
- **Payload:**
  ```json
  {
    "name": "payment-service",
    "github_repo": "org/payment-service",
    "health_url": "http://payment-svc.internal:8080/health",
    "environment": "production",
    "path_filter": "",
    "dependencies": ["auth-service", "postgres"],
    "rollback_strategy": "rerun"
  }
  ```
- **Fields:**
  - `name` (required): Internal service name
  - `github_repo` (required): GitHub `owner/repo` — used to match incoming webhooks via `repository.full_name`
  - `health_url` (required): Internal URL Fortis-CI will poll every 60s (can be VPC-internal since Fortis-CI is self-hosted)
  - `environment` (optional): `production` | `staging` | `development`
  - `path_filter` (optional): Glob pattern for monorepo support (e.g., `services/payment/**`). If empty, the service matches all webhooks from the repo (standard microservice behavior). Multiple services can share the same `github_repo` with different `path_filter` values.
  - `dependencies` (optional): Array of other registered service names — creates `DEPENDS_ON` relationships for blast radius analysis
  - `rollback_strategy` (optional): `rerun` (default — re-run previous successful workflow) | `workflow_dispatch` (trigger a specific workflow)

### `POST /api/services/import`
Bulk import services from a YAML config file.
- **Content-Type:** `multipart/form-data`
- **Body:** `file` field containing a `fortis-ci-services.yml` file
- **Response:** `201 Created` with count of services registered and any errors

### `GET /api/services/:id/env-drift`
Compare the GitHub Secrets key presence between the latest deployment and the previous one.

---

## 5. Health Status

### `GET /api/health-status`
Get the real-time health status of all tracked services.
- **Response:**
  ```json
  [
    {
      "service_name": "payment-service",
      "status": "degraded",
      "latency_ms": 1200,
      "last_checked": "2026-05-27T10:05:00Z"
    }
  ]
  ```

### `GET /api/health-status/:serviceId`
Get the historical health timeline for a specific service (used for charts).
