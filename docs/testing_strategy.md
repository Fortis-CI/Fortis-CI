# Fortis CI Testing Strategy

## Overview
As Fortis CI transitions into an enterprise-grade flagship, we are building a rigorous, multi-tiered testing pyramid. The goal is to mathematically prove the graph logic, ensure safe execution of automated side effects (like Rollbacks), and guarantee zero regressions.

Our target pyramid structure:
1. **Pure Functions & Service Logic** (Mocked I/O)
2. **Integration Tests** (Supertest API validation)
3. **Graph & Data Integration** (Docker Compose + Testcontainers for Neo4j & Redis)
4. **End-to-End (E2E) & Simulation** (GitHub API simulation, webhook replay)
5. **Advanced Validation** (Mutation testing, chaos testing)

---

## Testing Priorities (By Business Risk)
We prioritize tests based on blast radius. If the frontend renders a badge incorrectly, it's a nuisance. If the Rollback Engine oscillates or fails silently, production stays down.

1. **Rollback Engine** (Highest Risk: Idempotency, oscillation prevention, graceful degradation)
2. **Graph Queries** (The brain of the system: Structural evolution, Blast Radius scenarios)
3. **Health Worker** (Concurrency limits, failure counters, recovery resets)
4. **Webhook Ingestion** (Signatures, idempotency against duplicates)
5. **RCA Engine** (Handling malformed, 20MB, or binary logs)
6. **Notifications** (Ensuring network failures to Slack don't block core logic)
7. **Frontend** (UI/UX)

---

## What is Already Done (Phase 1 Base)
We laid the initial Jest configuration foundation:
- **Jest & ts-jest configured** in `backend/package.json`.
- **Initial Mocks established** for the database and GitHub APIs.
- **Base Coverage:** `rcaClassifier` (pure functions), `rcaEngine` (orchestration), and `rollbackEngine` (basic cooldowns and stateful checks).

---

## Roadmap & Scenarios (What Needs to Be Done)

### Phase 1.5: Deepening High-Risk Unit Tests
Before moving to Integration, we must harden the existing unit suites with brutal edge cases:

**Rollback Engine:**
- *Idempotency:* Calling trigger twice only creates one rollback event.
- *Oscillation:* (Deploy A -> Rollback -> Deploy A -> Rollback) fails due to cooldowns.
- *Graceful Failures:* `findLastHealthyDeployment()` returns null.
- *Network Isolation:* Slack API fails, but the rollback event is still recorded.

**Health Worker:**
- *Concurrency Limits:* 50 services evaluated, only 20 concurrent requests fire.
- *Recovery:* Service fails twice, recovers, counter resets to 0.
- *Double Rollback Prevention:* 3 failures trigger rollback, 4th failure ignores.

**RCA Engine:**
- *Malformed Data:* Feed empty, null, binary, truncated, and 20MB logs to ensure it doesn't OOM or crash.

### Phase 2: API & Webhook Integration (Supertest)
- POST `/webhook` with valid signature -> 200 OK.
- POST `/webhook` with invalid signature -> 401 Unauthorized.
- Duplicate delivery IDs -> Ignored gracefully.

### Phase 3: Data Integration (Testcontainers)
- Use Docker Compose via Testcontainers to spin up both **Neo4j and Redis**.
- Test graph evolution over time: `Deploy 1 -> Deploy 2 -> Deploy 3`. Verify we can still traverse backward to find the last healthy deployment.
- Scenario-driven Blast Radius: "Node A dies. Assert services B and C are returned as impacted."

### Phase 4: E2E Pipeline Simulation
- Full Webhook Replay -> RCA Execution -> Rollback Pipeline.

### Phase 5: Mutation & Performance Testing
- Introduce `Stryker` for mutation testing. Ensure changing `>=` to `>` intentionally fails the Rollback Engine tests.
