# node-flow — an open-source Conductor-class orchestration platform on NestJS

## Context

`/Users/dwaipayan/personal/node-flow` is empty. The goal is an open-source equivalent of **Orkes Conductor Cloud** (the commercial product built on Netflix Conductor), written in Node.js/TypeScript, targeting full feature parity *plus* modern additions, and genuinely robust and horizontally scalable.

Orkes charges for the parts that turn Conductor's engine into a platform: RBAC, multi-tenancy, secrets, scheduling, webhooks, human tasks, AI orchestration, observability and operational tooling. Those are the target, not just the engine.

Decisions taken up front, confirmed with the user:

| Decision | Choice |
|---|---|
| Scope | **All of it**, delivered phase by phase |
| Infrastructure | **Postgres only**, or **Postgres + Redis**. Nothing else is ever required — see "Two supported topologies". S3 is available for payload offload; Kafka/NATS/AMQP/SQS are integration targets, not node-flow’s own storage |
| Authoring | **JSON DSL** as the wire/storage format **+ a typed TypeScript builder** that compiles to it |
| Backend stack | **NestJS + Kysely** (migrated off Sequelize — see below) |
| UI stack | **Next.js + Tailwind CSS + HeroUI v3** |
| API shape | **Clean `/v1` API designed on its own merits**; Conductor wire-compatibility arrives as a translating layer in Phase 9 |
| Toolchain | **Nx 23 + npm on Node 24** (Node 20 is past EOL) |
| Worker auth | **All four**: service-account JWT and API keys in Phase 1; mTLS and OIDC workload identity in Phase 5 |
| Shared storage | **Out of scope** — users mount their own EFS/S3 Files and pass paths as ordinary task values |
| Differentiators | **All four**: AI/agent orchestration, developer experience, enterprise/multi-tenancy, observability |

### Status

**Phase 0 — Foundation: complete.** Re-verified from a clean tree on 2026-09-13, after the pnpm migration.

Verification performed by deleting `node_modules`, every `dist/`, all `*.tsbuildinfo` and the Nx cache, then reinstalling with `pnpm install --frozen-lockfile` exactly as CI does:

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Clean in 8.4s — lockfile is committable and CI-reproducible |
| `build` · `test` · `lint` · `typecheck`, cold cache | All 11 projects pass |
| Test suite | **43 tests** — 17 core, 19 engine, 7 package stubs |
| Boundary defence 1 (resolution) | `TS2307: Cannot find module '@nestjs/common'` ✓ |
| Boundary defence 2 (Nx lint) | `A project tagged with "scope:pure" is not allowed to import "@nestjs/common"` ✓ |
| Postgres 18.6 | Healthy in 6s; survives a full `down`/`up` cycle |
| `uuidv7()` | Works natively |
| `FOR UPDATE SKIP LOCKED` | Works — the queue design depends on it |
| `io_method=worker`, autovacuum tuning | Applied as configured |
| Root scripts (`pnpm build/test/lint/typecheck/db:up/db:down`) | All working |
| `.gitignore` | `node_modules`, `dist`, `.nx/cache` and `.env*` all correctly ignored |

| | |
|---|---|
| Workspace | Nx 23.2 + pnpm 11.5.1, created via `create-nx-workspace --preset=ts` |
| Runtime | Node 24.19.0 (`.nvmrc`), TypeScript 6.0.3 |
| Projects | `core` `engine` `store` `queue` `tasks` `sdk` `cli` `testkit` (libs) · `server` (NestJS) · `ui` (Next.js) |
| Boundaries | `scope:pure` · `scope:infra` · `scope:client` · `scope:app`, enforced by `@nx/enforce-module-boundaries` |
| Database | Postgres 18.6 via `docker compose`, healthy in ~6s |
| Checks | `build` · `test` · `lint` · `typecheck` all green across every project |

A caveat on the lint defence: `bannedExternalImports` only flags packages **installed in the workspace**. `sequelize` is not yet a dependency, so a `sequelize` import into `engine` would currently slip past the lint rule — resolution would still block it. Re-verify both defences once `store/` installs Sequelize.

One Postgres 18 gotcha cost a restart and is worth remembering: the image now requires the volume mounted at **`/var/lib/postgresql`**, not `/var/lib/postgresql/data`. The old path makes the container crash-loop on startup.

Known leftovers, deliberate rather than overlooked:
- `store`, `queue`, `tasks`, `sdk`, `cli`, `testkit` still contain the generator's placeholder `<name>.ts`/`<name>.spec.ts` stubs. They keep each project building and testable and get replaced as their phase lands.
- `create-nx-workspace` committed ~490 KB of instruction files for six AI tools (`.agents`, `.codex`, `.cursor`, `.gemini`, `.opencode`, `AGENTS.md`, `opencode.json`). **Kept, by decision** — leave them in place.

**Phase 1 — Core engine: complete.** (This section records how it got there; the tracker below has the current state.)

Done so far, all under `scope:pure` with zero framework imports:

| Module | What it contains |
|---|---|
| `core/status.ts` | Task and workflow statuses; terminal/successful/retryable predicates |
| `core/task-type.ts` | All 31 task types, split into worker / operator / system families |
| `core/policies.ts` | Retry, timeout and concurrency policy schemas + backoff computation |
| `core/definitions.ts` | The JSON DSL — workflow and task definition schemas (zod 4) |
| `core/execution.ts` | Runtime execution types and the `EvaluationState` the decider sees |
| `core/errors.ts` | Coded error taxonomy |
| `engine/expression.ts` | `${...}` parsing, static reference extraction, runtime resolution |
| `engine/blueprint.ts` | The compiler: flattening, static ref analysis, referential validation |
| `engine/commands.ts` | The command model the decider emits instead of performing I/O |
| `engine/decide.ts` | The decider — **all Phase-2 operators except `YIELD`** |

Operators complete: `SWITCH`, `FORK_JOIN`, `FORK_JOIN_DYNAMIC`, `JOIN`, `EXCLUSIVE_JOIN`, `DO_WHILE`, `DYNAMIC`, `SUB_WORKFLOW`, `START_WORKFLOW`, `TERMINATE`, `SET_VARIABLE`, `GET_WORKFLOW`, `NOOP`. Only `YIELD` remains, and it needs the signal plumbing that arrives with the store.

**Dynamically forked tasks have no blueprint node**, which has two consequences the decider handles explicitly:
- Their refs are recorded in the fork's own output as `forkedTaskRefs`, because that is the only place the downstream JOIN can discover what to wait for.
- When one reaches a terminal state there is no node to look up, so a separate path handles it. Without that, a completing dynamic branch would be silently dropped and its JOIN would wait forever. A failing one also has no `optional` flag to consult, so it always fails the workflow.

**`EXCLUSIVE_JOIN` fires on the first *completed* branch**, not on all of them — it follows a SWITCH where every other branch is `SKIPPED`, so waiting for all would be waiting for tasks that will never exist.

**In-pass operator resolution.** Operators needing no external work are settled inside the evaluation that reaches them and the pass continues straight through, via a `resolved` field on `ScheduleTask` telling the applier to insert the row already terminal. Without it a SWITCH nested in a FORK inside a DO_WHILE would cost three evaluations and three round trips to traverse control flow that does nothing. Task rows are still written, because seeing *why* a workflow took a branch is most of debugging one. Chaining is bounded by `MAX_RESOLUTION_DEPTH` so a cyclic definition surfaces as a stuck workflow rather than a decider spinning on a held row lock.

### Store — schema and queues (Postgres 18, Testcontainers)

| Module | What it contains |
|---|---|
| `store/migrations/0001-core-schema.ts` | Full schema in raw SQL: partitioning, partial indexes, `uuidv7()` defaults, per-table autovacuum |
| `store/database.ts` | Kysely connection, migration runner, startup capability assertion |
| `store/decide-queue.repository.ts` | The evaluation queue and the claim-before-read rule |
| `store/task-queue.repository.ts` | `SKIP LOCKED` leasing, fencing tokens, lease expiry, depth |
| `store/testing/postgres-harness.ts` | Real Postgres 18 per test file, with Docker socket auto-detection |

**24 integration tests against real Postgres**, written to break the design rather than demonstrate it:
- 20 concurrent workers racing 200 tasks — zero duplicates.
- Repeated concurrent rounds drain a queue exactly once.
- A stale worker whose lease was reclaimed **cannot** acknowledge or renew.
- **The lost-wakeup rule is proven**: a request arriving after the claim is accepted, a request racing an uncommitted claim is not swallowed, and a rollback restores the claim so a crashed decider loses nothing.
- Ten concurrent deciders claiming one workflow — exactly one wins.

Four things this surfaced that the design did not anticipate:

1. **A unique index on a partitioned table must include every partition-key column.** `UNIQUE ("taskId")` on `TaskQueues` (partitioned by `queueName`) is rejected outright. It is now `("queueName", "taskId")`, which forces `queueName` into the signature of every task lookup — without it those queries scan all eight partitions instead of one.
2. **`peekBatch` cannot distribute work, and should not try.** `FOR UPDATE SKIP LOCKED` only skips rows locked by *other in-progress* transactions; in its own auto-committing statement the locks are gone before the next caller looks, so every decider saw the same rows. Making it exclusive would mean claiming outside the evaluation transaction and giving up crash safety — a far worse trade. It is now explicitly advisory, with `claimForEvaluation` as the only gate, and the test asserts that claims stay exclusive *despite* overlapping peeks.
3. **Range-partitioned tables reject rows with no matching partition.** Without `DEFAULT` partitions every insert fails on a fresh database.
4. **Testcontainers only probes `/var/run/docker.sock`**, which OrbStack, Colima and Rancher Desktop do not create — it fails with "no container runtime" while `docker` works fine in the shell. The harness now detects the socket, so `nx test store` works on a fresh clone with any common runtime.

### The evaluator — engine and store composed

`store/evaluator.ts` runs the full transaction: claim → lock → read frontier → `decide()` → apply → commit. `store/workflow.repository.ts` and `store/outbox.repository.ts` back it. A workflow now runs end to end against real Postgres, including parallel branches, retries, outbox emission and idempotent starts.

Three bugs surfaced here that no unit test could have caught, each for a different reason:

1. **Idempotency keys did not deduplicate at all.** Same partition-key trap as `TaskQueues`, but silent instead of loud: a unique index on a partitioned table must include the partition key, `WorkflowExecutions` is partitioned on `startedAt`, and `startedAt` defaults to `now()` — so the index was unique on a value that differs every insert and never conflicted. It looked like a working guarantee while quietly creating duplicate executions. Idempotency now lives in an **unpartitioned `IdempotencyKeys` table** whose constraint actually constrains.

2. **Operator tasks were being pushed onto the worker queue.** A `JOIN`, `DO_WHILE` or `SUB_WORKFLOW` would sit there waiting for a worker that has no idea what to do with it. The evaluator now checks `isOperator()` and never queues one; `JOIN`/`EXCLUSIVE_JOIN` additionally resolve in-pass, since the decider only schedules a join once its dependencies are already satisfied.

3. **`allStaticRefs` omitted join dependencies, so joins could never fire.** The prefetch list was built only from `${...}` expressions, but a `JOIN` inspects its siblings via `joinOn` and branch tips — refs that appear in no expression. The prefetch returned nothing for them, every sibling looked unfinished, and the join hung forever. **Engine unit tests are structurally blind to this**, because they supply `resolvedRefs` by hand; only the real prefetch path exercises it.

Fixing (2) changed observable behaviour — a join now completes and control flows onward within the same evaluation — so seven engine tests that encoded the old "join waits for a worker" shape were updated to match.

### Data access: Kysely, not an ORM

Sequelize was removed. The numbers made the case: **30 raw SQL calls across four repositories against 9 model calls in one**, with ~700 lines of models plus a schema-drift test existing to serve those nine — and two compiler flags weakened package-wide to make decorators work.

The deeper reason is that **in this system SQL is the design, not an implementation detail.** `FOR UPDATE SKIP LOCKED` inside a CTE, `ON CONFLICT DO NOTHING` as the idempotency guarantee, partition pruning — those *are* the correctness argument. An ORM that cannot express them is not abstracting anything; it is a second way to do the easy tenth.

Kysely is a typed SQL builder rather than an ORM, so the hot path stays exactly as explicit as before while column and table names become compile errors when mistyped — which matters given quoted PascalCase identifiers.

**Deleted:** `models/` (7 files), the drift test, `experimentalDecorators`, `emitDecoratorMetadata`, `useDefineForClassFields: false`, `strictPropertyInitialization: false`, `stripNulls`'s reason for existing, and the dependencies `sequelize`, `sequelize-typescript`, `umzug`, `pg-hstore`, `reflect-metadata` — 35 packages.

**Added:** `store/schema.ts`, a pure type declaration of the tables. Schema drift is now a compile error rather than something a test goes looking for.

Three things the migration taught:

1. **`Json | null` and `Generated<Json>` do not work.** Kysely cannot unwrap a union of a `ColumnType` with `null`, nor a `Generated` wrapped around one; every write fails to infer as an unassignable `ValueExpression`. Nullability and defaults must live *inside* the `ColumnType` — hence `NullableJson` and `JsonDefaulted`.
2. **JSONB writes take a serialised string, not an object.** Kysely cannot tell a plain object from an expression, so the `Json` column type accepts `string` on write and the `json()` helper makes serialisation explicit at each call site.
3. **The ORM had been hiding a real schema mismatch.** `taskDefinitionSchema` declares `inputKeys`, `outputKeys` and `ownerEmail`; the table had none of them. Sequelize silently discarded unknown attributes, so the two drifted apart unnoticed. Kysely sends what it is given and the insert failed immediately. The columns were added, and task-definition writes now map columns **explicitly** rather than spreading the parsed schema — spreading is what let the storage layout couple itself to the DSL in the first place.

### Second audit — isolation and races

`isolation-and-races.spec.ts` probes multi-tenancy and concurrency seams after the Kysely migration. Three defects, one of them a security issue.

1. **Cross-tenant queue leak.** `lease()` and `depth()` keyed on queue name alone. Queue names come from user-chosen task names, so two tenants both have a `charge` queue — and tenant A's worker could lease tenant B's task. This happens *below* the API, so no amount of request-level authorisation would have caught it. Both are now namespace-scoped in the repository, which is where the filter belongs.

2. **Concurrent idempotent starts failed instead of deduplicating.** The loser of the claim race looked up the winner's workflow from inside its own transaction — where the winner is still uncommitted and therefore invisible at any isolation level. Two simultaneous starts with the same key produced an error rather than one shared execution. The lookup now happens *after* the losing transaction ends, with a brief bounded retry to cover the commit window.

3. **A pending retry shadowed the completed attempt it superseded.** `loadTasksByRef` ordered by `attempt DESC`, so once a retry was scheduled it won over the completed attempt — and a pending task has no output, so every expression reading that reference silently resolved to nothing and the next task received an empty input. Ordering now puts finished attempts first.

### The runners — closing all three gaps

Three things were previously recorded but never acted on. Each failed silently: the system looked healthy while deadlines and sub-workflows quietly did nothing.

| Module | Closes |
|---|---|
| `timer.repository.ts` | Durable timers, hourly-partitioned, claimed with `SKIP LOCKED` |
| `timeout-sweeper.ts` | Fires due deadlines; the decider decides what a timeout *means* |
| `outbox-relay.ts` | Publishes outbox events — sub-workflows now actually start |
| `task-dispatch.service.ts` | The worker protocol: lease, heartbeat, report, as one unit |

**Timers now work end to end.** The decider arms `scheduleToStart`, `startToClose` and `taskTimeout` when it schedules a task; the sweeper fires them; the decider then retries or fails per policy. Deadlines are cancelled when a task finishes, and the sweeper re-checks state before acting — a timer armed at schedule time usually outlives its usefulness, and firing it against completed work would invent a failure.

**Leasing and task state are now one transaction.** Previously the queue row got a lease and fencing token while the `TaskExecutions` row stayed `SCHEDULED` with no token at all — so nothing could tell a queued task from a running one, and `completeTask`'s fencing check could never match. `TaskDispatchService` is the single place a worker interacts with, so the two rows cannot disagree about who holds the task.

**One bug found while wiring this up:** task policy was loaded from *tasks that already exist*, but deadlines must be armed for tasks about to be **scheduled** — and on a first evaluation none exist, so no timer was ever armed. The blueprint now carries `allTaskDefNames`, computed at compile time, and the evaluator loads policy from that.

Delivery is at-least-once by construction: claim, handle and mark-published share one transaction, so a crash mid-delivery rolls back the mark and redelivers. An event with no subscriber is marked delivered rather than retried forever, or the outbox grows without bound whenever someone publishes a topic nobody listens to.

### Policies that were stored and silently ignored

Six settings had configuration, documentation and a database column, and did nothing. That is the worst shape a bug takes: the operator sets the knob, the system accepts it, and behaviour never changes.

| Policy | Was | Now |
|---|---|---|
| `nonRetryableErrors` | Never consulted — a permanent error retried anyway | Matched against the failure reason; skips retry entirely |
| `timeoutPolicy` | Ignored — `ALERT_ONLY` behaved as `TIME_OUT_WF` | `ALERT_ONLY` lets the workflow continue past a timeout |
| `retryBudget` | Never enforced | Recent retry share per task definition, over a 5-minute window |
| `heartbeatTimeout` | No timer ever armed | Re-armed on each heartbeat, replacing the previous one |
| `reclaimExpiredLeases` | Cleared the queue lease only | `reclaimAbandoned` resets the task row too |

`retryBudget` needs a query, so the evaluator computes it and passes the verdict in — the decider stays pure. It ignores samples below 20 executions: a budget that trips on the first couple of retries would make any new task definition unusable before it has meaningful traffic.

The reclaim fix matters because the old behaviour left a task saying `IN_PROGRESS` under a dead worker's name — precisely the state an operator would be trying to diagnose.

### Outbox dead letter — reversing an earlier call

The relay originally marked an event with **no registered handler** as delivered, to stop the outbox growing without bound. That was wrong, and the reasoning that fixed it is worth keeping:

> "No subscriber" conflates two very different situations — a topic nobody will ever consume, and a handler that is not registered **yet** (deploy ordering, a crashed module, a config typo). In the second case the event is silently lost, and since this relay is what starts sub-workflows, the result is a parent workflow hanging forever with no evidence anywhere.

Undeliverable events now back off exponentially and, past `maxAttempts` (10 by default, generous because the usual cause is a module still starting), move to a dead letter. Dead-lettered rows are **kept and replayable**, and leave the deliverable partial index so the hot path stays small — the outbox still does not grow without bound, but the work is recoverable once the missing handler ships.

A failing handler still does not fail its batch: one broken subscriber must not stall every other topic. What changed is that failure is now recorded per event with backoff, rather than simply retried on every pass — a permanently broken handler previously busy-looped on its row, burning a claim slot each time.

### Concurrency controls

All four are enforced at **dispatch**, never in the worker SDK. A limit checked client-side is advisory, and will eventually be bypassed by a worker that is older, misconfigured, or not ours.

| Control | Bounds | Where |
|---|---|---|
| `concurrentExecLimit` | Parallelism per task definition | `ConcurrencyRepository.allowance` |
| Rate limit (token bucket) | *Throughput* per window — what most third-party APIs actually meter | Fixed windows, one upsert on the dispatch path |
| Named semaphores | A shared ceiling across *unrelated* tasks, which a per-definition cap cannot express | Acquired all-or-nothing per task |
| Workflow caps | Live executions per definition; in-flight tasks within one execution | Start time, and the decider's fan-out check |

Decisions worth knowing:

- **Semaphore permits are leased, not held.** A crashed worker otherwise drains one permit per crash until the semaphore is permanently empty and nothing runs. Permits are released in the same transaction as the task result — releasing after leaves a window where a finished task still holds one; releasing before lets a second task in while the first is still running.
- **Acquisition is all-or-nothing.** Taking a subset and waiting for the rest is how two tasks needing the same two permits deadlock, each holding one.
- **A task refused a permit goes straight back on the queue** rather than waiting out its lease, or a contended semaphore idles the queue for the full lease duration on every miss.
- **Operators are exempt from the fan-out cap.** They perform no external work, and blocking them stalls the control flow that decides what runs next — the cap would stop the workflow progressing at all.
- **Rate-limit windows are fixed, not sliding.** A fixed window admits a burst of up to 2× at a boundary; a sliding one needs per-event timestamps. That burst is a fair trade for a single upsert on the hot path.

**A race the tests caught.** `concurrentExecLimit` counted in-flight work and then leased against that count — a read-then-write with nothing between. Ten concurrent dispatchers each read zero, each granted themselves the full cap, and **45 tasks were leased against a cap of 5**. Every sequential test passed; only the contention test exposed it. Admission now takes a transaction-scoped advisory lock keyed on the queue: it releases automatically at commit or rollback, so there is no cleanup path to get wrong, and it contends only with other dispatchers of the same queue.

### The evaluation watermark: two wrong designs before the right one

Determining "which tasks finished since the last pass" went through three iterations, and the failures are worth recording because each looked correct:

1. **A `lastEvaluatedAt` timestamp compared against a JS `new Date()`.** Task `endedAt` is written by Postgres, so this made correctness depend on the host and container clocks agreeing. Under skew, finished tasks became invisible and the workflow stalled with no error.
2. **The same watermark, on the database clock.** Better, and it fixed most cases — but still unsound. Postgres `now()` is *transaction start*, so a task whose transaction begins before an evaluation yet commits after its `SELECT` gets a timestamp below the newly-written watermark and is **never seen again**. This presented as a ~1-in-3 flaky test, which Nx flagged as flaky rather than failing.
3. **Explicit per-task bookkeeping** — a `deciderSeenAt` column, set inside the evaluation transaction for exactly the completions that pass consumed. No clock is involved, so neither failure mode exists, and a rollback leaves tasks unprocessed for the next decider.

A related bug surfaced alongside it: the decider inferred "first evaluation" from `pending` and `completed` both being empty, which is **also** true of a finished workflow whose watermark has moved past every completion. It re-scheduled the entry task, which already existed, and left the workflow at `RUNNING` forever. `EvaluationState.hasAnyTask` now distinguishes the two explicitly.

**Lesson worth keeping: a flaky test is a race condition that has not been diagnosed yet.** Retrying it would have hidden a bug that strands workflows in production.

### Adversarial audit

`evaluator-deep.spec.ts` probes the paths that were *assumed* to work rather than built deliberately. It found five real defects, four of them silent.

**Held up under pressure:** ten concurrent deciders on one workflow (exactly one wins, no duplicate tasks), crash recovery mid-evaluation, rollback leaving completions unprocessed, lease expiry returning real work with the stale worker fenced out, optional-task passthrough, and flat per-evaluation cost across a 200-step workflow.

**Defects found and fixed:**

1. **Retries never re-ran.** `RetryTask` inserted at the same `(workflowId, refName, iteration)` as the failed attempt it superseded, so `ON CONFLICT DO NOTHING` absorbed it — the decider reported scheduling a retry that never existed. **`attempt` is now part of the task identity**, which also preserves full attempt history for diagnosing flaky tasks.
2. **`DO_WHILE` never terminated.** The exit path re-scheduled the DO_WHILE task, colliding with the row that had been open since the loop began; it stayed non-terminal, the frontier never emptied, and the workflow ran forever. It now **completes** the existing row.
3. **Loops ran one iteration short.** `${loop.output.iteration}` was read as the iteration *about to start* rather than the count *completed*, so `< 3` ran the body twice.
4. **A finished workflow could stall at RUNNING.** The decider is pure and cannot see the database, so it may re-emit a schedule for a task that already exists; it then considers itself busy and declines to complete — while the insert did nothing, so no completion arrives to trigger another pass. The evaluator now detects an absorbed duplicate and re-enqueues one more evaluation.
5. **Queue depth read zero during a retry storm.** A task waiting out its backoff is neither available nor leased, so `depth()` counted it nowhere. It now reports `delayed` and `total` — the metric was blank during exactly the incident it exists for.

**And one methodology bug that invalidated earlier verification.** Running `npx vitest` directly resolves workspace imports through the `import` condition, loading each dependency's built `dist/` — so `store` tests were exercising a **stale `engine` build**, while `nx test` (which rebuilds dependencies first) exercised current code. The two silently disagreed, and a fix that appeared not to work had in fact landed. Every `vitest.config.mts` now sets `resolve.conditions: ['@node-flow-dev/source']` so both paths run the same code.

**160 tests passing.** Two design decisions are now enforced by test rather than by comment:

- `EvaluationState` has **no** `tasks: TaskExecution[]` field. Making the full task list unrepresentable means no one can write code that accidentally depends on loading 30,000 rows.
- Compiling a 30,000-task workflow is covered by a timing test, so accidental quadratic behaviour in the compiler fails CI rather than surfacing as a registration timeout.

Two bugs the tests caught, both worth recording:

1. **Retry jitter could exceed `maxRetryDelaySeconds`.** The cap was applied *before* jitter, so upward jitter pushed the delay back over the ceiling — defeating the control's entire purpose. Now clamped on both sides.
2. **Stale TypeScript state can hide a real error.** `nx typecheck --skip-nx-cache` skips *Nx's* cache but not TypeScript's own incremental `.tsbuildinfo`, so a genuine `TS2307` reported fine by a direct `tsc` run was silently skipped. When verifying that something *should* fail, clear `dist/` and `*.tsbuildinfo` first, or you will confirm the wrong conclusion.

3. **`JOIN` fired while a branch was still running.** With no explicit `joinOn`, the decider fell back to the fork's branch *heads* rather than its *tips* — so the join was satisfied when every branch had **started**, not when every branch had **finished**. Invisible with single-task branches, because head and tip are then the same node, which is why a full suite of fork/join tests passed over it. The blueprint now records `forkBranchTips` separately. **Any fork test using one task per branch cannot detect this class of bug**; multi-step branches are required.

Also worth knowing: after adding a cross-package dependency, **`nx sync`** must run to add the TypeScript project reference, or the build fails with an out-of-sync error.

### Phase 1 hardening — deadlines, history, partitions, payloads, runners

The remaining Phase 1 gaps, each of which was a mechanism that existed on paper but nothing drove.

| Module | Closes |
|---|---|
| `workflow-events.repository.ts` | Append-only execution history — audit now, deterministic replay later |
| `partition-manager.ts` | Creates time partitions ahead, drops expired ones, reports DEFAULT rows |
| `stuck-workflow-sweeper.ts` | Defence in depth for a lost wakeup; **should never find anything** |
| `blob-store.ts` · `payload-store.ts` · `payload-gc.ts` | Large payloads out of Postgres, and the garbage that creates |
| `background-runner.ts` · `engine-runners.ts` | The loops that make all of the above self-driving, role-flagged |

**The workflow deadline is armed on the one pass guaranteed to happen exactly once** — the `!state.hasAnyTask` first evaluation. Anywhere else either misses executions or accumulates a duplicate timer per pass, and both are silent.

**History is sequenced from the table, not a clock.** Two events written in one transaction can share a timestamp to microsecond precision, and a history whose order depends on tie-breaking is not a history. It is written inside the evaluation transaction, so it can never disagree with the state it describes.

#### Payload offload

Inputs and outputs over 256 KB move to blob storage and the row keeps a `<scheme>:<key>` ref. Filesystem driver by default — the reason node-flow still needs no object store — with S3/GCS behind the same `BlobStore` interface in Phase 8.

Three decisions carry the design:

- **The blob is written before the transaction that references it commits.** The other order would commit a row pointing at a blob that does not exist, which is unrecoverable. This one leaks storage on a rollback, which a garbage collector cleans up. Leaking is the right failure.
- **Refs carry their scheme** because they outlive the deployment that wrote them. A cluster that starts on the filesystem and later moves to S3 still has years of `fs:` refs in its history, and a bare key gives no way to know which store to ask.
- **The evaluator resolves every payload before the decider sees one.** This is the whole risk of offloading: an unresolved ref does not throw — the decider reads it as *absent*, so `${bigTask.output.status}` evaluates to undefined, the workflow takes the default branch, and it reports success. The offload tests therefore assert on the branch the engine actually took, never on the ref column.

Orphan collection needs to answer "does any row still point at this blob?" cheaply, so `0002-payload-refs` adds four **partial** indexes on the `*Ref` columns. They cover only offloaded rows, so a deployment where nothing exceeds the threshold pays nothing.

#### The runners

Every sweeper in this package exposes one `run a batch` method and no lifecycle. `background-runner.ts` is the single place that turns them into loops, and `NODE_FLOW_ROLES` selects which a process holds: `api` (none — request latency should never compete with a partition roll), `decider` (evaluation), `poller` (everything time-driven).

Four properties, each for an otherwise-silent failure:

- **Passes never overlap.** Two relays publishing the same batch turns a slow database into a correctness problem rather than just a slow one.
- **A throwing pass does not stop the loop**, and the error is counted rather than swallowed.
- **A full batch runs again immediately.** After an outage there may be thousands of due timers; sleeping a full interval between fixed-size batches would take hours to drain seconds of work.
- **Intervals are jittered.** Replicas started by one rollout otherwise sweep in lockstep forever, converting steady load into a periodic spike on already-contended rows.

An unknown `NODE_FLOW_ROLES` value throws rather than falling back to a default: running with no decider produces a cluster where every workflow starts and none progresses, traced to a typo nobody would think to look for.

#### Two partition bugs the integration test caught

Both were shipped, and neither could be seen from a unit test — they need a database with rows already in it.

1. **The roller could never create the current period's partition.** The migration created only DEFAULT partitions, so from the first insert every row landed there — and Postgres then refuses to create a partition that would orphan those rows. `ensureAhead` failed with a check violation on that same period forever, so retention silently never worked. Fixed at both ends: the migration now seeds the current period so a fresh database never writes to DEFAULT at all, and the manager recovers from a populated one by detaching DEFAULT, creating the partition, moving only the in-range rows and re-attaching — all in one transaction, because a crash without the DEFAULT attached would fail every out-of-range insert.

2. **Concurrent creation was unhandled.** Every poller replica runs this loop, so two creating the same partition at once is the normal case, not an edge one. Duplicate-table and overlapping-partition errors are now treated as "someone else got there first".

The first of these is worth noting as a methodology point: the partition tests passed because `truncateAll` runs before each one, so DEFAULT was always empty. It took wiring the runners against a database with live workflows in it to expose the failure.

**291 tests passing** across the workspace — 17 core, 80 engine, 188 store, plus the server and package stubs.

### The `/v1` API, authentication, and operator control

`packages/server` was a hello-world scaffold: the whole engine was real and unreachable. It is now the API in front of it.

| Module | What it holds |
|---|---|
| `config/` | Every env var, validated by zod once at boot |
| `database/` | The pool, migrations at boot, and every `store` repository as a provider |
| `auth/` | `Authenticator` chain, the single global guard, token exchange, credential admin |
| `health/` | Liveness and readiness, separated |
| `metadata/` | Workflow and task-definition registration |
| `execution/` | Start, read, history, and the six operator actions |
| `queue/` | The worker protocol: lease, heartbeat, report |
| `runner/` | Ties the background loops to the Nest lifecycle |

**Configuration fails the boot, not the request.** A setting whose wrong value is silently survivable gets no default — `DATABASE_URL` and `NODE_FLOW_JWT_SECRET` have none, because a server that quietly starts against `localhost/postgres`, or signs tokens with a fallback secret, is worse than one that refuses to start. All problems are reported at once; fixing misconfiguration one restart at a time is how a five-minute deploy becomes an hour.

**Authorization is default-deny.** The guard is registered through `APP_GUARD`, so a new controller is protected the moment it exists and opting out takes an explicit `@Public()`. Protecting only what is marked protected means every new endpoint is public until someone remembers, and the mistake is the *absence* of a line — invisible in review.

**Namespace isolation is enforced in two places, for two different reasons.** The guard checks that the `:ns` in the URL is the caller's own namespace, because trusting the URL would let any credential act anywhere by editing a path segment. The repositories filter by namespace independently, because a filter applied in a controller is one the next non-HTTP caller bypasses. Handlers only ever read `principal.namespaceId`; the guard's job is to guarantee it matches the path.

#### Three dependencies deliberately not taken

Each was in the plan's stack table and each turned out to cost more than it gave.

- **`@nestjs/swagger`** — its current release requires NestJS 12 and we are on 11, and it peers on `class-validator`, `class-transformer` and `@fastify/static`. Zod 4 emits JSON Schema 2020-12 natively via `z.toJSONSchema()`, which is exactly the dialect OpenAPI 3.1 consumes — so the document can be generated from the same schemas that validate requests. That is closer to the plan's own stated principle (*one source of truth for DSL types, validation, docs*) than the library would have been.
- **`class-validator`** — the DSL is already defined in zod in `core`. Re-declaring those shapes as decorator DTOs is precisely the duplication that lets an API and an engine drift apart. Requests are validated by a small zod pipe instead.
- **`@nestjs/terminus`** — every database indicator it ships is ORM-bound (TypeORM, Sequelize, Mongoose, Prisma) and we use none of them, so we would write a custom indicator anyway while inheriting fifteen optional peers for a response envelope. That envelope is forty lines.

#### Execution operations

Six operations that previously did not exist at any layer — the store had only `setStatus`. They live in `ExecutionControlService`, not in the controller, because the CLI and UI will call the same code.

Each takes the workflow row lock, the same one the decider takes, so an operator action and an evaluation are strictly ordered rather than interleaved. Without it, a terminate races a schedule and leaves a task running against a workflow that is already `TERMINATED`. Each is also recorded in `WorkflowEvents` in the same transaction: "who terminated this, and when" is asked after every incident and task rows cannot answer it.

**`terminate` is mostly cleanup**, and every part of it is load-bearing: an armed timer would fire against a dead execution, a queued task would be leased and run work nobody wants, and an unreleased semaphore permit would throttle unrelated workflows until its lease expired.

#### Three real bugs found while wiring this up

1. **Pause was decorative.** `PAUSED` is not a terminal status, so the decider kept evaluating a paused workflow and scheduling new tasks. The evaluator now returns early on it. The claim it took is discarded rather than left in place, which would busy-loop every poll — so `resume` re-enqueues an evaluation *in the same transaction as the status flip*. Without that enqueue the workflow returns to `RUNNING` and sits idle forever, because completions that landed during the pause had their wakeups discarded.

2. **`retry` reopened tasks that no worker could ever see.** Resetting a failed task row to `SCHEDULED` is not enough: the decider cannot re-enqueue it, because the row already exists and its `ScheduleTask` is absorbed by the unique index on `(workflowId, refName, iteration, attempt)`. The workflow went back to `RUNNING` with a runnable task on no queue, and stalled — silently, looking healthy. `retry` now enqueues them itself.

3. **The namespace guard failed open.** It was a second global `APP_GUARD`, in a different module from the auth guard, so their relative order was Nest's to decide. Reached before a principal existed, it hit `if (!principal) return true` and allowed the request — meaning a credential could act in another namespace by editing a path segment. Both checks are now one guard, in one order, so the question cannot arise. **A guard that opens when its precondition is missing is not a guard**, and no amount of comment would have made the two-guard version safe.

The third is the one worth generalising: the failure was not the missing check but the *fail-open default* underneath it, which turned a wiring mistake into a silent authorization bypass. A mutation test confirms both namespace tests fail when the check is removed.

#### Server tests moved from jest to vitest

The generator left `server` on jest while every other project used vitest. Beyond the inconsistency, jest resolves `@node-flow-dev/*` through `main`/`exports` and would have loaded each dependency's built `dist/` — the stale-build trap already recorded above, which silently invalidated an earlier round of verification.

`unplugin-swc` is configured with `legacyDecorator` and `decoratorMetadata`, and it is not optional: vitest transpiles with esbuild, which emits no `design:paramtypes`. NestJS reads exactly that to resolve constructor injection, and without it **DI does not throw** — it resolves every dependency to `undefined` and tests fail later with unrelated errors.

**383 tests passing** — 31 core, 80 engine, 233 store, 33 server, plus package stubs.

#### Open at the time of this section

The first two were closed immediately after, by the work in the next section. The rest still stand.

- ~~No bootstrap path~~ — closed by `nf bootstrap`.
- ~~No OpenAPI document~~ — closed by `GET /v1/openapi.json`.
- ~~No human login~~ — closed by email + password login with sessions and CSRF; see the section on it below.
- ~~No long-poll~~ and ~~no worker SDK~~ — both closed by the section after next; push delivery remains deferred to Phase 8.
- ~~No search or metrics~~ — both closed. OpenTelemetry tracing remains, deferred to Phase 8.
- ~~Task domains and I/O schema validation~~ — both closed; see the section on it below.

### OpenAPI, and `nf bootstrap`

Two gaps that were each blocking someone: the API had no machine-readable contract, and a fresh install had no way in.

#### The document is generated from the router, not written by hand

`GET /v1/openapi.json` serves an OpenAPI 3.1 document assembled at boot by walking Nest's own controller metadata. Three properties, each closing a way a spec normally drifts:

- **Routes come from the real router.** A hand-maintained spec is wrong the first time someone adds an endpoint and forgets, and the failure is invisible — the API works, the document quietly lies.
- **Schemas are the same zod objects the pipes validate with.** Zod 4's `z.toJSONSchema()` emits JSON Schema 2020-12, which is exactly the dialect OpenAPI 3.1 consumes, so there is no translation layer between them to be wrong. Generated with `io: 'input'`, because the *input* view is what a client must send — the output view would list fields as required that the server fills in itself.
- **Security requirements are read from the guard's own metadata.** The scopes documented per endpoint are the same `REQUIRED_SCOPES` the guard enforces, so the document cannot claim a permission the server does not require.

This is why `@nestjs/swagger` was not used, beyond its NestJS 12 requirement: it would need `class-validator` DTOs restating shapes `core` already defines, which is the drift this design exists to prevent. No Swagger UI is served — that needs `@fastify/static`, excluded earlier — but the document is the contract and any viewer can point at the URL.

#### `nf bootstrap` breaks the credential cycle

Every write endpoint needs a principal, a principal comes from a credential, and a credential belongs to a namespace — so a fresh database has no way in through the front door. Something out-of-band has to break that, and the alternatives were worse:

