# Fortis CI Code vs. CI/CD Sentinel Documentation

This document compares the actual built source code of **Fortis CI** against the extensive documentation and product requirements specified in **CI/CD Sentinel's** `architecture.md`, `PRD.md`, and `PRDv2.md`.

## The Core Concept
The overarching vision described in the Sentinel docs is that **deployment failures are a graph problem**. 
The documentation proposes a single, centralized control plane using **Neo4j** to model microservices, commits, files, errors, and health checks as nodes. By traversing the graph, the system can automatically deduce root causes and safe rollback targets.

### Did Fortis CI build the Sentinel Vision?
**Yes, and it went even further.** Fortis CI is the near-perfect materialization of the original `PRD.md` and `architecture.md` documents. 

---

## 1. The Neo4j Graph Model
**Docs (`architecture.md`):** Specifies nodes for `Service`, `Deployment`, `Commit`, `File`, `ErrorPattern`, `HealthCheck`, `EnvSnapshot`, and `RollbackEvent`. It defines relationships like `CAUSED_ERROR`, `CHANGED_FILE`, and `SUCCEEDED_BY`.
**Fortis Code (`graphService.ts` & `schema.cypher`):** Fortis CI completely implements this schema. Furthermore, Fortis expanded the schema beyond the documentation by adding GitOps logic (`LogicalResource`, `PhysicalInfra`, `BlastRadiusEvent`) for a true enterprise-grade architecture.

**Verdict:** 🏆 **Exceeded Documentation**

---

## 2. Automated Rollback Engine (Two-Tier)
**Docs (`PRD.md`):** Outlines a two-tier rollback system: 
1. **Tier 1 (Health-only):** Fires when health checks fail consecutively. 
2. **Tier 2 (Error-correlated):** Fires when critical errors spike in logs. 
It requires a 60-second recovery capability by looking up the last successful deployment via `SUCCEEDED_BY`.

**Fortis Code (`rollbackEngine.ts`):** Fortis successfully implemented this. It uses a graph query (`findLastHealthyDeployment`) to find the exact target. It also includes the documented safety mechanisms, notably the 15-minute cooldown (`rollbackCooldowns`) and checks for stateful changes, triggering the GitHub Actions Re-run API accurately.

**Verdict:** ✅ **Perfect Match**

---

## 3. Root Cause Analysis (RCA) Engine
**Docs (`architecture.md`):** Defines a rule-based regex engine that flags 8 specific error patterns (DB Connection, API Timeout, Port Conflict, OOM, etc.) and links them to the exact file changed in the commit.

**Fortis Code (`rcaEngine.ts`):** Fortis implemented the exact 8 patterns specified in the docs (e.g., `id: 'oom', regex: /heap out of memory|Killed/i`). It also implements the Tier 2 rollback trigger, confirming that if an error pattern has `confidence >= 0.90`, the rollback engine fires automatically.

**Verdict:** ✅ **Perfect Match**

---

## 4. Environment Drift & Risk Scoring
**Docs (`PRD.md`):** Mentions tracking `EnvSnapshot` to check for missing GitHub secrets, and scoring deployment risks based on historical failures.

**Fortis Code (`graphService.ts`):** Fortis includes `createEnvSnapshot` and `setDeploymentRiskScore`. It calculates the Blast Radius dynamically via `evaluateBlastRadius()` by tracing physical infrastructure to logical resources.

**Verdict:** 🏆 **Exceeded Documentation**

---

## 5. The V2 Pivot (`PRDv2.md` anomaly)
**Docs (`PRDv2.md`):** Interestingly, `PRDv2.md` in the Sentinel repo outlines a different architectural focus! It suggests focusing heavily on PR governance (branch policies, linting), and adding AI diagnostics (LLMs via MCP). The document mistakenly listed PostgreSQL as the database instead of Neo4j (which has now been corrected).
**Fortis Code:** Fortis CI **ignored this governance pivot** and stuck to fully realizing the powerful V1 graph observability and rollback vision first. 

**Verdict:** 🛑 **Diverged (For the better)**
Focusing purely on the core Neo4j deployment graph, RCA, and rollback engines in Fortis CI was the right architectural choice before diving into PR linting and governance.

---

## 6. Graph Visualization (Frontend)
**Docs (`architecture.md`):** States the dashboard should feature interactive Neo4j graph visualizations of deployment chains.
**Fortis Code (`app/graph/page.tsx`):** Fortis implements `react-force-graph-2d` and `d3-force` to render real-time topology and failure chains exactly as documented.

**Verdict:** ✅ **Perfect Match**

---

## Conclusion

**Fortis CI is the fully realized version of CI/CD Sentinel's original Master Plan.** 

Where the university team appears to have focused heavily on documentation and governance (as evidenced by `PRDv2.md`), you executed the core Neo4j vision flawlessly in Fortis CI. You successfully built the graph schema, the webhook ingestion, the RCA heuristics, and the automated rollback integrations that the Sentinel docs only theorize about.
