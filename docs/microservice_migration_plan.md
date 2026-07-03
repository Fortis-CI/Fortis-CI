# Fortis CI Microservice Migration Plan

## Vision
To evolve Fortis CI from a tightly-coupled Express monolith into a resilient, event-driven microservice architecture, without halting feature development or risking massive "big bang" rewrite failures.

We will achieve this through a 3-step **Modular Monolith** strategy (the Strangler Fig pattern). This allows us to decouple the logic immediately while delaying the operational overhead of managing multiple repositories until absolutely necessary.

---

## Step 1: Logical Decoupling (The Event Emitter)
**Goal:** Remove direct function calls between domains, keeping everything inside the current monolith.

Currently, engines invoke side effects directly:
```typescript
// Tight Coupling (Current State)
import { sendSlackAlert } from '../notifications';

async function triggerRollback() {
  // ... rollback logic
  await sendSlackAlert('Rollback Failed'); 
}
```

**The Plan:** Introduce a central Node.js `EventEmitter`.
```typescript
// Loose Coupling (Step 1)
import { eventBus } from '../events';

async function triggerRollback() {
  // ... rollback logic
  eventBus.emit('ROLLBACK_FAILED', { deploymentId, reason });
}
```
A new `listeners.ts` file will subscribe to `ROLLBACK_FAILED` and handle the Slack alert.
- **Why?** If Slack goes down, the Rollback engine doesn't crash. It sets the foundation for event-driven architecture with zero infrastructure changes.

---

## Step 2: Distributed Messaging (Redis Pub/Sub)
**Goal:** Swap the in-memory Node.js event bus for a distributed message broker.

Instead of `eventBus.emit`, we publish the payload to our existing Redis instance.
- **Publisher:** The main Express backend publishes `EVENT: RCA_COMPLETED` to a Redis channel.
- **Subscriber:** The *same* backend listens to the Redis channel and executes the Rollback logic.
- **Why?** The architecture is now officially distributed and asynchronous. We can spin up 5 copies of the Fortis backend behind a load balancer, and any node can pick up the Redis events.

---

## Step 3: Physical Microservice Split (The Final State)
**Goal:** Physically break the repository apart to allow independent scaling, deployments, and language choices (e.g., writing the Webhook ingress in Go for speed, and RCA in Python for ML).

When the codebase becomes too large, we snap the decoupled pieces apart into physical repositories:

1. **`fortis-core` (API Gateway)**
   - Ingests webhooks and serves the Next.js frontend.
   - Publishes `EVENT: DEPLOYMENT_COMPLETED`.
2. **`fortis-rca-worker` (The Brain)**
   - Listens to `DEPLOYMENT_COMPLETED`.
   - Runs regex heuristics, writes to Neo4j.
   - Publishes `EVENT: ROLLBACK_REQUIRED`.
3. **`fortis-rollback-worker` (The Saftey Net)**
   - Listens to `ROLLBACK_REQUIRED`.
   - Safely interacts with the GitHub API.
4. **`fortis-notification-worker`**
   - Listens to all failure events and routes them to Slack/Email with robust retry logic.

- **Why?** By the time we reach Step 3, the code is already built to communicate via Redis. The migration simply involves copy-pasting the listener files into a new repository. No complex logic rewrites required!



This is probably the strongest plan you've shown me so far. I'd give it a **9.7/10**. More importantly, it's the first one that I think could actually be executed over the next year without derailing development.

That said, there are a few architectural issues I'd address.

---

# 👍 What's excellent

## 1. Strangler Fig instead of a rewrite

This is exactly the right mindset.

The biggest mistake people make is:

```text
Monolith

↓

Rewrite

↓

6 months

↓

Nothing works

↓

Everyone cries
```

Your approach is

```text
Monolith

↓

Modular Monolith

↓

Distributed Events

↓

Microservices
```

That's how companies like Shopify, Amazon (internally for many systems), and many successful startups have evolved systems. You preserve working software while improving the architecture.

---

## 2. Modular monolith first

This is the biggest green flag.

Lots of junior engineers hear "microservices" and immediately create eight repositories with one endpoint each.

Then they spend more time debugging Docker networking than building features.

A modular monolith lets you answer an important question:

> **Are these domains actually independent?**

Only after the answer is "yes" should you split them.

---

## 3. Domain boundaries make sense

I like this decomposition.

```
Webhook

↓

Deployment

↓

RCA

↓

Rollback

↓

Notification
```

Each has a clear responsibility.

None of them feels artificially split.

---

# Things I'd change

## ❌ Step 1 should NOT use Node's EventEmitter directly

This is my biggest criticism.

People treat

```ts
eventBus.emit(...)
```

as event-driven architecture.

It isn't.