- A **bootstrap token in the environment** is a standing credential that outlives its purpose and gets forgotten in a config file.
- **Auto-creating a default namespace with a known key** ships every install with the same credential, which is the most reliably exploited misconfiguration in self-hosted software.

A deliberate local command means the secret exists once, on the operator's terminal. It connects to Postgres directly rather than to the API, which is the honest shape of the operation.

```
nf bootstrap --namespace default
nf migrate --database-url postgres://…
```

Idempotent on the namespace, **deliberately not on the credential**: the first key is unrecoverable by design, so "I lost it" is the common reason to run this again, and refusing would lock an operator out of their own install with no path back that does not involve SQL.

`migrate` exists separately so a multi-replica rollout can run schema changes as one job rather than racing them across every pod on deploy.

**Verified end to end outside the test suite**: bootstrap against an empty Postgres → build and boot the real server → the printed key authenticates at `/v1/auth/whoami`, an unauthenticated request gets 401, the document lists 28 paths, and SIGTERM stops the runners before the pool closes.

#### `cli` retagged from `scope:client` to `scope:app`

The boundary lint caught this rather than a human, and it is a real architectural question, not a lint annoyance. `scope:client` may only depend on `scope:pure` and `scope:client`, on the grounds that client packages ship to users' machines and must not carry a database driver.

`nf bootstrap` and `nf migrate` exist precisely to do what the API cannot, so they run next to the database by design. The CLI is an **operator tool**, not a library shipped to end users — `sdk` is the package that rule is really protecting, and it stays `scope:client`. Recorded in the eslint config next to the rule, so the exemption is a decision rather than a waiver.

**414 tests passing** — 31 core, 80 engine, 233 store, 49 server, 16 cli, plus package stubs.

### Long-poll delivery and the worker SDK

The last two structural gaps in Phase 1. Together they change the worker model from "poll on a timer and pick your poison" to "park and be woken".

#### Why long-poll rather than a shorter interval

Fixed-interval polling forces a choice between latency and load: poll every 100ms and a thousand idle workers generate ten thousand pointless queries a second; poll every five seconds and every task waits up to five seconds to start. Parking the request removes the trade-off — an idle worker costs one held connection and *no queries at all*, and a task starts within a millisecond of being enqueued.

`NOTIFY` is issued on the same connection as the enqueue insert, which makes it part of the transaction: Postgres holds notifications until commit, so a parked worker is never woken for a task a rollback then removes. Delayed tasks are not announced — they are not visible yet, so waking a worker would only burn a round trip.

One channel for the whole cluster, not one per queue. Channel names are global and a busy install has thousands of queues; routing to the right waiter happens in process, where it is free.

**`NOTIFY` is an optimisation and never a correctness guarantee.** It reaches only the connections listening at that instant, so a replica mid-reconnect silently misses everything in the gap. Every wait therefore also has a timeout, and *the timeout is what makes the design correct*. Treating notify as reliable is how a fleet quietly stops picking up work after a network blip — so the tests include a run with the notifier switched off entirely.

**The subscription is registered before the queue is read**, the same shape as the decider's claim-before-read rule. Check first and subscribe second, and a task enqueued in that window notifies nobody: the worker parks for its full timeout while its work sits ready. A test reproduces exactly that window by making the first lease attempt slow and enqueuing during it — with the ordering reversed it takes the full 5s instead of under 2s.

#### The SDK

`NodeFlowClient` uses the global `fetch` rather than an HTTP library — an SDK that drags a client into a user's dependency tree for four endpoints has made their problem worse. API keys go in a header; service-account credentials are exchanged for short-lived tokens, cached, refreshed 60 seconds early (clock skew makes the exact boundary unknowable), and concurrent refreshes collapse onto one exchange.

`Worker` leases, runs a handler, heartbeats, and reports. It never holds more work than its concurrency allows — leasing work it cannot start would hold a lease nothing is working under, and the server would reclaim it as abandoned. Heartbeats run at a third of the lease so two can be lost to a blip before it expires. A handler throwing `TerminalTaskError` reports `FAILED_WITH_TERMINAL_ERROR`, which skips the retry budget: retrying a malformed payload twenty times helps nobody.

#### Three real bugs found while building this

1. **Worker shutdown blocked for the full poll duration.** `stop()` awaits the lease loop, and the loop was sitting inside a parked HTTP request with nothing to cancel it. A fleet with a 30-second poll took 30 seconds to stop — longer than the grace period most orchestrators allow before SIGKILL, turning a clean drain into exactly the abrupt termination it was meant to avoid. The shutdown signal is now passed through to the request.

2. **Server shutdown blocked on parked polls.** A parked long-poll is an in-flight request as far as the server is concerned, so `close()` waited for it — and a worker aborting its side does not help, because the client socket closes while the handler keeps waiting. `HttpShutdownService` now releases every parked poll in `beforeApplicationShutdown`, which is the last hook before Nest closes the HTTP server. Measured: a real server with a worker parked on a 30-second poll now shuts down in **32ms**.

   Worth recording: `forceCloseConnections: 'idle'` looks like the fix for the keep-alive half of this and is not — Fastify only honours it when a custom `serverFactory` is supplied, which Nest's adapter does not do, so setting it is silently a no-op. `closeIdleConnections()` is called directly instead.

3. **Concurrent partition creation over-reported.** `CREATE TABLE IF NOT EXISTS` means the losing side of a race no-ops *successfully* and then reports having created the partition, so `ensureAhead` returned more names than partitions it made. Surfaced as a 1-in-4 flaky test, which — per the lesson already recorded above — is an undiagnosed race rather than a test to retry. Dropping `IF NOT EXISTS` lets the duplicate raise, and exactly one caller now claims each creation.

Also fixed: a lease that found work immediately **abandoned** its pending wait rather than cancelling it, leaving the listener and timer registered for the full duration. At a 30-second wait and a few hundred leases a second that is tens of thousands of dead closures, and a "parked pollers" metric that reads as a fleet-wide stall when nothing is stalled. `waitFor` now returns a cancellable waiter.

#### A test-isolation defect the speed-up exposed

Making the workers fast enough to interleave broke three SDK tests that had been passing: they shared one queue, so a test would pick up a *previous* test's leftover task, and the failure surfaced as an unrelated 20-second timeout. Each test now registers its own workflow with its own queue names — removing the coupling rather than adding cleanup that has to stay correct.

**466 tests passing** — 31 core, 80 engine, 253 store, 65 server, 17 sdk, 16 cli, plus package stubs.

### Search and metrics — Phase 1 complete

#### Search

Structured filters, not a query-string DSL. Conductor accepts a Lucene-ish string, which reads well in a demo and then has to be parsed, escaped and injection-proofed — and every client reimplements the escaping. A typed body needs none of that, is what a UI builds anyway, and keeps correlation ids out of access logs. It is a `POST` for that reason, despite being a read.

**Keyset pagination, never `OFFSET`.** Offset re-scans and discards every skipped row, so page 500 costs 500 times page 1 — but the serious problem is correctness: this table takes continuous inserts, so rows shift between requests and an offset silently skips and duplicates executions. A cursor on `(startedAt, id)` is stable under concurrent inserts and costs the same on every page. `startedAt` leads it so the planner can prune partitions rather than probing all of them.

`0004-search-indexes` adds the "runs of *this* workflow" index the existing schema was missing, plus the unfiltered newest-first listing and a parent lookup for sub-workflow trees. All ordered `startedAt DESC` to match the query — an index whose order disagrees still filters, but the planner must then sort the whole matched set before returning the first page, which is exactly what keyset pagination exists to avoid.

**A precision bug the tests caught.** The first cursor round-tripped `startedAt` through a JavaScript `Date`. `timestamptz` holds microseconds and a `Date` holds milliseconds, so the encoded value sorted *before* the row it came from — and a `<` comparison against it skipped every row sharing that millisecond. Under rapid inserts that was most of them: paging 12 executions returned 9. Invisible in any fixture that creates rows slowly. The cursor now carries `"startedAt"::text` at full precision and both sides of the comparison are cast explicitly, because leaving the cast to inference can pick `text` — which orders UUIDs lexically and quietly returns the wrong page.

#### Metrics

A Prometheus endpoint at `GET /v1/metrics`, with the gauges **chosen** rather than collected: decide-queue depth and age, tasks ready/leased/delayed, overdue timers, outbox pending and dead-lettered, running workflows. Each moves *before* users notice anything. Throughput counters are lagging indicators — useful for capacity, useless for paging someone.

Two decisions worth keeping:

- **No per-queue labels.** Queue names come from user-chosen task names, so a busy install has thousands; a per-queue gauge would create a series per queue per namespace and make the metrics endpoint the most expensive thing in the deployment. Per-namespace totals answer "is anything backing up"; the API answers "which queue".
- **Depth *and* age for the decide queue.** Depth alone is ambiguous — a thousand entries drained in a second is healthy, ten stuck for an hour is not. Age is what distinguishes them.

Engine gauges are collected at scrape time from the database, because they describe cluster-wide state no single replica knows; all nine share one cached reading, so a scrape is one query rather than nine. Runner counters come from the in-process loops. `runner_errors_total` is the one to alert on: a background loop survives its own exceptions by design, so nothing else would reveal a pass that throws every time.

The endpoint is **authenticated**, unlike the conventional open `/metrics`, under a dedicated `metrics:read` scope — separate from `admin` because a scraper is a long-lived automated credential that should not also be able to mint new ones. The gauges expose install-wide backlog, which is not something a tenant should read about the cluster.

#### Two smaller things found along the way

- **`POST /executions/search` collides with `POST /executions/{name}`** in shape — both one segment. Fastify prefers the static route, so search works, but that is a property of the router rather than of anything here: if it ever changed, "search" would be read as a workflow *name* and a search request would start a workflow. Pinned by a test.
- **A malformed cursor returned 500 and logged a server fault.** It threw a bare `Error`, which the domain filter cannot recognise. `ErrorCode.INVALID_ARGUMENT` now covers malformed input that no schema can catch, and maps to 400 — telling the caller their input was wrong rather than that the server is broken.

**505 tests passing** — 31 core, 80 engine, 275 store, 82 server, 17 sdk, 16 cli, plus package stubs. Verified on a live server: all nine engine gauges and per-runner labels populate.

### Email and password login for the UI

`PrincipalType.USER` finally has a producer. Nothing above the authenticator chain changed — the guard, the scope checks and every controller read a `Principal` and still do not know how it was established, which was the point of building the chain that way in Phase 1.

#### Sessions are rows, not signed tokens

A signed session token cannot be withdrawn before it expires, so an offboarded employee or a compromised laptop stays authenticated until the clock runs out. A row can be deleted. That costs one indexed lookup per request — nothing for humans making a handful of requests a minute, which is exactly why workers use bearer tokens and people use sessions.

Three deadlines, each for a different failure: an **absolute** expiry, because a session that only ever slides forward never ends; an **idle** expiry refreshed on use, to bound an abandoned session on a shared machine; and **revocation**, checked in the same query so no code path can forget it. Disabling an account revokes its sessions, and changing a password revokes every *other* session — leaving them alive is how an attacker keeps access while the user believes they have just locked them out.

#### The cookie, and the CSRF that has to come with it

`HttpOnly` is the single most important decision here: script cannot read the session, so an XSS bug cannot exfiltrate it. A token in `localStorage` — the usual alternative — turns every XSS into a full account takeover.

The cost is that browsers attach cookies *automatically*, so another site can cause an authenticated request. `SameSite=Lax` blocks the classic form-submission CSRF outright, and a double-submit token is the second layer: the same value in a script-readable cookie and in a header the page sets. An attacking site can cause the cookie to be sent but cannot read it, so it cannot produce the matching header.

**The scope of the CSRF check is the part worth getting right.** It applies only to cookie-authenticated, state-changing requests. An API key or bearer token is never attached automatically, so those requests cannot be forged — and demanding a token from workers would break every one of them for no security gain, which is how CSRF protection usually ends up switched off entirely. Sending neither half is a refusal, not "nothing to compare, allow"; that shortcut is what makes double-submit useless.

#### Passwords

A password is *chosen by a person*, so it has perhaps 30 bits of real entropy against a dictionary rather than 256 — which is why `password.ts` looks nothing like `hashApiKey`. scrypt, memory-hard, at N=2^15.

The cost parameters are stored **with each hash** (`scrypt$N$r$p$salt$hash`). Hard-coding them means they can never be raised, because every existing hash would become unverifiable; storing them makes cost a property of the value, so it can be increased and old hashes upgraded on their owner's next successful login — the one moment the plaintext is available. Parameters read back from storage are bounds-checked, because a hash is attacker-influenced data the moment anything can write one and `N = 2^40` from a poisoned row is memory exhaustion.

The policy is **length only, no composition rules**. Requiring an uppercase and a symbol pushes people towards `Password1!` and towards reuse; NIST dropped those rules for exactly that reason. There is an upper bound too, which is not a strength rule — it stops a megabyte "password" being fed to a deliberately expensive KDF.

Every failure path returns the same message *and takes comparable time*: an unknown email still burns a KDF, because returning early makes it measurably faster than a wrong password and that difference is a user-enumeration oracle.

Failed logins back off exponentially, capped at fifteen minutes and cleared on success — deliberately **not** a permanent lockout, which is a denial-of-service against any account whose email an attacker knows. A lockout answers 429 with `Retry-After`, the half of a 429 a client can actually act on. Per-IP limiting is a separate axis and a **known gap**: an attacker spreading one guess across many accounts is not slowed by this.

#### `nf create-user`

The same chicken-and-egg as `nf bootstrap`, one layer up: creating a user needs an `admin` credential, and the first admin is a person who cannot yet log in. The bootstrap password is held to the full policy — a bootstrap account is the most privileged one in the install, and "temporary" passwords are the ones that survive longest.

Verified against a live server with a real cookie jar: login sets `nf_session` as HttpOnly and `nf_csrf` as readable, an authenticated `GET` works, a `POST` without the header is 403 and with it is 200.

**569 tests passing** — 31 core, 80 engine, 318 store, 103 server, 17 sdk, 16 cli, plus package stubs. The CSRF check and the `HttpOnly` flag are both mutation-tested: removing either fails the tests that assert it.

#### Still open for human auth

- **No per-IP rate limiting** on login, as above.
- **No password reset.** It needs email delivery, which the system does not have; until then an admin creates a new account or an operator uses the CLI.
- **No OIDC/SAML SSO** — the agreed next layer, and by construction another `Authenticator` rather than a change to anything else.
- **No RBAC.** Users carry scopes directly, exactly as service accounts do; roles and groups remain Phase 5 proper.

### Closing the stored-and-ignored settings

Both of these were recorded as "not hard to fix" and left. That was the wrong call: a setting the system accepts, validates, persists and then ignores is not an unimplemented feature, it is **active misinformation** — and the two here were a tenant-isolation control and a data contract. They jumped the queue ahead of Phase 3.

#### Task domains

`domain` was in the DSL, validated, stored, and dropped at enqueue: every task went to the shared queue while the API kept accepting the routing request. Fixing it turned up the same mistake in three more places, which is the useful part:

- The **queue-name rule** (`taskDefName[:domain]`) now lives in one function in `core`, because it has to agree in three places that never see each other — the decider that schedules, the worker that leases, and the scope that authorises. Implicit, it was simply forgotten.
- The **task row now records its domain**. The queue entry encodes it, but that row is deleted on acknowledgement — so by the time an operator retried a failed task, the only record of where it belonged was gone and the retry landed on the shared pool.
- The **dispatch-policy lookup** was searching for a task definition called `charge:eu-west`, finding nothing, and silently dropping every concurrency cap, rate limit and semaphore for domained queues.

Authorization follows the isolation intent: `queues:lease:charge` does **not** grant `charge:eu-west`. Domains exist to separate fleets, so a fleet must be named explicitly; `queues:lease:charge:*` covers every domain of one task.

#### `inputSchema` / `outputSchema`

Accepted, stored, never consulted. Now enforced with Ajv — chosen over a hand-rolled subset because the field is documented as JSON Schema, and a partial implementation would accept schemas it then silently ignored half of, trading one lie for a subtler one.

Three decisions worth keeping:

- **A bad input fails the task, not the evaluation.** Throwing would roll the pass back, the decider would re-derive the same bad input on the next wakeup, and the workflow would spin forever. Recording it as `FAILED_WITH_TERMINAL_ERROR` lets the existing retry and timeout machinery handle it and puts the reason where someone debugging will look.
- **A bad output is thrown back at the worker**, not recorded as a task failure. The worker sent something wrong and needs to know; burying it in the execution record would leave the worker believing it succeeded.
- **A failure report is exempt from the output schema.** It is diagnostic, and holding it to the success contract would reject exactly the information needed to debug the failure.
- **No coercion, no defaults.** Ajv can rewrite the value it validates, which would make what the engine stores differ from what the worker reported — unacceptable in a system whose point is an auditable record.

An uncompilable schema is rejected at *registration*, because the validator skips one at execution time — so without that check an operator declares a contract, gets a 201, and it silently never applies.

Both fixes are mutation-tested: reverting either makes six tests fail.

**591 tests passing.**

---

### Remaining gaps, and when they close

Every known gap, with the phase that closes it. Recorded here so "known" means scheduled rather than forgotten — which is exactly how the two above went unfixed for three phases.

| Gap | Fix | When |
|---|---|---|
| **Per-IP login rate limiting** | Reuse `RateLimitBuckets`, keyed on IP rather than queue. The table, the fixed-window logic and the advisory-lock pattern already exist | **Phase 5**, with RBAC |
| **Password reset** | Needs email delivery, which the system does not have. Arrives with the `EMAIL`/SendGrid task in Phase 4 — reset is then a workflow, which is a pleasing use of the product on itself | **Phase 4** |
| **RBAC (roles, groups)** | Users and service accounts carry scopes directly today. Roles become a layer that *resolves to* scopes, so `Principal` does not change | **Phase 5** |
| **Push delivery** (gRPC/WebSocket) | Long-poll already removes the latency/load trade-off, so this is a throughput optimisation rather than a missing capability | **Phase 8** |
| **OpenTelemetry tracing** | Metrics shipped in Phase 1. Tracing needs context propagated into workers, which is an SDK change as much as a server one | **Phase 8** |
| **`YIELD` operator** | Needs the signal plumbing the API now provides; it was blocked, and no longer is | **Phase 2** |
| **JSONPath in expressions** | `${...}` covers the common case. `jsonpath-plus` slots into `engine/expression.ts` | **Phase 2** |
| **Typed TypeScript builder** | `sdk` has the client and worker; the builder is additive | **Phase 2** |
| **Saga / compensation** | `compensateWith` on a task, unwinding completed work in reverse. A decider change, so it needs the operator work Phase 2 finishes first | **Phase 2** |
| **Bulk operations** | Pause/resume/retry/terminate over a search result. Cheap once search exists, which it now does | **Phase 2** |
| **Namespace API** | Creating *further* namespaces still needs the CLI or SQL. Blocked on nothing; simply not written | **Phase 5** |

Two things that are **not** gaps and are sometimes mistaken for them:

- **Artifact and shared-volume management** is out of scope by decision, recorded with its rationale above.
- **Postgres-only** is the positioning, not a limitation. Adapters arrive in Phase 8 for installs that outgrow it, and the honest ceiling is documented rather than hidden.

### Phase 3 — system tasks, and the runner that executes them

Every task type the DSL declares beyond `SIMPLE` and the operators was accepted, validated, and then **enqueued for an external worker that by definition does not exist** — so an `HTTP` task simply hung until its timeout. Sixteen declared types, none runnable. This closes the architecture and the first executors.

#### A system task is a worker that lives in-process

The runner leases through the same queue, holds the same fencing token, heartbeats the same way, and reports through the same path. That is deliberate: a separate execution path would have to re-earn retries, timeouts, concurrency caps, lease expiry and fencing — and would get at least one of them wrong.

It did, in fact, get one wrong. The first version leased straight from the queue repository, skipping `markTaskStarted` — so the task row had no fencing token, `completeTask` silently refused every result, and the task sat `SCHEDULED` until the reclaimer ran it again. Forever. That is precisely the bug the Phase 1 note about leasing-and-marking-in-one-transaction records, reintroduced by adding a second lease path. `TaskDispatchService.leaseSystemTasks` now owns it, so both paths go through the same discipline.

`TaskQueues` gains a denormalised `taskType`. The type is on `TaskExecutions`, but that is the widest table in the system and this is its hottest one — the whole reason the queue is narrow and aggressively vacuumed is that leasing must not touch anything else. Written once at enqueue and never updated, so the usual objection to denormalisation does not arise.

The **registry is pluggable** because the useful set of system tasks is open-ended and install-specific: one deployment needs `JDBC`, another an internal protocol nobody else has. A closed `switch` would make every addition a fork.

#### `HTTP`, and why most of it is refusals

The most-used system task, and a **request-forgery primitive**. A workflow definition is user input, and this server sits inside the perimeter with reach to cloud metadata endpoints, internal admin panels and databases. So:

- **The SSRF guard is on by default**, checks the *resolved address* rather than the hostname — a name check is bypassed by pointing your own domain at `127.0.0.1` — and covers loopback, RFC1918, carrier-grade NAT, multicast, IPv6 unique-local and IPv4-mapped IPv6. `169.254.0.0/16` matters most: it is where every major cloud puts instance metadata, and reading it usually yields credentials.
- **Redirects are followed manually** so every hop is re-checked. `redirect: 'follow'` would let a perfectly public URL bounce to `169.254.169.254` and defeat the entire guard. Headers are dropped when a redirect changes host, because forwarding an `Authorization` header to wherever a redirect points is how credentials leak to third parties.
- **Allowing private addresses is a deployment setting, not a task input.** As an input, any workflow author could set it themselves — which is the same as not having the guard.
- **The body is streamed and counted**, not buffered on trust: `Content-Length` is a hint a hostile server need not honour.
- **`set-cookie` and friends are redacted** from recorded output. A task's output is stored, searchable and shown in the UI; a session cookie there outlives its request somewhere nobody thinks to look.
- **4xx is terminal, 5xx and 429 are not.** That distinction is what makes the retry policy useful rather than a way to turn one broken URL into twenty attempts.

A known limit, recorded rather than papered over: the guard resolves, then `fetch` resolves again, so DNS can change in between — the classic rebinding race. Closing it properly needs the checked address pinned for the connection, which requires a custom dispatcher.

#### One more latent bug, surfaced by an index

Adding the system-task index changed a query plan and broke a priority test that had passed for months. The selection was never wrong — the CTE's `ORDER BY` decides *which* rows are leased — but the test relied on `UPDATE … RETURNING` giving them back in that order, which Postgres has never guaranteed. A worker would silently have begun processing its batch lowest-priority first. The order is now sorted explicitly, so the guarantee is real rather than accidental.

**630 tests passing** — 31 core, 80 engine, 357 store, 103 server, 23 tasks, 17 sdk, 16 cli. Verified on a live server: an `HTTP` task completed with a real response body, and one aimed at `169.254.169.254` failed terminally with the guard's reason.

#### Still to come in Phase 3

**Nothing.** Every system task is implemented - see "Phase 3 is complete" below. `UPDATE_SECRET` is the single inventory row deferred, to Phase 5, because it writes to a secrets store that does not exist yet.

One note on the plan's original wording: `INLINE` was to run in a **worker-thread pool**, and does not yet. The interrupt handler bounds CPU from inside the sandbox, so a runaway script cannot hang the process — but a long-running one still occupies the event loop for its budget. The pool matters once `INLINE` volume is high enough for that to show up as decider lag, and is tracked with the Phase 8 throughput work. `JSON_JQ_TRANSFORM` since took the thread route for a different reason entirely — see below — so the mechanism now exists and reusing it for `INLINE` is a smaller change than it was.

### `WAIT` and `INLINE`

#### `WAIT` is completed by the clock, and never queued

A queued task holds a lease, and a lease must be heartbeated or it expires — so a seven-day wait would either occupy an execution slot for a week or be reclaimed as abandoned within the minute. Neither is a wait.

So `WAIT` is **timer-backed**: the decider arms a `wait` timer and the task sits `IN_PROGRESS`, costing nothing until the sweeper fires it. `isTimerBacked()` in `core` is what keeps the three places that must agree — the decider, the evaluator's enqueue, and the deadline arming — from drifting apart.

Two details that would each have been a bug:

- **No dispatch deadlines are armed.** `scheduleToStart` measures "nobody picked it up", which is permanently true of a task nothing picks up — it would fire while the WAIT was legitimately waiting and mark it `TIMED_OUT`, turning the feature into something that looks like one of the engine's own guarantees failing. `taskTimeout` is kept, because a declared total budget should win over the wait itself.
- **A fired wait completes rather than times out.** Every other timer kind records a deadline being *missed*; this one records the task doing exactly what it was asked. Sharing the TIMED_OUT path would have made every successful wait look like a failure.

The task starts `IN_PROGRESS` rather than `SCHEDULED`, because nothing will ever pick it up and `SCHEDULED` would misreport it as waiting for a worker in every view an operator looks at.

#### `INLINE` — the sandbox is the design

This is the one place a user supplies **code**, so the choice of sandbox is the whole feature.

`node:vm` is not a sandbox: the context shares a heap with the host, and `this.constructor.constructor('return process')()` walks out in one line. `isolated-vm` is a real isolate and faster, but it is a native addon in the host address space with a type-confusion escape CVE in August 2026 — and "fast, with a history of escapes" is the wrong trade for untrusted code in a multi-tenant control plane.

QuickJS on WebAssembly has a categorically different property: the guest **cannot address host memory at all**, because WASM's memory model provides no way to. There is no host object graph to reach; an escape needs a bug in the WASM engine rather than in a binding layer.

The guest gets the input and nothing else — no `require`, `fetch`, timers or `process`. That is not a restriction to relax: a task needing the network has `HTTP`, and one needing to do real work has a worker.

A **fresh runtime per execution**, from a shared compiled module. Instantiating the module costs tens of milliseconds; a runtime costs almost nothing. That is what guarantees one script leaves nothing behind for the next — no globals, no prototype edits, no memory — across tenants.

A **timeout alone cannot stop `while (true) {}`**, because the guest never yields and nothing outside gets a chance to act. An interrupt handler checked by the engine between operations does, from the inside, and the guest cannot disable it.

#### The stack limit that aborts the engine

`setMaxStackSize(512 * 1024)` looks like a sensible number and is a live hazard.

QuickJS enforces that limit itself and raises a catchable JS error. The *host* WASM stack has its own, lower ceiling. Set the guest limit above the host's and the host `RangeError` fires first — which leaves the runtime holding live objects, so `dispose()` trips an assertion and **aborts the shared WASM module**, breaking every later `INLINE` task in the process. Not one failed task: all of them, until a restart.

Measured directly: 256 KB traps cleanly and disposes; 512 KB aborts. The default is 128 KB, which is a few thousand frames — ample for any transform — with real margin. As defence in depth, a failed dispose drops the cached module so the next execution rebuilds it.

The test asserts the executor is *still usable afterwards*, not merely that the task failed. Without that second assertion the poisoning is invisible.

**659 tests passing** — 31 core, 80 engine, 365 store, 103 server, 44 tasks, 17 sdk, 16 cli. Verified live: a `WAIT`-then-`INLINE` workflow completed in 3s for a 2s wait with `{"at":"DONE","total":10}`, and `while(true){}` failed with `InternalError: interrupted` while the server stayed healthy.


### Webhooks, both directions

The two halves are separate task types rather than "use `HTTP`", because what makes a webhook a webhook is exactly what generic HTTP does not do.

#### `WAIT_FOR_WEBHOOK` — the token in the URL *is* the authorisation

A third party cannot hold an API credential for your install. A payment provider, a signing service, an approval system: none of them will be issued a key, so the capability has to travel in the URL you hand them. Everything about the incoming half follows from that single fact:

- **The endpoint is public, deliberately.** It is the only design that works, and it is safe only because the token completes *exactly one task* and grants nothing else. Handing it out is safe in a way handing out an API key never is.
- **Stored hashed** (SHA-256 — 256 bits of generated entropy has no dictionary for a slow hash to slow down, and this is on the request path). A leaked backup must not hand over the ability to complete live workflows.
- **Single-use, via a conditional update** rather than read-then-write. Every webhook sender retries; two concurrent deliveries of the same retry would otherwise both see an unconsumed row and both complete the task — which, for a payment confirmation, means shipping the order twice.
- **Expiring**, so an abandoned workflow leaves nothing open, with the slots closed outright when the execution ends.
- **Optionally HMAC-verified**, over the **raw bytes**: re-serialising the parsed JSON changes key order and whitespace, so a digest recomputed over a round-tripped payload would never match. A bad signature leaves the slot usable, because the legitimate sender may simply have been misconfigured.

The status codes are chosen for how senders actually behave, which matters more here than elsewhere: almost every sender retries on 5xx and gives up on 4xx. A replay is **409**, not 200 — a 200 would be indistinguishable from a second completion. An unknown token is **404**, identical to an expired-and-pruned one, so the endpoint cannot be probed for live callbacks.

Like `WAIT`, the task is never queued — nothing in-process will ever execute it — so `isExternallyCompleted()` joins `isTimerBacked()` under `isWaitingTask()`, which is what keeps the decider, the enqueue path and the deadline arming from drifting apart.

#### `WEBHOOK` — outgoing, signed, with a receipt

Signed because the receiver has no other way to know the delivery came from you rather than from anyone who learned the URL; without a signature a public callback endpoint is an open write. Signed over `timestamp.body`, not the body alone — binding the timestamp in is what makes it useful against replay, since a captured delivery cannot be re-sent later with a fresh timestamp without invalidating the signature.

It carries a delivery id that is stable **per task, not per attempt**, so a receiver deduplicating on it sees a retry as one event. The receipt is recorded on failure as well as success: "we tried to deliver this id at this time and got a 503" is the question asked when a receiver says it never arrived.

The transport is the `HTTP` executor, reused rather than re-implemented, so the SSRF guard, manual redirect re-checking, size caps and header redaction all apply. A webhook URL is user-supplied like any other.

#### The bug that every store test missed

`WAIT_FOR_WEBHOOK` worked perfectly in 20 store tests and was completely broken in the running server.

`Evaluator` takes its `WebhookRepository` as an **optional constructor argument** — optional because unit tests build an evaluator without one — and the DI factory simply did not pass it. `openCallback` began `if (!this.webhooks) return;` and returned. The task was scheduled, went `IN_PROGRESS`, minted no token, and waited for a callback that could not be sent. Every store test kept passing, because they wire the evaluator by hand and pass the repository explicitly.

Two fixes, because either alone leaves the hole open:

1. The factory injects it — the actual defect.
2. **The quiet return is gone.** Scheduling a `WAIT_FOR_WEBHOOK` with no repository now throws. A task that can only be completed by a callback is unrunnable without one, so a wiring mistake must be a loud failure at schedule time rather than a workflow that hangs until its timeout with no explanation anywhere.

The lesson generalises past this one bug: **an optional dependency is a silent-disable waiting to happen**, and the tests that would catch it cannot be the ones that construct the object themselves. The new coverage lives in `server`'s container-level suite, where the object under test is the one Nest built. Confirmed by mutation: removing the injection fails three tests; removing the single-use guard fails the replay test; removing `@Public` fails three more.

A second, smaller bug fell out of writing those tests: a malformed execution id reached Postgres, which rejected it before the query ran, and the driver error escaped as a **500 carrying a fragment of the storage layer**. A typo in a URL is a 404. Every id-bearing execution route funnels through one `load()`, so one guard covers all ten.

**679 tests passing** — 31 core, 80 engine, 385 store, 108 server, 44 tasks, 17 sdk, 16 cli, 1 each for queue/testkit/ui. Verified on a live server end to end: a `WAIT_FOR_WEBHOOK` workflow minted a callback, an unauthenticated POST to it returned 200 and resumed the workflow, the replay returned 409, an unknown token returned 404, and the downstream task's input resolved to `{"got":"approved"}` — the callback payload reaching a `${...}` expression, which is the whole point of the feature. Shutdown 9ms.


### `JSON_JQ_TRANSFORM`, and the first thing that had to leave the main thread

Real jq — 1.8.2, compiled to WebAssembly — rather than a subset. A "mostly-jq" implementation is a compatibility claim that breaks on the first program someone pastes from the jq manual, and Conductor users arrive with programs they already have.

#### A jq program cannot be interrupted, and that changes the design

`INLINE` is bounded from the inside: QuickJS has an interrupt handler the guest cannot disable, so `while (true) {}` fails as a task and nothing else notices. jq offers no equivalent, and `jq-wasm`'s API is **synchronous**. Measured before choosing an approach: `def f: f; f` never returns, ignores every deadline, and had to be SIGKILLed.

On the main thread that is not a failed task, it is a **dead process**. The event loop stops, so the decider stops, the pollers stop, parked long-polls hang and every lease held by that process expires. One malformed jq program in one workflow of one tenant would take down everything sharing the process.

`worker.terminate()` is the only mechanism that stops it, and it exists only for threads. So `JSON_JQ_TRANSFORM` runs in a worker thread, the CPU budget is a hard kill rather than a cancellation, and the thread's `maxOldGenerationSizeMb` bounds a program that allocates rather than spins. This is the worker-thread isolation the plan called for as a throughput measure; it arrived as a **correctness requirement** instead.

The test that pins it asserts elapsed time, not just failure — if the isolation is ever removed, it stops failing and starts hanging the suite, which is exactly what it would do to the server. Confirmed by mutation: with the budget neutered, it fails at 20s instead of passing at 1.5s.

#### Three days of bundler, compressed into what survives

The server is a webpack bundle, and every mechanism for getting code into a worker thread fights it. Recorded because the next person to touch this will otherwise retry all three:

- **A sibling worker file is impossible.** Webpack rewrites `new URL('./jq.worker.js', import.meta.url)` to the literal string `[object Object]`. The worker body is therefore inline source passed to `eval: true`, which has nothing for a bundler to resolve.
- **`jq-wasm` cannot be bundled.** Its 4 MB Emscripten glue ships as several independently-built entries in both CJS and ESM; webpack mis-emits it and the bundle dies at startup with `__webpack_modules__[moduleId].call is not a function`, before a line of application code runs. It is an `externals` entry, and a dependency of `server` even though no file in `server` imports it — Node resolves it beside the bundle at runtime.
- **A module cannot ask where its own source lives.** `__dirname` is a webpack shim that breaks module concatenation when a bundled module also declares it; `import.meta.url` cannot be expressed once the module is emitted as CommonJS, and webpack fails the build with "Cannot get final name for export". So the runner asks where the *process* lives instead — `process.argv[1]`, then the working directory — and lets `createRequire` do normal Node resolution from there. That is also what makes it work under pnpm's strict layout, where a bare specifier resolved from the wrong directory finds nothing at all.

An eval'd worker resolving `jq-wasm` by bare specifier fails for the same pnpm reason, so the parent resolves the absolute path and passes it in `workerData`.

#### A stale `dist` that reported success

`tasks:build` failed on an unused-property error, so `packages/tasks/dist` kept an older copy with no jq in it, and the server bundled *that* — silently, because the build filter I was grepping matched only `Successfully`/`Failed to`. The task was queued with `taskType = JSON_JQ_TRANSFORM` and no executor ever claimed it, which looks exactly like a registration bug and is not one. The same shape as the `.tsbuildinfo` trap recorded earlier: **a build that half-succeeds is worse than one that fails**, and a grep narrow enough to miss the error is part of the defect.

#### Semantics worth stating

- **The program is not data.** `queryExpression` is removed from the document it runs against, or `keys` reports a field nobody supplied.
- **jq is a stream language.** A program yields zero, one or many values; all three are legitimate, so `resultList` carries them all and `result` is the first (`null` for an empty stream) rather than the rest being silently dropped.
- **A program that cannot compile is terminal; a runtime error is not.** A syntax error will never compile, so retrying only delays the error someone has to read. A type error is about *this* data, and the next attempt may carry different data.
- **Output is bounded**, because it is stored, indexed and handed to the next task.

**698 tests passing** — 31 core, 80 engine, 385 store, 108 server, 58 tasks, 17 sdk, 16 cli. Verified live inside the webpack bundle: a transform returned `{"n":3,"top":"b","total":20}` and the downstream task's input resolved to `20`; `def f: f; f` was killed at its 5s budget, exhausted its retries and failed the workflow — while the server stayed healthy and ran the next transform normally.


### `GET_SIGNED_JWT` and `HTTP_POLL`

#### A token is only worth what a verifier says it is

`GET_SIGNED_JWT` is what lets the rest of a workflow authenticate: Google, Apple, Snowflake and most enterprise APIs are reached by signing a short-lived assertion with a private key. Without it the options are an `INLINE` script — inside a sandbox that deliberately has no crypto — or a bespoke worker per integration.

The signing stays in-process because the private key is the most sensitive value a workflow ever touches: read once, used, never handed to a worker fleet that logs and stores whatever it logs and stores. For the same reason the key is **never echoed into the output**, which is persisted, indexed and displayed in the UI.

`none` is not supported. It is a legal JWT algorithm and the single most exploited weakness in JWT's history — a token signed with `none` validates against any verifier that honours the header.

The tests verify every signature with an **independent code path** rather than asserting on the shape of the string, and that caught a real bug immediately: the PSS padding was written as `1 << 5`, which is 32, where `RSA_PKCS1_PSS_PADDING` is 6. Every PS-family token was unsignable. A shape-checking test would have passed. The same design is why ES256 is checked for raw `r‖s` rather than DER — OpenSSL emits DER, JWS requires the raw pair, and a DER signature is a perfectly well-formed token that every conforming verifier rejects.

#### A polling task must not sleep in its execution slot

`HTTP_POLL` is the shape of every "kick off a job, wait for it to finish" integration. The obvious implementation loops with a delay, and that is wrong in two ways: it holds a concurrency slot for the entire polling lifetime — an hour of waiting on a slow export occupies a slot for an hour while doing nothing — and a restart loses all progress.

So this introduces a third task outcome, alongside completed and failed:

> **`IN_PROGRESS` with `callbackAfterSeconds`** — not finished, ask again later. The task keeps its row, its attempt and its deadlines, and **gives back its execution slot** until it is due again.

