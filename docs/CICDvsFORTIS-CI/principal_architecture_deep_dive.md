# Principal Engineering Architectural Deep Dive: Fortis CI vs. Sentinel

A software architecture is defined by the tradeoffs it accepts and the boundaries it enforces. This document bypasses feature counting to evaluate the structural integrity, abstraction quality, and distributed systems resilience of **Fortis CI** compared to its prototype, **CI/CD Sentinel**.

---

## 1. The Dependency Graph & Coupling

How do components talk to each other? Let's map the flow from failure detection to recovery.

### The Fortis CI Rollback Chain (Tight Coupling)
```text
HealthWorker -> GraphService -> RollbackEngine -> GitHubService
                                               -> Notifications
```

**Architectural Analysis:**
In Fortis CI, `rollbackEngine.ts` directly orchestrates side effects. It explicitly imports and calls `sendSlackAlert` and `sendPRComment`. 
- **The Tradeoff:** This is a **tightly coupled** design. If the Slack API goes down and throws an unhandled promise rejection, it could crash the rollback engine or leave the graph in an inconsistent state.
- **The Alternative:** An event-driven architecture using an EventEmitter or message broker (e.g., Redis Pub/Sub). The `RollbackEngine` should emit a `ROLLBACK_TRIGGERED` event, and the `NotificationService` should independently listen and react. This isolates failures and improves resilience.

---

## 2. Failure Handling & Resilience

What happens when the network fails during a critical operation? 

### The GitHub API Rollback Call
In `rollbackEngine.ts` (Fortis), the system triggers a GitHub Actions rerun:
```typescript
const result = await rerunWorkflow(parsed.owner, parsed.repo, runId);
if (result.success) {
  await createRollbackEvent(...);
} else {
  await sendSlackAlert(`CRITICAL: Automated rollback FAILED...`);
}
```

**Architectural Analysis:**
- **The Good:** It fails gracefully. It catches HTTP 403, 404, and 409 errors natively via Axios interceptors in `github.service.ts` and alerts humans via Slack if the automated recovery fails.
- **The Bad:** There is **zero retry logic, exponential backoff, or circuit breaking**. If GitHub API returns a transient 502 Bad Gateway, the rollback permanently fails. For a tool claiming to guarantee 60-second recovery, a transient network blip shouldn't require manual intervention.
- **Recommendation:** Implement a robust retry mechanism (like `axios-retry`) with exponential backoff for the `rerunWorkflow` call.

---

## 3. Distributed Systems: The Health Worker

### CI/CD Sentinel (`Promise.all`)
```typescript
await Promise.all(services.map(svc => probeServiceHealth(svc)));
```
### Fortis CI (`concurrencyLimit`)
```typescript
await concurrencyLimit(tasks, MAX_CONCURRENCY); // max 20
```

**Architectural Analysis:**
- **Throughput vs. Memory:** Sentinel's unbounded `Promise.all` fires all HTTP requests simultaneously. At 50 services, it's fine. At 5,000 services, it will immediately starve the Node.js event loop, spike memory usage, trigger `ECONNRESET` locally due to socket exhaustion, and effectively DDoS the target applications.
- **Backpressure & Fairness:** Fortis CI introduces `concurrencyLimit(20)`. This provides strict backpressure. It ensures steady throughput and prevents local socket exhaustion. However, at large scale, a 60-second cron cycle evaluating 5,000 services at 20 concurrent requests (with a 10s timeout) will silently overrun the 60-second window, causing cycle overlap.
- **The Missing Piece:** Neither system uses a distributed task queue (like BullMQ). If the Fortis container restarts mid-cycle, health checks are dropped. 

---

## 4. Graph Model Evolution & Cypher Query Quality

### Why did Fortis add `BlastRadiusEvent` and `PhysicalInfra`?
Sentinel's schema stops at `Service` -> `Deployment`. 
Fortis CI introduces:
```cypher
(LogicalResource)-[:HOSTED_ON]->(PhysicalInfra)
```
via the `infraContractParser.ts`.

**Architectural Analysis:**
- **Why is this useful?** This decouples infrastructure discovery from deployment ingestion. It allows Fortis to correlate a purely logical GitHub repository (e.g., `payment-api`) with its physical Kubernetes manifestations (e.g., `pod/payment-api-7b89f`). By mapping this in Neo4j, Fortis can execute a single `MATCH (p:PhysicalInfra)-[*1..3]->(affected)` traversal to calculate the Blast Radius of a pod crashing, rather than guessing based on static service configurations.
- **Cypher Quality:** The Fortis schema uses precise `CREATE CONSTRAINT` blocks. However, in `rollbackEngine.ts`, the query to find the last healthy deployment does not leverage an `OPTIONAL MATCH` for fallback states. If a service has never had a successful deployment, the query returns null, effectively neutralizing the rollback engine on Day 1 deployments.

---

## 5. Code Quality & Abstraction Layers

### Is `rcaClassifier` vs. `rcaEngine` over-engineered?
- `rcaClassifier.ts` handles pure, side-effect-free string matching (regex evaluation on log lines).
- `rcaEngine.ts` orchestrates the fetching of logs, invokes the classifier, writes to Neo4j (`createErrorPattern`), and dynamically triggers `triggerRollback()`.
- **Verdict:** This is **excellent abstraction**. The classifier is perfectly unit-testable because it has no IO dependencies. The engine handles the IO and coordination. 

### The `governance.ts` Monolith
- In contrast, `governance.ts` in Fortis CI mixes GitHub API fetch logic, business logic heuristics (risk scoring), and string interpolation for the PR comment all into a single, massive `analyzePullRequest` function.
- **Verdict:** This is a **poor abstraction**. Policy evaluation should be decoupled from the API layer. If you wanted to run the risk scorer locally via a CLI, you couldn't, because it is tightly bound to `fetch(url, { headers })`.

---

## Final Assessment
Fortis CI is an outstanding piece of engineering that legitimately solves the cascading failure problem using graph traversals. It successfully implements backpressure in its workers and cleanly abstracts its regex engines. 

However, to graduate from "advanced side-project" to "enterprise-grade platform," it must address its tight coupling in the rollback engine, introduce retry mechanisms for external API dependencies, and decouple policy evaluation from network IO.