It's still synchronous unless listeners intentionally defer work.

If a listener throws,

your publisher can still be affected.

Instead, define an interface:

```ts
interface EventPublisher {
    publish(event: DomainEvent): Promise<void>;
}
```

Then implement:

```
InMemoryPublisher

↓

RedisPublisher

↓

KafkaPublisher
```

Now your business logic never knows what messaging system exists.

That makes Step 2 almost trivial.

---

## Redis Pub/Sub isn't enough

This is another big point.

Redis Pub/Sub is **fire-and-forget**.

If no subscriber is connected,

the event is gone forever.

Imagine:

```
Deployment Completed

↓

Publish

↓

Rollback worker restarting

↓

Event disappears

↓

Production remains broken
```

Not great.

I'd strongly recommend one of these instead:

* **Redis Streams** (best fit since you're already using Redis)
* RabbitMQ
* Kafka (probably overkill for now)

Redis Streams give you:

* persistence
* acknowledgements
* consumer groups
* replay
* retries

That's much closer to what you want for rollback events.

---

## API Gateway

I don't love the name.

```
fortis-core
```

doing

* webhooks
* frontend
* API gateway

is three responsibilities.

I'd think of it more as:

```
Fortis Control Plane
```

or

```
Fortis API
```

The Next.js frontend should ideally stay separate from the ingestion service over time.

---

## Notification worker

This is perfect.

Notifications are classic asynchronous work.

Slack being slow should never block rollback.

---

# Missing services

I'd eventually introduce two more.

## Scheduler

Currently

```
HealthWorker
```

is inside the main service.

Eventually I'd split:

```
Scheduler

↓

Health Check Events

↓

Workers
```

That makes scaling much easier.

---

## Graph Service

Right now Neo4j access is everywhere.

Eventually I'd isolate graph operations.

```
RCA

↓

Graph Repository

↓

Neo4j
```

instead of every service talking directly to Neo4j.

---

# Biggest thing missing

## Event contracts

This is critical.

Don't just publish random JSON.

Define versioned events.

Example:

```json
{
  "version": 1,
  "eventType": "ROLLBACK_REQUIRED",
  "occurredAt": "...",
  "deploymentId": "...",
  "serviceId": "...",
  "reason": "...",
  "correlationId": "..."
}
```

Future you will thank present you.

---

## Correlation IDs

Every event should carry

```
deploymentId

traceId

correlationId

causationId
```

Then you can trace

```
Webhook

↓

Deployment

↓

RCA

↓

Rollback

↓

Slack
```

through logs.

That's invaluable when debugging.

---

# Biggest improvement I'd make

Instead of

```
Deployment Completed

↓

RCA

↓

Rollback Required
```

I'd model the system around **domain events**.

For example:

```
DeploymentStarted

DeploymentSucceeded

DeploymentFailed

HealthCheckFailed

HealthRecovered

RCACompleted

RollbackRequested

RollbackStarted

RollbackCompleted

RollbackFailed

BlastRadiusCalculated

NotificationRequested
```

Everything reacts to these events.

That gives you a much richer event log and cleaner separation.

---

# Step 3: Don't split by repository first

One subtle point:

You don't need multiple repositories immediately.

I'd do:

```
apps/

  api/

  rollback-worker/

  rca-worker/

packages/

  events/

  graph/

  shared/

  sdk/
```

inside a **monorepo**.

Only create separate repositories if teams, release cadence, or ownership truly diverge. Separate repos add coordination overhead that isn't free.

---

# Long-term architecture

This is what I eventually see:

```
GitHub Webhook
        │
        ▼
  Fortis API
        │
        ▼
 Redis Streams
        │
 ┌──────┼────────┐
 ▼      ▼        ▼
RCA   Health   Notifications
 │
 ▼
Neo4j
 │
 ▼
Rollback Worker
 │
 ▼
GitHub Actions
 │
 ▼
Redis Streams
 │
 ▼
Dashboard
```

Notice how nothing depends directly on Slack, GitHub, or another internal service. Everything communicates through durable events.

---

## Overall verdict

This isn't "microservices because they're fashionable." That's refreshing. It's a staged evolution that minimizes risk and preserves development velocity.

My only substantial changes would be:

1. **Replace `EventEmitter` with an abstraction (`EventPublisher`) from day one.**
2. **Use Redis Streams instead of Pub/Sub when you introduce distributed messaging.**
3. **Define versioned event contracts with correlation IDs before any service split.**
4. **Keep everything in a monorepo initially rather than multiple repositories.**

Those changes make the migration path smoother while avoiding a lot of painful refactoring later. Ironically, the best microservice architecture often starts by pretending you're never going to build microservices at all. That discipline keeps the boundaries honest instead of aspirational.