Each pass makes exactly one request. The poll count lives on the task row rather than in the executor, because the next pass may run in a different process — an executor-held counter would silently restart at zero after a deploy and poll forever. A restart mid-poll now costs one request.

The three steps of a deferral — fencing check, state write, requeue — share one transaction, and the order matters. Writing the output first and deferring after leaves a window where a crash strands a task holding a lease that will expire and be **reclaimed as abandoned**, losing the progress just recorded. The lease token is checked first for the same reason it is checked everywhere else: a runner that stalled long enough to lose its lease must not write over the runner that replaced it. Mutation-tested by dropping the predicate.

Two smaller decisions worth stating:

- **A deferral consumes no attempt.** Nothing failed. Charging it against the retry budget would silently cap any poll at `retryCount` passes and fail the task for a reason that never appears in its history.
- **Deadlines stay armed across passes.** A polling task's total budget is its task timeout; re-arming per poll would let it poll forever as long as each individual poll was quick.

A transient 5xx does not end a poll — the endpoint is by construction one that is not ready yet — but a termination condition that cannot be evaluated does, because it will not evaluate on the next pass either.

#### One sandbox, not two

The termination condition is user-supplied code, so it runs in the same QuickJS sandbox as `INLINE` rather than a second evaluation path — a second path is a second chance to get the CPU budget, heap ceiling and stack limit wrong, and the stack limit in particular is the one that aborts the shared WASM module when set too high. `InlineTaskExecutor` now delegates to the extracted `JsSandbox`; all 21 of its existing tests passed unchanged, which is the only reason to trust the refactor.

**733 tests passing** — 31 core, 80 engine, 392 store, 108 server, 86 tasks, 17 sdk, 16 cli. Verified live inside the bundle: a minted RS256 token was used as a real `Authorization` header on a downstream `HTTP` task; a poll ran to completion across passes; and one whose condition never held gave up, retried per policy and failed the workflow with `polled 2 times without the termination condition becoming true`.


### `HUMAN` — waiting on a person

Structurally the same idea as `WAIT_FOR_WEBHOOK`: the engine schedules a task and then waits for something outside itself, so it is never queued and sits `IN_PROGRESS` until completed through an API. `isExternallyCompleted()` already covered that shape, which is why the engine side of this was three lines.

The inbox is modelled separately rather than reusing the callback table, because the questions asked of it are entirely different. Nobody queries "which webhooks are waiting for me"; that is the *only* question anyone asks here.

#### Two columns carry the whole design

- **`assigneeId` is routing** — this task is *for* that person.
- **`claimedBy` is possession** — that person is working on it *now*.

Keeping them apart is what lets a task be assigned to someone who has not started it, and released back without losing who it was meant for. An inbox is by construction a shared list several people are looking at simultaneously, and the failure mode is not an error message: it is two people doing the same work, or one person's answer silently replacing another's.

So completion **requires holding the claim**. Without that, Bob can answer a task Alice is actively working and his answer becomes the decision — a lost update with a person on the other end of it.

#### A test that passed for the wrong reason

`claim` was first written as a read, a check, then a conditional update. Removing the `claimedBy IS NULL` predicate from that update left **all 416 tests passing**, including the one named "has exactly one winner under concurrency".

The read-then-check was short-circuiting: whether two simultaneous claims actually collide depended on how their reads and writes interleaved, so the race was real but only sometimes reachable, and the concurrency test was reaching the early return instead. The predicate was load-bearing in production and untested.

Rewritten as a **single conditional `UPDATE`**, Postgres serialises the two on the row lock and the loser re-evaluates the predicate after the winner commits, matching nothing. The outcome no longer depends on timing at all — and the same mutation now fails two tests. A second read happens only when nothing was updated, to say *why* it was refused.

The general lesson is worth more than the fix: **a mutation test that survives is telling you the test is weak, not that the code is safe.** Two of the three mutations tried here were caught immediately; the one that was not is the one that found a real defect.

#### Refusing what cannot be honoured

Group routing — "anyone on the payments team" — needs user groups, and there are none until Phase 5. Accepting `candidateGroup` and quietly dropping it would send an approval that decides whether a refund goes out to an empty pool, where it would sit until it timed out with nothing to explain why. So it is **refused**, and the task fails with a reason naming the alternative.

Refused by failing the *task*, not the evaluation — the schema-validation lesson, applied. Throwing aborts and rolls back the pass, so the decider re-derives the same bad input on the next wakeup and the workflow spins forever.

Writing that test exposed a gap that had been there since schema validation: a task inserted already-failed recorded its reason **only in the event history**, so the task view an operator opens said `FAILED_WITH_TERMINAL_ERROR` and nothing else. The existing schema-violation test even selected `reasonForIncompletion` without asserting on it. Both now carry the reason on the row, and the older test asserts it.

#### Only people do human tasks

Every route requires a **user** principal. An API key names a fleet, not a person, so recording a service account as the approver of a refund would make the audit trail worse than useless — it would look complete while naming nobody. The completing user's id is written into the task output for the same reason: an approval that cannot say who approved it is not worth much six months later.

A lost claim is **409, not 403**: the loser did nothing wrong, they were simply second, and a UI should refresh the list rather than ask for credentials.

`human-tasks:read` and `human-tasks:write` are separate from `executions:*` because the audiences differ — the people who approve a refund are not the people who operate the engine. Adding them surfaced a latent bug in `isValidScope`: its pattern allowed no hyphen, so **every multi-word scope name was unissuable**. It was rejecting `human-tasks:read` at user creation, which would have hit the first person to define any scope with a hyphen in it.

**763 tests passing** — 31 core, 80 engine, 416 store, 114 server, 86 tasks, 17 sdk, 16 cli. Verified live inside the bundle, signed in as a real user over session cookies and CSRF: completing before claiming returned 409, claiming returned 200, a privileged **service account** was refused with 403, completion returned 200, the workflow completed with `completedBy` flowing into the next task's input, and the inbox emptied.


### `EVENT` and `JDBC`

#### `EVENT` is resolved by the decider, not run by a runner

The obvious implementation is a task executor that publishes. That puts the publish **outside** the transaction that completes the task, and a lease expiring in between retries the task and publishes the event a second time with nothing recording the first.

So `EVENT` joins the immediate operators: the engine emits a `PublishEvent` command, and the applier writes it to the transactional outbox **in the same transaction** that completes the task. They commit together or not at all, which is exactly what the outbox was built for — the relay delivers after commit.

The task never reaches a queue, and a redundant evaluation publishes nothing extra, because the unique index on the task row means there is nothing to re-derive.

A missing `sink` is refused **at registration**, by the blueprint compiler. Two reasons: a typo in a definition is best reported while the author is still looking at it, and a resolved task has nowhere to put a runtime failure — `resolved` is `COMPLETED | SKIPPED`, an operator has no way to fail.

One comment had to be corrected before it misled someone. The `idempotencyKey` on the command was documented as preventing double publishing. It does not: the transaction and the unique index do that. The key is for the **subscriber**, because relay delivery is at-least-once and a consumer needs something stable to deduplicate across redeliveries.

The transactional coupling is now tested by breaking it — an evaluator whose history write throws, asserting that nothing reached the outbox. Every other test observes the happy path, where a publish outside the transaction looks identical. Mutation-confirmed: swapping `tx` for the pool fails it.

#### `JDBC` — the connection never comes from the workflow

This is the decision most likely to be "simplified" later by someone adding a `url` input because it seems convenient. A workflow definition is user input, so a definition that could name its own database could:

- **point at node-flow's own Postgres** and read every namespace's executions and API key hashes, or forge task rows directly — total escalation past every check elsewhere in the system;
- reach any host the server can, which is SSRF again, except the `HTTP` defence does not transfer: an internal address is not a red flag for a database, it is the *normal case*;
- carry credentials in a definition that is stored, versioned, listed over the API and rendered in the UI.

So datasources are **named and configured by the operator** and referenced by name. The operator decides what is reachable; the author decides nothing about connectivity. An install that never lists its engine database cannot have a workflow reach it, and the default is an empty map — which disables the task entirely, so an install that needs none is not exposed at all. A connection string in a definition is **refused rather than ignored**, because the author clearly expected it to be used.

Values are **bound, never interpolated**. The statement comes from the definition, but the values come from task input — derived from workflow input and upstream output, so attacker-influenced anywhere workflows start from external requests. Offering no way to build a statement from values leaves the injection nowhere to go.

Driver errors are redacted against the connection string and its password: a failure reason is persisted, searchable and shown in the UI, so a password reaching it outlives the incident somewhere nobody thinks to rotate.

#### `SET LOCAL` is a no-op outside a transaction

The statement timeout was written as `SET LOCAL statement_timeout`, which applies only inside an explicit transaction and is **silently ignored outside one**. The code read as though it enforced a limit and enforced nothing: `pg_sleep(5)` sailed past a 250 ms timeout. A runaway query would have held a connection and an execution slot indefinitely.

Now `SET`, which is session-scoped and safe here because it is re-set before every statement on the connection. Found only by testing against a real database — no amount of stubbing would have shown it.

#### A failed suite is not a failed test

`sql.spec.ts` could not import `@testcontainers/postgresql`, and the run reported **`Tests 86 passed`** — because a suite that fails to load has no tests to fail. The count I was grepping was unchanged and green. The same shape as the stale-`dist` trap: a narrow grep is part of the defect, so the verification now also checks `Test Files` for failures.

**787 tests passing** — 31 core, 80 engine, 426 store, 114 server, 100 tasks, 17 sdk, 16 cli. Verified live against a *separate* application database: a parameterised query returned rows and fed an `EVENT` whose payload landed in the outbox with its deduplication identity; a definition supplying its own connection string to node-flow's own database was refused terminally; an unconfigured datasource named the ones that exist and nothing else; and an `EVENT` without a sink was rejected at registration with a 400.


### `KAFKA_PUBLISH`, and two bugs it uncovered

#### Publishing goes through the outbox, not through a broker call

The obvious implementation is a task executor that calls the broker. This does not do that, for the same reason `EVENT` does not: the message is written to the **transactional outbox in the same transaction that completes the task**, and the relay delivers it after commit.

What that buys is worth stating plainly, because it is the difference between a workflow engine and a script:

- **A broker outage delays messages instead of failing workflows.** A synchronous produce would fail the task, burn its retry budget on an outage nobody in the workflow can do anything about, and eventually fail an execution that had already done all its real work.
- Delivery inherits the relay's retry, backoff and dead-letter machinery, which already exists and is already tested.
- An install with **no Kafka configured dead-letters visibly** rather than appearing to succeed.

The trade, stated honestly: the task completes when the message is durably *queued*, not when Kafka acknowledges it, so there is no partition or offset in the output.

#### Kafka is optional, and stays optional

The client is dynamically imported and declared an **optional peer dependency**. node-flow's positioning is that Postgres is the only thing you must run; a Kafka client in every install's dependency tree would undo that for the majority who never publish to Kafka.

That also decided *which* client. The official Confluent client is actively maintained but is a native addon — it needs a source build that pnpm blocks by default, and it failed to install here without one. Making that a required dependency would break installs that never touch Kafka. `kafkajs` is pure JavaScript and installs everywhere; it is also unmaintained since 2023, which is why the client sits behind a `KafkaProducer` interface rather than being used directly. Swapping it is a contained change, and a deployment preferring the native client can supply its own producer.

One thing the broker taught: kafkajs **refuses an idempotent producer with retries disabled**, and retries are disabled deliberately — the relay holds a database transaction open for the whole delivery, so a client retrying for a minute is a minute of held transaction. Producer idempotence was the wrong tool anyway: it deduplicates a producer's *own* internal retries, and redeliveries here come from the relay, a different session entirely. Duplicates are handled where they can be — every message carries `_event.id`, a stable identity derived from the task, for the consumer.

#### `SUB_WORKFLOW` did not work, and nothing said so

Registering the Kafka sink meant touching where outbox handlers are registered — and there were none. `SUB_WORKFLOW` and `START_WORKFLOW` publish `subworkflow.start` and `workflow.start` to the outbox, the payload types were exported, and **no handler was ever registered in the server**. Every `store` test registered its own inline, so the gap was invisible there. In a real deployment those events backed off, dead-lettered, and the parent waited forever for a child that was never created — exactly the failure the relay's own documentation warns about.

Writing the handlers exposed a second, worse one directly beneath it. With the child now starting correctly — right parent links, running to `COMPLETED` — the parent *still* hung on a `SCHEDULED` sub-workflow task, because **nothing carried a finished child's outcome back to its parent**. No wakeup, no task completion, no evidence anywhere.

So `SUB_WORKFLOW` was non-functional end to end, in a phase the tracker called complete. It could not be otherwise: `decide` is pure and sees one workflow's state, so a child's outcome is not something it can know, and the applier — the only layer that could — was not doing it. The engine's own tests stop at the emitted command; the store's tests drove the child by hand.

Both halves now live in the applier and share the child's transaction, so a parent is never woken for a child whose completion rolled back. The test that proves it is a **container-level** one: a parent that cannot finish unless a child was really created and really ran.

That is the **third** defect of this exact shape, after the webhook repository and the human-task inbox. The pattern is now unmistakable: *the wiring is what breaks, and only the container that does the wiring can test it.* Unit tests that construct their own collaborators will pass regardless — they are testing a system nobody deploys.

**796 tests passing** — 31 core, 80 engine, 434 store, 115 server, 100 tasks, 17 sdk, 16 cli. Verified live inside the bundle: a parent workflow ran its child and completed, and a `KAFKA_PUBLISH` reached a real Redpanda — outbox row marked published with no error and zero retries, topic created on the broker. That a delivered message is actually *consumable* is proven by the integration test, which reads it back and asserts its key and value.


### `gRPC` — the last of Phase 3

Unary calls to another service, and the third time the same question had to be answered: **what may a workflow definition reach?**

`HTTP` answers it with an SSRF guard that blocks private address ranges by default. That answer does not transfer here, and the reason is worth recording because it looks like it should: almost every gRPC target *is* a private address. A guard that refuses them would either reject every legitimate call or be switched off immediately and defend nothing.

So `gRPC` follows `JDBC`: **services are named and configured by the operator**, referenced by name, with the address, the proto and the TLS settings out of a definition that is stored, versioned and rendered in a UI. An address supplied by the definition is refused rather than ignored, and an install that configures none cannot make a call at all.

**Streaming is deliberately unsupported.** A task has one input and one output and is retried as a unit; a stream has neither shape nor a meaningful retry. Supporting it would produce a task that appears to work and silently truncates, which is worse than not having it. A workflow that needs a stream needs a worker.

Two smaller decisions:

