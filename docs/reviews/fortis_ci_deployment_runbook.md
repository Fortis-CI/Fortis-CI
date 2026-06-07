# Fortis-CI Observer Mode Deployment & Validation Runbook

This runbook provides the exact operational steps, configurations, and validation procedures required to deploy Fortis-CI into the TicketFlow environment safely in Observer Mode.

---

## 1. Observer Mode Deployment Steps

1. **Prepare Configuration:** Define all 20 TicketFlow microservices in `services.yml`. Ensure all `healthEndpoint` definitions point to HTTP 200 exporters, not raw TCP sockets.
2. **Execute Terraform:**
   ```bash
   cd terraform-aws-fortis-ci
   terraform init
   terraform apply -var="environment=staging" -var-file="secrets.tfvars"
   ```
3. **Enforce Observer Safety:** When providing the `GITHUB_TOKEN` to Terraform, you MUST use a Fine-Grained Personal Access Token that **strictly lacks** the `actions:write` or `workflow:write` scopes. This guarantees Fortis-CI is physically incapable of triggering rollbacks, enforcing pure Observer Mode.

---

## 2. GitHub Webhook Configuration

Configure at the **Organization Level** in GitHub:

*   **Payload URL:** `https://<fortis-ci-url>/webhooks/github`
*   **Content Type:** `application/json`
*   **Secret:** Must exactly match the `GITHUB_WEBHOOK_SECRET` environment variable deployed to Fortis-CI.
*   **Events to send:**
    *   `Workflow runs` (Triggers Git diff ingestion and deployment nodes)
    *   `Pull requests` (Triggers governance checks)

---

## 3. ArgoCD Notification Configuration

Apply the following to your `argocd-notifications-cm` ConfigMap:

**Webhook Destination:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
data:
  service.webhook.fortis: |
    url: https://<fortis-ci-url>/webhooks/argocd
    headers:
      - name: Content-Type
        value: application/json
```

**Custom Payload Template:**
```yaml
  template.fortis-ci-rollout: |
    webhook:
      fortis:
        method: POST
        body: |
          {
            "event": "{{.notificationType}}",
            "service": "{{.app.metadata.name}}",
            "infra_commit": "{{.app.status.sync.revision}}",
            "image_tag": "{{ (index .app.spec.source.helm.parameters 0).value }}",
            "timestamp": "{{.app.status.operationState.finishedAt}}"
          }
```

**Triggers:**
Map `on-sync-running`, `on-sync-succeeded`, `on-deployed`, and `on-health-degraded` to send the `fortis-ci-rollout` template to the `fortis` webhook destination.

---

## 4. Required Neo4j Constraints

Execute these Cypher queries immediately after the Neo4j container boots to ensure data integrity and query performance:

```cypher
CREATE CONSTRAINT IF NOT EXISTS FOR (s:Service) REQUIRE s.name IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (d:Deployment) REQUIRE d.workflowRunId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (c:Commit) REQUIRE c.sha IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (a:Artifact) REQUIRE a.tag IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (ic:InfraCommit) REQUIRE ic.sha IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (r:Rollout) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (hi:HealthIncident) REQUIRE hi.id IS UNIQUE;
```

---

## 5. Required Environment Variables

The `fortis-ci-backend` ECS Task requires these exact variables:

*   `PORT`: `3000`
*   `NEO4J_URI`: `bolt://localhost:7687` (Sidecar networking)
*   `NEO4J_USER`: `neo4j`
*   `NEO4J_PASSWORD`: `<secure-password>`
*   `REDIS_URL`: `redis://localhost:6379`
*   `GITHUB_TOKEN`: `<read-only-token>` (Enforces Observer Mode)
*   `GITHUB_WEBHOOK_SECRET`: `<secure-hmac-secret>`
*   `SERVICES_YAML`: `<base64-encoded-services-yml>`

---

## 6. First Deployment Smoke-Test Checklist

- [ ] `GET https://<fortis-ci-url>/ping` returns `200 OK`.
- [ ] Neo4j Browser is accessible via port `7474`.
- [ ] Invalid webhook signatures return `401 Unauthorized`.
- [ ] The Fortis-CI Dashboard loads the `services.yml` registry.
- [ ] Backend logs show: `[HealthWorker] Polling 20 services...` every 60 seconds without timing out.

---

## 7. Validation Procedures

Before the 14-Day Plan, run these 5 specific tests:

1.  **GitHub Workflow Ingestion:**
    *   *Action:* Push a safe commit to `ticketflow-auth`. Let the GitHub Action complete.
    *   *Validation:* Query Neo4j: `MATCH (d:Deployment) RETURN d`. Verify the `workflowRunId` matches GitHub.
2.  **Risk Engine Scoring:**
    *   *Action:* Push a commit modifying `prisma/migrations/fake_migration.sql`.
    *   *Validation:* Verify the Neo4j Deployment node shows `riskScore: 1.0`, `riskLabel: 'Critical'`, and `hasStatefulChanges: true`.
3.  **ArgoCD Rollout Creation:**
    *   *Action:* Trigger an ArgoCD Sync manually.
    *   *Validation:* Verify the `Rollout` node is created. Watch the graph update from `status: 'progressing'` to `status: 'success'` and calculate `durationMs`.
4.  **HealthIncident Creation:**
    *   *Action:* Scale down the `redis` deployment in the `ticketflow-infra` namespace manually.
    *   *Validation:* ArgoCD sends `on-health-degraded`. Verify a `HealthIncident` node is created and linked to the *previous* successful Rollout node.
5.  **Stateful Rollback Blocking:**
    *   *Action:* Attempt to manually trigger a rollback for the Deployment created in Step 2 via the Fortis-CI UI (or API).
    *   *Validation:* The backend immediately logs `Rollback aborted: Deployment contains stateful changes` and the API rejects the request.

---

## 8. Go/No-Go Criteria (Before 14-Day Validation)

You are **GO** for the 14-Day Validation Plan ONLY IF:

1.  **Zero Exceptions:** The backend has run for 24 hours with zero uncaught exceptions or OOM restarts.
2.  **Unbroken Trace:** You have successfully queried Neo4j and observed at least one perfect end-to-end GitOps trace (`Commit -> Artifact -> InfraCommit -> Rollout -> Service`).
3.  **Health Latency:** The Health Worker successfully polls all 20 TicketFlow services in under 10 seconds per minute.
4.  **Observer Integrity:** You have mathematically verified that the configured GitHub Token cannot execute a `POST /rerun` API call.
