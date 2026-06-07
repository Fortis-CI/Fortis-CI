# Fortis-CI Graph Philosophy & System Boundaries

This document clarifies the philosophical boundaries, source of truth hierarchy, and product positioning of the Fortis-CI platform.

## 1. Source Of Truth (When Signals Disagree)

**The Scenario:**
*   ArgoCD: `Healthy`
*   Kubernetes: `Healthy`
*   `/health` Endpoint: `Healthy`
*   Business KPI (Orders/min): `0`

**Which signal wins?**
**The Business KPI always wins.** A system that successfully runs an image but drops all orders is a critically failed deployment. 

**How does Fortis-CI handle this?**
Philosophically, Fortis-CI is completely blind to "Orders/min". It relies on the `/health` endpoint as its *absolute proxy* for truth. If the `/health` endpoint says `Healthy`, Fortis-CI will **never** trigger an auto-rollback.

**The Solution (The Contract):**
You must bridge the gap inside the application, not inside Fortis-CI. The `/health` endpoint must evolve from a "dumb ping" to a "business-aware metric." If `ticketflow-orders` detects that 0 orders have been processed in the last 5 minutes (when the historical baseline is 100/min), the `/health` endpoint itself must return `503 Degraded`. 
*Fortis-CI forces engineering teams to build honest health checks.*

---

## 2. Confidence Scoring (RCA Engine)

Confidence scoring calculates the probability that a specific code change directly caused a specific runtime error.

**Example Chain:** `Deployment → Error → File → Dependency`

*   **Low Confidence (e.g., 20%):** 
    An `ECONNREFUSED` error appears in the logs 1 minute after deployment. However, the Git diff shows only CSS files were modified. The error is likely environmental (e.g., the database restarted concurrently), not caused by the deployment.
*   **Medium Confidence (e.g., 60%):**
    An `ECONNREFUSED` error appears. The Git diff shows changes to `package.json` (a dependency update). The system assumes the dependency bump *might* have broken the connection logic, but there is no explicit string match linking the error to the file.
*   **High Confidence (e.g., 95%):**
    The log error string explicitly prints a stack trace pointing to `src/db/connection.ts`. The Fortis-CI Git Diff Engine sees that `src/db/connection.ts` was modified in this exact `Deployment` commit. The `RELATED_TO_FILE` edge is formed. The system strongly asserts this code change caused the outage.

---

## 3. The Business Graph

**Should Fortis eventually support Business KPIs (Orders Created, Revenue) as graph nodes?**
**Absolutely Not.**

**Why?**
1.  **Identity:** Fortis-CI is a deployment intelligence layer, not an APM or a Business Intelligence (BI) tool.
2.  **Cardinality Explosion:** A Neo4j graph modeling deployments changes maybe 50 times a day. If you ingest "Orders Created," the graph changes 10,000 times a minute. It will instantly OOM the database. 
3.  **Tool Sprawl:** Datadog and Prometheus already solve high-frequency time-series event tracking perfectly. 

Fortis-CI must remain deployment-focused forever. It answers: *"What changed, what broke, and how do we revert it?"* It does not answer: *"How much money did we make today?"*

---

## 4. RCA Boundaries & Scope Creep

**At what point does Fortis become an observability platform?**
If Fortis-CI begins ingesting distributed traces (OpenTelemetry spans) or streaming continuous application logs, it has crossed the boundary into a full APM.

**What capabilities should NEVER be added?**
*   **Log Aggregation:** Fortis-CI temporarily holds 500 lines of GitHub Actions logs for RCA. It should *never* attempt to be ElasticSearch or Splunk.
*   **Metric Dashboards:** It should *never* build CPU, Memory, or Network I/O dashboards. That is Grafana's job.
*   **Trace Storage:** It should *never* ingest Jaeger/Datadog APM traces. 

**The Rule:** Fortis-CI only ingests data *at the time of deployment* and strictly for the purpose of *evaluating deployment risk and rollback safety*.

---

## 5. Public Release Strategy

If Fortis-CI launched tomorrow, the ideal customer profile is highly specific.

**The Ideal Customer:** **Mid-size SaaS & Platform Teams.**

**Why?**
*   **Startups:** Do not need it. They have 1 or 2 monolithic repositories. If something breaks, they know exactly what it was. Blast radius analysis provides zero value to a monolith.
*   **Enterprise:** Will not adopt it. They require massive scale, SOC2 compliance, advanced SSO, and are likely deeply entrenched in Datadog, Splunk, or Spinnaker.
*   **Mid-size SaaS (20 - 100 Microservices):** This is the sweet spot.
    *   They are large enough that the "what broke?" panic is a daily reality because teams deploy independently.
    *   They rely heavily on GitHub Actions.
    *   They do not have massive, dedicated Site Reliability Engineering (SRE) teams to build complex, custom Datadog correlation dashboards.
    *   A drop-in "brain" for their CI that provides a deployment graph and auto-rollback is a massive, immediate quality-of-life upgrade.