- **A deadline, not a client-side timer.** The server is told when to stop, so a call that outlives its budget is cancelled at both ends rather than abandoned while the server keeps working on it.
- **Status codes decide retryability**, the gRPC analogue of "4xx is terminal, 5xx is not". `INVALID_ARGUMENT`, `NOT_FOUND`, `PERMISSION_DENIED`, `UNAUTHENTICATED` and `UNIMPLEMENTED` are permanent; `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `ABORTED` and `INTERNAL` are things a healthy service does while briefly unhealthy. Without the distinction a permanently broken call burns its whole retry budget and delays the error someone needs to read.

Tested against a real gRPC server rather than a stubbed client, because everything interesting here belongs to the transport — deadlines, status codes, and whether a nested message round-trips as ordinary JSON the rest of the engine can address. A stub would only assert that the executor calls a function.

**813 tests passing** - 31 core, 80 engine, 434 store, 115 server, 117 tasks, 17 sdk, 16 cli. Verified live inside the bundle against a real service: a call returned `{"sku":"WIDGET-1","total":40,"currency":{"code":"GBP"}}` and the next task's input resolved `${q.output.response.currency.code}` to `GBP`; a definition supplying its own address was refused terminally; and an unconfigured service named only the one that exists.

### Phase 3 is complete

Every system task in the Conductor inventory now runs, plus the two webhook directions that are ours rather than Conductor's. What changed along the way is worth stating in one place, because the pattern was not obvious at the start:

- **Three kinds of task are resolved by the decider, not by a runner** - `EVENT`, `KAFKA_PUBLISH` and the operators - because their side effect has to commit with the task rather than beside it.
- **Two are completed by something outside the engine** - `WAIT_FOR_WEBHOOK` and `HUMAN` - and neither is ever queued.
- **One had to leave the main thread entirely** - `JSON_JQ_TRANSFORM`, because jq cannot be interrupted.
- **Three had to answer "what may a definition reach?"** and gave two different answers: `HTTP` guards addresses, while `JDBC` and `gRPC` refuse to take an address at all.

`UPDATE_SECRET` is the one row of the inventory not implemented here; it writes to a secrets store that does not exist until Phase 5 and is tracked there.


### Phase 4 — the leased cron scheduler

The half of Phase 4 that is distinctive. Event *consumers* remain; the outbox already produces.

#### Why this is not `@nestjs/schedule`

Every in-process scheduler — `@nestjs/schedule`, `node-cron`, a `setInterval` — holds the schedule in memory and fires on a local timer. With N replicas that is N firings, and it passes every single-replica test on the way to production. It is the single most common way "run this nightly" becomes "bill every customer four times".

Here **the row is the schedule**. A poller claims due rows with `FOR UPDATE SKIP LOCKED`, starts the workflow and advances `nextRunAt` in one transaction, so a second poller ticking at the same instant finds nothing to claim.

Two mechanisms defend different things, and a mutation test proves the distinction rather than assuming it: remove the row lock and both pollers *do the work* — each reports a firing, each advances the schedule — but the execution count stays at one, because the idempotency key catches it downstream. The key is derived from the schedule and the **scheduled instant**, not from "now", so a retry, a redelivery or a bypassed lock all resolve to the same execution. So: the lock makes it **one firing**, the key makes it **one execution** even if a refactor ever breaks the lock.

#### The two policies Conductor does not have

The interesting questions about cron are not about cron syntax.

- **`overlapPolicy`** — the previous run is still going. `ALLOW` is right for an independent job and catastrophic for one that holds a lock or reconciles a balance; `SKIP` declines rather than stacking.
- **`catchupPolicy`** — the server was down three hours and a five-minute schedule missed thirty-six firings. Running all thirty-six on boot is a self-inflicted stampede at the moment the system is least healthy. `SKIP` drops the backlog, `FIRE_ONE` (the default) runs one catch-up, `FIRE_ALL` runs them all — bounded at 50, because a minute-by-minute schedule and a day-long outage is 1,440 executions arriving at once.

`FIRE_ONE` runs the **most recent** missed window rather than the oldest: catching up on a report means producing today's, not the one from three hours ago.

Timezones are stored, not assumed. "09:00 in Sydney" and "09:00 UTC" are different instants for most of the year, and a business schedule almost always means the former. `croner` supplies the arithmetic and brings no dependencies of its own, which matters for a project whose pitch is that Postgres is the only thing you must run.

#### Smaller decisions that each prevent a specific failure

- **A malformed expression is rejected at creation**, not discovered at firing time — otherwise the schedule exists and silently never runs.
- **`nextRunAt` is computed on create**, because the poller's index is partial and a null would make the schedule invisible to it.
- **Resuming recomputes from now.** Pausing is an instruction not to run, not a request to defer; a schedule paused over a weekend must not wake owing three days of firings.
- **One broken schedule cannot stop the others.** Each is handled on its own and its error recorded on its row, because a throw aborting the batch would let one schedule pointing at a deleted definition halt every schedule in the install.
- **A failed schedule still advances.** Leaving `nextRunAt` in the past makes the poller re-claim it every pass forever.
- **`lastError` is returned by the API.** "Why did my schedule stop working?" should not be answerable only from server logs.

Writing the failure tests exposed an inconsistency worth fixing: the version check only ran for schedules that had *not* pinned a version. An unpinned schedule naming a deleted definition recorded a clear error on its row, while a pinned one happily started an execution that failed later for an unrelated-looking reason. The same question now gets the same answer, served from the blueprint cache.

**848 tests passing** — 31 core, 80 engine, 462 store, 122 server, 117 tasks, 17 sdk, 16 cli. Verified live the way the phase's own criterion states it: **two replicas sharing one database, both polling**, a schedule backdated so both saw it due at the same instant — one execution, `runCount` 1, no error, workflow completed, and the scheduled instant carried into the workflow input as `_schedule.scheduledFor`.


### Phase 4 — inbound event handlers

The mirror of the outbox. The outbox is how a workflow tells the world something happened; this is how the world tells a workflow — a message on a broker starts an execution, or finishes a task that was waiting for one.

#### A row per handler, not configuration

A handler is an operational thing: enabled, disabled, edited when a topic is renamed, inspected when somebody asks why their workflow did not start. Every one of those is a database operation, not a redeploy. `eventCount` and `lastError` sit on the row for the same reason they sit on a schedule — "is it receiving anything?" is the first question, and an answer that lives only in server logs is not an answer.

Topics come from the handler rows rather than from configuration: a consumer subscribes to what is actually handled, instead of to a list somebody has to keep in step with the handlers.

#### The transport is the least interesting part

Matching, filtering, expression resolution and idempotency are all decided by a dispatcher that has never heard of Kafka, which is why almost none of the tests need a broker.

- **Idempotency comes from the delivery, not the clock.** Consumers are at-least-once — a crash between acting and committing an offset redelivers the message — so the key is derived from the handler and the delivery id (for Kafka, topic/partition/offset). Without it a redelivered payment notification starts a second workflow. Mutation-tested by removing it.
- **Offsets are committed after dispatch, never before.** Committing first turns any crash into a silently dropped message. At-least-once with an idempotency key is a guarantee; at-most-once is a data-loss bug with better marketing.
- **The message binds as `event.output`**, so an input template reads `${event.output.orderId}` — the shape the DSL already uses for a task's output, so an author who can write an input parameter can write this without learning anything.
- **The raw message is always carried through** as `_event`, because a template that forgot a field is a common mistake and an unrecoverable one if the original is discarded.
- **Conditions run in the same QuickJS sandbox as `INLINE`**, because they are user-supplied code that arrived through an API. A condition that cannot be evaluated does *not* act: a filter that cannot decide must not start a workflow.
- **One broken handler cannot silence a topic.** Each is applied independently and its error recorded on its row.

#### A weak test that a mutation caught

The cross-namespace test — a handler in one namespace must not complete another's task by naming its id — passed while the namespace check was deleted. The foreign workflow in the fixture had no task with that ref name, so the *task lookup* failed first and the test never reached the check it was named after.

Fixed by giving the foreign workflow a task with the same ref, so nothing but the namespace check stands in the way; the mutation now fails it. The check also moved ahead of the task lookup, because checking the task first let a handler learn whether a task exists in another namespace by comparing which error came back.

That is the second time in two phases that a surviving mutation exposed a test passing for the wrong reason, after the human-task claim race. Both were tests of a *refusal*, and both were satisfied by an earlier, unrelated refusal — which seems to be the characteristic failure mode of negative tests.

The same pinned-version inconsistency found in the scheduler was present here too and fixed the same way: a handler naming a deleted definition now reports a clear error whether or not it pinned a version.

#### NATS, AMQP and SQS — the same dispatcher, three more transports

Each broker is a connection map in the environment — `NODE_FLOW_NATS_CONNECTIONS`, `NODE_FLOW_AMQP_CONNECTIONS`, `NODE_FLOW_SQS_CONNECTIONS`, shaped like `NODE_FLOW_KAFKA_CLUSTERS` and validated at boot (a connection missing its address, or a name containing `:`, refuses to start). A connection `default` is the source `nats:default`, and the **same string plus a destination is the sink**: an `EVENT` task publishes to `nats:default:orders.created`, `amqp:default:refunds` (or `exchange/routingKey`), `sqs:default:payments`. The relay gained `onPrefix`, so one handler claims every destination on a connection — exact subscriptions still win, and the longest prefix beats a shorter one; a topic that is *only* a prefix names nothing and dead-letters.

The clients (`nats`, `amqplib`, `@aws-sdk/client-sqs`) are **optional peers**, loaded on first use like `kafkajs`.

Delivery semantics differ, and are stated rather than hidden:
- **SQS and AMQP are at-least-once.** A message is deleted or acknowledged only after dispatch. The SQS message id, or the AMQP `messageId` the sink sets, is the delivery id the dispatcher deduplicates on.
- **Core NATS is at-most-once** — a subscriber that is down misses messages. The sink sets `Nats-Msg-Id` to the event id, and the source uses it as the delivery id. Subscriptions join a queue group, so replicas share rather than duplicate. A wildcard handler (`orders.*`) matches under its pattern, with the concrete subject in the `nats-subject` header for conditions.

Consumers now **follow the handler table**: sources are reconciled every 15 seconds, and a source whose enabled topics changed is restarted. Before, a Kafka handler created after boot was never consumed until the server restarted. A broker that is down at boot no longer stays down for the process's lifetime either; the next pass retries it.

Status listeners gained **NATS, AMQP and SQS sinks** through the same publishers, keyed by execution id (the message group on a FIFO queue, so one run's changes stay in order).

**Found while testing it:** stopping the AMQP consumer sometimes redelivered a message that had already been handled. Two causes. First, `stop()` closed the connection without waiting for in-flight handlers, so their acks never went out. Second, even after waiting, amqplib multiplexes frames across channels, so a connection close could overtake an ack still buffered on the channel. The fix tracks in-flight handlers and closes the channel before the connection. Each broker is tested against the real thing: NATS, RabbitMQ and ElasticMQ (the SQS API) in containers.

**Found by the live end-to-end run, and not a broker bug:** a workflow of three `EVENT` tasks published the second and third **twice**. RabbitMQ hid it (the consumer deduplicated on the event id), but SQS ran the triggered workflow twice, because its source keyed on the SQS message id. The cause was in the engine. A task resolved in-pass was inserted COMPLETED but not marked as seen by the decider, so the next pass reacted to its completion again and walked into its successors a second time. The unique constraint absorbed the duplicate *task rows*, but the successor's publish had already been written to the outbox. The existing "publishes once however many times it is evaluated" test used a single EVENT, which has no successor to repeat. Fixed at the source: decide now marks each resolved task it actually walked past (`continuedInPass`; false at the resolution-depth limit, where the next pass must continue), and the evaluator records those as seen. As defence in depth, the SQS source now deduplicates on the event id a node-flow sink sets. Both are mutation-tested.

**And one more, found by writing that fix's saga test:** compensable steps that resolved in the same pass as the failure were never compensated. The unwind looked only at tasks loaded from the database, and those steps did not exist there yet. The in-pass results are now visible to it.

The first version of the fix hung a `FORK_JOIN` inside a `DO_WHILE`, and the server suite caught it. A body made only of operators runs every iteration in one pass, before the DO_WHILE row exists, and the loop was completed by looking for that row among the *loaded* pending tasks. That had only ever worked because the next pass revisited the last body task, which is exactly what the fix removed. The loop now turns its own schedule from the same pass into the completion, and joins see branch tips resolved earlier in the pass. It completes one pass sooner as a result.

**882 tests passing** — 31 core, 80 engine, 489 store, 129 server, 117 tasks, 17 sdk, 16 cli. Verified live with **two replicas and a real Redpanda**: both joined one consumer group with the partition assigned to exactly one member, two messages were produced, and the result was **one execution** — the second filtered out by its condition — with the template-mapped input, the resolved correlation id and the raw message all present, and `eventCount` 2 against 1 workflow.


### Phase 5 — secrets, and a resolved value that is never written down

#### The rule the whole design rests on

`${secrets.x}` survives evaluation **untouched** and is substituted exactly once, at dispatch, into the copy handed to an executor or a worker.

That is not a preference. The decider resolves a task's input and the applier persists it, so a secret resolved there would be written to `TaskExecutions` in clear, returned by the execution API, rendered in the UI and kept for the retention period — a credential leak with a long half-life and no audit trail. The engine's resolver therefore returns a secret reference **verbatim** when no secrets are supplied, and only the dispatch path supplies them.

It was already half-wired in a way that was worse than not existing: `secrets` was a recognised expression scope that nothing populated, so every `${secrets.NAME}` silently resolved to `null`. A task authenticating with `null` produces a 401 from somewhere far away with the reason nowhere near it.

The corollary constrains future work, so it is written next to the code: anything that persists a task's *resolved* input — a debugging aid, a replay feature, a richer audit log — must take its copy **before** secrets are substituted.

Mutation-confirmed: make the resolver substitute during evaluation and the test asserting the stored input still holds the reference fails.

#### Envelope encryption

Every value gets its own data key, encrypted by a master key and stored beside the ciphertext. That indirection buys the two operations anyone actually performs:

- **Rotating the master key** re-wraps one small data key per secret instead of re-encrypting every value, so rotation is an operation rather than a project — and a rotation that is expensive is a rotation nobody performs.
- **A leaked data key** exposes one secret. A single key encrypting everything makes every leak total.

AES-256-GCM, so ciphertext is authenticated: a value edited in the database fails to decrypt rather than decrypting to something else. The namespace and name are bound in as additional authenticated data, which stops a row being *moved* — copying one tenant's secret into another's namespace, or renaming `staging-db-password` onto `prod-db-password`, yields something that will not open. Mutation-confirmed by removing the binding.

An install with **no master key stores no secrets** and says so, rather than falling back to plaintext — the failure that an optional encryption key otherwise invites. Environment variables still work, because they are not credentials and being readable is their point.

#### There is no endpoint that returns a secret

Not for an admin, not for the owner, not with a confirmation. An endpoint that returns a secret turns every over-broad credential, every logging middleware and every screen-share into a disclosure; anyone who genuinely needs the value has it already, and anyone who does not needs a rotation instead. Writing one requires `admin` rather than `workflows:write`, because the people who edit definitions are usually not the people who hold production credentials.

#### A Phase 1 gap found while wiring this

Workers received **no task input at all**. `LeasedTask` carried a task id, a workflow id and a lease token — and nothing else — so a `SIMPLE` task's `inputParameters`, the entire point of declaring them, never reached the code meant to act on them.

It went unnoticed because every test that exercised worker tasks asserted on what the *worker reported back*, never on what it was given, and the system tasks that do read their input take a different path.

Fixed on the same seam secrets needed: leasing now resolves offloaded payloads and substitutes secrets into the delivered copy. Both resolutions happen after the lease transaction commits, so a slow blob read or secret lookup cannot hold row locks on the queue.

**906 tests passing** — 31 core, 80 engine, 513 store, 129 server, 117 tasks, 17 sdk, 16 cli. Verified live against the bundle with a sentinel value: the `PUT` response, the listing and the execution API all returned nothing containing it; the `Secrets` table held only an envelope; the stored task input kept `"Bearer ${secrets.API_KEY}"` rather than the value; and the workflow **completed**, which it could only do if the header had actually been resolved for delivery. Rotation returned 200 against a live install.


### Phase 5 — groups, and the refusal that finally came good

Groups are **one concept, not three**. Orkes separates roles from groups from applications; a role is a named bundle of permissions and a group is a set of people, and every installation ends up with one group per role plus a mapping nobody enjoys maintaining. A group that carries scopes *is* a role with members, and collapsing them removes a layer of indirection without losing any expressiveness.

**Scopes only accumulate — there is no deny.** A model where two rules can disagree is one where "can this person do that?" cannot be answered by reading it: you have to simulate the evaluation order, and the answer changes when an unrelated group is edited.

Effective scopes are resolved on the principal, once, rather than at each authorization check — so no check can forget to consider groups, which is the omission that produces "it works in the API but not in the UI". They are resolved per request rather than frozen into a session, so removing someone from a group takes effect without waiting for a logout.

#### `HUMAN` group routing, three phases later

Phase 3 built `HUMAN` and **refused** `candidateGroup` rather than accepting it and quietly dropping the routing — an approval that decides whether a refund goes out would have landed in an open pool and sat there until it timed out, with nothing to explain why. That refusal is now a feature: a task names a group, the engine resolves it, and only members see it or can claim it.

Removing the refusal immediately reintroduced the bug it was protecting against, in a new place. The first version resolved the group inside the applier and **threw** when it did not exist — which aborts and rolls back the pass, so the decider re-derives the same routing on the next wakeup and the workflow spins forever. It is the same lesson as a schema violation, and the fix is the same shape: a missing group fails the **task**, with the reason on the row, and the pass commits.

Nor does it fall back to the open pool. Routing an approval to "the payments team" and landing it in everyone's inbox is exactly the mistake that naming a group was meant to prevent.

#### The silent-disable shape, caught by a test for once

`UserRepository` takes its `GroupRepository` as an optional constructor argument. That is the precise shape that has now silently disabled three features in this codebase — the webhook repository, the human-task inbox, and the workflow-start handlers — each time because a DI factory did not pass it, and each time invisible to every unit test because they construct their own collaborators.

This time the container-level test came first: a user created with **no scopes of their own**, so anything they can do comes from the group alone. Mutation-confirmed by removing the injection, which fails two tests. It is the first time this failure mode has been caught by a test rather than by a live server.

#### A flaky test, and what I can actually claim about it

A scheduler test failed twice in three runs and then passed ten times. One genuine defect is provable by inspection: `stops planning past endAt` used a per-minute cron against an `endAt` one second out, so whether the next occurrence fell inside the window depended on where in the minute the suite ran. That is fixed — a daily cron against an hour-long window is unambiguous.

What I cannot claim is that this was the cause of both failures, because the runs that failed were not captured by name. Ten clean runs since is evidence, not proof. Recorded here rather than closed off, because "a flaky test is an undiagnosed race" applies to this file too.

**Closed during Phase 6.** A full clean run failed again, this time with the name captured: `SKIP still fires a schedule that is merely due`. The mechanism is the same defect as the first one and is exact, not probabilistic-sounding. The fixture forced `nextRunAt` to one second ago against a once-a-minute cron, and `collectOccurrences` walks every occurrence in `(due, now]` — so whenever a minute boundary happens to fall inside that one second, the window holds **two** occurrences, which is a backlog, and `SKIP` correctly drops both. Roughly one run in sixty. The test was asserting where the wall clock stood, not the policy.

The fix is a daily cron, which cannot produce a second occurrence inside a one-second window at any time of day — so the fixture now means one thing only. The behaviour the flaky version was accidentally exercising is worth having, so it is now a test of its own, anchored to a computed minute boundary rather than to `now`: a two-occurrence window is a backlog however narrow it is, and `SKIP` drops the lot. `plan` is pure, so that test hands it a clock instead of racing one.

The lesson generalises past this file: **a fixture that forces a time not on the schedule's own grid is testing the grid, not the policy.** Both flakes in this file were that same mistake, and both presented as "sometimes fails".

Six consecutive clean runs of the spec, then a full clean `build test lint typecheck` across all eleven projects.

**914 tests passing** — 31 core, 80 engine, 514 store, 136 server, 117 tasks, 17 sdk, 16 cli. Verified live: two accounts with no scopes of their own, one added to a `payments` group carrying `human-tasks:*`; that member's scopes came back as exactly the group's and the other's as `[]`; a `HUMAN` task routed to `payments` appeared in the member's inbox and returned 403 to the non-member; the member claimed it with 200 and the non-member was refused with 403.


### Phase 5 — `UPDATE_SECRET` and the audit log

#### `UPDATE_SECRET`, and what it honestly cannot do

The use it exists for is token refresh: call an identity provider, get a short-lived credential, store it so later executions read it through `${secrets.NAME}` without calling the provider again.

It does **not** retroactively protect the value, and the live verification demonstrates that rather than leaving it as a claim. A run that minted a token and stored it showed the value appearing **0 times** in `UPDATE_SECRET`'s own output and **once** in the producing task's output — because that task completed, and completing persists output. Writing to the secret store protects *future* reads; it does not remove the copy already in the execution history.

Saying so matters because the opposite is the natural assumption, and acting on it leaves a credential in a task output nobody is watching. What the task *can* do is avoid making it worse: the value never appears in its own output, and a wrong-typed value is refused without echoing what arrived — a mis-resolved expression there is usually carrying the very thing that should not be written twice.

**The gap is named, not hand-waved**: closing it needs output redaction declared on a task definition, so a task can mark which of its output fields are credentials. Tracked below.

#### The audit log answers one question well

**Who changed this, and when?** Not "what ran" — `WorkflowEvents` already records that per execution, and duplicating it would double the write volume of the busiest path in the system for nothing. So this records control-plane changes only: definitions, schedules, secrets, groups, credentials. Rare, deliberate, and exactly the set that matters after an incident.

**Append-only by construction.** There is no update and no delete in the repository, and that absence is the feature — an audit log with an edit path is one nobody can rely on, and the argument for adding one always sounds reasonable in the moment. Retention is a dropped partition, which never rewrites a surviving row. Entries are kept for seven years against execution history's one, because "who changed this?" is usually asked long after the executions involved were pruned.

**Global interceptor, not a call per handler.** A log whose completeness depends on every future author remembering a line has holes in it, and the holes are invisible until the day somebody needs the entry that is missing.

Two things the tests pin, both mutation-confirmed:

- **Field names, never values.** The body of a secret write *is* the secret. Recording `{fields: ["value", "description"]}` keeps the entry useful without making the audit log a second place credentials live.
- **Refusals are recorded.** "Who tried to read the production secrets and was refused" is the question an incident starts with.

That second one exposed a real hole. Nest runs **guards before interceptors**, so a 403 from `@RequireScopes` never reaches the interceptor at all — the first implementation logged only what passed the guard, which is the wrong half. Denials are now recorded by the guard itself, where the refusal is actually decided, and the write is best-effort so a failed log entry cannot turn a 403 into a 500.

**927 tests passing** — 31 core, 80 engine, 514 store, 141 server, 125 tasks, 17 sdk, 16 cli. Verified live: a workflow minted a token and stored it as a sealed secret attributed to `workflow:<id>`; the audit log showed `secret.put` and `group.create` with field names and no values, and a search of the whole log for either secret's value found nothing.


### Phase 5 — sealed task output

The gap `UPDATE_SECRET` exposed, closed. A task that fetches a token writes it to its output; completing a task persists that output; so by default the credential sat in the execution history in clear for the retention period. `UPDATE_SECRET` could avoid adding a second copy — only this prevents the first.

#### Sealing, not redaction

Redaction is the obvious move and it breaks the only flow that matters: the next task needs the value. `${mint.output.token}` has to resolve to a token, not to `"[redacted]"`.

So a field named in `secretOutputFields` is stored as an **encrypted envelope**, and the engine **defers** any expression that lands on one — the same mechanism `${secrets.x}` already uses, for the same reason: the decider is pure, holds no key, and resolving there would write the envelope into the next task's input where a plaintext value belongs, and persist it. The dispatch path opens it into the copy an executor receives, and nowhere else.

The marker lives in `core` because three layers must agree on it without seeing each other: the store produces it, the engine recognises and defers it, the dispatch path opens it.

**The cost, stated because it is real**: a sealed field cannot drive a `SWITCH` condition or a loop predicate, because the decider genuinely cannot see it. That is the correct trade — a credential steering control flow would have to be readable by the component that must never read it.

An install with no master key **refuses** to store a declared field rather than storing it in clear: the definition asked for protection, and quietly ignoring that is how a credential ends up somewhere its author was told it would not be. Mutation-confirmed, along with the deferral itself.

#### Found by running it, not by testing it

Every unit test passed while the feature did nothing. `secretOutputFields` was accepted by the schema, validated, returned by the API — and **dropped on write**, because `upsertTaskDefinition` names its columns explicitly and this one did not exist. The unit tests exercise the sealer directly, so none of them touched the path that loses it.

The live run is what showed the token sitting in the task output in clear. This is the "declared and ignored" trap that the domain and schema-validation work already recorded once, in a new place: **a field that survives validation is not a field that survives storage**, and only an end-to-end run distinguishes them.

#### Two things my own verification got wrong

Worth recording, because both would have produced a false result:

- **A mutation that does not compile proves nothing.** Removing the deferral left an unused import, so `engine:build` failed and the tests never ran — and the grep that was watching for failures saw silence and read it as a pass. The mutation was redone so it compiles.
- **The fixture leaked the secret itself.** The first script wrote the token as a literal inside the `INLINE` expression, so it appeared in that task's *input* — which sealing does not touch and should not. That is the fixture behaving unlike a real flow, where the value arrives from a call rather than being written into the definition.

**936 tests passing** — 31 core, 80 engine, 523 store, 141 server, 125 tasks, 17 sdk, 16 cli. Verified live: the producing task's output holds an envelope, the consuming task's stored input holds `"Bearer ${mint.output.token}"`, the token appears **zero** times across `TaskExecutions`, the workflow row and everything the execution API returns — and the workflow **completed**, which it could only do if the real token reached the downstream task. A non-secret sibling field in the same output stayed readable.


### Phase 5 — per-tenant quotas, and a test that proved nothing

Quotas are enforced at the **front door** — starting a workflow, registering a definition, creating a schedule — and nowhere later. Shedding at admission is the only load-shedding that preserves correctness: a rejected start costs the caller a 429, while throttling work already in flight leaves half-finished executions holding leases, permits and timers.

They live in `Namespaces.settings` rather than their own table: one small object per tenant, read on a path that already loads the namespace, where a table would add a join to the hottest write in the system to store four numbers. **Unset means unlimited**, deliberately — a default quota is a number somebody picked without knowing the workload, and the first thing it does is reject legitimate traffic on a Monday morning.

A 429 carries `Retry-After`, read from the control that tripped rather than guessed. A 429 without one is an invitation to hot-loop: a client told to come back later and not told when comes back immediately.

#### Sharing a transaction is not the same as serialising

The first implementation checked the quota and inserted the execution in one transaction, with a comment explaining that this closed the race. **It did not.** Two READ COMMITTED transactions see the same snapshot: both count `limit - 1` running, both conclude there is room, and both insert. The transaction makes the check and the insert commit *together*; it does nothing to stop a second transaction reading the same count.

The mutation test is what exposed it — splitting the check and the insert into separate transactions changed nothing, and 149 server tests still passed. That is the signal that a test is measuring the happy path rather than the property.

The fix is a transaction-scoped advisory lock keyed on the namespace, the same instrument the queue's admission control already uses — and whose comment reads *"Every sequential test still passes, which is what makes it dangerous."* It was written about exactly this mistake, one layer down, and did not stop me making it again. Taken only when a concurrency quota is configured, so an install with no quotas pays nothing.

The test moved too. The HTTP-level race approximated concurrency through one event loop and passed with the serialisation removed; the replacement races `withStartQuota` directly, where the transactions are real and concurrent. Twelve simultaneous starts against a limit of three admit exactly three, and removing the lock now fails it.

This is the **third** time in this project that a surviving mutation exposed a test passing for the wrong reason — after the human-task claim race and the event-handler namespace check. All three were the same shape: a concurrency or refusal property, satisfied in the test by something other than the mechanism under test. The lesson is now explicit: **a property test that has never been seen to fail has not been shown to test anything.**

**947 tests passing** — 31 core, 80 engine, 526 store, 149 server, 125 tasks, 17 sdk, 16 cli.


### Phase 5 — workload identity: mTLS and OIDC

The two mechanisms that let a workload authenticate **without holding a secret**, which is the whole point of both: there is no credential to leak, rotate, or accidentally commit.

One binding table serves both, because they differ only in what the external identity is *called* — for mTLS the CA's distinguished name and the certificate's subject, for OIDC the `iss` and `sub` claims. Both answer the same question: some other system vouched for this request; which service account is that?

**The binding is explicit, never inferred from a name match.** A certificate whose CN happens to equal a service account name proves nothing. The CA or IdP decides *who you are*; the operator decides *what that may do*. Conflating those is how a certificate issued for one purpose ends up authorised for another, and the row is where the second decision lives. Bindings are globally unique, so one certificate cannot mean different things in different tenants.

Disabling a service account closes every door into it, including one opened by a binding nobody remembered to remove — checked in the same query as the lookup, because that binding is precisely the credential that outlives its owner.

#### The JWT verifier is hand-written, and that needs a reason

A JWT verifier is a known set of checks, each with a documented CVE for skipping it, and the whole of it is a hundred lines against Node's own crypto. Node 24 reads JWK keys natively, which removes the key-conversion code that usually justifies a dependency. Every check exists because omitting it is a published attack:

- **The algorithm comes from the key, never the token.** A token claiming `HS256` verified against an RSA *public* key turns a public value into a signing secret. `none` is never reached because it is not in the table.
- **The issuer matches exactly.** Nothing looser is offered — a prefix or hostname check is how an IdP nobody configured mints tokens for your install.
- **The audience must match**, or a token minted for another service replays here.
- **`exp` is required**, because a token with no expiry check is a password that never rotates.
- **An unknown `kid` refetches at most once per minute.** Rotation is normal and a verifier that cannot survive it fails a fleet at 3am; unbounded refetching makes a made-up `kid` an unauthenticated amplifier against the IdP.

For mTLS the critical check is `authorized`. A peer certificate is *present* on any connection where the client sent one; only the TLS layer knows whether it chains to a trusted CA. Reading the subject without that verdict is authentication by self-assertion, and it is the classic way mTLS is implemented wrongly — so the verdict is carried alongside the subject, making it impossible to read one without the other. Distinguished names are normalised to a sorted form, because object key order is not something to bind an identity to.

#### A mutation that survived, and what it was really saying

Removing the algorithm/key-type binding broke **nothing**. The alg-confusion test uses `HS256`, which is rejected earlier as an unsupported algorithm and never reaches that check — so the check was defending a case no test exercised.

The case it actually guards is subtler: a token claiming `ES256` whose `kid` points at an RSA signing key, which is only reachable in a key set containing both. That test now exists, and the mutation fails it.

Worth separating from the three earlier instances: those were tests passing for the wrong reason. **This one was a test that did not reach the code at all** — the assertion was correct and the path was not. A mutation distinguishes them; reading the test does not.

**978 tests passing** — 31 core, 80 engine, 533 store, 173 server, 125 tasks, 17 sdk, 16 cli. The container test is the one that matters for wiring: a real RSA key pair, a real JWKS served over HTTP, a real signed token arriving as an `Authorization` header, authenticating with no API key and no session — and returning **200 rather than 403**, which is the half that a binding merely resolving would fail.


### Phase 5 — tag-based resource access

The model, stated once because every call site reads against it:

> **Tags restrict. They never grant.**

An untagged resource is governed by scopes alone — exactly the access it had before tagging existed. A tagged resource *additionally* requires a grant matching one of its tags. So adding a tag can only ever **narrow** access.

That direction is the whole decision. The alternative — tags as grants, where holding `env:prod` gives you production — reads identically in the happy case and fails the opposite way: a resource nobody has tagged yet is reachable by everyone, and forgetting to tag something is far more common than forgetting to grant it. The mistake this model invites is locking yourself out, which is loud.

Grants live on groups, like scopes, so "who can touch production?" is answered by reading one group rather than auditing every account. Matching reuses the scope rule exactly — literal or trailing `*` — so there is one matching syntax in the system rather than two.

Enforced at three points, because reading, running and replacing are different acts:

- **Listing** filters in the query. A definition you cannot reach must not appear in a list and then vanish when opened.
- **Starting** is checked separately from reading, and is the more consequential of the two.
- **Registering over an existing tagged definition** is checked, because tagging something has to protect it from being *replaced*, not only from being read.

All three report an unreachable resource as **absent** rather than forbidden. Distinguishing them would tell a caller that a workflow with that name exists in a space they cannot see — the same disclosure the namespace check exists to prevent.

#### A required parameter instead of an optional one

`listWorkflows` and `getWorkflowDefinition` take the caller's access as a **required** argument. An optional one is precisely the shape that has silently disabled a check in this codebase more than once: a caller that forgets it gets full visibility and no error. Required means the compiler asks the question at every call site — and it immediately did, catching the scheduler and the event dispatcher.

Those two turned out to want something different. A schedule firing or an event handler starting a workflow runs as the **engine**, not as a person: the access decision was made when the schedule or handler was created, and re-applying the creator's tag grants at fire time would break the moment they left the team. They got an explicit unrestricted existence check instead, which says so in its name.

#### A bug the tests caught immediately

That new `definitionExists` was written as `row !== undefined`, and `findDefinitionRow` returns **`null`** for a miss — so it was always true and a missing definition was never detected. Two unrelated tests ("keeps going when one handler is broken", "records the failure and keeps the rest of the batch running") failed on the next full run, which is the only reason it is not in a release. A `null`/`undefined` identity check is a small enough slip to survive review and not a test.

#### One mutation that needed a second look

Inverting the restrict/grant direction survived the server suite. Not a gap: the check lives in `core`, whose test asserts `mayReachTags([], [])` directly and fails immediately — I had simply run the mutation against the wrong suite. Worth recording as the inverse of the earlier lessons: a surviving mutation is evidence to investigate, not proof of a weak test.

**996 tests passing** — 41 core, 80 engine, 533 store, 181 server, 125 tasks, 17 sdk, 16 cli.


### Phase 5 — single sign-on for humans

Authorization Code flow with PKCE. Every element exists for a named attack, and each has caused real incidents:

- **`state`** binds the callback to the browser that began the flow. Without it an attacker completes *their* login, redirects the victim to the callback, and the victim is signed into the attacker's account — login CSRF, where the damage is everything the victim does next believing it is theirs. Both callback routes are public `GET`s by necessity, so this check is the only thing standing between them and that.
- **PKCE** binds the code to this client. An intercepted code — from a proxy, a log, a `Referer` — cannot be redeemed without the verifier, which never leaves the process.
- **`nonce`** binds the ID token to *this* request, so one obtained in another flow cannot be replayed into this one.
- **The redirect URI is configured, never taken from the request**, and `returnTo` is reduced to a path. An open redirect arriving immediately after authentication is the most convincing kind, because the victim has just proved they trust the site.
- **`email_verified: false` is refused.** An unverified address is an account-takeover primitive: anyone able to claim it at the IdP would inherit the account already using it here. Absent is tolerated, since not every IdP sends it; false is not.

Flow state travels in a **signed**, HttpOnly, ten-minute cookie rather than a table — it is short-lived and browser-bound by nature, and a row would need a sweeper for the abandoned logins that are the normal case. Signed because an unsigned one lets an attacker supply both halves of the `state` comparison, at which point the check proves nothing.

Both mutation-confirmed: removing the state check fails the login-CSRF test, removing the nonce check fails the replay test.

#### Accounts are provisioned; authority is not

A first sign-in creates the account, because the alternative is an administrator creating every account by hand, which in practice means a shared login or SSO nobody uses. What it does **not** create is access: a new account holds no scopes and reaches nothing until someone puts it in a group. A stranger who can authenticate at the IdP gets an empty session, and the end-to-end test asserts exactly that — **403, not 401** — because the difference between "authenticated" and "authorised" is the whole design.

Password lockout counters are deliberately untouched by a federated sign-in: there is nothing here to brute-force, and letting SSO reset them would hand an attacker a way to clear the evidence of an attempt.

Human SSO is kept separate from workload OIDC, with its own configuration, despite both being OIDC. Conflating them would let a machine token open a human session, or a human login satisfy a workload binding — and the two have different lifetimes, different audiences and different consequences.

#### SAML, and the half of it a library cannot do

SAML's security rests on XML Digital Signature, which requires canonicalisation and careful handling of where a signature applies. **Signature-wrapping** — moving the signed element so a verifier validates one document and reads another — has produced vulnerabilities in most major SAML implementations, repeatedly. A JWT verifier is a hundred lines of well-understood checks against Node's own crypto, which is why the OIDC one here is written directly; XML-DSig is not that, and writing it from scratch would be the least defensible code in this repository. So the cryptography is `@node-saml/node-saml`'s, and `SamlService` is the part around it.

That part is not a thin wrapper, because what a SAML library cannot judge is whether *this browser* asked for the assertion it just received:

- **SP-initiated only.** An IdP-initiated assertion arrives unsolicited and carries no `InResponseTo`, so it cannot be bound to the browser about to be handed a session. Accepting one means anyone holding a valid assertion — including from a different session at the same IdP — can log a victim into that account. node-flow refuses an assertion it did not ask for, and that refusal is mutation-tested.
- **`InResponseTo` is checked against our own request id**, generated per login and kept in the signed flow cookie. The library can do this through an in-memory cache, which stops working the moment a second replica handles the callback; a cookie travels with the browser, so it works across replicas *and* binds the assertion to the browser rather than to the cluster.
- **`RelayState` is a random token**, checked in constant time before the assertion is parsed at all — SAML's `state`, and the whole of the login-CSRF defence.
- **Assertions must be signed**, not merely wrapped in a signed envelope. A test posts exactly that — a signed `Response` around an unsigned `Assertion` — and it is refused; relaxing `wantAssertionsSigned` makes that test fail.
- **The audience must be us.** An assertion minted for another service provider at the same IdP is perfectly valid and must not work here.
- **SHA-256**, where the library still defaults to SHA-1, and a **10-minute** ceiling on assertion age whatever the IdP allows.

One consequence worth naming: the flow cookie is `SameSite=None` in production, because the IdP returns the assertion by a cross-site form POST and a `Lax` cookie is not sent on one. That is safe only because the cookie is signed and single-use and because `RelayState` and `InResponseTo` are both checked — the cookie policy is not carrying the defence here.

`GET /v1/auth/saml/{provider}/metadata` publishes the service-provider metadata, since a hand-transcribed ACS URL or entity id is how most SAML setups fail. The login page lists OIDC and SAML providers together, each saying which protocol it speaks.

**1,017 tests passing** — 41 core, 80 engine, 533 store, 202 server, 125 tasks, 17 sdk, 16 cli.


### Phase 6 — the dashboard begins

Foundations plus the two screens that justify opening it: the execution list and one execution.

#### Same-origin by a runtime proxy, not by CORS

The session is an `HttpOnly` cookie, so the browser has to believe the API is same-origin for it to be sent at all. Cross-origin would mean `SameSite=None`, a CORS allowlist and credentialed fetches everywhere — three things to get wrong for nothing, since a real deployment fronts both with one hostname.

The obvious mechanism is Next's `rewrites()`, and it is the wrong one: **its results are baked into the build**, so the API's address would be fixed when the image is built. The live run found this immediately — the dashboard proxied to `localhost:3000` no matter what the environment said. A route handler reads the environment per request instead, which is the difference between a deployable product and one that needs rebuilding to point at a different server.

Two details in that proxy are easy to get wrong and were: `host` must not be forwarded, or the API believes it was addressed as the dashboard and every absolute URL it builds — an SSO redirect URI most visibly — points at the wrong place; and `set-cookie` must be copied with `getSetCookie()`, because `Headers.forEach` collapses repeats into one comma-joined value and a login sets two.

#### Rendering on the server, acting from the browser

Pages fetch on the server, forwarding the cookie: the session token never reaches the page. Only *actions* run in the browser, through one module that knows about CSRF.

That split exposed something about the API's own shape. Execution search is a `POST` — a deliberate Phase 1 decision to take a structured query rather than a query-string DSL — so a **read** trips the CSRF check like any mutation. The server-side client supplies the header from the cookie it already holds, which is not a workaround: double-submit rests on an attacker's page being unable to *read* the cookie, and this process legitimately can.

#### Decisions about what an operator sees

- **The list defaults to what is running**, not to everything. The reason someone opens it is "what is happening" or "what broke", and a default that buries both under a month of completed runs makes the first action on every visit a filter change.
- **The failure reason sits above the task list.** Finding why an execution broke should not require reading thirty rows.
- **Failed task rows open themselves**; the rest stay shut, because a thirty-task execution with every payload expanded is unreadable.
- **Retry attempts are called out.** A task that succeeded on its fourth attempt looks identical to one that succeeded immediately unless it is said out loud.
- **Only applicable actions are offered.** A greyed-out "Resume" on a finished workflow invites the reader to work out why it is disabled; absence says the same thing faster.
- **Colour is never the only signal.** `RUNNING` and `FAILED` are the pair an operator most needs to separate under pressure, and red/green is the pair most commonly indistinguishable — so each status carries a word and a shape too.
- **Navigation lists only pages that exist.** Listing the roadmap and letting unbuilt entries 404 is the fastest way to teach people not to trust the navigation.

Two small API additions fell out of building a client: `GET /v1/auth/me`, because a browser holding a session cookie knows neither its namespace nor its scopes until it asks; and the namespace **slug** on that response, because every namespaced URL is written with a slug and a client cannot construct a single path without it.

Password sign-in asks for the namespace rather than guessing. An email address is unique *within* a namespace, so the same address can exist in two — a namespace-free login is genuinely ambiguous, not merely inconvenient. Single-tenant installs set `NODE_FLOW_UI_NAMESPACE` and nobody sees the field pre-filled wrong.

**1,017 tests passing**, unchanged — this turn added no engine behaviour. Verified live instead, which is the only thing that would have caught the baked-in rewrite: a browser-shaped login through the dashboard's own origin stored a session cookie, `/executions` and `/executions/:id` both returned 200, the execution page rendered the workflow name, its status, its task and its correlation id, and a signed-out request redirected to `/login?returnTo=/executions` which rendered a form.

### Deviations from plan introduced by the Nx generators

Recorded so they are decided deliberately rather than inherited by accident:

| Planned | Generated | Decision |
|---|---|---|
| NestJS 12.0.1 | **NestJS 11.2.3** | **Accepted.** `@nx/nest@23.2` pins v11; fully supported, and nothing we need differs between 11 and 12 |
| `@nestjs/platform-fastify` | `@nestjs/platform-express` | **Switched to Fastify** (`@nestjs/platform-fastify@11.2.3`) |
| Next.js 16.3.5 | **Next.js 16.1.6** | Accepted; bump whenever convenient |
| Vitest 5.0 | **Vitest 4.1.11** | Accepted; Nx pins it |

**Standing condition: keep `server` HTTP-adapter-agnostic.** No `@Res() res: Response`, no adapter-shaped middleware in controllers — `main.ts` is the only file that should know which adapter is in use. The swap was a few lines precisely because nothing had leaked yet.

`main.ts` also sets three things that are easy to get wrong and painful to diagnose:
- **`listen(port, '0.0.0.0')`** — Fastify defaults to localhost, which inside a container presents as "connection refused" against a perfectly healthy process.
- **`enableShutdownHooks()`** — the decider and pollers hold transactions and task leases; without this a SIGTERM kills them mid-flight and leases expire on a timeout instead of being released.
- **`connectionTimeout: 0`** — long-poll holds connections for `pollTimeoutSeconds`, so this stays unbounded deliberately.

An e2e assertion pins the adapter at the wire level (Fastify advertises a `keep-alive` timeout header, Express does not), so silently reverting to Express fails a test rather than passing unnoticed.

Two generator bugs fixed along the way:
- `packages/server-e2e/jest.config.cts` was emitted with **ESM syntax in a `.cts` file** (`import`/`export default`) while `packages/server/jest.config.cts` correctly used CommonJS. Jest failed with "Failed to load the ES module" and the e2e target could never run. Now consistent.
- `@nestjs/platform-fastify` peers on `@fastify/view` and `@fastify/static` for templating and static file serving. We are a JSON API with a separate Next.js dashboard, so both are added to the webpack `IgnorePlugin` allowlist rather than installed.

### Phase 6 — the operator's four screens

The inbox, the workflow browser, schedules and queues. Each one is a page plus, where the API could not answer the question the page asks, a new endpoint.

#### A dashboard is a set of questions, not a set of tables

Three of the four screens changed shape once I wrote down what someone actually opens them to find out.

**Queues.** The API had `GET /queues/{queue}/depth` and nothing else — perfect for an autoscaler, which already knows the queue's name, and useless for a person, who does not. A dashboard needs the list, so `GET /queues` is new: every queue holding outstanding work, grouped from the rows.

There is no registry of queue names — a queue exists because something was pushed to it — so a drained queue **disappears from the list rather than reporting zeros**. That is a real consequence and the page states it rather than letting someone infer a deleted queue.

The column that matters is not depth. Depth cannot tell a queue of 500 that arrived a second ago from a queue of 3 that nothing has touched in an hour, and the second is the incident, so the page sorts by how long the oldest runnable task has been waiting. `workers` counts *distinct* holders of a live lease — the closest thing to a live worker count without workers having to register, which they deliberately do not. Work waiting with zero workers is the signature of a fleet that is down or listening on the wrong domain, and it renders in the failure colour.

**Schedules.** Live verification contradicted my own sorting comment: a paused schedule keeps reporting `nextRunAt` — the time it *would* fire if resumed, which is worth showing. Ordering on that field alone therefore files a paused schedule among the ones about to run, which is the single thing this page must not do. Paused now sorts last explicitly. `lastError` gets a row of its own, not a tooltip: "my schedule stopped working" is the question, and hiding the answer in server logs is how it stays unanswered.

**Workflows.** One row per name, newest version. Showing every historical version by default buries "what will run?" under "what has ever run?". Start opens an input editor rather than firing immediately — most workflows take input, and a one-click start that silently sends `{}` produces a run that fails deep for a reason unrelated to the button pressed.

#### A declared type that was not true

`listWorkflows` declared `tags: string[]` and defended with `row.tags ?? []` inside its filter while returning the row unchanged — so a null could leave under a type that said it could not. Harmless server-side, and the first consumer to render `tags.length` would have thrown. Normalised at the repository, because pushing the guard onto every caller is what the type exists to prevent.

#### Two mutations that both said the same thing

The `GET /queues` tests looked thorough and both load-bearing mutations survived them:

- Dropping the `FILTER` from `min("visibleAt")` changed nothing, because the fixture used a *negative* delay — which is an available row in the past, not a delayed one. The filter's exclusions were never exercised. The trap it actually guards is a **leased** row: it is the oldest row in the table, and an unfiltered `min` reports an hour of starvation on a queue that is being served.
- `count(DISTINCT "workerId")` → `count("workerId")` changed nothing, because each worker in the fixture held exactly one lease, and with a lease each, counting leases and counting holders agree.

Both fixtures were rewritten to make the distinction load-bearing and both now kill their mutants. The pattern is worth naming: **both weak tests were weak because the fixture was too tidy** — one worker per lease, one kind of row per state. A fixture in which everything is symmetric cannot detect a query that confuses two things.

#### What the live run proved that no test could

Bootstrap → boot → exercise → SIGTERM, against real Postgres 18, then the built dashboard pointed at it:

- The overview tracked a real workflow: three starts → `charge` 3 available / 0 workers, two workers leasing three tasks → `leased: 3, workers: 2` (the DISTINCT case, live), completion → `charge` drained and vanished, `notify` appeared.
- Human tasks refuse a service account outright — they are user-only by design — so this needed a real signed-in user, which is exactly the dashboard's path. Ada claimed, responded, and `apply` was scheduled with `decision: "approved"` resolved from the human task's output. Re-claiming as Ada is idempotent; Bob got `CONFLICT` on claim and `CONFLICT` on complete.
- All five pages rendered with real data through the dashboard's own proxy, which proves `getSetCookie()` forwarding works — a single collapsed `set-cookie` would have logged nobody in.
- The client mutation path: start-with-CSRF succeeded, the identical request **without** the `x-csrf-token` header was refused, and resume flipped `paused` to false.

Two environment notes, since both cost time: `POSTGRES_PASSWORD` applies only at initdb, so a container whose volume predates the current value has a role whose password never matched it; and something other than Docker holds port 5432 on this machine — the container's log showed none of the failed attempts, which is how to tell the difference from a wrong password.

**1,019 tests passing** — 41 core, 80 engine, 538 store, 202 server, 125 tasks, 17 sdk, 16 cli. Five added: four for the queue overview and one pinning the narrow-window catch-up that closed the scheduler flake. A full clean `build test lint typecheck` is green across all eleven projects from a tree with every `dist`, `out-tsc`, `.next` and `.tsbuildinfo` deleted.

### Phase 6 — the live execution stream

`RealtimeModule`, which has been in the module map since the plan was written and never built. It is what the execution view and the DAG editor both need, so it came before either.

#### Server-sent events, where the plan said WebSocket

The divergence is about resume, not taste. The stream is strictly one-directional — the viewer receives and never sends — and `WorkflowEvents` already carries a gap-free `seq` per execution. SSE's `Last-Event-ID` *is* that cursor: the browser replays it automatically on reconnect with no client code involved, and the server answers with an indexed range scan over `("workflowId", "seq")`. A WebSocket would hand-roll the same protocol and then have to get the reconnect loop right, which is the part that is always subtly wrong.

It also costs nothing at the edges: SSE is ordinary HTTP, so the session cookie, the auth guard, the dashboard's proxy and every intermediary work unchanged. The honest cost is that nothing can be sent *to* the server over it — Phase 8's push delivery to workers still wants a real bidirectional transport, and that is where WebSocket earns its place.

#### The notification is raised by the database, and carries a cursor

Two decisions, each of which removes a whole class of bug rather than avoiding one.

**A trigger, not a call site.** This codebase has now silently disabled four features because something forgot to pass or call something, each time invisible to every unit test. A `NOTIFY` that every writer must remember to issue is that shape exactly, and its symptom would be the worst kind — a dashboard that works in development and goes quiet on whichever path nobody exercised. An `AFTER INSERT … FOR EACH ROW` trigger on the partitioned parent cannot be forgotten: the decider, the sweeper, an operator action and a migration backfill all raise it identically, and Postgres fires it at **commit**, so nothing is announced that later rolls back.

**The payload is `workflowId:seq` and nothing else.** Postgres caps a notification at 8000 bytes and task payloads are unbounded, so carrying events inline would fail on exactly the large payloads most worth watching. More importantly, a subscriber that reads *from its own cursor* rather than consuming a delivery makes a dropped notification cost latency and nothing else — the next one returns the gap along with the new event. Notification is an optimisation over a durable log, the same relationship `QueueNotifier` has with the poll timeout, and `onConnect` fires on every reconnect so recovery is immediate rather than eventual.

The `LISTEN`/reconnect plumbing is now one class, `PgChannelListener`, shared with `QueueNotifier`. It was extracted rather than copied because the duplicated part is the part nobody re-reads, and copies acquire fixes separately. The extraction also closed a real gap: reconnect had no test at all, in either copy.

#### Two things that were never recorded at all

Building the stream surfaced that the event log it streams was missing most of the story.

**`workflow.started` was defined and never written.** Every execution's history began mid-story, with the first `task.scheduled`. It is now written by `WorkflowRepository.insertWorkflow` — the one place all four ways a workflow starts pass through (the API, the cron scheduler, an event handler, a parent's `SUB_WORKFLOW`), because an event only three of them remember to append is worse than no event at all.

**Nothing recorded a task finishing.** `task.completed`, `task.failed` and `task.timedOut` were constants nobody wrote. The history showed tasks being scheduled and never resolving — which reads as a stuck workflow, on every workflow, and would have made the live view useless the moment anyone opened it. Recorded now in `completeTask`, again because every path to a terminal task goes through it: a worker reporting, a system task running in-process, a human responding, a webhook arriving.

That second fix carried a real concurrency bug, and finding it is the most valuable thing in this section. Allocating `seq` as `MAX(seq) + 1` is safe for the decider, which holds a row lock — but a worker reporting a result holds nothing, so two workers finishing two branches of a fork at the same instant both read the same maximum and write the same number. Nothing rejects it; the index is not unique. The damage surfaces far away: a stream reading `seq > cursor` skips whichever duplicate landed in an earlier batch, so an event is lost from a log whose entire value is being complete. Fixed with `pg_advisory_xact_lock` on the workflow — and the first version of that fix was wrong in a way worth recording, because `completeTask` called without a transaction has none to scope the lock to, and **`pg_advisory_xact_lock` outside a transaction is released the instant its own statement ends**. It looked like protection and provided none — the same trap as `SET LOCAL` outside a transaction, and just as quiet. `completeTask` now opens its own transaction when the caller supplies none. Mutation-confirmed: without the lock, six concurrent completions produce three events instead of seven.

#### A mutation that was never applied

Three mutations against the trigger and the cursor read; two died, one survived. The survivor looked like a real finding and was not: `FOR EACH ROW` appears in the migration twice — once in the comment above the SQL and once in the SQL — and a replace-first-occurrence edited the comment. Applied properly it kills the test immediately.

Worth recording because the failure mode is invisible: a mutation that does not apply is indistinguishable from a mutation that survives, and it argues for the *opposite* conclusion — that the test is weak. **Verify the mutant actually changed what you meant it to change before believing what it tells you.**

The detour did produce one genuine finding. A statement-level trigger referencing `NEW` does not error in Postgres — it fires and calls `pg_notify` with an **empty payload**, because the unassigned `NEW` collapses the concatenation to NULL. The listener's `if (!message.payload) return` guard is what turns that into "no notification" rather than a crash, and it is the reason a mistake like this would present as a quiet dashboard rather than a loud failure.

#### The page is told *when* to re-read, not *what* changed

The execution view is server-rendered and resolves payloads, applies tag access and formats everything. A client applying events to a local copy would be a second implementation of all of that, and the two would drift — usually toward showing an operator something the server would not. So `EventSource` drives `router.refresh()`, debounced at 150 ms so a fork scheduling twelve branches is one refresh rather than twelve. Re-fetching is more work per event and cannot be wrong.

The indicator has three states rather than two. With two, the server-rendered HTML — produced before any connection is attempted — reads "Reconnecting", which tells an operator something is wrong at precisely the moment nothing is.

#### Verified live, including the part most likely to be broken

Whether Next's proxy *streams* rather than buffers is not something a unit test can answer. Timestamped per line, the backlog arrived at `:16` and the events for a task completed afterwards arrived at `:18` — as they happened, not batched at the end. Resume through the proxy with `last-event-id: 4` returned only events 5 and 6. The server closed the stream on `workflow.completed`. The page rendered "Connecting…" for a running execution and no indicator at all for a finished one.

Closing on the execution's own status rather than on a list of terminal event types matters here: a workflow timed out by the sweeper reaches `TIMED_OUT` without appending any `workflow.*` event, so an event-type check would hold the stream open forever on exactly the executions someone is most likely to be watching.

#### A second flake, caught by name this time

The full run failed once with `grows the delay with each failure`, then passed four times. Reproduced on the first repeat and diagnosed rather than re-run until quiet.

`retryAfterSeconds` is a `Math.ceil` over the difference between a Postgres timestamp and the host clock, so a value that should be 1 reads as 2 whenever the two clocks differ by even a fraction of a millisecond. The test walked a **single** backoff tier — because a locked account does not count further failures, so its loop of four attempts advanced the counter by one — and then compared two adjacent one-second tiers. About one run in fifty, that is 2 against 2.

The fixture now clears the lock before each attempt so the counter actually advances, and separates the two measurements by four tiers instead of one, putting the assertion far outside the rounding. Still kills a flat-backoff mutant.

Both flakes found in this project so far have been the same mistake in different clothes: **an assertion whose margin is smaller than the quantisation of what it measures.** The scheduler one compared a one-second window against a once-a-minute grid; this one compared a one-second difference read through a `ceil`. Neither was a race.

**1,044 tests passing** — 41 core, 80 engine, 553 store, 212 server, 125 tasks, 17 sdk, 16 cli. Twenty-five added: ten for the notifier and cursor reads, five for the newly-recorded events including the concurrency case, and ten API-level tests that run against a real socket rather than `app.inject()` — which buffers a response until it ends, so a stream that stays open would simply hang and the only tests that passed would be the ones where nothing streamed.

**Next:** the visual DAG editor. The live execution view is done.

### Phase 6 — the visual editor

Build, edit and version a workflow without touching JSON; see any execution drawn over the definition it ran. Built and then used in a real browser, which found five things no test had.

#### No free-form edges, by design

The DSL is a tree — sequences, switch cases, fork branches, loop bodies — and a free-form edge from anywhere to anywhere has no representation in it. An editor that allowed one would either refuse to save or quietly save something other than what was drawn. So every change is a **structural operation on the tree** (`lib/dag/edit.ts`), and the graph is derived from the tree afterwards. Nothing about the picture is ever stored, which is what guarantees that what you see is what you save.

Tasks are addressed by **path** — `['tasks', 2, 'decisionCases', 'approved', 0]` — which is deliberately the exact shape zod reports an issue's location in, so a server validation issue lands on a node with no translation.

#### No layout library

Every graph this DSL can express is series-parallel, and for that class a recursive layout is exact: no crossings, no heuristics. More importantly for an editor it is **stable** — inserting a task moves only what is below it. A global layered layout (dagre, ELK) can reshuffle the whole canvas after one insert. `@xyflow/react` is the only new dependency, for rendering, pan and zoom.

**Edges carry their insert points.** The "+" on an edge knows where in the tree a task dropped there belongs, so the editor never derives tree positions from screen geometry. That is also where the one invariant that matters is enforced by construction: the edges from a fork's branches into its join insert at the *end of the branch*, never between the fork and the join, which the compiler would reject. An invariant test sweeps every insert point the graph offers across a fixture that nests a fork inside a switch case with a loop and a nested switch as branch ends, and checks none of them separates a fork from its join.

#### Joins that follow their branches

A join lists the references it waits on, almost always the last task of each branch. Appending a task to a branch therefore silently leaves the join waiting on the task *before* it — a workflow that compiles, runs, and continues past the join while the branch is still running. It is the most common way hand-edited forks go wrong. The editor keeps a join in step with its branch ends **only if it was already waiting on exactly those** before the edit; a join someone pointed elsewhere on purpose is left alone. Fork and join are inserted and deleted as one unit.

#### The server decides what is valid

`POST /metadata/workflows/validate` runs `checkDefinition` — the same function registration now runs — and returns a verdict as a 200 rather than a 400, because asking "is this valid?" and being told "no" is the endpoint working. Issues carry a path (schema) or a task reference (compile), and the editor highlights the node. A second validator in the browser would be a second opinion, and the first time the two differed the editor would be lying. Responses are sequenced so a slow check of an old definition cannot mark the current one valid, and Save is enabled only for a verdict on the definition currently on screen.

Saving always creates the **next version**. Definitions are immutable and executions are pinned to the version they started on, so an edit can never change what a running workflow does.

#### Engine gaps the editor surfaced

Building templates for every task type forced the question "what is the minimum valid version of this?", and three answers were wrong.

- **A `SUB_WORKFLOW` with no `subWorkflowParam` hung forever.** It started no child, so nothing ever completed it, and there was no error anywhere. `START_WORKFLOW` reported success having started nothing. Both are now compile errors naming the task. The comment in `definitions.ts` also claimed per-type validation lived in a `validateTaskShape` function that does not exist.
- **`checkDefinition` caught only one of the compiler's two error types**, so a `CompilationError` would have been a 500 from an endpoint whose job is to report such things.
- **A loop condition in Conductor's syntax silently runs once.** `$.loop['iteration'] < 3` is compared as literal text, which is never less than 3, so the loop exits after one pass — and **the editor's own loop template shipped with exactly that condition**, passing validation, until it was checked against the evaluator. Confirmed by an engine test rather than by reading the code: the evaluator really does exit.

The loop rule is enforced at **registration, not in the compiler**, and that placement is the interesting decision. Stored definitions are recompiled whenever a process loads them; a stricter compiler would make workflows registered before the rule fail to load and stop every running execution of them. A mutation that moved the rule into the compiler failed the test that loads such a legacy definition. The rule rejects only what is certainly wrong — no comparison at all, or an operand that contains `$` without being a `${…}` expression — and deliberately accepts bare words, because `${charge.output.status} == PAID` works as written.

Templates now leave what cannot be guessed empty rather than plausible: an empty `sink`, `topic` or `uri` key shows where to fill in and still fails validation until someone does. A UI test compiles **every** palette template with the real engine and checks it against the real registration rule — the engine imported as a dev dependency only, never shipped to the browser. It failed immediately on `EVENT` and `KAFKA_PUBLISH`, whose templates did not compile.

#### What the browser found

- **Clicking "+" right after typing did nothing.** The mousedown blurred the field, the blur committed, the graph re-rendered and replaced the button before mouseup. The palette now opens on mousedown, which is safe because a blur only commits field values and no field value moves an insert point. The palette's outside-click listener then had to be armed a tick late, or it would receive the mousedown that opened it and close immediately.
- **Undo left the form showing the undone value**, and the next blur would have committed it straight back. Fields now follow their value whenever they are not being edited; remounting the form instead would have lost focus on every commit.
- **The view was fitted once, on load**, so inserting a parallel block pushed the join below the canvas while the top stood empty. It now refits when the graph outgrows the view — and only then, since refitting after every edit would throw away the stable layout.
- **"failed with terminal error" was truncated** to "failed with terminal" inside a node — cutting exactly the word that says it will not retry.
- The search box lost focus because the browser focuses the "+" button as part of the same click.

End to end: built `order_flow` by clicking, including a parallel block and an appended branch task whose join followed it; a duplicate reference was flagged on the right node with Save disabled; undo, save as v1; edited and saved as v2 with a loop; ran v2 and the loop body executed exactly **three** iterations before the workflow completed. An execution of v1 drew completed, failed and never-run tasks over the definition it was pinned to.

#### Two robustness bugs found through a flake

The full run failed once with an **unhandled** Postgres error while every test passed. Diagnosed rather than re-run:

**Any idle connection loss crashed the server.** `pg` reports a failure on an idle pooled connection by emitting `error` on the pool; nothing listened; Node turns an unlistened `error` into an uncaught exception raised from a socket callback; there is no process-level handler. So a Postgres restart, a failover, an `idle_session_timeout` or a network blip would take the server process down. Reproduced *before* fixing by terminating an idle backend with `pg_terminate_backend` — the test body passed and the process-level exception was the failure, which is exactly how this hid. `createPool` now always attaches a listener, and the server logs losses as warnings. It surfaced in the realtime spec because `pg-pool`'s `end()` resolves before its clients' sockets have closed, so stopping the container raced them.

**A refused event stream answered 200.** Re-running the realtime spec for the first bug exposed a second: one run in several, a key from another namespace received `200` and an open, empty event stream instead of `404`. Nest does not await an `@Sse()` handler before starting the response, so a refusal thrown after the handler's first `await` raced the headers. Fifty concurrent attempts made it deterministic: **49 of 50 came back 200**. No event data leaked — the refusal still prevented the subscription, and the first chunk was the bare preamble — and the result was the same whether the execution belonged to another tenant or did not exist, so it was not an existence oracle. But an authorisation failure reported as success is wrong, and each held a connection open. The check now lives in `ExecutionStreamAccessGuard`: guards are awaited before anything is written, so refusal is always a clean 404. A mutation removing only the namespace comparison fails exactly the two isolation tests.

#### Also

- pnpm had written a non-boolean placeholder for `@confluentinc/kafka-javascript` into `allowBuilds`, so every install exited with an error. It is a transitive of `@testcontainers/redpanda`, our Kafka code uses kafkajs, and its native build has never run — now denied, with the reason recorded beside the others.
- `packages/ui/vitest.config.mts` declared `resolve` twice, so the second silently discarded the `@/` alias.
- `mutate.ts` still described the build-time rewrites replaced earlier.

**Deferred, and why:** drag-to-reorder (insert and delete cover construction; moving a subtree between branches is a separate structural operation worth doing properly); renaming a reference does not rewrite `${ref…}` expressions, because a text replace corrupts any expression containing the old name as a substring — validation reports the dangling references instead; system-task inputs beyond `sink`, `topic` and loop conditions are not validated at registration, and a sub-workflow's target is not checked for existence, which needs a namespace lookup the pure compiler cannot make. A task's *name* is its queue name, so a name with a space — which the editor allows — produces a queue called `charge card`; valid, but workers must URL-encode it.

**1,138 tests passing** — 41 core, 97 engine, 558 store, 220 server, 125 tasks, 17 sdk, 16 cli, 64 ui. Clean `build test lint typecheck` across all eleven projects.

**Next:** superseded — see the UI revamp below.

### Phase 6 — the UI revamp: a modern console, and six bugs the browser found

The first dashboard copied Conductor's screens closely. The redesign keeps Conductor's *workflows* — how an operator gets from a failed run to the task that failed, what it was given, what it returned and what it logged — and drops its look. HeroUI v3 only, own theme (Geist, an indigo accent, light and dark with a system default), every screen verified in a real browser in both themes.

#### What changed on screen

- **Shell.** A collapsible sidebar grouped into Operate / Build / Resources, a ⌘K command palette that jumps to any page or pasted execution id, and a theme menu.
- **Execution detail.** A header with status and live indicator; an overview strip (started, duration that ticks while running, task progress, correlation id, trigger); a failure banner with "Inspect task"; and tabs for Diagram, Tasks, Timeline, Input & output, Variables, Events and JSON. Selecting a task anywhere opens a **resizable side panel** — Overview, Input, Output, **Logs**, JSON, Definition — with every attempt reachable, Re-run from here and Skip. Panel, tab and task live in the URL.
- **Timeline** is a Gantt of queue wait against run time, with a range slider to zoom and an axis in offsets from the start, because wall-clock labels six seconds apart all read the same.
- **Executions list.** Status tabs, one search box that takes an execution id *or* a correlation id, workflow and time filters that apply the moment they change, extra filters in a popover, rich rows that open on click, auto-refresh while anything on screen is running, and a floating bulk-action bar.
- **Workflows list and editor.** One row per workflow with versions, owner and a Run button; the editor's nodes reveal their delete control on hover rather than covering the canvas in red.
- **Task definitions** — new: a list that shows each type's retries, timeout policy and limits at a glance, and an editor with a Form/JSON toggle and a "How it behaves" card that reads the policy back as sentences, including the actual retry schedule (`1s → 2s → 4s`). Backed by two new endpoints, `GET` and `DELETE /metadata/task-definitions/:name`; delete is refused while tasks of that type are queued, including domain-routed queues (`name:domain`), and a name that merely shares a prefix does not block it.

#### Task logs

Workers can now say what they are doing. `context.log(message, level?)` in the SDK buffers lines (flushed every 2s, every 50 lines, and before a result is reported, so a crash report's last words are not lost) and posts them to `POST /tasks/:id/logs`, **fenced on the lease token** like a result — a log that anyone could append to is worse than none during an investigation. Lines are capped per task and per line, with the cap itself recorded as a line. The panel's Logs tab tails them live while the task runs, with search and level filters, and stops following when the reader scrolls up.

#### Engine and store bugs found by running real workflows through the new screens

- **Conductor's `value-param` SWITCH always took the default branch.** Its expression is the *name of an input parameter* (`expression: "switchCaseValue"`); the engine resolved it as a literal string, matched no case, and every run silently went down the default path — including the editor's own SWITCH template. It is now read as a parameter name when it is one, and registration refuses a bare word that names no input parameter, and a `javascript` evaluator the pure engine never runs. Found because an express order shipped by ground.
- **A late result overwrote a timeout.** A task timed out and its retry was scheduled; one second later the original worker reported success. The timeout had not revoked the lease token, so the report matched, and `TIMED_OUT` became `COMPLETED` beside a second attempt already running — two attempts claiming one result. `completeTask` now only ever moves a task out of a non-terminal status. A mutation removing that guard fails the regression test.
- **`TIME_OUT_WF` retried.** The policy documented as "fail the workflow" spent retries on timeouts, so a task with a five-minute budget and three retries held its workflow for twenty minutes. Only `RETRY` now retries a timeout, matching both the plan and Conductor. Existing tests had all used `retryCount: 0`, which is exactly why none noticed.
- **A skipped branch was recorded as skipped three times.** Later passes re-derive a skip; the insert was idempotent but the history entry was not.

#### UI bugs the browser found

- **Typed numbers were never saved** — in every numeric field of the workflow editor since it shipped. React Aria's `NumberField` fires `onChange` on commit, in the same event as `onBlur`, and the blur handler compared the stale draft. Only the stepper buttons worked.
- **Save straight after typing dropped the last edit.** Fields commit on blur; the save read the state from before that commit. Both editors now commit pending edits, yield a tick, and read the draft from a ref.
- **Dark mode never applied on load.** Hydration reset the attributes the pre-paint theme script set on `<html>`; the theme is re-applied in a layout effect before paint.
- **The diagram stayed white in dark mode**: React Flow puts a `light` class on its root by default, and HeroUI's `.light` selector redefined every token inside it. The graph now receives the resolved theme.
- **Fit-to-screen shrank a ten-task workflow to 32%** — all visible, none readable. The graph now fits only when the result is legible, and otherwise pins to the top at a readable zoom and refits when a side panel narrows the canvas.
- A running task's duration in the panel was frozen at the moment it was opened.

### Phase 7 — AI orchestration

#### Integrations, not endpoints in definitions

An AI task names an **integration** (`llmProvider: "openai"`, `mcpServer: "github"`) and never an endpoint or a key, for the reason `JDBC` names a datasource: a definition is user input that is stored, versioned, listed and shown in the UI. An integration is a namespace resource: provider, base URL, the models it allows, and the *name* of the secret holding its key. The key is unsealed at call time and never reaches a task row. Authors can read integrations to pick one; only `admin` can change them, because an integration decides where requests go. Header values on MCP integrations are returned masked, and a masked value saved back means "unchanged", so a form round-trip cannot wipe a token.

Providers go through the Vercel AI SDK (OpenAI, Anthropic, Gemini, and any **OpenAI-compatible** server: Ollama, vLLM, Groq, LM Studio). The SDK's own retries are off. The task definition's retry policy governs, so attempts stay visible in the history. Failures are classified: 4xx other than 408 and 429 is terminal, so a revoked key does not burn the retry budget.

#### Tasks

`LLM_TEXT_COMPLETE`, `LLM_CHAT_COMPLETE` (Conductor's `{role, message}` and the common `{role, content}`), `LLM_GENERATE_EMBEDDINGS`, `CHUNK_TEXT` (paragraph, then sentence, then word boundaries, with overlap), `LLM_INDEX_TEXT`, `LLM_SEARCH_INDEX`, `LIST_MCP_TOOLS`, `CALL_MCP_TOOL` and `AGENT`.
- `jsonOutput: true` parses the answer, markdown fence and all. It **fails** when the answer is not JSON, because the next task would otherwise read nothing and carry on.
- A prompt with a variable missing fails rather than sending a gap, since a model answers a prompt that lost its subject just as confidently.

#### Prompts

Prompts are versioned like definitions: every save is a new immutable version, numbered under an advisory lock so concurrent saves never collide. A task records which version it sent. The **prompt studio** runs a draft through the same executor a task uses.

#### Vectors on stock Postgres

Embeddings live in `VectorDocuments` as `real[]`, so retrieval works on the stock image, keeping Postgres as the only required dependency. When the `vector` extension is present, the migration enables it and search casts to it, so distance is computed in C. Without it, a SQL cosine function is used. **The same test runs against both** (`postgres:18-alpine` and `pgvector/pgvector:pg18`) and asserts identical ranking. Re-indexing a document replaces all its chunks in one transaction, so a shorter version does not keep the old tail. Mixing embedding dimensions is refused on write and on search, naming the model mismatch rather than returning meaningless scores.

#### `AGENT` — the loop is node-flow's

The SDK can run a tool loop in memory; a crash would lose it. Here the conversation, the pending tool calls and the step record live in the task's state:
- **Tools** are MCP tools (from an integration, optionally filtered), **workflows** (run as child executions with their own history, retries and permissions) and **indexes** (retrieval).
- **A workflow tool** is started with an idempotency key from the agent task and the tool call, so a replayed step joins the run it already started. While the child runs, the agent **yields** (`IN_PROGRESS`) instead of holding an execution slot, and it makes no model call until the child finishes. That is mutation-tested.
- **A failing tool** is information for the model, not a failed task.
- **`maxSteps`** bounds model calls. Running out fails the task with the transcript attached.
- The execution view has an **Agent** tab: each step's text, tool calls with their inputs, and results.

#### Documents, media and guardrails

- **`PARSE_DOCUMENT`** reads PDF (page by page, through `unpdf`), HTML (scripts and styles dropped, blocks kept as paragraphs, entities decoded), JSON and text, from a URL or from base64.
  - A URL gets the `HTTP` task's SSRF guard, now a shared `urlBlockedReason`, checked on **every redirect hop**, since a public URL redirecting inward is the usual bypass. Mutation-tested by checking only the first hop.
  - Documents are capped at 20 MB, counted while streaming as well as from the header.
  - A corrupt PDF fails terminally.
- **`GENERATE_IMAGE`** and **`GENERATE_AUDIO`** return base64 with the media type. Large outputs go through the ordinary payload offload.
- **`GENERATE_VIDEO`** is start-then-poll, because a video takes minutes rather than a second. The first pass starts the job and **yields** (`IN_PROGRESS`), keeping only the provider's opaque operation handle in task state; later passes check it. Holding an HTTP request open for ten minutes would tie up a worker slot and lose the job on a restart — a handle on the task row survives both, and the generation keeps running on the provider's side either way. The deadline (`maxWaitSeconds`, default 30 minutes) is the task's own, so a job that never reports completion fails instead of polling forever; that failure is *not* terminal, since a retry gets a fresh generation. Videos come back as a URL where the provider hosts one and base64 where it hands over bytes. Google is the only provider of ours with a video model, and asking another for one says so by name. Both the yield and the deadline are mutation-tested.
- **Guardrails** are declared per task and apply to text, chat, agents and media.
  - **Redaction:** email, phone, card (Luhn-checked, so an order number survives) and SSN are redacted before the request leaves. The output reports counts, never values.
  - **Blocked terms:** whole words or `/regex/`, checked on the way in and on the answer. A blocked answer is withheld, not recorded.
  - **Size cap:** `maxInputCharacters`.
  - A blocked request fails terminally without calling the model.

#### Workflows as MCP tools

`/v1/ns/{ns}/mcp` is an MCP server (streamable HTTP) listing every workflow tagged `mcp:tool` that the caller's key may execute, with its `inputSchema` (or declared input names) as the tool schema.
- A call starts the workflow **through the ordinary execution path**, so scopes, resource grants, the input schema, quotas and concurrency limits all apply. A malformed call comes back as the tool's error, not a protocol error.
- A run that outlasts 30 seconds returns its id, and a `get_execution` tool fetches the result.
- Opt-in by tag, because "refund an order" becoming callable by any agent holding a key should be someone's decision.
- API keys are now also accepted as `Authorization: Bearer nf_…`, the one credential header most MCP clients can send.

#### How it is tested without a paid key

`@node-flow-dev/tasks` ships two fixtures that speak the real protocols over real HTTP:
- **An OpenAI-compatible server:** chat completions with tool calls, and embeddings as hashed bags of words, so similar texts really do score close.
- **An MCP server** built on the SDK, with a required auth header.

The executor tests, the API tests (integrations, prompt versions, RAG in a workflow, an agent calling a workflow tool and an MCP tool, the MCP gateway driven by the real MCP client) and the live browser run all go through the provider SDKs and the MCP client exactly as production does.

**Verified live in the browser:**
- An administrator created an OpenAI-compatible integration and tested it.
- A broken integration named its missing secret.
- An MCP integration connected with 2 tools.
- A prompt was written, run with variables (rendered prompt, answer, tokens and latency shown) and saved as v1.
- An index was created from the UI and searched with scores.
- `support_agent` ran end to end: one agent called a workflow tool (a child run with a 3-second wait, started exactly once and linked by correlation id), a second agent called the MCP tool through the integration's token, and an LLM task used the saved prompt. The Agent tab showed each step.
- An external MCP client listed `lookup_customer` and ran it through `/v1/ns/verify/mcp`; a bad key got a 401 naming the problem.

**Found by that run:**
- Prompt and integration authors were recorded by id rather than name.
- A test result from one integration stayed on screen after switching to another.
- The document drawer defaulted to an integration with no embedding model.
- Plurals read "1 documents in 1 chunks".
- The final agent step repeated the answer.

All fixed.

### Phase 9 — replay, time travel, the CLI and generated clients

#### Deterministic replay

`replay()` in `@node-flow-dev/testkit` runs a recorded execution through the pure engine again.
- **Inputs:** each task's recorded outcome is a mock, consumed in the order it happened, so nothing real is called. The engine re-derives everything between those outcomes: branches taken, loop iterations, each task's resolved input, how the run ended.
- **Comparison:** by task run (`ref#iteration#attempt`) for presence, status and input (canonical JSON, so key order is not a difference), plus the workflow's ending and output.
- **`POST /executions/{id}/replay {version?}`** runs it on stored runs, resolving offloaded payloads and masking masked fields in the divergences.
  - Against the run's own version, a divergence is an engine determinism bug. The API test replays a real run with INLINE, SWITCH, SET_VARIABLE and a fork inside a loop, and it matches exactly.
  - Against another version it previews that change on runs that already happened.
