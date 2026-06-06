# Fortis-CI API Reference

Fortis-CI provides a REST API to query the graph database and trigger deployments programmatically.

## Base URL
`http://localhost:3001/api`

---

## Deployments

### `GET /api/deployments`
Retrieves a paginated list of deployments.
**Query Params:** `page` (default: 1), `limit` (default: 50)
**Response:** `Array<Deployment>`

### `GET /api/deployments/:id`
Retrieves a single deployment by ID, including its associated Git commit and RCA error patterns.
**Response:** `DeploymentWithCommit`

### `POST /api/deployments/:id/redeploy`
Triggers a manual GitHub Actions rerun for the specified deployment.
**Response:** `{ message: "Successfully triggered GitHub Actions run #..." }`

### `POST /api/deployments/:id/rollback`
Automatically finds the last healthy deployment for the service and triggers a rollback.
**Response:** `{ message: "Rollback initiated successfully" }`

### `GET /api/deployments/:id/env-drift`
Analyzes the deployment for added, removed, or modified GitHub secrets compared to the previous deployment.
**Response:** `{ added: string[], removed: string[], modified: string[] }`

---

## Services & Graph

### `POST /api/services`
Registers a new service into the Neo4j graph.
*Note: Limited to 3 services on the OSS Free Tier.*
**Body:** `{ name, repoUrl, healthEndpoint, environment, dependencies }`

### `GET /api/graph/service-dependencies`
Retrieves nodes and edges for the Service dependencies topology graph.
**Response:** `{ nodes: Node[], links: Link[] }`

### `GET /api/graph/deployment-chain/:serviceId`
Retrieves the success/failure chain for a specific service.
**Response:** `{ nodes: Node[], links: Link[] }`