- **UI:** "Replay…" in the execution actions, with a version picker and the divergences side by side.

Writing it exposed that `simulate()` did not mirror the evaluator fix for in-pass tasks (`continuedInPass`): a chain of EVENTs would have published twice in test mode. It now marks those tasks processed as the evaluator does, with a test.

#### Time travel

A scrubber over the execution diagram: step, play, or drag through every instant a task changed, with the graph redrawn as it stood then. It is rebuilt from each task row's scheduled, started and ended timestamps (`statusesAt`, `momentsOf`), so it works on every run ever recorded, not only new ones. The caption names what changed at each step and links to the task.

#### `nf`

The CLI grew commands that talk to a running server: `workflows list|get|register` (files or directories), `run` (with `--wait`: exit 0 completed, 1 failed, 2 still running), `executions list|get`, `tail` (each task change once, until the run ends), `replay`, `export` and `import`. There is also `nf test`, which needs no server: JSON test files with a definition, mocks and expectations run through the engine, and a failing expectation exits 1, so it drops into CI. The connection comes from `--url`/`--api-key`/`--namespace` or `NF_URL`/`NF_API_KEY`/`NF_NAMESPACE`. All of it was verified against the live stack.

Exporting an agent's workflow did not bring the workflows its agent calls as tools. The dependency walk now includes AGENT workflow tools.

#### Generated clients, and five defects in our own OpenAPI document

`clients/` holds Python, Go, Java and TypeScript clients generated from the committed `openapi.json` by `generate.sh`. Each was built: the Java jar and the Go build in Docker, TypeScript with `tsc`. The Python and Go clients ran a workflow synchronously on a live server.

Getting there meant fixing the document, which no generator could use as served:
1. **Unresolvable references.** Zod emits recursive types (a JSON value, a task that nests tasks) as schema-local `$defs` referenced by `#/$defs/__schema0`, which resolves against the document root, where nothing exists. They are now hoisted into `components/schemas` under content-hashed names, which also shares them between routes.
2. **No operation ids.** Generated methods would have been called things like `v1NsNsExecutionsIdReplayPost`. Each operation now has a unique `controller_handler` id (`execution_replay`) and a tag.
3. **Zod's regex beside `format: date-time`.** It produced a Python validator referencing an import the generator never wrote, so the package would not import. A standard format now stands alone.
4. **JavaScript's safe-integer bounds.** On every integer they overflowed Go's `int32`. Those bounds are removed, and 3.1's numeric `exclusiveMinimum` on integers becomes the equivalent inclusive `minimum`.
5. **"Any JSON value" as a recursive six-way union.** Java generators emitted uncompilable code for it. It is now `{}`, OpenAPI's own spelling of "anything".

Also, a route that declared no response schema was documented with no content, so clients discarded the body; it is now JSON of any shape. Each fix has a test over the whole document, and hoisting is mutation-tested.

#### The Conductor compatibility layer

One module, one controller, forwarding every request to the service that already implements it — so scopes, resource grants, input schemas, quotas, admission control and masking apply unchanged, and the translation holds no policy of its own. The namespace comes from the credential, because Conductor has none.

**Mounted at `/conductor/api`, not `/api`.** Conductor's SDKs build that path themselves: the JavaScript client strips a trailing `/api` from its `serverUrl` and appends `/api/...`, while the Python and Java clients take a base URL already ending in `/api`. One mount therefore serves both — point the JS SDK at `https://host/conductor`, the others at `https://host/conductor/api` — and the compatibility surface stays visibly separate from the `/v1` API this project designs against. A translation, not the contract.

Covered: `POST /token`, workflow and task definitions, start (plain-text id, as their clients expect), synchronous execute, get, correlated lookup, pause, resume, retry, restart, rerun, terminate, search, single and batch poll, task update by id and by reference, task logs and queue sizes. `update-v2` is deliberately absent: the SDK probes it, takes the 404 and falls back to the legacy endpoint, which is the path worth supporting.

Two differences are inherent, and are documented rather than papered over:
- **Fencing is weaker.** A Conductor `TaskResult` carries no lease token, so the token is read from the task row and a mismatched `workerId` is refused instead. A worker that kept its id but lost its lease to a timeout could still report — which is Conductor's own guarantee. `/v1` workers keep the fencing token.
- **Search is partial.** Conductor's query language is an Elasticsearch dialect. The equality forms (`workflowType=`, `correlationId=`, `status=`/`status IN (…)`) are translated and anything else is ignored, because returning a different result set than the caller asked for looks like an answer.

`X-Authorization` is now accepted alongside `Authorization`, and a bare `nf_…` key works in either, since Conductor's header carries no scheme.

**Verified with the real thing:** the unmodified `@io-orkes/conductor-javascript` SDK registered a definition, started a workflow, ran a `TaskManager` worker that polled and completed the task, and read back a COMPLETED run with the worker's output — against node-flow, with only a base-URL change. The API tests cover the same loop plus the refusals, and the stale-worker check is mutation-tested.

### Phase 8 — the load harness, and what it found

`@node-flow-dev/bench` (`nf-bench`) drives a **running** server over the ordinary API — no in-process shortcuts, no privileged SQL on the hot path — so every number it prints is one a user with an API key can reproduce. Two shapes, because they stress different halves of the engine: `chain` (*K* tasks in sequence, all turnaround) and `fanout` (a `FORK_JOIN` of *K* branches and a join, all decider width). Two pacing modes, and the distinction is the point: a **closed loop** cannot show overload, because when the system slows the harness stops asking, while an **open loop** starts runs on a schedule regardless and reports its own lateness rather than folding it into latency. Percentiles are exact and nearest-rank, so a reported p99 is a latency some run actually had.

The metric that matters is **step turnaround**: the gap between completing one task and leasing the next task of the same run. That interval is entirely node-flow — evaluate, schedule, enqueue, deliver — where workflow latency also contains the worker's own work.

Pointing it at the server immediately paid for itself. On a 3-task chain, 10 runs in flight, 6 workers:

| | workflows/s | step turnaround p50 | workflow p50 |
|---|---|---|---|
| Before | 16.6 | 359 ms | 1134 ms |
| Decider woken by `NOTIFY` | 41.4 | 122 ms | 457 ms |
| + evaluations run 4-at-a-time | 65.4 | 67 ms | 273 ms |
| + the lost-wakeup fix below | **~58** (median of 3) | **~78 ms** | ~300 ms |

The last row is the honest one: the correctness fix costs roughly a tenth of the throughput, because it makes sibling completions of the same workflow take a row lock the previous version skipped. A silent hang is not a trade worth making for 10%, and the result is still 3.5× where this started.

Two changes, both small:

- **The decider was polled, not triggered.** Its 200 ms interval exists so a wake-up can never be *missed*; it was also deciding how quickly work was *noticed*, so every step of every workflow waited half an interval before anyone looked at it. `DecideQueues.enqueue` now raises a `NOTIFY` that Postgres holds until the enclosing transaction commits, and a `DecideNotifier` turns it into a `wake()` on the runner. The interval remains, because the notification is advisory — a replica mid-reconnect misses it — and the loop is what makes the system correct. A wake arriving *during* a pass is remembered rather than dropped, which is the same lost-wakeup shape one level down.
- **A decider pass evaluated its batch one workflow at a time.** Evaluations of different workflows are independent, each arbitrated by its own claim and row lock, so serialising them made every workflow wait behind the ones ahead of it. Now four at a time — bounded well inside a default pool, because starving the API to speed up the decider is a poor trade.

#### The bug the harness found

The `fanout` profile left **3 of 40 runs stuck**: every branch `COMPLETED`, the fork `COMPLETED`, the join never scheduled, and nothing in any log. This is the lost-wakeup failure PLAN.md warns about, through a door the claim-before-read rule did not cover:

> A branch completes and its transaction inserts into `DecideQueues` — but a row is already there from a sibling branch, so `ON CONFLICT DO NOTHING` does nothing **and takes no lock**. A decider then deletes that claim row, reads the task frontier, and misses the branch whose transaction has not yet committed. The completion commits a moment later, having left nothing behind to ask for another evaluation. No further wakeup ever comes.

The fix is one clause: `ON CONFLICT DO UPDATE`. The row is still pure dedupe and the written `reason` changes nothing an evaluation reads — what matters is that `DO UPDATE` **locks** the existing row for the rest of the completing transaction, so a claim must wait until that completion is visible. That is the interlock the claim-before-read rule always assumed it had. The regression test asserts the *ordering* (the claim returns after the completion commits, not merely that both finish); with `DO NOTHING` the claim returns in 1 ms instead of 250, and the test fails.

Forty-run fan-outs now finish 40/40 across repeated runs at ~31 workflows/s and ~283 tasks/s.

#### Two supported topologies, and why the second one is still empty

The commitment is **Postgres, or Postgres + Redis** — never a third thing. Before building the Redis tier, the harness was asked where the ceiling actually is. On one laptop (Docker Postgres 18, one process holding `api,decider,poller`, 16 workers, 3-task chains), open-loop:

| arrivals | completed | step turnaround p50 | queue depth | WAL |
|---|---|---|---|---|
| 25/s | 22/s | 16 ms | 1 | 0.74 MB/s |
| 50/s | 44/s | 114 ms | 2 | 1.09 MB/s |
| 100/s | 53/s | ~2.0 s | 2 | 1.01 MB/s |

The shape of saturation is the finding. At 100 arrivals/s the system still drains every run, but latency grows by two orders of magnitude — and **WAL stays near 1 MB/s while the task queue never goes above a couple of rows**. Nothing is queueing in Postgres and nothing is near the WAL wall; the backlog is in the decider, inside a single Node event loop that is also serving the API. The ceiling here is CPU in one process, not the database.

That answers the Redis question honestly: **Redis would not move this number**, because the thing that is full is not the thing Redis replaces. Token buckets and counters are the right *first* Redis candidates if a real deployment ever shows Postgres contention — losing a token is harmless — but permits that guard state (named semaphores, `concurrentExecLimit`) must stay in Postgres, because their correctness comes from committing in the same transaction as the state they protect. Until there is a measurement that Redis addresses, adding it would be infrastructure bought on a guess.

One inefficiency the same experiment exposed: running three decider processes on the same machine made throughput *worse* (53 → 47 workflows/s, turnaround 2.0 s → 2.8 s). Some of that is four Node processes and a database sharing four cores, but not all — `peekBatch` takes an `offset` precisely so replicas can look at different parts of the queue, and `runnersForRoles` never passes one, so every decider peeks the same fifty rows and races for the same claims. Recorded here rather than fixed blind, because a fair measurement of horizontal scaling needs more than one machine.

#### Read replicas and the partition-ownership decider: gated on a measurement, not deferred out of laziness

Both are in this phase's plan, and neither is built, for the same reason the Redis tier is not: the harness says the thing they fix is not what is full.

**Partition ownership** exists to replace the `FOR UPDATE` row lock when a single primary's lock throughput becomes the ceiling. At saturation on this machine the lock is not contended — the decide queue backs up while the task queue sits at two rows and WAL at 1 MB/s, because one Node process is serving the API and running the decider on the same event loop. Replacing row locks with an ownership protocol would add the most delicate distributed-systems code in the repository to fix a limit nothing has hit, and the failure mode of getting it wrong is two deciders evaluating one workflow — the exact thing the current design makes impossible by construction.

**Read replicas** move search and list queries off the primary. The same measurement applies, plus a correctness wrinkle worth stating: replica lag makes read-your-writes fail, so a user who starts a run and immediately opens it can get a 404. That is only acceptable for queries where staleness is obviously fine — analytics, historical search — and the seam has to be explicit about which, not a pool swap that silently applies to everything.

The gate is concrete rather than vague: build partition ownership when a benchmark on separated `api` and `decider` processes shows lock waits in `pg_stat_activity` as the limiting factor; build read replicas when search traffic measurably competes with the decider for connections. Until then this is speculative optimisation of a system whose real next step — running the roles in separate processes, which already works — costs nothing to try.

Also in this phase: **S3 payload storage** (`NODE_FLOW_BLOB_STORE=s3`) behind the existing `BlobStore` seam, written against the S3 API rather than one vendor's, so MinIO, R2, B2 and Ceph work through `endpoint` + `forcePathStyle`. `@aws-sdk/client-s3` is an optional peer, so a default install never loads it. Tested against MinIO in a container rather than a mocked SDK, because the parts worth testing — streamed bodies, key prefixes, paged listings — are exactly the parts a fake would get wrong.

And one flaky test fixed on the way: an execution search matched on a 13-character UUIDv7 prefix, which is precisely the millisecond clock, so two runs started in the same millisecond collided. It failed whenever the machine was fast.

#### BPMN is a graph; a definition is a tree

The importer converts the *structured* subset — every split matched by a merge, branches nesting rather than interleaving — and **names everything it could not convert**. That asymmetry is the whole design. A converter that silently approximates produces a workflow which looks right in a diagram and takes a different path in production, and nobody re-reads the original to find out why; one that refuses outright is useless against the BPMN people actually have.

So the endpoint returns a draft, a warning list and the same validity verdict registration would give, and the UI shows the warnings **above** the draft, uncollapsed — the warning that matters is the one someone scrolling past would miss. Nothing is saved until a person saves it.

#### A task output Postgres could not store

Found while validating the service registry in a browser against the public Swagger Petstore: the run hung, `find_pet` sat `IN_PROGRESS` forever, and the only trace was a line in the server log — `unsupported Unicode escape sequence`.

Postgres `jsonb` **cannot represent a NUL inside a string**. JSON can, JavaScript can, and so can any HTTP response — the Petstore's public test data contains one. So the task did its work, got its 200, and then could not record the result: the insert threw, the task never reached a terminal state, and the workflow waited on something that would never finish. Nothing in the UI could have explained it.

`json()` — the single funnel every JSONB write passes through — now strips the escape. Stripping rather than failing, because the data is already in hand and refusing to record a successful call over one unprintable byte is the worse bug; a NUL mid-text is a truncation marker or a fuzzer's leftover, never content. The regression test completes a task whose output carries one and asserts the text around it survives; without the fix the test reproduces the exact production error.

### Phase 10 — Orkes enterprise parity: gap analysis

The goal set after the UI revamp: match what Orkes sells, not only what open-source Conductor ships. This is an inventory of the Orkes console (Launch Pad, Assistant; Executions: workflows, agents, human tasks, scheduler, queue monitor, workers, event monitor; Definitions: workflows, agents, tasks, user forms, event handlers, scheduler, secrets, webhooks, AI prompts, environment variables, schemas, remote services, tags; Integrations; Access control: applications, groups, users; APIs: services, authentication) and the orkes.io/content docs, compared against node-flow as it stands. Where node-flow already goes further (named semaphores, retry budgets, sealed task output, worker poll health) that is noted, not re-planned.

Before starting, a robustness pass ran every screen against edge cases. It found and fixed, each with a regression test that fails without the fix:

- **Retrying a terminated workflow rewrote it as FAILED.** Terminate cancels in-flight tasks; retry reopened only failed ones, so it reopened nothing and the decider turned the cancellation into a failure with the old reason. Retry now reopens cancelled tasks too, and refuses — rather than silently re-deciding — when there is nothing to retry.
- **Retry ran a task once per exhausted attempt.** A task that used up three retries has three failed rows; all three were reopened and ran concurrently. Only the latest attempt is reopened now.
- **One unresolvable expression crashed the decider in a loop.** The error escaped `decide`, the runner failed, retried the same workflow forever, and the execution sat at RUNNING with no tasks and the reason only in the server log. It now fails that workflow, and only it, with the reason recorded.
- **A loop body could not read its own iteration** (`${loop.output.iteration}` — "page N"), which is how the previous bug was found: a 300-iteration loop never started.
- **Open redirect on sign-in.** `returnTo` was followed verbatim after a password login; only same-origin paths are honoured now (the API already guarded SSO).
- **`failureWorkflow` is accepted and ignored** — found by this inventory. First item of the first wave.
- The timeline drew operators' whole lives as queue wait, did not distinguish loop iterations, and rendered hundreds of rows at once; unstyled 404 and error pages.

| Area | Orkes | node-flow today | Plan |
|---|---|---|---|
| Failure workflow | `failureWorkflow` started with `workflowId`, `reason`, `failureStatus`, `failedWorkflow` | ✅ Started on FAILED and TIMED_OUT (decider and workflow-timeout sweeper), with the failed run's input, `workflowId`, `reason`, `failureStatus`, correlation id; version pinnable; at most once per failed run; not on TERMINATED | ✅ Wave 1 |
| Idempotency | `idempotencyKey` + `FAIL` / `RETURN_EXISTING` / `FAIL_ON_RUNNING` | ✅ All three; a finished key is handed to exactly one of several concurrent starts; strategy in the Run dialog | ✅ Wave 1 |
| Environment variables | `${workflow.env.x}`, Plain/JSON, CRUD + UI | ✅ Text and JSON, `${workflow.env.x}` and `${env.x}`, resolved at decision time so SWITCH and loops can use them, 5s cache, API + page | ✅ Wave 1 |
| Schema registry | Named, versioned JSON/Avro/Protobuf schemas referenced by defs, `enforceSchema` | ✅ JSON: immutable versions (concurrent-safe numbering), `{name}` follows latest / `{name, version}` pins, dangling references refused at registration, task input/output and **workflow input** enforced, sample-payload validation API and page. Avro/Protobuf deferred to Phase 8 with the Kafka schema registry | ✅ Wave 1 |
| User forms | Versioned form templates (JSON Schema + UI schema), builder, preview | ✅ Versioned templates, visual builder (8 field types, ordering, choices, bounds, required, help) with a live preview that *is* the inbox form, `form: { template, version? }` copied onto the task when it opens, missing template fails the task not the evaluation, **responses validated on the server** | ✅ Wave 1 |
| Human task assignment | Assignment chain with `slaMinutes` escalation, auto-claim, triggers on state change, skip, reassign, admin search | ✅ Chains of users (by email) and groups with per-link SLA, leased escalation sweeper, `LEAVE_OPEN` / `TERMINATE` at the end, claimed tasks never move, reassign (releases the claim) and skip for operators, chain and countdown in the inbox. **Auto-claim** (`autoClaim: true` claims for a single-person assignee at open, escalation and reassignment; an untouched auto-claim still escalates when its window closes). **Triggers** (`triggers: [{ on: ASSIGNED|CLAIMED|RELEASED|COMPLETED|SKIPPED|TIMED_OUT, workflow, version? }]`, started through the outbox in the transaction that changed the task, trigger workflows checked to exist when the task opens). **Admin search** (`GET human-tasks/search` by state, assignee, group, workflow, text and age, with people named and tag-hidden workflows excluded) and an **All tasks** operator tab. Found while verifying: operators were offered Claim on work assigned to someone else | ✅ Wave 1 |
| Admin screens | Users, groups, applications (access keys), permissions | ✅ Users (add with generated policy-compliant password, disable and sign out), groups (members, scopes, tag grants), applications (service accounts and API keys, secret shown exactly once), secrets (write-only, rotate), all with a scope picker that says what each grant unlocks | ✅ Wave 1 |
| Audit log UI | Search by resource, user, action; diff of entity state | ✅ Filter by resource and action, keyset "load older", full record in a drawer. **Coverage gap closed:** workflow and task definitions, users, service accounts, API keys and human-task reassign/skip were never audited. **Entity-state diffs:** every audited change records the entity `before` and `after` (read before the handler and after it succeeds; `null` for a create or delete), shown in the drawer as changed-field chips and a line diff. Columns are selected by name, so password, token and key hashes and sealed secret values are never recorded, and runtime counters are left out. **Found while building it:** adding a group member was never audited (its decorator sat on the tag-grants route, which was logged as `member-add`), schedule pause/resume and event-handler enable/disable were unaudited, and a new user was filed under their display name rather than their email | ✅ Wave 1 |
| Tags dashboard | Tags across resources, permissions by tag | ✅ Admin **Tags** page: every tag in use with the workflows carrying it and the groups that reach it (including via wildcard). It flags tags no group can reach and grants that open nothing, such as a misspelled pattern. Tags can be edited from the dashboard and the Workflows list (`PUT /metadata/workflows/:name/tags`) | ✅ Wave 2 |
| Sync execution | `execute` with `waitForSeconds`, `waitUntilTaskRef`, return strategies | ✅ `POST …/:name/execute` waits (notifier-driven, poll backstop, ≤60s) for completion or one task, answers `reached: false` on timeout without cancelling | ✅ Wave 2 |
| Signals | Complete the blocked WAIT/HUMAN task by workflow id, sync variant | ✅ `POST …/:id/signal` resumes the blocked WAIT or YIELD (or a named task), searching running sub-workflows, optional wait for the result; a **Resume** dialog in the execution task panel | ✅ Wave 2 |
| Workflow message queue | Push messages into a running workflow, `PULL_WORKFLOW_MESSAGES` | ✅ `POST /executions/:id/messages` queues a message per execution, and `PULL_WORKFLOW_MESSAGES` (with `batchSize` up to 100) completes with the oldest waiting messages, as soon as there is at least one. Messages pushed before the pull is scheduled are handed over when it is scheduled, in the same transaction. Push and delivery take the execution's row lock, so a message landing mid-evaluation is never stranded. Claims use `SKIP LOCKED`, so no message goes to two pulls. Messages to a finished execution get 409. The execution page gains a **Messages** tab (composer plus a list showing which task took each message), shown only for workflows that pull; the editor palette has "Pull messages" | ✅ Wave 2 |
| Workflow rate limit by key | `rateLimitConfig{rateLimitKey, concurrentExecLimit}` queues excess starts | ✅ Key resolved from the input at start, on every start path (API, schedule, event, sub-workflow, START_WORKFLOW). An execution over its key's limit is created waiting, in arrival order, and admitted by a leased runner as slots free. Starts serialise on a per-key advisory lock, and a newcomer never jumps the line. A missing key shares one bucket instead of escaping the limit. Shown as "Queued" in the list and on the execution page; editor fields | ✅ Wave 2 |
| CDC / status listener | Workflow state changes to Kafka/SQS/NATS/… | ✅ **Status listeners**: named per namespace, filtered by workflow name (exact or `prefix*`) and lifecycle event (STARTED, COMPLETED, FAILED, TIMED_OUT, TERMINATED, PAUSED, RESUMED, RESTARTED), delivered to a **signed webhook** (the WEBHOOK task's executor, so the same SSRF guard and HMAC signing) or a **Kafka topic** keyed by execution. Every status change goes through the workflow repository, which writes one outbox row per matching listener in the transaction that made the change, so each listener retries and dead-letters on its own. Optional output (masked fields masked, over 256 KB left out), delivered/failed counters and last error, "Send test" and a Status listeners screen. **Found while building it:** every completed or failed workflow wrote a `workflow.completed` / `workflow.failed` outbox event that nothing consumed, so each one retried ten times and was dead-lettered (58 on the dev database); those events are gone. NATS, AMQP and SQS sinks added with the Phase 4 sources | ✅ Wave 2 |
| Scheduler executions | Per-schedule run history, previous and next firings | ✅ Every firing is recorded in the scheduler's transaction as **started** (with the execution and its status now), **skipped** (overlap policy, naming the run still going) or **failed to start** (with the reason), for the occurrence it was for, so a late catch-up shows how late. `GET schedules/:name/runs` pages newest first and filters by outcome; history is pruned after 30 days by a leased hourly runner. A run-history drawer on the Schedules page with outcome tabs. **Found while building it:** the table's workflow column was headed "Runs", a press on a row's history link also opened the edit drawer, the edit drawer said "1 runs", a sub-minute cron previewed as the same minute repeated, and a schedule the poller had not yet claimed showed its next run "8s ago" (now "Due now") | ✅ Wave 2b |
| Execution search | Free-text and SQL-style search, column chooser, saved views | ✅ One search box with a small syntax — `status:FAILED,TIMED_OUT workflow:checkout_* version:3 id: correlation: key: reason:"…" input.customer.tier:gold output.approved:true is:sub/top/running/finished` plus plain words matched across id, workflow, correlation id, idempotency key, reason, input and output (every term must match). Parsed once on the server (`parseExecutionQuery`) into the same typed filters, so values stay bound parameters and API callers get it too; an unknown key is a 400 naming the keys there are. `input.`/`output.` terms are JSON containment (a number or boolean also tries its string form) backed by `jsonb_path_ops` GIN indexes; LIKE wildcards in words are literal; tag-hidden workflows stay hidden. Column chooser (execution id, started, ended, duration, correlation id, idempotency key, failure reason) remembered per browser; **saved views** (`/saved-views`, personal or shared with the namespace, owner-only edits, admins may delete any) restore both search and columns; a syntax popover with runnable examples. Offloaded payloads are not searched | ✅ Wave 2b |
| Task to domain | `taskToDomain` at start, shown on the execution | ✅ `taskToDomain` accepted when starting a run (`{ "charge": "eu-west", "*": "canary" }`, validated), stored on the execution and applied as each worker task is scheduled or retried — the task's own name, then `*`, then the domain in the definition — so the task row and its queue always agree. System tasks are never routed (only this server's runner leases them). Sub-workflows inherit the parent's routing with `subWorkflowParam.taskToDomain` on top; run-again keeps it. Run dialog field (`task = domain` lines, per-line errors) and a Task domains row on the execution. **Found while building it:** the row claimed sub-workflow propagation worked, but the evaluator dropped `subWorkflowParam.taskToDomain` when publishing the child's start — children always ran on the plain queues | ✅ Wave 2b |
| Definition import / export | Import and export workflows and tasks as JSON, in bulk | ✅ `POST metadata/export` writes one `node-flow.definitions` bundle — all reachable workflows, or chosen ones with the sub-workflows, started workflows and failure workflow they name and the task definitions their worker tasks use; latest or all versions; tags included; tag-hidden workflows left out. `POST metadata/import` validates the **whole** bundle before writing (one invalid definition imports nothing and says which), reports each item as new / unchanged / skipped / new version / overwrite, handles conflicts as asked (workflow versions: skip or register as the next version, never colliding with versions the bundle itself declares; task definitions: skip or overwrite), supports `dryRun`, respects tag access and the definition quota, and never strips tags from an existing workflow. Workflows page: Export all, per-row Export with dependencies, and an Import dialog (drop or choose a bundle, a single workflow's JSON or a list) that previews the server's dry run as options change. **Found while building it:** "import as the next version" first bumped a conflicting v1 to v2 while the same bundle also carried a v2, so the second registration failed half-way | ✅ Wave 2b |
| Fine-grained permissions | Per-resource grants (read, execute, update, delete) to users, groups and applications | ✅ **Resource grants**: a user, group (every member) or application (service account or API key) gets READ / EXECUTE / UPDATE / DELETE on workflows or task definitions — by exact name, `prefix*`, `tag:key:value`, `tag:key:*` or `*`; any access implies READ. They combine with scopes as an OR (scope + tag reach, or a grant naming the resource — a named grant reaches a tagged workflow). Resolved per request onto the principal (own + groups, 5 s cache, cleared on change). Routes opt in with `@AllowResourceGrant`, which lets a principal without the scope past the guard only if it holds a grant of that kind; the handler then decides for the specific resource at the same points that enforce tags: definition list/get/register/tags/delete, export/import, start, every read and operator action on an execution, execution search, the live stream, and task definitions. `/permissions` admin API (audited), a Permissions admin page, a per-workflow Permissions dialog, and navigation that shows Workflows/Executions/Task definitions to grant holders. **Found while building it:** groups never exposed their id, so nothing could reference one; and stacking the grant dialog over the permissions dialog closed it when a picker opened — replaced by one dialog with two views | ✅ Wave 3 |
| SAML SSO | SAML 2.0 identity providers | ✅ SP-initiated SAML 2.0 over `@node-saml/node-saml`, with the request binding, RelayState and audience checks done here; SP metadata published | Phase 5 |
| Masking | `_masked`, `_secrets`, `maskedFields` | ✅ `maskedFields` on the workflow: values under those key names, at any depth, show as `***` on every read path (execution detail, including variables and task input/output; history event payloads; sync-execute and signal results; the SSE stream). Stored values are untouched, so workers and expressions still use them. Only payloads are masked, never the envelope, so masking `status` cannot blank an execution's status. Set in the workflow editor. Sealed secret output remains the stronger option for credentials. **Found while testing:** the UI's "Run again" copied the input it had read, so a re-run would have started with `***` as the password. It now calls `POST /executions/:id/run-again`, which copies the stored input on the server | ✅ Wave 2 |
| Task output cache | `cacheConfig{key, ttlInSecond}` | ✅ Key is an expression resolved by the decider; a fresh hit settles the task in-pass without queueing; per task definition so unrelated tasks never share results; offloaded outputs not cached; hourly prune; editor fields | ✅ Wave 2 |
| Webhook verifiers | GitHub, Slack, Stripe, Teams, SendGrid, Twitter, header, HMAC presets; start and/or resume | ✅ **Webhooks** (Build): named inbound endpoints at `/v1/hooks/:id` with presets for GitHub, Stripe (timestamped, tolerates secret rotation), Slack (timestamped, answers the URL challenge), Shopify, custom HMAC (header, hash, encoding, prefix), a shared header token, or none. Signatures are checked over the raw bytes in constant time, against a sealed secret-store entry. A verified delivery becomes an event on source `webhook` with the webhook's name as topic, scoped to its namespace, so handlers start workflows or complete tasks with the usual conditions, templates and deduplication (by the platform's delivery id), and every outcome appears in the event monitor. Signature headers are dropped before the payload reaches a workflow. Forgeries count as rejections and touch nothing else. Cards show the URL, accepted and rejected counts, the last error, and listening handlers with an "Add handler" shortcut. Teams, SendGrid (ECDSA) and Twitter CRC are not yet supported | ✅ Wave 2 |
| Bulk operations | Bulk pause/resume/restart/retry/terminate APIs | ✅ `POST …/executions/bulk/:action` for pause, resume, retry, terminate: up to 1000 ids, bounded concurrency, per-execution outcome; the list's bulk bar uses it | ✅ Wave 2 |
| Test mode | Mocked run of a definition | ✅ `@node-flow-dev/testkit` `simulate()` runs a definition in memory through the **real engine**. It mirrors exactly how the database evaluator applies commands (task identity, static-ref loading, retries, skips, variables, sub-workflows run for real) and applies the same registration rules. Outcomes are mocked per task reference, optionally one per attempt; unmocked tasks are listed. `POST /metadata/workflows/test` runs saved or unsaved definitions with namespace task definitions, environment and sub-workflows; INLINE, JQ and business rules run for real in their sandboxes. Nothing is persisted or published. The editor gains a **Test** tab (input, per-task outcomes remembered per browser, path taken with mocked, real and default badges, output) | ✅ Wave 2 |
| Remote services | HTTP (Swagger) and gRPC service registry, method discovery, circuit breaker | ✅ **Circuit breaker** (✅): shared by `HTTP`, `HTTP_POLL` and `gRPC` so one dying dependency is known to all of them; per target host (scheme, host and port) and per configured gRPC service; opens on a failure ratio over a rolling window with a minimum sample, admits exactly one probe when the window expires, and doubles the wait up to a cap while probes keep failing. Only server-side failures count — a 404 is the caller's fault and must not open the breaker for everyone else — and an open breaker fails the task **non-terminally**, so backoff, jitter and the retry budget still decide what happens next. Off unless `NODE_FLOW_CIRCUIT_BREAKER` enables it. **Service registry** (✅): an **HTTP integration** — the same administered object as an LLM or MCP server, so it inherits the RBAC, the secret reference and the masking. A task writes `{ service: "billing", path: "/invoices", query: {…} }` and the server supplies the base URL and the credential; the definition holds neither. The service's headers are applied *underneath* the task's, so an author can add a correlation header but cannot overwrite the `Authorization` the integration supplies and send the key elsewhere; a path that climbs out of the base URL is refused; and the SSRF guard still applies to whatever the registry returns. **Method discovery** (✅): `GET integrations/{name}/operations` reads the service's OpenAPI document — inline or by URL, OpenAPI 3 and Swagger 2 — and lists operations with the parameters they take. Discovery, never enforcement: a stale document must not block a call that works. Fetching the document goes through the same SSRF guard, because "an administrator configured it" is not a reason to let the server read `169.254.169.254` and hand back the result. gRPC services deliberately stay operator configuration, for the reason they always did: a proto path and a certificate are not things a definition should carry | Wave 3 |
| API gateway / MCP gateway | Workflows as REST routes and MCP tools, auth configs, CORS, JS transforms | ✅ **MCP gateway** (✅): `/v1/ns/{ns}/mcp` serves every workflow tagged `mcp:tool` that the key may execute, through the ordinary start path; **REST gateway** (✅): `POST /v1/ns/{ns}/api/{workflow}` runs a workflow tagged `api:route` and answers with its **output** — no execution envelope, because a partner's webhook or a front end should not have to learn what an execution is. Query parameters merge into the input (the body wins on a clash), `X-Idempotency-Key` is honoured, and the wait is bounded: a run still going answers **202** with its id rather than failing, because slow is not broken. A failed run is **502**, not 500 — the gateway worked, the thing behind it did not. A workflow shapes its own HTTP reply by returning `_response: { status, headers, body }`, which covers "201 with a Location" without running user JavaScript inside the gateway, the thing products offering "response transforms" end up doing. Exposure is **opt-in by tag** and an untagged workflow answers 404 rather than 403, so the route cannot be used to enumerate a namespace. Authentication is deliberately unchanged — a different *shape*, not a different *door*; anonymous public endpoints are a separate decision with their own blast radius, and this layer does not make it quietly. CORS remains | Wave 3 (with Phase 7) |
| Integrations | Providers + resources (LLMs, vector DBs, brokers, apps) with RBAC | ✅ **LLM, MCP and HTTP integrations** (✅): named per namespace, admin-managed, keys by secret reference, a live test. Brokers and SQL datasources stay operator configuration | Wave 3 (with Phase 7) |
| AI prompts, AI tasks, agents | Prompt studio, 20+ LLM/vector/media/MCP tasks, agent runtime, guardrails | ✅ **Prompt studio** with versions and a live run; LLM text and chat, embeddings, chunking, index and search, MCP list and call, and a durable **AGENT**. Document parsing, image, speech and video generation, and guardrails | Phase 7 |
| Workers / Event monitor | Poll data per worker; consumed events and actions | ✅ Worker poll data (queues page). Event monitor: every (message, handler) pair recorded with an outcome (acted, skipped, failed), the reason, the execution it started and the payload (summarised above 32 KB), kept 7 days. Per-handler health cards, outcome and handler filters, live updates, cursor paging, and a payload drawer. **Send test message** delivers through the real dispatch path, from the handler list or by replaying a monitored message | ✅ Wave 2 |
| BPMN import | .bpmn → workflows | ✅ `POST metadata/workflows/import-bpmn` converts a BPMN 2.0 process into a **draft**, never a registration, and the UI opens it in the editor for a person to finish. Service, user, script, business-rule and call tasks, exclusive and inclusive gateways as `SWITCH`, parallel gateways as `FORK_JOIN`/`JOIN` (merge found by walking branches to their first shared element, so two unrelated splits are never paired), timer events as `WAIT`, terminate end events as `TERMINATE`. Namespace-prefix agnostic, so a Camunda file and a Signavio file read the same. **Everything it cannot convert is reported by name** — a loop it will not guess a `DO_WHILE` from, a gateway that never merges, an element nothing reaches, a Groovy script carried as data rather than handed to a JavaScript sandbox | Wave 3 |
| Launch Pad, Assistant | Home with templates; AI copilot that builds, debugs and searches | ✅ **Overview** home (✅): live running, paused and queued counts; success-rate ring; p50/p95 duration; a throughput chart (completed and failed columns with a started line, hover details); failure hotspots by workflow; recent failures linking to the failed task; and a "Needs attention" list (stalled queues, failed runs, overdue or waiting human tasks, failed events, rate-limited runs). Every figure links to the screen that acts on it, and tagged workflows are filtered out. **Templates** (✅): seven starters, each a working example of exactly one idea — reading another task's output, a human decision, fork and join, saga compensation, polling, looping, retrieval plus a model call. They live in `core` (so the CLI can offer them too) and a test compiles **every one** through the same checker registration uses, because a starter that fails on save teaches the mistake and leaves the reader unsure whether the example or they are wrong. Choosing one opens the editor on a draft; nothing is registered until a person saves **Assistant** (✅): `POST /v1/ns/{ns}/assistant` runs a bounded tool loop over the namespace's own LLM integration, with **read-only tools and no hands** — list and read workflows, search executions, read one execution, validate a draft. It cannot start, retry, terminate or register anything, and a definition it proposes comes back for a person to open in the editor. The caller's permissions are applied by the functions the loop is given, not by the system prompt, so it can never read a workflow its user could not open — a test proves a tag-restricted workflow never reaches it. Every answer shows **what it looked at**, because for a tool whose failure mode is confident invention, a checkable answer is the difference between useful and dangerous | Wave 1 ✅ / Templates ✅ / Assistant ✅ |

**Wave 1 progress.**

- **Failure workflows.** The failure workflow is started through the same outbox path as `START_WORKFLOW`, from both places a run can fail: the decider, and the sweeper that fires whole-workflow timeouts (which never passes through the decider — it would have been missed). Its idempotency key derives from the failed run, so a replayed evaluation or a sweeper racing the decider starts it once. It is not started for TERMINATED: an operator stopping a run on purpose is not a failure to compensate for. A failure workflow that fails does not start itself. Wiring it exposed that `START_WORKFLOW` had never passed its `correlationId` to the run it started — the command carried it, the outbox payload dropped it.
- **Idempotency strategies.** `FAIL` refuses any reuse and names the owning execution; `FAIL_ON_RUNNING` refuses while the owner is live and otherwise hands the key to a new run, conditionally on the owner not having changed, so six concurrent retries of a finished job start exactly one.
- **Environment variables** are a separate store from unsealed secrets on purpose: shown in clear, JSON-capable, editable with `workflows:write`, and resolved when the decider schedules a task — so a SWITCH or loop condition can branch on one, which a dispatch-time secret cannot. Loaded into the pure engine's evaluation state, never read by it.

- **Schema registry.** Building it exposed another stored-and-ignored field: a *workflow's* `inputSchema` was accepted at registration and never checked — only task schemas were. A start now refuses input that breaks it, with a 400 naming the field, before anything is created. A reference is `{ "name": "order" }` or `{ "name": "order", "version": 2 }`; the two shapes cannot be mistaken for an inline JSON Schema (which never has a lone string `name`). References resolve per load, not cached with the task definition, so "latest" follows new versions within five seconds while pinned versions never move.

- **User forms.** A human task's response was never checked against its form on the server — the inbox rendered the form, but a response posted straight to the API was accepted whatever it contained, so a workflow could receive an "approval" with no decision in it. Completion now validates against the task's form and answers 400 naming each violation. A template is copied onto the task when it opens, so editing a form never changes what someone mid-approval is looking at; a reference to a template that does not exist fails that task rather than throwing out of the evaluation (the poison-pill shape again).

- **Assignment chains.** Links are resolved when the task opens — an escalation to a team that does not exist would otherwise surface only when the first window closed, with nobody watching — and an unresolvable link fails that task, not the evaluation. The sweeper takes rows `FOR UPDATE SKIP LOCKED`, so every replica runs it; a task somebody has claimed is never moved; `TERMINATE` at the end of a chain times the task out and leaves what happens next to the workflow's own timeout and retry handling. Reassigning releases any claim, because moving work away from someone without telling them is how two people end up doing it.

- **Admin screens and the audit gap they exposed.** Building the audit page showed that issuing an API key or a service account — the most security-relevant thing an administrator does — was not recorded, nor were changes to workflow and task definitions, users, or human-task reassignment. They are now, and a test proves the issued token never appears in the entry: the interceptor records field names, never values or responses. A create's resource id now falls back to the body's `name`/`email`, so "who created `ci-deploy`?" is searchable.

**Wave 2 progress.**

- **Synchronous execution and signals** — and the two engine bugs their first test found. **A workflow's declared `outputParameters` was never applied**: completion returned the last task's output, which looks plausible in every simple workflow and is wrong in every other. Outputs now resolve from the definition, key by key (a key naming a task in a branch not taken is null, not a failed workflow), and their references join the evaluation prefetch — without that, `${charge.output.id}` on the last task's completion would resolve against nothing. **A WAIT with no duration completed at once** instead of waiting to be told, which is what makes a signal meaningful; one with a timing that does not parse still completes at once, deliberately, so a typo cannot become a workflow waiting forever. Conductor's duration strings (`10m 30s`, `1 day 4 hours`) are understood.
- **Workflow rate limit by key.** Race-tested: with each start holding its transaction open, 12 concurrent starts against a limit of 2 admit exactly 2, and the test fails if the per-key lock is removed. A queued execution ignores stray wakeups, is not reported by the stuck-workflow sweeper, and a paused or terminated waiter is never admitted. **Found on the way: the execution page's "Live" indicator never refreshed on task progress.** The server sends named SSE frames (`event: task.scheduled`), which never reach `onmessage`, so the page only updated when a workflow ended. The client now listens for every event type by name, with a 15s poll as a backstop.
- **Event monitor and test messages.** The first live test message exposed a leak: a handler resolving a malformed workflow id failed with Postgres's raw `invalid input syntax for type uuid` instead of "no workflow … in this namespace". Fixed, with a regression test that fails without the fix. The same pass found that the monitor should never fail a delivery, so monitor rows are written best-effort after the handler acts.
- **Tags dashboard — and an access-control hole it exposed.** Tags were stored per version but protect a workflow by name, which caused two leaks: (1) tagging a workflow by registering a tagged version left every earlier version listable and readable by anyone; (2) registering a new version without restating `tags` made the workflow public again. The editor never sends `tags`, so **every save from the UI stripped a workflow's protection**. Tags now apply to every version, unstated tags are inherited, and a new retag endpoint changes all versions at once. Store and API regression tests fail without the fix.
- **A second tag leak: executions.** Tags protected a workflow's definition and refused starts, but its executions (input, output, history, logs, the live stream) were readable and searchable by anyone with `executions:read`. Execution reads now return 404 for an unreachable tag, the same as a missing execution. Search, correlation lookups, the overview and the SSE stream all filter by tag. The API regression test covers each path and fails without the guard.
- **Webhooks: found on the way.** The JSON body parser never kept the raw bytes, so the existing `WAIT_FOR_WEBHOOK` HMAC check fell back to re-serialised JSON. That can never match a real sender whose whitespace or key order differs. The parser now keeps the raw body, and an API test sending non-canonical JSON with a GitHub signature fails without it. Form-encoded bodies were answered with 415 before any verifier ran; they are now parsed, into objects with no prototype. Handler lookup gained namespace scoping, so a webhook in one namespace can never trigger a handler in another that names the same topic (mutation-checked).
- **Test mode found an engine bug: a `FORK_JOIN` inside a `DO_WHILE` hung forever.** The first simulator run with a loop around a fork stalled, and the live server did the same, sitting at RUNNING indefinitely. The engine treated "a task with this ref has finished" as "already scheduled" regardless of iteration, so the second pass never started. Behind it was a second bug: a join counted the previous iteration's branch results as its own and fired a pass early. Both are fixed (iteration-aware scheduling and join lookups, including dynamic forks), with engine unit tests and an API test that fail without the fix.
- **Responsive shell.** Found while testing Overview at phone width: the fixed 256px sidebar left pages about 130px wide. Below `md` there is now a top bar with a navigation drawer, page gutters are 16px, and the execution task panel becomes a full-screen sheet (its 520px width had pushed its close button off-screen). Verified with no horizontal overflow at 390px on Overview, Executions, Workflows, Event monitor, Queues, Human tasks, Tags and Schedules. A system task that the engine settles itself now shows a real duration instead of "—".
**Order of work.** Wave 1 closes correctness gaps first (a declared failure workflow that never runs is a silent defect, not a missing feature), then the definitions and admin surfaces an operator reaches for daily. Wave 2 is execution semantics that change what integrations can be built. Wave 3 depends on Phase 7's AI plumbing. **Wave 2b** was added by a second pass over the Orkes console once Wave 2 shipped: smaller operator conveniences it offers that the first inventory folded into other rows.

**Wave 3 is now shipped too:** remote services (circuit breaker and an HTTP service registry with OpenAPI discovery), the REST and MCP gateways, integrations, BPMN import, AI prompts, agents, templates and the assistant. **Remaining:** broker/SQL integrations, which stay operator configuration by design. CORS on the REST gateway shipped — an allow-list in `NODE_FLOW_GATEWAY_CORS_ORIGINS`, answered with `Vary: Origin` so a shared cache cannot hand one caller the headers computed for another

### Where this sits in the landscape

The crowded part of this space is *code-first durable execution* — Temporal, Trigger.dev, Inngest, Restate. They all say "write an async function, we make it durable." None of them is what Conductor is.

Conductor's actual differentiators are a **declarative JSON DAG**, **language-agnostic workers** that poll a queue rather than embedding a runtime, and a **visual editor** where the diagram is the source of truth rather than a rendering of code. That model is what multi-language shops and ops users actually buy Orkes for — and nothing in the Node ecosystem offers it self-hosted. Building a Temporal clone would be entering a fight already won; this is an empty room.

Positioning: *Conductor's model, Node's ecosystem, one dependency.* Orkes needs Redis + Cassandra + Elasticsearch to stand up. node-flow needs Postgres.

### Why this is tractable

Netflix published their Conductor 4.0 rework in September 2026 — a rewrite driven by exactly the bottlenecks a naive implementation hits. We start on the far side of those lessons instead of rediscovering them:

- The old engine **loaded the entire running workflow into memory** for each evaluation. 4.0 separates workflow metadata from execution data and loads only the tasks an evaluation needs. Max workflow size went from ~2,500 → 30,000 tasks.
- They **removed distributed locking** by storing pending and terminal task state separately and reconciling in the application layer. Failed lock acquisitions went from ~2,700/interval → ~zero.
- They moved **evaluation off the synchronous request path** into per-workflow exclusive queues processed sequentially.
- They **decoupled indexing from execution** and moved large task payloads to blob storage.

These four ideas are load-bearing below and built in from day one rather than retrofitted.

---

## Non-negotiable design principles

1. **Blueprint ≠ execution.** Definitions are immutable per version and aggressively cached in-process. Execution state is separate and loaded incrementally.
2. **Never load the whole workflow.** An evaluation loads pending tasks plus *only* the terminal task outputs its expressions actually reference — computed statically at registration time.
3. **No distributed lock service.** Per-workflow serialization comes from a Postgres row lock in Phase 1, partition ownership in Phase 8. Never Redlock, never ZooKeeper.
4. **No side effects inside a transaction.** Every outbound action goes through a transactional outbox relay. At-least-once, never lost.
5. **The engine is a pure function, free of every framework.** `decide(blueprint, state) → commands` is synchronous, deterministic, and imports **neither NestJS nor Sequelize**. This is what makes replay, time-travel debugging and a sub-second test suite possible. It is the first thing that will erode under delivery pressure and the most expensive to restore, so CI enforces it.
6. **Explicit transactions, not ambient ones.** Transaction boundaries *are* the correctness model here; they must be visible in the code.
7. **Honest scaling ceiling.** Postgres-as-queue is comfortable into the low tens of thousands of tasks/sec; WAL volume, not lock contention, is the wall.

---

## Architecture

### Process topology

One NestJS application, role-flagged, so components scale independently:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  api         │  │  decider     │  │  poller      │
│  NestJS +    │  │  evaluation  │  │  timers /    │
│  Fastify     │  │  loop        │  │  sweeper /   │
│  REST·gRPC·WS│  │              │  │  outbox relay│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └─────────────────┼─────────────────┘
                   ┌─────┴──────┐
                   │ Postgres 18│  state · queues · timers · outbox
                   └────────────┘
```

`NODE_FLOW_ROLES=api,decider,poller` runs everything in one process for dev; production scales them separately. Roles select which NestJS modules get registered at bootstrap via dynamic modules.

**CPU-bound work never runs on the main event loop.** A `worker_threads` pool handles INLINE JS, JQ transforms and JSONPath over large payloads. This is the most important Node-specific concern — the JVM original gets true parallelism for free and we do not.

### Monorepo layout

```
packages/
  core/       # types, zod schemas, JSON DSL, errors — zero deps, no framework
  engine/     # the decider: PURE state machine. no NestJS, no ORM, no I/O
  store/      # Kysely queries, raw-SQL migrations, repositories, the queue
  tasks/      # system task implementations (HTTP, INLINE, JQ, ...)
  server/     # the NestJS application — all modules below
  sdk/        # worker SDK + typed TS workflow builder + client
  cli/        # `nf` — deploy, run, tail, test, migrate
  ui/         # Next.js + Tailwind + HeroUI v3 dashboard
  testkit/    # workflow unit-test framework + testcontainers helpers
  bpmn/       # BPMN 2.0 import
  bench/      # `nf-bench`, the load harness
  docs/       # the documentation site (Fumadocs) and marketing landing page
docker/
```

Two changes from the original plan, both settled and both load-bearing:

- **There is no `packages/queue`.** The queue is not separable from the state it
  guards — leasing, fencing and task identity are the same transaction — so it
  lives in `store/` (`task-queue.repository.ts`, `queue-notifier.ts`). A
  separate package would have been a boundary with nothing on either side of it.
- **Sequelize and Umzug are gone**, replaced by Kysely and raw-SQL migrations.
  The reasoning below about raw SQL being *the design* is exactly why: an ORM
  whose escape hatch is every hot path is not earning its place. The schema-drift
  test went with it — `schema.ts` makes a mismatch a compile error instead.

`core` and `engine` depend on **nothing**. Enforced in CI by Nx's `@nx/enforce-module-boundaries`, not by convention:

```jsonc
{ "sourceTag": "scope:pure",
  "onlyDependOnLibsWithTags": ["scope:pure"],
  "bannedExternalImports": ["@nestjs/*", "sequelize*", "pg", "umzug"] }
```

This catches both cross-project imports *and* third-party framework imports, which is the failure mode that actually happens.

**pnpm as the package manager** — migrated from npm on 2026-09-12, once Node 24 made corepack's pnpm shim work again.

The motivation was to get a second, non-skippable line of defence for the `scope:pure` boundary. Investigating it turned up something important that is easy to get wrong:

> **pnpm's strict layout alone does not prevent phantom imports.** Module resolution walks *up* the directory tree, so anything declared in the **workspace-root** `package.json` is reachable from every package regardless of package manager. Nx's generators put `@nestjs/*`, `next` and `react` at the root, and with those there, `engine` could `import '@nestjs/common'` and it resolved fine under pnpm too.

The guarantee only holds when **both** things are true:

1. pnpm's isolated `nodeLinker` (never `hoisted`, never `shamefully-hoist`), **and**
2. **every runtime dependency declared in the package that uses it, never at the root.**

The workspace root now carries dev tooling only; `@nestjs/*` lives in `server`, `next`/`react` in `ui` and `docs`. With that in place an undeclared import fails at resolution — verified with a probe file that produced `TS2307: Cannot find module '@nestjs/common'` and a `require.resolve` throw. **Keep the root `dependencies` block empty.** Adding a runtime dependency there silently disables this protection for the entire workspace.

> This has already been broken once, by a generator rather than by a person:
> `nx g @nx/next:application` adds `next`, `react` and `react-dom` to the root
> manifest. Scaffolding the docs and marketing sites put all three back, and
> nothing failed — which is the whole problem, since the protection they defeat
> is itself a thing that fails silently. They were removed again and all three
> Next apps build from their own declarations. **Check the root manifest after
> running any generator.**

The Nx `bannedExternalImports` lint rule remains the primary enforcement; this is belt and braces.

Costs paid, both anticipated:
- NestJS's optional peers (`class-validator`, `class-transformer`, `@nestjs/websockets`, `@nestjs/microservices`) are lazily `require()`d inside `@nestjs/core`, and webpack resolves statically, so it reported them as missing. Handled with an `IgnorePlugin` allowlist in `packages/server/webpack.config.js` rather than by installing packages we do not use. `RealtimeModule` has since landed on **SSE rather than WebSocket** — see the live-stream section for why — so `@nestjs/websockets` stays on that list and stays uninstalled. It comes off when Phase 8 adds push delivery to workers, which genuinely needs a bidirectional transport.
- pnpm blocks dependency build scripts by default. The five we need are allowlisted in `pnpm-workspace.yaml` with a note on what each one is for.

### Identity and authentication

Workers connect from Phase 1, so the authentication seam is built then rather than retrofitted alongside RBAC in Phase 5. A pluggable `Authenticator` chain resolves every request to a `Principal { type, id, namespace, scopes }`, and all authorization decisions read only the Principal — so adding a mechanism later never touches a call site.

| Mechanism | Used by | Phase |
|---|---|---|
| Service account key/secret → short-lived scoped JWT | Worker fleets | **1** |
| API keys — long-lived, revocable, scoped, audited | `nf` CLI, CI pipelines | **1** |
| mTLS client certificates | Zero-trust worker deployments | 5 |
| OIDC workload identity (IRSA / GCP WI / SPIFFE) | Cloud workers, no stored secrets | 5 |
| OIDC / SAML SSO | Humans in the UI | **5 ✅** (both) |

All four worker-facing mechanisms are committed; the two cloud/PKI ones land in Phase 5 because they need the secrets and certificate machinery that phase builds anyway. What matters is that the `Authenticator` abstraction and scope model exist in Phase 1, so those are additions rather than surgery.

Scopes are queue- and workflow-granular: a service account may lease from `train_model` and `score` but not start workflows or read another namespace's executions. **Least privilege is the default** — a new service account can do nothing until scopes are granted.

### Out of scope: artifact and shared-volume management

Shared storage between workers — EFS, S3 Files, NFS — is deliberately **not** a node-flow concern. Users attach whatever volumes they need to their own workers, and pass file paths or URIs as ordinary task input/output values; the engine treats them as opaque data it never dereferences.

This keeps node-flow holding no cloud credentials, provisioning nothing, and portable across infrastructure — a laptop, a VM and an EKS cluster all run the same workflow. The cost is that node-flow offers no artifact lineage, no integrity verification and no memoization, and that workers must agree on paths out-of-band. Revisit only if path-passing proves insufficient in practice.

### NestJS module map (`packages/server`)

```
AppModule
├── ConfigModule          @nestjs/config, env validated with zod at boot
├── DatabaseModule        SequelizeModule.forRootAsync + model registration
├── TelemetryModule       OpenTelemetry, nestjs-pino, Prometheus
├── HealthModule          @nestjs/terminus — liveness/readiness incl. DB + queue depth
├── MetadataModule        workflow-def & task-def CRUD, blueprint compilation
├── ExecutionModule       start / get / search / pause / resume / retry / terminate
├── DeciderModule         [role: decider] the evaluation loop runner
├── QueueModule           worker poll / ack / update / lease renewal endpoints
├── TaskExecModule        system task registry + executors (+ worker_threads pool)
├── TimerModule           [role: poller] durable timer poller
├── OutboxModule          [role: poller] transactional outbox relay
├── EventsModule          event handlers (Kafka/NATS/SQS/AMQP) + incoming webhooks
├── SchedulerModule       [role: poller] cron triggers
├── AuthModule            guards, RBAC, API keys, OIDC/SAML
├── SecretsModule         envelope encryption, KMS/Vault backends
└── RealtimeModule        SSE execution streaming (built; see Phase 6 for the SSE-over-WebSocket reasoning)
```

Controllers stay thin: validate, delegate to a service, map to DTO. Services own orchestration logic. Repositories in `store/` own all SQL. The decider and pollers are **not** HTTP concerns — they are `OnApplicationBootstrap` runners with their own lifecycle and graceful shutdown via `OnApplicationShutdown`.

`@nestjs/schedule` is deliberately **not** used for timers or cron. It is in-process and uncoordinated; with more than one replica every schedule would fire N times. Our scheduler is database-backed and leased.

### API shape

The primary API is **namespace-first and designed on its own merits**, not inherited from Conductor:

```
POST   /v1/ns/{ns}/workflows/{name}/executions      start (idempotency-key aware)
GET    /v1/ns/{ns}/executions/{id}                  full execution
GET    /v1/ns/{ns}/executions/{id}/status           lightweight status
POST   /v1/ns/{ns}/executions/{id}:pause|:resume|:terminate|:retry|:rerun
POST   /v1/ns/{ns}/executions/search                structured query, not a query-string DSL
POST   /v1/ns/{ns}/queues/{queue}/lease             batch lease (replaces poll)
POST   /v1/tasks/{id}/heartbeat                     lease renewal
POST   /v1/tasks/{id}:complete|:fail                fencing-token guarded
GET    /v1/ns/{ns}/metadata/workflows               definitions, versioned
WS     /v1/ns/{ns}/executions/{id}/stream           live execution updates
```

Conductor's `/api/*` surface is **not** implemented in Phase 1. It arrives in Phase 9 as a thin translating layer over the same services, so existing Conductor SDKs work with only a base-URL change. Deferring it keeps legacy shapes (query-string search DSL, ack semantics, poll-only delivery) from leaking into the core design, at the cost of no drop-in migration until Phase 9. The `/v1` API is versioned from the first commit precisely so the compat layer can be additive rather than a rewrite.

### Stack

Versions verified against npm on 2026-09-12.

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node 24.19.0** via `.nvmrc` | Node 20 is EOL — see toolchain note |
| Monorepo | **Nx 23.2 + pnpm 11.5.1** | Tag-based boundaries; strict linking as a second defence |
| Database | **Postgres 18** | `uuidv7()` and async I/O — see Data model |
| Language | **TypeScript 6.0.3** to build, TS 7 `tsgo` to type-check | See below |
| Framework | **NestJS 12.0.1** on `@nestjs/platform-fastify` | Modules/DI at this size, Fastify throughput underneath |
| Data access | **Kysely 0.29.5 + `pg`** — no ORM | See below; in this system SQL *is* the design |
| Migrations | Raw SQL, own migrator | Partitioning and `uuidv7()` defaults have no builder expression |
| Validation/docs | `zod` 4.6 + `@nestjs/swagger` 12.0.1 → OpenAPI 3.1 | One source of truth for DSL types, validation, docs |
| Build | `nest build --builder swc` (`@swc/core` 1.16.2) | Substantially faster than tsc; tsc still used for type-check |
| Tests | `vitest` 5.0 + `unplugin-swc` 1.6.0 + `testcontainers` 12.1 | See decorator-metadata note |
| Sandbox | `quickjs-emscripten` 0.32 | See below |
| JQ / expressions | `jq-web` (wasm), `jsonpath-plus` 10.4 | No native addon; Conductor `${...}` compatibility |
| HTTP client | `undici` 8.10 | Pooling, per-host caps |
| Telemetry | `nestjs-pino`, `@opentelemetry/sdk-node` | — |
| UI | `next` 16.3, React 19, `tailwindcss` 4.3, **`@heroui/react` 3.2.5**, `@xyflow/react` 12.11 | HeroUI v3 components; React Flow for the DAG |
| AI tasks | `ai` 7.0 (Vercel AI SDK) | One interface across LLM providers |

**Toolchain — the runtime must move off Node 20.** Node 20 reached **end of life on 30 April 2026**: the currently installed 20.19.4 receives no further security patches. Node 22 is already Maintenance LTS and EOLs in April 2027; **Node 24 is Active LTS until April 2028** and is the right target for a project starting now. nvm already has **24.19.0** installed locally, so `nvm use 24` plus a committed `.nvmrc` settles it.

**TypeScript version — we cannot use the latest, and this is not a preference.** `@nestjs/cli@12.0.0` declares `"typescript": "~6.0.2"` as a direct dependency. TypeScript 7.0.2 (the native Go compiler) dropped the **programmatic Compiler API** — `createProgram`, `getParsedCommandLineOfConfigFile`, `getPreEmitDiagnostics` — which the Nest CLI calls, so with TS 7 installed `nest build`, `nest start` and `--watch` all fail outright, as do the `@nestjs/swagger` CLI plugin and type-aware ESLint. The tracking issue (nest-cli #3479) is open with no published timeline. So: **build on 6.0.3**, the newest release the Nest CLI accepts, and optionally run TS 7 purely as a fast type-checker alongside. It becomes a one-line flip when Nest ships support.

**Testing — two runners, deliberately.** Vitest transpiles with esbuild, which **does not emit decorator metadata**. Pointed at NestJS as-is, DI does not throw — it silently resolves dependencies to `undefined` and tests fail in confusing, unrelated ways.

Rather than fight that with `unplugin-swc`, we split by what each package actually is:

| Package | Runner | Why |
|---|---|---|
| `core`, `engine`, `store`, `queue`, `tasks`, `sdk`, `cli`, `testkit` | **Vitest** | No decorators anywhere, so esbuild is safe and the suite stays fast — which matters most for the engine, the suite we run constantly |
| `server` (NestJS) | **Jest + `@swc/jest`** | SWC emits decorator metadata correctly; this is what `@nx/nest` generates by default and it sidesteps the trap entirely |
| `ui` (Next.js) | **Vitest** | React, no decorators |

The pure packages are the ones whose tests must be instant, and they are exactly the ones that can use the fast path. Nothing is lost.

**Sequelize and the hot path.** Sequelize 6 is right for models, associations, migrations and ordinary CRUD. It is the wrong tool for the decider and queue, which need `SELECT … FOR UPDATE SKIP LOCKED` inside CTEs, `INSERT … ON CONFLICT DO NOTHING`, partitioned tables and `uuidv7()` defaults. Those live behind a small set of repository methods using `sequelize.query()` with bound replacements and an explicit transaction. **Raw SQL never leaves `store/`.** Sequelize v7 is still alpha after several years and `@nestjs/sequelize@12` does not accept it, so v6 is both the stable and the only supported option.

**Transactions are explicit.** `nestjs-cls` / `@nestjs-cls/transactional` would propagate transactions ambiently through AsyncLocalStorage, and for ordinary CRUD apps that is a nice ergonomic win. We are deliberately not using it on the engine path. In an orchestrator the transaction boundary *is* the correctness guarantee — which statements commit together is the whole design — and making that invisible is how subtle, unreproducible bugs get written. Repositories take an explicit `tx` parameter.

**INLINE sandbox.** `isolated-vm` is faster, but it had a critical type-confusion sandbox-escape CVE in August 2026 (fixed in 7.0.1) and it is a native addon running untrusted user JS inside a multi-tenant control plane. Default to `quickjs-emscripten`: WASM memory-model isolation means there is no host object graph to escape into, plus clean CPU/memory limits via the interrupt handler. `isolated-vm` stays an opt-in fast path for trusted single-tenant deployments. `vm2` is abandoned and `node:vm` is not a sandbox.

---

## Data model

**Postgres 18 is the baseline**, and two of its features are load-bearing rather than incidental:

- **`uuidv7()`** — time-ordered UUIDs. `WorkflowExecutions` and `TaskExecutions` are the hottest insert tables; random UUIDv4 keys scatter btree inserts across the whole index and cause severe page splits at this write rate. UUIDv7 keeps inserts at the right edge.
- **Async I/O** — 2–3× on sequential scans and **vacuum**. Vacuum throughput on the queue tables is the exact pressure point of a Postgres-backed queue.

```
Namespaces          (id, slug, settings)

WorkflowDefinitions (namespaceId, name, version, definition JSONB,
                     blueprint JSONB, createdAt, createdBy)
                    PRIMARY KEY (namespaceId, name, version)   -- immutable

TaskDefinitions     (namespaceId, name, retryCount, retryLogic, retryDelaySeconds,
                     backoffScaleFactor, maxRetryDelaySeconds, retryBudget,
                     timeoutSeconds, scheduleToStartTimeout, startToCloseTimeout,
                     heartbeatTimeout, responseTimeoutSeconds, pollTimeoutSeconds,
                     timeoutPolicy, concurrentExecLimit, rateLimitPerFrequency,
                     rateLimitFrequencySeconds, inputSchema JSONB, outputSchema JSONB)

WorkflowExecutions  (id UUID DEFAULT uuidv7(), namespaceId, defName, defVersion,
                     status, correlationId, idempotencyKey, priority,
                     input JSONB | inputRef, output JSONB | outputRef,
                     variables JSONB, parentWorkflowId, parentTaskId,
                     startedAt, updatedAt, endedAt, version BIGINT)
                    PARTITION BY RANGE (startedAt)             -- monthly

TaskExecutions      (id UUID DEFAULT uuidv7(), workflowId, refName, taskDefName,
                     taskType, status, attempt, iteration, parentRefName,
                     input JSONB | inputRef, output JSONB | outputRef,
                     reasonForIncompletion, workerId,
                     scheduledAt, startedAt, endedAt)
                    PARTITION BY HASH (workflowId)
  INDEX ("workflowId") WHERE status NOT IN (terminal…)         -- the pending frontier
  UNIQUE ("workflowId", "refName", iteration, attempt)   -- attempt is part of identity

TaskQueues          (id BIGSERIAL, namespaceId, queueName, taskId, priority,
                     visibleAt, leaseExpiresAt, leaseToken UUID, workerId)
                    PARTITION BY HASH (queueName)
  INDEX ("queueName", priority DESC, id) WHERE "leaseExpiresAt" IS NULL

DecideQueues        (workflowId UUID PRIMARY KEY, enqueuedAt)  -- dedupe key
Timers              (id, fireAt, kind, workflowId, taskId, payload JSONB)
                    PARTITION BY RANGE (fireAt)                -- hourly; drop old
Semaphores          (namespaceId, name, permits, holderTaskId, leaseExpiresAt)
OutboxEvents        (id BIGSERIAL, topic, payload JSONB, createdAt, publishedAt)
WorkflowEvents      (id BIGSERIAL, workflowId, seq, type, payload JSONB, at)
                    PARTITION BY RANGE (at)                    -- audit + replay
```

**Naming follows Sequelize's defaults — we set no explicit table or column names.** Model classes are PascalCase and Sequelize pluralises them into table names (`OrganizationMember` → `OrganizationMembers`), and attributes stay camelCase rather than being mapped to snake_case.

The consequence to internalise early: **PostgreSQL folds unquoted identifiers to lowercase**, so PascalCase and camelCase identifiers must be double-quoted in every raw statement. `SELECT * FROM TaskQueues WHERE queueName = $1` silently becomes `taskqueues`/`queuename` and errors. Since our entire hot path is hand-written SQL, this is a standing trap rather than a one-off: every raw query and every Umzug migration quotes its identifiers, and a lint check in CI rejects raw SQL in `store/` containing an unquoted capital-letter identifier.

sequelize-typescript models mirror these for CRUD and associations. The partitioning, partial indexes and `uuidv7()` defaults are declared in **Umzug raw-SQL migrations**, which are the source of truth for DDL; model definitions are kept in sync and verified by a schema-drift test.

### The blueprint — how we avoid loading the whole workflow

At registration a definition is **compiled** into a blueprint stored alongside it:

- a flattened node graph with resolved successor edges (fork branches, switch cases, loop bodies pre-linked);
- for each node, the **static set of task refs its input expressions reference** (`${charge.output.txnId}` → `charge`).

That second item makes incremental evaluation possible. When scheduling a task the decider batch-fetches exactly the referenced terminal rows by `("workflowId", "refName")` — an indexed point lookup per ref, memoized per evaluation. Cost is O(refs used), not O(tasks in workflow), so a 30,000-task workflow evaluates as cheaply as a 5-task one. Blueprints are immutable per `(name, version)` and held in an LRU cache; immutable versions are why cache invalidation never becomes a problem.

### Payload offload

Any input/output over a threshold (default 256 KB) is written to blob storage and the row stores a ref. Local filesystem driver by default, S3/GCS/Azure adapters.

The engine sees a uniform `Payload` type, and the **evaluator resolves every ref before the decider runs** — not lazily. Lazy resolution was the original intention and it is unsafe here: the decider reads an unresolved ref as *absent* rather than failing, so a `${...}` over an offloaded output silently evaluates to undefined and the workflow takes the wrong branch while reporting success. Resolution is eager and exhaustive; the threshold exists to keep that cost rare.

---

## The decider

```
decide(workflowId):
  BEGIN
    DELETE FROM "DecideQueues" WHERE "workflowId" = $1          ← claim BEFORE reading
    wf ← SELECT … FROM "WorkflowExecutions" WHERE id = $1 FOR UPDATE ← serializes
    if terminal(wf.status): COMMIT; return
    bp ← blueprintCache.get(wf.defName, wf.defVersion)
    pending ← SELECT … FROM "TaskExecutions"
              WHERE "workflowId" = $1 AND status NOT IN (terminal)    ← partial index
    refs ← bp.staticRefsFor(pending)                                  ← batch point lookups
    cmds ← engine.decide(bp, wf, pending, refs)                       ← PURE, no I/O
    apply(cmds)  -- insert TaskExecutions, enqueue, set timers,
                 -- append WorkflowEvents, write OutboxEvents
  COMMIT
  -- relay publishes outbox entries after commit
```

The `FOR UPDATE` row lock gives per-workflow serialization with Postgres as the coordinator — correct, crash-safe, zero extra infrastructure. Phase 8 replaces it with partition ownership when a single primary's lock throughput becomes the ceiling.

Evaluation is **triggered, never polled**: task completion, timer fire, signal, or `PUT /workflow/{id}/decide` inserts into `DecideQueues` with `ON CONFLICT DO UPDATE`.

> **`DO UPDATE`, not `DO NOTHING`.** This said `DO NOTHING` for most of the
> project's life and it was wrong in a way that cost real workflows. A
> conflicting `DO NOTHING` **takes no lock**, so a completing branch could find
> the row already there, do nothing, and commit — while a decider that had
> already claimed and read the frontier never saw it. `DO UPDATE` writes the
> `reason` column, which takes the row lock and serialises the two. The load
> harness found this; see the lost-wakeup section below.

### The lost-wakeup race — and the ordering rule that prevents it

Dedupe plus concurrency creates a specific silent failure that strands workflows:

> Task A completes and enqueues a decide request. A decider reads the pending set. Task C (a parallel branch) then completes and tries to enqueue — but the dedupe row still exists, so the insert is a no-op. The decider finishes having never seen C. **No further wakeup ever comes and the workflow hangs forever.**

The rule: **claim the decide request before reading any state.** Any completion landing after the claim finds no row, inserts successfully, and earns its own evaluation. One landing between claim and read is both seen *and* re-enqueues, producing one redundant pass.

That asymmetry is the point: **redundant evaluations are free, lost evaluations are fatal.** Every ambiguous case resolves toward scheduling another pass. This requires evaluation to be idempotent, which the `UNIQUE ("workflowId", "refName", iteration, attempt)` constraint guarantees.

> `attempt` is part of that key and has to be. Without it a `RetryTask` inserted
> at the same `(workflowId, refName, iteration)` as the attempt it superseded,
> the conflict clause absorbed it, and the decider reported scheduling a retry
> that never existed.

Keeping the claim *inside* the transaction is what makes it crash-safe — a rollback restores the claim row, so the wakeup survives a mid-evaluation crash. The cost is that a concurrent inserter briefly blocks on the unique index; a fair trade for needing no recovery path.

As defence in depth, a low-frequency sweeper finds workflows that are non-terminal with no pending tasks, no pending timers and no `DecideQueues` entry — the signature of a stuck workflow — and re-enqueues them. It should never find anything; a hit raises an alert, because it means a real correctness bug.

### Operator representation

Each operator is an `OperatorHandler` in `engine/`: given its node and the current frontier, return commands. Resolved incrementally, never expanded eagerly.

| Operator | Approach |
|---|---|
| `SWITCH` | Evaluate case expression; schedule only the taken branch; mark others `SKIPPED` |
| `FORK_JOIN` | Schedule all branch heads; `JOIN` waits on named branch tips |
| `FORK_JOIN_DYNAMIC` | Branch list resolved at runtime from a task output; materialized lazily |
| `JOIN` / `EXCLUSIVE_JOIN` | Completion counter over branch tips; exclusive takes first non-skipped |
| `DO_WHILE` | `iteration` column; body re-materialized per pass. **Only the current iteration is ever loaded** |
| `SUB_WORKFLOW` | Child execution with `parentWorkflowId`; completion enqueues a decide on the parent |
| `DYNAMIC` | Task name resolved from an expression at schedule time |
| `SET_VARIABLE` / `GET_WORKFLOW` / `TERMINATE` / `YIELD` | Direct state manipulation |

### Failure semantics

- **Retries** — `FIXED` / `LINEAR_BACKOFF` / `EXPONENTIAL_BACKOFF` with `backoffScaleFactor`, **plus jitter by default** (Conductor omits it; synchronised retry storms are a real production failure mode).
- **Response timeout** — worker took the task then went silent; lease expiry requeues or fails per `timeoutPolicy`.
- **Task/workflow timeout** — durable timers.
- **Crash mid-evaluation** — transaction rolls back, decide-queue entry survives, another decider picks it up. Nothing is lost because no side effect ever escaped the transaction.
- **At-least-once side effects** — inherent. Documented honestly; idempotency keys on task execution, and the SDK makes worker idempotency easy.
- **Sub-workflow failure** propagates per policy.
- **Compensation/saga** — first-class: a task declares `compensateWith`, and failure unwinds completed tasks in reverse. Conductor makes you hand-roll this.

---

## Execution controls — concurrency, timeouts, retries, limits

This is the part of an orchestrator that decides whether it survives contact with production, so every control is specified explicitly: what it bounds, where it is enforced, and what happens when it trips. Anything enforced only in the SDK is advisory and will be bypassed; **everything below is enforced server-side.**

### Concurrency

| Control | Scope | Enforced at | Behaviour when exceeded |
|---|---|---|---|
| `maxConcurrentExecutions` | Workflow definition | Workflow start | Queue, or reject per policy |
| `maxConcurrentTasks` | Workflow **instance** | Task scheduling | Hold in decider; bounds fork-join fan-out blast radius |
| `concurrentExecLimit` | Task definition (global) | Dequeue | Task stays queued; no worker gets it |
| `maxConcurrent` | Worker process | SDK lease batch + server lease count | Worker leases no more until one completes |
| `maxConcurrentExecutions` | Task **domain** | Dequeue | Isolates a tenant/fleet's share of a task type |
| Namespace quota | Tenant | Workflow start + dequeue | Reject with `429`, surfaced in metrics |
| **Named semaphore / mutex** | Arbitrary, user-defined | Task scheduling | N holders of `db-migration` cluster-wide; a mutex is a semaphore of 1 |

Named semaphores are a deliberate addition. Conductor's per-task-def limit cannot express "these six *different* tasks across three workflows may not exceed four concurrent hits on a fragile legacy API." A `Semaphores` table with lease-based holders, released transactionally on task completion or lease expiry, does.

Every counter is a row in Postgres updated inside the same transaction as the state change it guards, so a crash can never leak a permit. Counters are reconciled by the same sweeper that finds stuck workflows.

### Timeouts

Conductor conflates "waiting for a worker" with "worker is running it." We separate them, which is what makes a slow queue distinguishable from a hung worker:

| Timeout | Clock starts | Clock stops | Typical failure it catches |
|---|---|---|---|
| `scheduleToStartTimeout` | Task enqueued | Worker leases it | No workers running; wrong domain; starved queue |
| `startToCloseTimeout` | Worker leases it | Worker reports terminal | Worker is slow or wedged |
| `heartbeatTimeout` | Last heartbeat | Next heartbeat | Long-running task whose worker died mid-execution |
| `responseTimeoutSeconds` | Worker leases it | Any status update | Conductor-compatible alias over the lease |
| `timeoutSeconds` (task) | Task scheduled | Task terminal | Total task budget, end to end |
| `timeoutSeconds` (workflow) | Workflow start | Workflow terminal | Whole-workflow budget |
| `pollTimeoutSeconds` | Long-poll opened | Server releases | Bounds held connections |
| HTTP connect / read / total | Per system-task request | Response | Hung downstream dependency |

`timeoutPolicy` per task and workflow: `ALERT_ONLY` (fire an event, keep running), `RETRY` (count against the retry budget), `TIME_OUT_WF` (fail the workflow). Every timeout is a durable timer row, so a server crash cannot lose one.

### Retries

| Setting | Meaning |
|---|---|
| `retryCount` | Maximum attempts after the first |
| `retryLogic` | `FIXED` · `LINEAR_BACKOFF` · `EXPONENTIAL_BACKOFF` |
| `retryDelaySeconds`, `backoffScaleFactor` | Base delay and growth rate |
| `maxRetryDelaySeconds` | **Cap** — exponential backoff without one eventually schedules retries days out |
| `jitter` | Proportional randomisation, **on by default** |
| `retryOn` / `nonRetryableErrors` | Error classes that retry vs fail immediately |
| `FAILED_WITH_TERMINAL_ERROR` | Worker signals "never retry this" |
| `retryBudget` | Per task-def ceiling on the *share* of executions that may be retries |

The retry budget is the control that prevents the classic cascading failure: a downstream dependency degrades, every task starts retrying, and the retry traffic keeps it down. Once retries exceed the configured fraction of throughput, the budget trips, further retries fail fast, and an event fires. Conductor has no equivalent.

Poison tasks — those exhausting `retryCount` — go to a dead-letter queue with full context, inspectable and replayable from the UI rather than silently lost.

### Rate limiting and backpressure

- `rateLimitPerFrequency` / `rateLimitFrequencyInSeconds` per task definition — a token bucket checked at dequeue.
- Per-namespace and per-service-account API rate limits, returning `429` with `Retry-After`.
- **Admission control**: when queue depth or decider lag crosses a threshold, new workflow *starts* are rejected before in-flight work is degraded. Shedding at the front door is the only load-shedding that preserves correctness.
- **Circuit breakers** on system tasks (HTTP, gRPC) per target host, so one dead dependency cannot consume the whole worker pool. ✅ Implemented and shared across those tasks; per process rather than cluster-wide, because a shared breaker would need a second dependency to protect against a dependency being down. `JDBC` is excluded deliberately: a datasource already has a bounded pool and a statement timeout, which is the same protection by another name.
- Queue depth, decider lag and lease-expiry rate are first-class metrics with alert thresholds, because these are the leading indicators of every incident this system will have.

### Precedence

Where controls overlap, the **most restrictive wins**, evaluated namespace → workflow → domain → task → worker. Every rejection records which control tripped, so "why is my task not running?" is answerable from the execution view rather than by reading server logs.

---

## Queueing

```sql
WITH c AS (
  SELECT id FROM "TaskQueues"
  WHERE "queueName" = $1 AND "visibleAt" <= now() AND "leaseExpiresAt" IS NULL
  ORDER BY priority DESC, id
  FOR UPDATE SKIP LOCKED LIMIT $2
)
UPDATE "TaskQueues" q
   SET "leaseExpiresAt" = now() + $3, "leaseToken" = $4, "workerId" = $5
FROM c WHERE q.id = c.id RETURNING *;
```

- **Long-poll** — worker polls with a timeout; on empty the server parks on `LISTEN` plus an in-process emitter and retries on notify. **Push** via gRPC/WebSocket streaming is also offered; Conductor's poll-only model wastes a lot of round trips.
- **Leases** — `leaseToken` is a fencing token. A worker whose lease expired cannot complete its task; the update is rejected. This is what makes lease expiry safe.
- **Task domains** — `queueName = taskDefName[:domain]`.
- **Rate limits / concurrency caps** — token-bucket table checked at dequeue; `concurrentExecLimit` via an `IN_PROGRESS` counter.
- **WAL is the wall, not locking.** Mitigations from day one: hash partitioning, low `fillfactor`, aggressive per-table autovacuum shipped in the migration, drop-partition cleanup. An opt-in `UNLOGGED` queue table is safe because `TaskExecutions` is the source of truth and the queue is rebuildable on restart.

### Timers at scale

`Timers` is range-partitioned hourly. The poller scans only the leading partition with an index range scan on `fire_at`, batching with `SKIP LOCKED`. Old partitions are dropped, not deleted. Millions of pending timers stay cheap because the working set is always the current hour.

---

## Phases

Each phase is independently shippable and leaves the system releasable.

### Phase tracker

Last verified **2026-09-16** against a full `nx run-many -t build test lint typecheck` from a cleared `dist/`, `.next/` and `*.tsbuildinfo` — 1,017 tests green, with no failed suites.

Legend: **✅** built and tested · **🟡** partial, gap named · **⬜** not started.

| Phase | Status | Where it stands |
|---|---|---|
| 0 — Foundation | ✅ **Done** | Toolchain, boundaries, CI, Postgres 18 all verified from a clean tree |
| 1 — Core engine | ✅ **Done** | Engine, API, auth, operator control, OpenAPI, `nf bootstrap`, long-poll, worker SDK, search and metrics. Push delivery deferred to Phase 8 |
| 2 — Complete DSL | ✅ **Done** | Every operator including `YIELD`, saga compensation, JSONPath and the typed TypeScript builder. **`SUB_WORKFLOW` only became functional end to end in Phase 3** — it emitted the right commands all along, but nothing started the child or reported it back |
| 3 — System tasks | ✅ **Done** | Every system task runs, plus both webhook directions. `UPDATE_SECRET` deferred to Phase 5, which builds the secrets store it writes to |
| 4 — Triggers and eventing | ✅ **Done** | Leased cron scheduler and inbound event handlers both done and proven across two replicas. Kafka, NATS, AMQP (RabbitMQ) and SQS are all sources and sinks, with consumers that follow the handler table without a restart. **Redis Streams** is done too: a stream rather than pub/sub (which drops anything sent while nobody listens), consumed through a **consumer group** so replicas share work instead of each starting the same workflow, with `XAUTOCLAIM` taking over entries a dead replica left pending and no acknowledgement until dispatch succeeds. External payload storage pulled forward into Phase 1 |
| 5 — Control plane | ✅ **Done** | Namespace isolation, machine and human credentials, **OIDC single sign-on**, sealed secrets and task output, groups carrying scopes and tag grants, an append-only audit log, per-tenant quotas, mTLS and OIDC workload identity, tag-based resource access, and **SAML 2.0** alongside OIDC — the signatures a reviewed library’s, the request binding ours |
| 6 — UI | ✅ **Done** | A modern HeroUI console (own theme, light and dark, ⌘K) on **every** screen, now responsive down to phone width (a top bar with a nav drawer; the task panel becomes a full-screen sheet). Execution detail has a side task panel (attempts, re-run and skip, reason, logs, input and output, definition), timeline, events, a Messages tab, **find-a-task on the canvas**, skipped branches drawn apart from the path taken, a **linked "Triggered by"** (parent, failure of, started by, schedule, webhook, event) and a **"Failure workflow" link** from a failed run. Also: Overview home, executions search with bulk actions, workflow editor with a **Test** tab, task definitions, schedules, queues, human-task inbox, event handlers, webhooks, event monitor, and admin screens (users, groups, tags, applications, secrets, audit). **Compare versions** in the editor: any two versions, or a version against unsaved edits. It gives a task-level summary (added, removed, and changed with the fields that changed) plus a unified line diff over key-sorted JSON, showing only the changed regions with line numbers. All verified in a browser |
| 7 — AI / agents | ✅ Done | Integrations (OpenAI, Anthropic, Gemini, any OpenAI-compatible server; MCP over streamable HTTP), versioned prompts, LLM text and chat, embeddings, chunking, pgvector-or-SQL vector indexes, MCP client tasks, a durable `AGENT` whose tools are MCP tools, workflows and indexes, and **workflows as MCP tools**. UI: Integrations, Prompt studio, Vector indexes, AI tasks in the editor, and an agent step view. Also document parsing (PDF, HTML, JSON, text, SSRF-guarded on every redirect), image, speech and video generation (video as a durable start-then-poll task that yields between checks), and guardrails (PII redaction, blocked terms in and out, size caps) |
| 8 — Scale and pluggability | ✅ **Done, with two items measurement-gated** | **Load harness** (`nf-bench`) driving a real server, with chain and fan-out profiles and open/closed pacing; it found and measured a 3.9× throughput win (decider woken by `NOTIFY`, evaluations run four at a time) and a **lost-wakeup bug** that stranded fan-out joins. **S3 payload storage** behind the `BlobStore` seam. Scope narrowed to **two topologies — Postgres, or Postgres + Redis**; the OpenSearch backend and Kafka/NATS queue backends are dropped rather than deferred. Remaining by decision rather than by omission: **Redis as node-flow's own infrastructure** (throttles, counters, wake-ups — distinct from Redis Streams, which ships as an event source), read replicas and the partition-ownership decider are **gated on a measurement** that says they would help — the harness currently says the limit is CPU in one process, not Postgres |
| 9 — Developer experience | ✅ **Done** | `testkit` `simulate()` and **deterministic `replay()`** (a recorded run re-derived through the engine from its recorded outcomes, against its own version or another, with divergences by task), **time travel** over the execution diagram, a full **`nf` CLI** (workflows, run, executions, tail, replay, export/import, and offline `nf test` for CI), and **generated Python, Go, Java and TypeScript clients**, each compiled and the Python and Go ones exercised against a live server. A **Conductor compatibility layer** at `/conductor/api` completes the phase: an unmodified Conductor SDK registers, starts, polls, works and finishes against node-flow with only a base-URL change |
| 10 — Orkes enterprise parity | ✅ **~95%** | **Shipped:** all of Wave 1 (failure workflows, idempotency, env vars, schema registry, user forms, assignment chains with auto-claim, triggers and operator search, admin screens, audit log with entity-state diffs, sync execution and signals, bulk ops) and all of Wave 2 (CDC / status listeners, task output cache, workflow rate limits by key, event monitor, tags dashboard, masking, webhook verifiers, workflow message queue, test mode), plus fine-grained permissions from Wave 3, all of Wave 2b (scheduler run history, execution search with saved views, taskToDomain at start, definition import/export) and the Overview home. **Wave 3 is shipped too:** remote services (circuit breaker, HTTP service registry with OpenAPI discovery), the REST and MCP gateways, integrations, BPMN import, AI prompts, agents, templates and the assistant. **Remaining:** broker/SQL integrations, which stay operator configuration by design. Gateway CORS shipped: an allow-list in `NODE_FLOW_GATEWAY_CORS_ORIGINS`, answered with `Vary: Origin` so a shared cache cannot hand one caller the headers computed for another |

Package reality, so the tracker cannot drift from it:

| Package | Lines (src, excl. tests) | State |
|---|---|---|
| `core` | ~1,240 | ✅ Complete for Phases 1–2 |
| `engine` | ~2,650 | ✅ Every operator, saga compensation, iteration-aware loops |
| `store` | ~17,900 | ✅ Phase 1 complete; plus event monitor, incoming webhooks, workflow messages, workflow rate limits, overview aggregates, schema registry, forms, environment, users, sessions, groups, schema validation, the system-task runner, webhook callbacks, task deferral, the human-task inbox, event publishing, the Kafka sink and source, the workflow-start handlers, the leased cron scheduler, inbound event handlers, sealed secrets, the queue overview and the workflow-event notifier |
| `server` | ~8,900 | ✅ `/v1` API, machine + human auth incl. SSO and workload identity, health, operator actions, search, metrics, OpenAPI, webhook callbacks, human-task inbox, schedules, event handlers, secrets, groups, quotas, audit, queue overview, live execution streaming |
| `ui` | ~19,000 | ✅ Every console screen (see Phase 6), responsive; Tailwind 4 + HeroUI 3 + React Flow |
| `cli` | ~420 | ✅ `bootstrap`, `create-user`, `migrate`, plus the Phase 9 commands (run, tail, test, replay) |
| `sdk` | ~950 | ✅ Client, worker with long-poll, and the typed workflow builder |
| `tasks` | ~2,360 | ✅ Registry, shared JS sandbox, `HTTP`, `HTTP_POLL`, `WEBHOOK`, `INLINE`, `JSON_JQ_TRANSFORM`, `GET_SIGNED_JWT`, `JDBC`, `gRPC`, `NOOP`, `UPDATE_TASK`, `BUSINESS_RULE` |
| `testkit` | ~350 | ✅ `simulate()` with mocks, retries, loops, forks, sub-workflows and registration rules |

---

#### Phase 0 — Foundation ✅ *(complete)*

| | Item |
|---|---|
| ✅ | Node 24.19 via `.nvmrc`; TypeScript 6.0.3 |
| ✅ | Nx 23.2 + pnpm workspace, `scope:pure` tags |
| ✅ | Purity boundary enforced twice — module resolution *and* `bannedExternalImports` |
| ✅ | NestJS 11 on `@nestjs/platform-fastify`, adapter pinned by an e2e wire-level assertion |
| ✅ | Kysely + raw-SQL migrations (Sequelize/Umzug removed — see *Data access: Kysely, not an ORM*) |
| ✅ | Vitest + Testcontainers, with Docker socket auto-detection |
| ✅ | `.github/workflows/ci.yml`; `docker/docker-compose.yml` with Postgres 18.6 |
| ✅ | **Closed.** `GET /v1/health/ready` reports migrations applied, and `DatabaseModule` migrates at boot. Written without `@nestjs/terminus` — see the deviations below |

#### Phase 1 — Core engine ✅

**The engine half is done.** A workflow runs end to end against real Postgres, drives itself through role-flagged loops, and survives crashes, lease expiry, retry storms and concurrent deciders.

| | Item | Where |
|---|---|---|
| ✅ | Data model — partitioning, partial indexes, `uuidv7()` | `migrations/0001-core-schema.ts`, `0002-payload-refs.ts` |
| ✅ | Pure decider, zero framework imports | `engine/decide.ts` |
| ✅ | Blueprint compiler with static ref analysis | `engine/blueprint.ts` |
| ✅ | Claim-before-read evaluation transaction | `evaluator.ts`, `decide-queue.repository.ts` |
| ✅ | Postgres queue — `SKIP LOCKED`, fencing tokens, lease expiry | `task-queue.repository.ts` |
| ✅ | Transactional outbox + relay + dead letter + replay | `outbox-relay.ts`, `outbox.repository.ts` |
| ✅ | Durable timers; all six timeout classes | `timer.repository.ts`, `timeout-sweeper.ts` |
| ✅ | Retries — backoff, jitter, `maxRetryDelaySeconds`, `nonRetryableErrors`, retry budgets | `core/policies.ts`, `decide.ts` |
| ✅ | Idempotent starts, including under concurrency | `IdempotencyKeys`, `workflow.repository.ts` |
| ✅ | Concurrency — `concurrentExecLimit`, rate limits, named semaphores, workflow caps | `concurrency.repository.ts` |
| ✅ | Worker protocol, server side — lease / heartbeat / report / reclaim | `task-dispatch.service.ts` |
| ✅ | Payload offload + orphan GC | `blob-store.ts`, `payload-store.ts`, `payload-gc.ts` |
| ✅ | Append-only execution history | `workflow-events.repository.ts` |
| ✅ | Partition roll-forward, retention, DEFAULT adoption | `partition-manager.ts` |
| ✅ | Stuck-workflow sweeper (defence in depth) | `stuck-workflow-sweeper.ts` |
| ✅ | Role-flagged runner loops, `NODE_FLOW_ROLES` | `background-runner.ts`, `engine-runners.ts` |

**The server half now exists too.** What remains against the original Phase 1 list is push delivery and OTel tracing, both of which the parity table always placed in Phase 8.

| | Item | Note |
|---|---|---|
| ✅ | `/v1` REST API | `metadata`, `execution`, `queue`, `auth`, `health` controllers |
| ✅ | `ConfigModule` — env validated by zod at boot | No default for anything whose wrong value is silently survivable |
| ✅ | `DatabaseModule` — pool, capability assertion, migrations at boot | |
| ✅ | `HealthModule` — liveness and readiness, deliberately separate | Liveness never touches the database; a shared Postgres blip must not restart the fleet |
| ✅ | `Authenticator` chain; service-account JWT; API keys; queue-scoped authorization | Default-deny, one global guard |
| ✅ | Execution operations — `pause` `resume` `terminate` `retry` `rerun` `skipTask` `decide` `cancelTask` `rerunTasks` | `ExecutionControlService`, each under the workflow row lock |
| ✅ | Namespace isolation at the edge *and* in the repositories | |
| ✅ | Worker SDK — long-poll, heartbeat, concurrency, graceful drain | `sdk/client.ts`, `sdk/worker.ts` |
| ✅ | Long-poll via `LISTEN`/`NOTIFY` | An idle worker costs one connection and no queries; a task starts within a millisecond |
| ⬜ | Push delivery (gRPC/WebSocket streaming) | Long-poll covers the latency case; push is a Phase 8 throughput concern |
| ✅ | OpenAPI 3.1 document at `GET /v1/openapi.json` | Routes from the router, schemas from the zod objects, scopes from the guard's metadata |
| ✅ | `nf bootstrap` | Creates the first namespace and credential against an empty database |
| ✅ | Namespace API | `POST /v1/namespaces` creates one and optionally mints its first key, under `platform:admin` — the one scope `admin` deliberately does not satisfy, so a tenant's administrator can neither create tenants nor enumerate them |
| ✅ | Search and correlated lookup | Keyset pagination; `search.repository.ts` |
| ✅ | Prometheus metrics | Nine engine gauges plus per-runner counters, under a `metrics:read` scope |
| ✅ | OpenTelemetry tracing | Off unless `NODE_FLOW_OTEL_ENABLED=true`; HTTP and `pg` instrumented, and the run's `traceparent` is **stored with the execution and handed back on lease**, so one trace spans the API call, the engine and the worker |
| ✅ | **Task domains** | `taskDefName[:domain]`, recorded on the task row, honoured on retry and in the dispatch-policy lookup |

#### Phase 2 — Complete DSL ✅

| | Item |
|---|---|
| ✅ | `SWITCH` `FORK_JOIN` `FORK_JOIN_DYNAMIC` `JOIN` `EXCLUSIVE_JOIN` `DO_WHILE` `DYNAMIC` `SUB_WORKFLOW` `START_WORKFLOW` `TERMINATE` `SET_VARIABLE` `GET_WORKFLOW` `NOOP` |
| ✅ | `${...}` expression engine + static reference extraction |
| ✅ | Blueprint compiler, immutable per `(name, version)`, 30k-task compile covered by a timing test |
| ✅ | Workflow versioning — `metadata.repository.ts` |
| ✅ | Named semaphores — landed early, in Phase 1 |
| ✅ | `YIELD` — waits IN_PROGRESS for a signal (`POST /executions/:id/signal`, found by default alongside WAIT), whose output later tasks read; a **Resume** dialog in the execution task panel; mockable in test mode. Before this it hung forever: nothing could resume it |
| ✅ | JSONPath in `${...}` — a sandbox-free evaluator in the pure engine: `[n]`, `[-1]`, `['quoted.key']`, `[*]`, `..`, unions, slices, `[?(@.field op literal)]` filters and `.length()`. Definite paths yield values, selecting paths arrays. Unit-tested and proven end to end. It was a silent gap: `${x.output.items[0].id}` resolved to nothing |
| ✅ | Typed TypeScript builder in `sdk` — `workflow<Input>()` with `simple`, `http`, `inline`, `wait`, `yield`, `human`, `subWorkflow`, `setVariable`, `terminate`, `switch`, `fork`, `loop` and `compensation`. References are typed proxies that serialise to `${...}` (indexes and `.length()` compile to JSONPath), so a misspelt field is a **compile error**, enforced by `@ts-expect-error` lines in the spec that break the typecheck if they ever compile. `build()` validates against the DSL schema, and the tests run built workflows (switch, fork, loop, saga) through the real engine |
| ✅ | Saga / compensation — `compensateWith` (a task, or a task-definition name that receives the original input and output). When a run fails (FAILED or TIMED_OUT, never an intentional TERMINATED), completed compensable tasks are undone one at a time, most recent first, with nothing else scheduled meanwhile. Then the run fails with the original reason and what was compensated; a failed compensation (after its own retries) fails the run with both reasons. State lives in the visible `__compensation` variable. The field was declared before and silently ignored. Proven in the simulator (mutation-checked) and end to end on Postgres; editable in the task form |
| ✅ | Bulk pause/resume/retry/terminate — `POST /executions/bulk/:action`, up to 1000 ids, per-id outcome |
| ✅ | **Schema validation on I/O** — enforced with Ajv; input at schedule time, output at report time |

#### Phases 7–9

| Phase | Blocked on / note |
|---|---|
| 7 — AI / agents | Needs Phase 3's task registry, which is done |
| 8 — Scale and pluggability | The Redis topology and read replicas remain; the decider is still on row locks (correct, and the plan’s design) |
| 9 — Developer experience | Complete: `testkit` `simulate()` and `replay()`, time travel, the full `nf` CLI, generated Python, Go, Java and TypeScript clients, and the Conductor compatibility layer |

#### Cross-cutting: two settings that were stored and silently ignored — now closed

The earlier audit found six of these and fixed them all; the tracker surfaced two more, and both are now fixed:

- ~~**Task domains**~~ — routed, recorded on the task row, and honoured on retry and in the dispatch-policy lookup.
- ~~**`inputSchema` / `outputSchema`**~~ — enforced on input at schedule time and on output at report time.

Leaving them recorded-but-open was a mistake worth naming: a setting the system accepts, validates, persists and ignores is not an unimplemented feature, it is active misinformation.

---

### Phase definitions

**Phase 0 — Foundation.** `.nvmrc` (Node 24), Nx workspace (pnpm) with `scope:pure` tags, TS 6.0.3 config, NestJS skeleton on the Fastify adapter, Kysely connection, raw-SQL migrations, Vitest + Testcontainers, CI, `docker compose up` with Postgres 18.
*Done when:* `docker compose up` serves a health endpoint with migrations applied, and CI fails if `engine/` imports NestJS.

**Phase 1 — Core engine.** Data model; pure `engine` decider; repositories; Postgres queue; outbox + relay; `SIMPLE` tasks; worker SDK with long-poll, lease renewal, ack; retries, backoff, timeouts, idempotency; `/v1` REST API with OpenAPI; durable timers; **`Authenticator` abstraction with service-account JWT and API-key mechanisms, and queue-scoped authorization**.
*Done when:* a multi-step workflow with a failing worker retries, times out and completes correctly under `kill -9` of the server mid-execution — and an unauthenticated or wrongly-scoped worker is refused.

**Phase 2 — Complete DSL.** All operators; expression engine (`${...}` + JSONPath); blueprint compiler with static ref analysis; workflow versioning; typed TypeScript builder in `sdk`; saga/compensation.
*Done when:* nested fork-join inside a do-while inside a sub-workflow executes correctly, and the TS builder round-trips to JSON.

**Phase 3 — System tasks, including first-class webhooks in both directions.** `HTTP`, `HTTP_POLL`, `INLINE` (quickjs in a worker-thread pool), `JSON_JQ_TRANSFORM`, `WAIT`, `EVENT`, `KAFKA_PUBLISH`, `NOOP`, `BUSINESS_RULE`, `JDBC/SQL`, `gRPC`, `UPDATE_TASK`, `UPDATE_SECRET`, `GET_SIGNED_JWT`, `HUMAN`. Pluggable task-type registry.

Webhooks get two dedicated nodes rather than being left to generic `HTTP`:
- **`WEBHOOK` (outgoing)** — deliver an event to an external URL with HMAC request signing from a managed secret, configurable retry/backoff, delivery receipts and a dead-letter path. Generic `HTTP` covers none of that.
- **`WAIT_FOR_WEBHOOK` (incoming)** — the workflow pauses and the engine mints a unique callback URL; an external system POSTs to it to resume, with signature verification, replay protection and correlation back to the exact task instance. Pairs with a workflow-level timeout so a callback that never arrives fails cleanly.
*Done when:* a workflow calls an API, transforms with JQ, branches on the result and waits for a webhook.

**Phase 4 — Triggers and eventing.** Leased cron scheduler with timezone support and backfill; event handlers (Kafka/NATS/SQS/AMQP/Redis); incoming webhooks with signature verification; workflow status events; external payload storage.
*Done when:* a cron-scheduled workflow and a Kafka-triggered workflow both run unattended across two replicas without double-firing.

**Phase 5 — Control plane.** Namespaces with hard isolation; RBAC (users, groups, roles, tag-based access); mTLS and OIDC workload identity for workers; **email + password login for the UI**, with OIDC/SAML SSO layered on after it; secrets with envelope encryption and KMS/Vault backends; environment variables; audit log; per-tenant quotas.

*UI login is email + password first* — decided 2026-09-13. An OIDC-only login means a fresh self-hosted install has no way in at all until an identity provider is configured, which contradicts the "one dependency, `docker compose up`" positioning. SSO arrives as an additional `Authenticator`, which by construction changes no call site.
*Done when:* two namespaces cannot see each other's definitions, executions, queues or secrets — enforced in the repository layer, not the controller, and verified by negative tests.

**Phase 6 — UI.** Next.js + Tailwind + HeroUI v3: definition browser and diff, visual DAG editor (`@xyflow/react`), live execution viewer over WebSocket with per-task input/output inspection, operational actions (pause/resume/retry/rerun-from-task/terminate/bulk), human task inbox with form templates, queue and worker dashboards, admin screens.
*Done when:* you can build, run, debug and operate a workflow without touching the API.

**Phase 7 — AI / agent orchestration.** LLM tasks via the Vercel AI SDK; embeddings generate/store/search with **pgvector as the default vector store**; index/search document, chunk text, parse document; image/audio/video generation; MCP client tasks; an `AGENT` task running a tool-use loop where tools are other node-flow tasks; and **workflows exposed as MCP tools**, making any workflow callable by an external agent.
*Done when:* an agent workflow does retrieval over pgvector, calls an MCP tool and loops to a conclusion.

**Phase 8 — Scale and pluggability.** **Two topologies and no more: Postgres, or Postgres + Redis.** Redis relieves the two places a single Postgres becomes the ceiling — cross-replica wake-ups and the hot counter rows behind rate limits and concurrency caps. Blob adapters (S3) for payload offload; partition-ownership decider replacing row locks; read replicas; benchmark harness with published numbers.
*Done when:* the harness reports sustained throughput on both the Postgres and the Postgres + Redis paths, and the docs state each one's real ceiling.

**Deliberately dropped: the OpenSearch search backend, Kafka and NATS as queue backends.** Each would be a third or fourth thing an operator has to run, monitor and upgrade, and the whole positioning of this project is that Orkes needs Redis + Cassandra + Elasticsearch where node-flow needs Postgres. Postgres full-text and JSONB containment already serve execution search, and the queue's correctness rests on enqueueing *inside* the transaction that changed the state — which no external broker can join. Kafka, NATS, AMQP and SQS remain fully supported as **integration targets** (event sources and status sinks): those are the user's systems, not node-flow's storage.

**Phase 9 — Developer experience.** `@node-flow-dev/testkit` — unit-test workflows with mocked task outputs and no server, possible only because `engine` is pure; deterministic replay and time-travel debugging in the UI; `nf` CLI; local dev server with hot-reload; generated clients for Python/Go/Java from OpenAPI; a Conductor compatibility layer and migration tool.
*Done when:* a workflow has a passing unit test that runs in CI in under a second.

**Phase 10 — Orkes enterprise parity.** Everything the Orkes console offers that Phases 1–9 do not: failure workflows and CDC, idempotency strategies, sync execution and signals, workflow message queues, masking and task output caching; environment variables, a versioned schema registry, user forms with assignment chains, SLAs, escalation and triggers; webhooks with platform verifiers; remote services with circuit breakers; an API and MCP gateway; applications, users, groups, permissions, tags and audit screens; worker and event monitors; a Launch Pad and an AI assistant.
*Done when:* every row of the Phase 10 gap-analysis table is ✅ and exercised end to end in the browser.

---

## Where the tests stand

**1,631 passing** across twelve projects — 770 store, 319 server, 178 tasks, 142 engine, 95 ui, 49 core, 22 cli, 22 sdk, 20 testkit, 8 bpmn, 6 bench — plus 46 smoke checks and 242 feature checks against the built image. A clean `build test lint typecheck` with `--skip-nx-cache` is green across all of them, in about four and a half minutes.

The number matters less than its shape. Store and server carry most of it because that is where the failures are silent — a lost wakeup, a permit that leaks, a lease that expires into a double execution — and those tests run against a real Postgres rather than a mock, because the bugs found this phase (a claim that took no lock, a NUL that Postgres will not store) do not exist in a mock. The engine's 135 are pure and run in milliseconds, which is what makes it worth rerunning them on every change.

---

## Release prerequisites — two things code cannot decide

The images are built and verified, the libraries are packaged, and
`.github/workflows/release.yml` publishes all three channels off a `v*` tag.
Two things block it, and both are decisions rather than work:

**There is no git remote.** The repository has one commit and no origin, so the
GitHub release has nowhere to go and GHCR has no namespace to push to — the
workflow derives both from `github.repository`, so it needs the repository to
exist and nothing more.

**The `@node-flow` npm scope belongs to someone else.** `@node-flow-dev/core` and
`@node-flow-dev/cli` are already published there (`0.0.1-alpha.11`, by npm user
`waynegong`, an unrelated project). Scopes are owned, so this is not a matter of
picking unused names within it. Publishing to npm means renaming every package
and every `@node-flow-dev/...` import in the workspace. Checked and free:
`@node-flow-io`, `@conductorjs`, and the unscoped name `nodeflow` (so
`nodeflow-sdk`, `nodeflow-cli` and so on). A personal scope would also do.

Neither blocks the Docker images or the GitHub release; only npm waits on the
rename — and the rename itself is done, as a tool rather than as a decision.

**Decided: `@node-flow-dev`.** Not yet applied — the rename runs on instruction,
not on this note, so every package in the workspace is still `@node-flow-dev/…`.
Running `node scripts/rename-scope.mjs @node-flow-dev` is the whole change.

`scripts/rename-scope.mjs` takes the new name and rewrites every occurrence:

```bash
node scripts/rename-scope.mjs @acme        # scoped:   @acme/core
node scripts/rename-scope.mjs nodeflow-    # unscoped: nodeflow-core
node scripts/rename-scope.mjs @acme --dry-run
```

It was verified by running it against a full copy of the repository and building
there: 388 occurrences across 246 files, then `pnpm install`, then `build`,
`typecheck`, `lint` and the test suites, all green. Two things it deliberately
leaves alone, both found by the dry run rather than by reasoning:

- **`pnpm-lock.yaml`**, because it is derived. `pnpm install` rewrites it from
  the manifests, and a hand-edited lockfile disagrees with its own integrity
  hashes — it looks like it worked and fails at the next `--frozen-lockfile`
  install.
- **The script itself**, which names the old scope in its own constant and would
  otherwise be unable to find anything the second time it ran.

The `@node-flow-dev/source` export condition is renamed with everything else. It is
internal to this workspace — `tsconfig.base.json`, each `vitest.config.mts` and
each package's `exports` map have to agree, and if they drift the tests quietly
resolve to a stale `dist` instead of source. That agreement is what the trial
run's passing tests actually prove.

Nx project names (`core`, `server`, …) are **not** renamed. They are internal
identifiers in the task graph and in every `nx run` anyone has typed, and have
nothing to do with what npm calls a package.

---

## Release verification — what running the artefact found

Before 1.0.0, the published images were started against a real database and driven through the HTTP API and a browser. Everything below passed `build test lint typecheck` beforehand, which is the point: each of these is a defect the test suite could not see, because the suite exercises the source and a release ships an *artefact*.

| Found by | Defect | Fix |
|---|---|---|
| Starting the image | `Cannot find module 'tslib'` — the container died on boot | Nx's default `externalDependencies: 'all'` runs `webpack-node-externals` against the **workspace root** `node_modules`. Under npm's flat hoisting that is roughly every dependency; under pnpm it is only what the root package.json declares — so whether a module was bundled depended on where it happened to be declared. `tslib` and `@node-saml/node-saml` fell out of the bundle that way. Set `externalDependencies: 'none'` and moved `@node-saml/node-saml` to the package that imports it |
| Reading the health response | The image reported ready with a schema one migration behind the binary | `checkMigrations` asserted only that *some* migrations had run, though its own comment promised "the schema is at the revision this build expects". Now compares against the migrations the build ships and names what is missing |
| `docker compose up` on a developer machine | Host tools reached a different Postgres and failed with `password authentication failed` | A local Postgres on 5432 is common; Docker binds the port anyway, so the collision surfaces as an auth error rather than a bind error. Compose now publishes 5433 by default |
| Driving the API | Registering an existing version returned **400**, indistinguishable from a malformed definition | `CONFLICT` → 409, for both a duplicate workflow version and a duplicate namespace slug. Both also now translate the unique-constraint violation, so the loser of a race gets the same 409 instead of a 500 |
| Driving the API | `SET_VARIABLE` was **write-only**: the value was stored, and `${workflow.variables.x}` — Conductor's spelling, and the one most users will write — silently resolved to `null` everywhere | Only `${global.x}` was wired up. `workflow` is a real scope, so the missing `variables` key walked off the end of the object and became null rather than raising. Aliased both forms, exactly as `${workflow.env.x}` already aliased `${env.x}` |
| A browser console | React #418 on **every page**: the server HTML was discarded and the whole tree re-rendered on the client, so SSR was doing nothing for the entire dashboard | `Dropdown.Trigger` *is* a button — its props extend React Aria's `Button` — so the `<Button>` inside it emitted `<button><button>`, which the HTML parser flattens to siblings. It had spread to eleven call sites because nothing about it is visible: the component looks right, behaves right, and only the console carries a minified error code |
| The same console, after that fix | React #418 again, now `args[]=text`, on every page showing a time — which is most of them | Two causes wearing one error code. `formatRelative` reads `Date.now()`, so the server rendered "just now" and the browser, hydrating a moment later, rendered "1 min ago" — a disagreement about *when*. `formatDateTime` is built from `getFullYear()`/`getHours()`, which read the renderer's timezone, so a UTC container and an operator in any other zone disagreed about *where* — and that one is not a race, it is every timestamp, every time. Added `<Ago>` and `<LocalTime>`, which carry the `suppressHydrationWarning` that tells React the difference is expected, and converted 20 call sites. Rendering UTC on both sides would also have worked and would have been wrong: an absolute time is here so an operator can line it up against their own clock. Fixing call sites does not hold on its own, so `no-clock-in-markup.spec.ts` scans the source and fails on any clock- or timezone-dependent helper used as JSX text; `suppressHydrationWarning` covers an element's own attributes, so `title={formatDateTime(…)}` is deliberately still allowed |
| Following the README | `pnpm nf bootstrap` — the first command after `docker compose up` — **did not exist**, and would have failed for a second reason if it had: `bootstrap` needs a database URL the quickstart never mentioned | Added the root `nf` script and the `DATABASE_URL` export. The quickstart is the one path guaranteed to be walked by someone with no context, and it was the least exercised |
| Storing a secret through the image | Every write returned 400: the compose stack set no `NODE_FLOW_SECRET_KEYS`, so the Secrets screen was dead on the stack meant for trying the product | The *server* behaved correctly — refusing to store a secret rather than keeping it in clear is the right answer to a missing key, and it says so in one sentence. Compose now ships a development key, next to the development JWT secret and for the same reason |
| Reading the generated document | **19 endpoints validated a request body the document did not describe**, so the Python, Go, Java and TypeScript clients exposed them with no body parameter — endpoints you cannot call from the clients the project ships | `@ApiRoute` takes the schema separately from the `@Body(zodBody(…))` pipe that enforces it, so the two can silently disagree. Declared the missing ones, and added a test that walks every controller and fails when a route validates a body it does not document |
| That same fix | Adding one of them took the **whole document to a 500** — `z.date()` cannot be represented in JSON Schema, and one schedule's `startAt` was enough | The converter now renders a date as `{ type: 'string', format: 'date-time' }`, which is what it actually is on the wire. The spec's own setup also accepted the 500 silently: a failed generation still returns JSON, so `JSON.parse` succeeded and the tests read fields off an error envelope. It now asserts the status first |

Afterwards the whole thing was rehearsed the way a stranger meets it: `docker
compose down -v` to destroy the volume, then `up`, then the README's commands in
the order the README gives them. Postgres initialised, all 37 migrations ran at
boot, readiness turned green, `nf bootstrap` minted the first credential,
`nf create-user` made a dashboard login, and `pnpm smoke` passed all 46 checks
against that cold stack — including a cron schedule firing, which is the one
check that proves the poller role actually started rather than merely being
listed in `NODE_FLOW_ROLES`.

### Then every feature, one at a time

The pass above was breadth-first — does the artefact work at all. A second suite
(`scripts/e2e/`, 242 checks) drives each *feature* against the same image:
every operator, the system tasks and their failure semantics, the control plane,
the operator actions, each interface, every execution control — raced against
rather than configured, to the standard this plan sets — the event sources and
sinks against a real Redis, NATS, RabbitMQ and Kafka, and the tasks that *wait* — a `YIELD` held
open for a signal, a `WAIT_FOR_WEBHOOK` holding a minted callback, a `HTTP_POLL`
returning to a dependency until it is ready. It found five defects in the
decider, all of a single kind:

| Operator | What happened | Why the tests missed it |
|---|---|---|
| `DO_WHILE` | A loop with no task after it **hung forever** — every task terminal, workflow `RUNNING`, nothing left to wake it | Every existing loop test put a task after the loop, so the pass always scheduled something and the workflow completed on the next evaluation |
| `FORK_JOIN_DYNAMIC` | **Never ran.** The fork sat `SCHEDULED` with zero branches materialised, because operators are never queued and the decider only advances terminal tasks | Every test constructed the fork task as already `COMPLETED`, proving what happens next and nothing about how it got there |
| `EXCLUSIVE_JOIN` | Returned a branch map like a plain `JOIN`, so `${join.output.field}` could not be read without knowing which branch won — and fired off a *skipped* branch before the taken one finished | The tests asserted only *when* it fires, never what it outputs |
| `SET_VARIABLE` | The next task read `null` from `${workflow.variables.x}` | The pass continues through an operator and resolves the next task's input against a scope the command had not updated; no test read a variable back in the same pass |
| `SUB_WORKFLOW` retry | A retried sub-workflow **hung its parent for ever**, and `retryCount` defaults to 3 — so this was the ordinary path, not an edge case | Three causes at once: the retry started no child, the start was deduplicated against the previous attempt’s child, and the task was queued to a worker that will never serve an operator. Every test drove the child to *success* |

A fifth was not a bug in the engine but a feature with no door into it. Named
semaphores — the differentiator this plan claims a per-task-definition limit
cannot match — were honoured by the dispatcher and configured by nothing:
`configureSemaphore` had no caller outside its own repository tests. Since an
unconfigured semaphore deliberately does not gate, a task definition could
declare one, register cleanly, and run completely ungated. A declared control
that silently is not one is the exact failure the controls section is written to
prevent, so it now has a `/v1/ns/{ns}/semaphores` API, and the suite proves one
permit holds two different task types to a single runner.

The shape is the same in all five engine bugs: **a test that supplies the state
whose construction is broken cannot fail.** `FORK_JOIN_DYNAMIC` is the clearest case —
thirteen tests, all starting from `t('fanOut', COMPLETED)`, and the operator had
never once completed in production. The sub-workflow retry is the most costly:
three independent causes, all reachable by default, all hidden because no test
ever failed a child. Two of the four were the worst failure this
system has, a workflow stuck forever with nothing to act on, which is exactly
what the sweeper exists to shout about and exactly what the lost-wakeup rule was
written to prevent.

The suite also confirmed a good deal working: the SSRF guard refusing a private
address, secrets refusing to store without a key, human tasks unreachable with an
API key, a 4xx not consuming the retry budget, a quota returning 429, an
unregistered version pinning correctly, and Conductor's own poll/ack pair driving
a workflow to completion.

Three things generalise from that list.

**Several were invisible to any check that reads source.** The externals bug needs the bundle; the hydration bugs need a browser parsing real HTML; the quickstart bug needs someone with no context typing the commands in order. The second hydration bug needed the browser *and* a clock and timezone that differ from the container's — it would not reproduce on a machine set to UTC.

**Most were silent.** No exception, no failing test — a null, a wrong status code, a page quietly re-rendering, a client missing a parameter. The health check is the sharpest case: its comment described the right behaviour while the code did something weaker, and the comment is what everyone reads.

**Two came from a promise nothing enforced.** `@ApiRoute`'s own comment says the schemas are "the *same objects* the validation pipes use — not a restatement of them", and that is exactly right; but the decorator takes the schema in one place and the pipe in another, so nineteen routes drifted apart without a word. The fix that lasts is not declaring the nineteen, it is the test that now walks every controller and fails on the twentieth. A spot check cannot find a gap in a population — the existing test asserted this property, correctly, about one route.

The clock bug was fixed the same way for the same reason. Twenty call sites were
converted, but `formatDateTime` is still an ordinary exported function and the
next page to show a timestamp will reach for it; so the rule that no
clock- or timezone-dependent value may be rendered as markup is now a test over
the source rather than something to remember.

### Then the documentation, which found more than the suites did

Writing the consumer and contributor documentation meant reading every schema,
every executor and every config field against what the code actually does. That
turned up eight defects, and the shape of them is worth recording: **none were
reachable by any test, because in each case the test and the code shared the
same wrong assumption.**

| Found while documenting | What was wrong |
|---|---|
| `DATABASE_MIGRATE_ON_BOOT=false` | Returned early from `onModuleInit` **before** the seed and both `LISTEN`/`NOTIFY` listeners. The documented multi-replica pattern — migrate from a job, disable on the pods — therefore cost every pod its long-poll wake-ups and its live execution stream. Both degrade to a backstop poll rather than failing, so it read as "a bit slow" rather than as a misconfiguration |
| `NODE_FLOW_MTLS_ENABLED` | The one flag using `z.coerce.boolean()` instead of the strict `boolean()` helper. Coercion follows JavaScript truthiness, under which the *string* `"false"` is true — so `NODE_FLOW_MTLS_ENABLED=false` **switched mTLS on**. Now checked for every boolean in the schema by a test that enumerates them, because a spot check cannot find the next one |
| Task-level retry settings | `retryCount` was honoured; `retryLogic`, `retryDelaySeconds`, `backoffScaleFactor`, `maxRetryDelaySeconds` and `jitter` were **stripped by zod before the engine saw them**. No error at registration, nothing in the stored definition. The e2e suite wrote `retryLogic: 'FIXED'` in two places and passed while asserting nothing about it. All six are now accepted and honoured |
| `README.md`'s SDK example | `baseUrl: 'http://localhost:3000/v1'`, while the client appends `/v1` itself — so the documented snippet produced `/v1/v1/…` and 404ed on first call. Fixed, and the client now accepts and strips the suffix, because the project's own README getting it wrong is good evidence users will |
| `GET_SIGNED_JWT` in the e2e suite | Set `ttlSeconds`; the executor reads `ttlInSecond`. It passed because nothing asserted on the expiry. Both fixed — the field *and* the missing assertion |
| The e2e human-task section | A stale default password that no longer matched the compose file |
| Root `package.json` | Carried `next`, `react` and `react-dom` again — put there by `nx g @nx/next:application` when the docs and marketing sites were scaffolded. That silently disables the module-boundary protection for the whole workspace, which is the invariant recorded above |
| `asyncComplete`, `restartable`, workflow-level `timeoutPolicy` | Accepted by the schema, stored, and read by nothing. Documented as inert rather than quietly left to look supported |

The generalisation is the same one this project keeps relearning, in a new
place: **writing down what the code does is a test that no test can be.** Six of
the eight were settings — and a setting is the one kind of code whose failure
mode is to do nothing at all, which no assertion about a happy path can catch.

### Then a real Conductor project, pointed at it

A sixty-workflow production codebase using `@io-orkes/conductor-javascript`
found three more, all in the compatibility layer and all hidden by the same
property of its test suite: **the suite writes its definitions by hand and
authenticates with an API key, so it never sent what the SDK actually sends.**

| Found | What was wrong |
|---|---|
| Registering any builder-made workflow | `ConductorWorkflow` initialises `failureWorkflow` to `""` and emits it unconditionally, so every workflow without a failure workflow carried an empty string — refused as too short. Empty now means "none", which is what Conductor means by it |
| Reading the rejection | The message was the bare sentence "workflow definition failed validation". The offending paths were attached as structured detail, which Conductor's SDKs never read — their error handler takes `message` and nothing else. Sixty workflows failed with a sentence naming neither the workflow nor the field |
| Authenticating as a service account | The SDKs declare `X-Authorization` as an *apiKey* credential, meaning the raw value with no scheme. The guard required `Bearer`, so a service account authenticated at `/token` and was refused on every call after it. An API key worked, which is why the suite passed |

The lesson is narrower than "test more" and worth stating exactly: **a
compatibility layer has to be tested against the other side's output, not
against a hand-written approximation of it.** Every one of these is a field or a
header the SDK always produces and the suite never did.

---

## Release engineering — what the pipeline found

The release pipeline is itself an artefact that had never been run, and running
it found four defects in one afternoon. All four share a shape: **a step that
only executes on the real release cannot be covered by the rehearsal of it.**

| Found by | Defect | Fix |
|---|---|---|
| The first CI run | `server-e2e:e2e` failed. The package was untouched Phase 0 scaffold: its `globalSetup` waited for a server on `:3000` that nothing starts, and its one test asserted `GET /v1` returns `{message:'Hello API'}` when that route 404s. It had never passed, because local runs used `build test lint typecheck` and CI runs `lint test build typecheck e2e` — a target nobody had ever invoked | Deleted the package, and with it the last consumer of jest. The one assertion worth keeping — that the app is served by **Fastify** and not Express, observable on the wire only as the `keep-alive: timeout=N` response header — moved into `scripts/smoke.mjs`, where it runs against the built image instead of a server nobody started |
| The next CI run | The image build died on `COPY packages/server-e2e/package.json`. Both Dockerfiles carry a hand-written list of every workspace manifest, copied in before `pnpm install` so the install layer caches on dependency changes rather than source changes. Nothing tells you when that list stops matching the workspace: deleting a package fails the build minutes in, on a change that had nothing to do with Docker, and *adding* one fails nothing at all — it silently omits the package from the install | `release-manifests.spec.ts` compares the two lists and names the offending package in a unit test |
| Reading the manifests | `@node-flow-dev/cli` was `private: true` while the docs gave three `npx @node-flow-dev/cli@1.0.0` recipes — including the Kubernetes migration Job, which is the *only* documented way to migrate an install running `DATABASE_MIGRATE_ON_BOOT=false` | Published `cli`, and with it `store` and `tasks`, which it needs. The same spec now fails on any published package that depends on an unpublished one — a manifest with `workspace:*` rewritten to a version that does not exist installs as a 404, in the registry, where it cannot be taken back |
| Running the image | The docs answered the same question two incompatible ways, and **both were wrong**. Two pages said "`nf` is not on npm — it ships inside the server image" and gave a `docker run … server:1.0.0 nf migrate`; three others already used `npx @node-flow-dev/cli@1.0.0`. The image carries only the bundled server, so `nf` resolves against `CMD ["node", …]` and dies with `Cannot find module '/app/nf'` — while the npx form 404'd because the package was private. A contradiction that visible survived because nobody had run either | Publishing the CLI settles it toward npm: all five recipes now use `npx`, and the callout says plainly that the image carries the server and nothing else. The image is unchanged — a production artefact is not a toolbox |
| Reading the workflow | `pnpm -r publish --provenance` would have failed on every package: provenance refuses to sign a package with no `repository` field, and not one of them had it. The dry run cannot catch this, because `dry_run` swaps the publish for `npm pack` | Added `repository`, `homepage` and `bugs` to all seven, and a check that every published package carries `repository.url` and the right `repository.directory` |

### The one the pipeline found that the suite could not

The fifth defect was not a pipeline defect at all. `pnpm smoke` failed one check
against the image — `resume accepted — got 500` — and the container logs named
the cause exactly:

```
Process 142 waits for ShareLock on transaction 901; blocked by process 90.
  insert into "DecideQueues" ... on conflict do update
Process 90 waits for ShareLock on transaction 900; blocked by process 142.
  select * from "WorkflowExecutions" where "id" = $1 for update
```

An **ABBA lock-order inversion** between an operator action and the decider.
The evaluator takes the claim row first and the workflow row second, and that
order *is* the lost-wakeup rule — it cannot move. `ExecutionControlService`
took the same two rows in the opposite order, so any operator action racing an
evaluation of the same workflow could deadlock, and Postgres would shoot one of
them. The operator lost, `resume` answered 500, and the run stayed paused.

Three things about it are worth keeping:

- **The unit test for the same operation could not see it.** `pauses and
  resumes` in `api.spec.ts` discards the resume response and polls for the
  status, so a 500 became "condition never became true" fifteen seconds later —
  indistinguishable from slowness, and duly dismissed as flake on a loaded
  runner. An assertion that was never written cost more than the bug.
- **It needed two processes and a real database.** Nothing in the engine's own
  suite can produce it, because the deadlock is a property of two transactions
  holding two rows, not of the decider's logic. The regression test therefore
  parks a transaction between the evaluator's two locks and polls
  `pg_stat_activity` until a backend is genuinely blocked — it throws rather
  than passing vacuously if the race never sets up.
- **The same inversion existed in two other places**, found by looking rather
  than by failing: `timeout-sweeper.fire` (fixed the same way — the sweeper and
  the evaluator race more than anything else, since both are driven by the same
  workflows finishing) and `WorkflowMessageRepository.push`. The fix was
  *reverted* for `push`: hoisting the enqueue wakes the decider on every push,
  so a `PULL_WORKFLOW_MESSAGES` task completes on whatever has arrived instead
  of on a full batch, and an invariant test caught it. Changing when messages
  are batched to fix a lock order is the wrong trade, and the narrower window
  is recorded in the code instead.

The dry run is worth keeping despite the last two: it caught nothing here, but
it is the only thing that proves the image build, the smoke gate and the pack
step work before a tag makes them irreversible. What it cannot do is exercise
the steps it exists to skip, so those need tests of their own — which is what
the spec above now is.

---

## Where we deliberately diverge from Conductor

- **Pure engine core** → real unit testing, deterministic replay, time-travel debugging.
- **Typed TypeScript builder** → compile-time checking of `${...}` references, which are runtime string errors in Conductor.
- **Push delivery** alongside long-poll.
- **WASM sandbox** for INLINE rather than a shared-heap isolate.
- **Saga/compensation declared, not hand-rolled.**
- **Retry jitter by default.**
- **pgvector default** — no extra infrastructure for RAG workflows.
- **Workflows as MCP tools** — the orchestrator becomes callable by agents, not just a caller of them.
- **OpenTelemetry native**, trace context propagated into workers so one trace spans engine → worker → downstream.
- **One required dependency.** Orkes needs Redis + Cassandra + Elasticsearch; node-flow needs Postgres.

---

## Verification

Correctness for an orchestrator is mostly about what happens when things break, so testing is weighted accordingly:

1. **Engine unit tests** (Vitest, no I/O, no decorators) — every operator, nesting combination and failure path. Fast, exhaustive, the primary safety net.
2. **Repository/queue integration tests** (Testcontainers, real Postgres 18) — lease expiry, `SKIP LOCKED` under concurrency, outbox publish-once, partition pruning, schema-drift check between Sequelize models and migrations.
3. **Chaos tests** — `kill -9` the decider mid-evaluation, kill workers holding leases, partition the DB, skew the clock. Assert no workflow is ever lost, stuck or double-completed.
4. **Concurrency invariants** — N deciders racing on one workflow must equal one decider. Property-based via `fast-check`. This is where the lost-wakeup rule is proven.
5. **Control-enforcement tests** — one per row of the execution-controls tables, each written to *defeat* the control rather than confirm it: 200 workers racing a `concurrentExecLimit` of 5 must never exceed 5 in flight; a named semaphore must never over-grant under contention or leak a permit when a holder is `kill -9`'d; every timeout class must fire within tolerance and be attributed to the right cause; the retry budget must trip before a degraded dependency is saturated; admission control must shed new starts while leaving in-flight work untouched. A control that has no test that tries to break it is not implemented.
6. **Load harness** — reports workflows/sec, task latency p50/p99, queue depth and WAL rate on a fixed profile, run in CI to catch regressions.
7. **End-to-end** — `docker compose up`, register via CLI, run, watch in the UI, terminate and rerun-from-task.
8. **Conductor compatibility suite** (Phase 9) — run Conductor's own example definitions and diff execution results.

---

## Appendix — Conductor parity checklist

The commitment is *every* Conductor/Orkes feature. This is the inventory it will be checked against; each phase is done only when its rows pass. Rows marked **+** are ours, not Conductor's.

### Operators
| | Phase | | Phase |
|---|---|---|---|
| `SWITCH` | 2 | `SUB_WORKFLOW` | 2 |
| `DO_WHILE` | 2 | `START_WORKFLOW` | 2 |
| `FORK_JOIN` | 2 | `TERMINATE` | 2 |
| `FORK_JOIN_DYNAMIC` | 2 | `SET_VARIABLE` | 2 |
| `JOIN` | 2 | `GET_WORKFLOW` | 2 |
| `EXCLUSIVE_JOIN` | 2 | `YIELD` | 2 |
| `DYNAMIC` | 2 | **+ `COMPENSATE`** (saga) | 2 |

### System tasks
| | Phase | | Phase |
|---|---|---|---|
| `SIMPLE` (worker) | **1 ✅** | `JDBC` / SQL | **3 ✅** |
| `HTTP` | **3 ✅** | `gRPC` | **3 ✅** |
| `HTTP_POLL` | **3 ✅** | `NOOP` | **3 ✅** |
| `INLINE` (sandboxed JS) | **3 ✅** | `UPDATE_TASK` | **3 ✅** |
| `JSON_JQ_TRANSFORM` | **3 ✅** | `UPDATE_SECRET` | **5 ✅** |
| `EVENT` | **3 ✅** | `GET_SIGNED_JWT` | **3 ✅** |
| `KAFKA_PUBLISH` | **3 ✅** | `HUMAN` | **3 ✅** |
| `WAIT` | **3 ✅** | `BUSINESS_RULE` | **3 ✅** |
| **+ `WEBHOOK`** (outgoing, signed) | **3 ✅** | Email / SendGrid | **✅ `EMAIL`** |
| `WAIT_FOR_WEBHOOK` (incoming) | **3 ✅** | Opsgenie / alerting | **covered** |
| `QUERY_PROCESSOR` | **covered** | `PULL_WORKFLOW_MESSAGES` | **4 ✅** |

Three rows say **covered** rather than ✅, and the distinction is deliberate:

- **`EMAIL` is a real task**, over SMTP rather than one vendor's REST API — SMTP is the one interface every provider speaks, so SES, SendGrid, Postmark and the relay in someone's data centre are all `NODE_FLOW_SMTP_TRANSPORTS` entries instead of five executors. The transport, its credentials and the default `From` are operator configuration named by the task, so moving providers does not mean editing every workflow that sends mail.
- **Alerting** (Opsgenie, PagerDuty, and whatever the next one is called) is an HTTP POST with a JSON body. `HTTP` and the signed `WEBHOOK` task already do that, with retries, a circuit breaker and delivery receipts. A vendor-specific executor would add a name and no capability, and would date badly.
- **`QUERY_PROCESSOR`** exists in Conductor to query *its* Elasticsearch index. node-flow does not have one — deliberately, see the topology decision — and `JDBC` plus execution search cover what the task is used for.

### AI tasks
| | Phase | | Phase |
|---|---|---|---|
| LLM text complete | **7 ✅** | Index document / text | **7 ✅** (text) |
| LLM chat complete (+ tool calling) | **7 ✅** | Search index | **7 ✅** |
| Generate embeddings | **7 ✅** | Chunk text | **7 ✅** |
| Store / get embeddings | **7 ✅** (index text) | Parse document | **7 ✅** |
| Search embeddings (vector) | **7 ✅** | Generate image / audio / video / PDF | **7 ✅** (image, audio, video; no PDF task — no provider generates one, so it stays a worker's job) |
| List MCP tools | **7 ✅** | Call MCP tool | **7 ✅** |
| **+ `AGENT`** (tool-use loop) | **7 ✅** | **+ workflow-as-MCP-tool** | **7 ✅** |

### Execution operations
`start` · `get` · `getStatus` · `getTasks` · `search` · `searchByTasks` · `correlatedLookup` — Phase 1
`pause` ✅ · `resume` ✅ · `retry` ✅ · `rerunFromTask` ✅ · `terminate` ✅ · `skipTask` ✅ · `decide` ✅ · **`cancelTask`** ✅ · **`rerunTasks`** ✅ · `restart` · `resetCallbacks` · `delete`/archive — Phase 1–2
Bulk variants of pause/resume/retry/terminate · `test` (mocked run) — Phase 2 · 9

### Platform
| | Phase | | Phase |
|---|---|---|---|
| Workflow versioning | 2 | Secrets + env vars | **5 ✅** |
| Retries / backoff / jitter | 1 | RBAC, groups, applications | **5 ✅** (groups, scopes, tag-based access) |
| All timeout classes | 1 | API keys / service accounts | **1 ✅** |
| Concurrency + rate limits | 1 | mTLS · OIDC workload identity | **5 ✅** |
| **+ Named semaphores** | 2 | Email + password login | **5 ✅** |
| OIDC / SAML SSO | **5 ✅** (OIDC and SAML 2.0) |
| **+ Retry budgets** | 1 | Audit log | **5 ✅** |
| **+ Admission control** | 1 | Multi-tenancy / namespaces | **5 ✅** |
| Task domains | **1 ✅** | Human tasks + form templates | **3 ✅ · 6 ✅** |
| Saga / compensation | **2 ✅** | Visual DAG editor | **6 ✅** |
| External payload storage | **1** | Live execution viewer | **6 ✅** (SSE) |
| Cron scheduling (+ timezone, backfill) | **4 ✅** | Queue / worker dashboards | 6 ✅ |
| Event handlers (Kafka/NATS/SQS/AMQP) | **4 ✅** | Metrics **1 ✅** + OpenTelemetry 8 |
| Incoming webhooks | **3 ✅** | Search backend (OpenSearch) | **dropped** — Postgres serves search; see "Two supported topologies" |
| Schema validation on I/O | **1 ✅** | Workflow testing framework | 9 |
| Integrations (LLM, vector, apps) | 7 | **+ Deterministic replay / time-travel** | 9 |
| API / MCP gateway | **✅** (REST and MCP) | Conductor wire-compat layer | **9 ✅** |

### Explicitly out of scope
Artifact management and shared-volume orchestration (EFS / S3 Files) — users mount their own storage and pass paths as ordinary task values. Recorded above with rationale.

---

## Open risks

| Risk | Mitigation |
|---|---|
| Scope is genuinely large | Phases ship independently; Phases 1–3 alone are a usable engine |
| Postgres queue throughput ceiling | Honest benchmarks; adapters in Phase 8; WAL mitigations from day one |
| Node single-threaded CPU limits | Worker-thread pool for all CPU-bound work; role-split processes; measured in the harness |
| Framework creep into `engine` | Nx `bannedExternalImports` on the `scope:pure` tag. npm's flat hoisting means this lint rule is the *sole* enforcement — it must run on every PR and never be waived |
| Sequelize fighting the hot path | Raw SQL confined to `store/` repositories from the first commit, not retrofitted |
| Vitest decorator-metadata trap | `unplugin-swc` configured in Phase 0, before any Nest test exists |
| Untrusted INLINE JS escape | WASM sandbox default; `isolated-vm` opt-in only |
| Large-workflow memory blowup | Static ref analysis, incremental loading, payload offload; enforced by a 30k-task test |
| Multi-tenant data leakage | Namespace filter in the repository layer, not the controller; negative tests each phase |
| TS 7 / tooling churn | Build pinned to 6.0.3; tsgo additive and removable |

---

## First actions

1. `nvm use 24` and commit `.nvmrc` — Node 20 is EOL; this also fixes the broken corepack shim.
2. Scaffold the Nx monorepo with `scope:pure` tags wired up, CI, `docker compose` with Postgres 18.
3. Write `@node-flow-dev/core` — the JSON DSL zod schemas and shared types.
4. Write `@node-flow-dev/engine` — the pure decider with `SIMPLE` tasks and sequential flow, fully unit-tested **before any NestJS or Sequelize code exists**.
5. Only then add `store/` and the NestJS app.

Building the engine before the framework is deliberate: it is the only reliable way to keep the purity boundary that Phase 9 depends on.
