# Changelog

## 1.0.0

First release. node-flow is a workflow orchestrator with Conductor's model — a declarative JSON DAG, language-agnostic workers polling a queue, a visual editor where the diagram is the source of truth — running on Postgres alone.

### Operator control over individual tasks

Two operations for the case where a run is wrong and starting over is too blunt.

**Stop a running task.** `POST /executions/{id}/tasks/cancel` marks it `CANCELED`, releases its permits, queue entry and timers, and pauses the workflow in the same transaction. Deliberately *not* a failure: a failure is something the definition handles — it spends a retry, may start the failure workflow, may unwind compensation — and an operator stepping in is none of those. It does not stop the worker, because nothing server-side can; the lease is released so the eventual result is refused, and that is said plainly at every surface rather than left to be discovered.

**Run specific tasks again.** `POST /executions/{id}/rerun-tasks` takes the task references and a `cascade` flag, default off. With it, everything that depended on those tasks — by data *and* by control flow — is re-run too. Without it, only the named tasks run, and the response names the tasks still holding output from the run being replaced, because a half-replaced execution otherwise looks identical to a clean one.

Both refuse on a `RUNNING` workflow and say to pause it first. Doing either live races the decider for the frontier and a worker for a row about to be deleted, and "re-run this" has no agreed meaning while its downstream is still executing.

Two things that only came out of building it:

- **The dependency closure is exact, where `rerun` was approximate.** `rerun` discards every task with `scheduledAt >= target`, which is a straight line's idea of "downstream" — across a fork it also throws away an unrelated parallel branch that happened to start a moment later. The new `dependentsOf()` walks the blueprint instead. A sibling fork branch is correctly left alone; a task inside a `DO_WHILE` body correctly still reaches past the loop, which needs the containment edge because the body's `next` is empty and the loop node owns what follows it.
- **The first attempt at `cascade: false` silently did nothing.** The decider derives work from the pending frontier. Delete a task in the middle of a finished run and the frontier is still empty — everything downstream is `COMPLETED` — so it concludes the workflow is done and completes it again, having never rescheduled the task that was asked for. Non-cascade now re-arms the row in place and queues it directly, as `retry` does.

Available from the API, the `nf` CLI (`executions cancel-task`, `executions rerun-tasks --cascade`) and the execution view.

### Licence

**node-flow License 1.0 — source available, not open source.**

Run it for anything, including commercially and inside a product you sell.
Redistribute it unmodified, which is what makes installing from npm or pulling a
container image lawful. Patch your own deployment when you have to, and fork it
to open a pull request.

What it does not grant is the right to publish your own version: no forks as
separate projects, no distributing or selling modified copies. Improvements come
back here rather than becoming somebody else's product.

Configuration is explicitly not modification — your workflow definitions, task
definitions and environment are yours, and the licence does not reach them.

It is bespoke, so no legal team already knows what it means. If your review
process depends on recognising a standard licence, raise it early.

### Getting started

`docker compose up` is the whole installation. The server seeds a namespace and an administrator on a database that has none, so there is no bootstrap command and no `DATABASE_URL` to export before the first run; further namespaces, users, groups and keys are created from the dashboard.

Seven packages publish to npm under `@node-flow-dev`. Two are the ones to reach for — `sdk` for workers, the API client and the typed builder, `testkit` for unit-testing workflows with no server — and `cli` is `nf`, installable with `npx --yes @node-flow-dev/cli@1.0.0`. The other four (`core`, `engine`, `store`, `tasks`) publish because those three depend on them, not because they are an API to build against. The container images carry the server and the dashboard, and nothing else: `nf` is not inside them, deliberately, because a production artefact is not a toolbox.

The seed deliberately does **not** ship a fixed password. Left unset, `NODE_FLOW_SEED_PASSWORD` makes the server generate 160 bits per install and print them once at boot, so no two deployments share a credential — the compose file pins a known one only so the quickstart is copy-pasteable. `NODE_FLOW_SEED=false` turns it off entirely.

### Documentation

A documentation site (Fumadocs) with two entirely separate trees — one for people running node-flow, one for people changing it — and an API reference generated from the OpenAPI document the clients are built from. Neither shares anything with the dashboard. A marketing site for node-flow.dev ships alongside it.

The dashboard's own API reference is now rendered by Scalar against the *running* server's document, so it describes the build you are talking to rather than the published one.

### The engine

- **Pure decider.** `decide(blueprint, state) → commands` does no I/O and imports no framework; CI enforces the boundary. This is what makes deterministic replay and a millisecond test suite possible.
- **Every operator**: `SWITCH`, `FORK_JOIN`/`JOIN`, `EXCLUSIVE_JOIN`, `FORK_JOIN_DYNAMIC`, `DO_WHILE`, `DYNAMIC`, `SUB_WORKFLOW`, `START_WORKFLOW`, `TERMINATE`, `SET_VARIABLE`, `GET_WORKFLOW`, `YIELD`, and saga compensation declared with `compensateWith` rather than hand-rolled.
- **Execution controls** enforced server-side: retries with backoff, jitter and budgets; six distinct timeout classes; concurrency caps at namespace, workflow, task and worker level; named semaphores; rate limits; admission control; circuit breakers on outbound tasks.
- **Transactional outbox** for every side effect, so a crash mid-evaluation loses nothing.
- **Incremental evaluation**: a blueprint records which task outputs each expression references, so a 30,000-task workflow evaluates as cheaply as a five-task one.

### Tasks

`SIMPLE` (your workers), `HTTP`, `HTTP_POLL`, `INLINE` (QuickJS sandbox), `JSON_JQ_TRANSFORM`, `JDBC`/SQL, `gRPC`, `EVENT`, `KAFKA_PUBLISH`, `WEBHOOK` (signed, with delivery receipts), `WAIT_FOR_WEBHOOK`, `WAIT`, `HUMAN`, `BUSINESS_RULE`, `UPDATE_TASK`, `UPDATE_SECRET`, `GET_SIGNED_JWT`, `PULL_WORKFLOW_MESSAGES`, `NOOP`.

AI: LLM text and chat, embeddings, chunking, index and search over pgvector-or-SQL, MCP list and call, a durable `AGENT` whose tools are MCP tools, workflows and indexes, document parsing, image, speech and video generation, and guardrails.

### Platform

- Namespaces with isolation enforced in the repositories, not the controllers.
- RBAC: users, groups, tag-based access, per-resource grants; API keys, service accounts, mTLS, OIDC workload identity; **OIDC and SAML 2.0 SSO**.
- Secrets with envelope encryption, sealed task outputs, audit log with entity-state diffs, per-tenant quotas.
- Namespace API under `platform:admin` — the one scope `admin` deliberately does not satisfy.

### Triggers and eventing

Leased cron with timezones and backfill; inbound webhooks with signature verification for GitHub, Slack, Stripe and others; event handlers over **Kafka, NATS, AMQP, SQS and Redis Streams**; status listeners (CDC) to any of them.

### Interfaces

- REST API with an OpenAPI 3.1 document, and generated **Python, Go, Java and TypeScript** clients.
- A **Conductor wire-compatibility layer** at `/conductor/api` — existing Conductor SDKs work with a base-URL change.
- **MCP gateway**: workflows tagged `mcp:tool` are callable by any MCP client.
- **REST gateway**: workflows tagged `api:route` answer with their output, shaping their own HTTP response.
- Next.js dashboard: visual DAG editor, live execution viewer, human-task inbox, queue and worker dashboards, admin screens, an assistant that can read and draft but never act.

### Developer experience

`@node-flow-dev/testkit` unit-tests workflows with no server; deterministic replay re-derives a recorded run through the real engine; time travel in the UI; the `nf` CLI; BPMN 2.0 import that reports everything it cannot convert; seven starter templates, each compiled by a test.

### Observability

Prometheus metrics, and OpenTelemetry tracing where the run's `traceparent` is stored with the execution and handed back on lease — so one trace spans the API call, the engine and the worker.

### Measured

A load harness (`nf-bench`) ships with the project. On one machine: ~58 workflows/s on a 3-task chain with ~78 ms engine turnaround per step, WAL near 1 MB/s at saturation. The harness found two bugs during development that testing had not:

- a **lost wakeup** where a completion's dedupe insert took no lock, letting a decider read a frontier before that completion committed — fan-out joins were occasionally stranded forever;
- a **task output Postgres could not store**, where a NUL byte in an API response made the insert throw and left the task `IN_PROGRESS` with nothing in the UI to explain it.

Both are fixed, with regression tests that reproduce the original failure when the fix is reverted.

### Found by running the release, not the source

The published images were started against a real database and driven through the API and a browser before tagging. Every check — `build`, `test`, `lint`, `typecheck` — was already green, so each of these is a defect that reading the source could not reveal:

- The server image **died on boot** with `Cannot find module 'tslib'`. Nx's default externals rule runs against the workspace root `node_modules`, which under pnpm contains only root-declared packages — so whether a dependency was bundled depended on where it happened to be declared, not on anything about the dependency.
- Readiness **reported healthy against a schema one migration behind the binary**, despite a comment promising otherwise. It now compares against the migrations the build ships and names what is missing.
- `SET_VARIABLE` was **write-only**. `${workflow.variables.x}` — Conductor's spelling — resolved to `null` everywhere, silently, because only `${global.x}` was wired up. Both forms now work.
- Registering an existing workflow version, or an existing namespace slug, returned **400 rather than 409**, leaving a client unable to tell "already done" from "malformed" without matching on the message. Both now also translate the unique-constraint violation, so a lost race returns the same 409 rather than a 500.
- The dashboard **failed hydration on every page**, discarding its server-rendered HTML and re-rendering the whole tree client-side: `Dropdown.Trigger` is itself a button, so the `<Button>` placed inside it emitted markup no browser can parse back. Eleven call sites had copied it.
- With that fixed, **every page showing a timestamp still failed hydration**, for a second and unrelated reason: the time helpers read the machine rendering them. `formatRelative` reads the clock, so the server said "just now" and the browser said "1 min ago"; `formatDateTime` is built from `getHours()`, so a UTC container and an operator anywhere else disagreed about every absolute time. Timestamps now render through `<Ago>` and `<LocalTime>`, which mark the difference as expected, and a test refuses any clock- or timezone-dependent call in markup so the next page to show a time cannot reintroduce it.
- `docker compose up` **collided with a local Postgres on 5432** and surfaced as an authentication error rather than a port conflict. Compose now publishes 5433.
- **19 endpoints validated a request body the OpenAPI document did not describe**, so the generated clients exposed them with no body parameter. A test now walks every controller and fails when a route validates a body it does not document — and the document renders dates as `date-time` strings rather than failing to generate at all.
- `pnpm nf bootstrap`, the first command in the README after `docker compose up`, **did not exist**, and needed a `DATABASE_URL` the quickstart never mentioned. Both fixed.
- The dashboard's "API reference" link pointed at `/v1/docs`, which was never built and answered **404**. The server deliberately serves no Swagger UI, so the reference is now a page in the dashboard, rendered from `/v1/openapi.json`.
- **Every operator action could deadlock against the decider**, answering 500. An operator took the workflow row and then the `DecideQueues` row; the evaluator takes them the other way round, and must, because claim-before-read *is* the lost-wakeup rule. Postgres detected the cycle and shot one side. It surfaced as `resume` returning 500 in one smoke run, and the unit test covering the same operation could not tell anyone — it discards the resume response, so a 500 looked like a fifteen-second timeout and read as a flaky test on a loaded machine. The operator path now takes the claim row first. The same inversion in the timeout sweeper is fixed with it; the one in `push` is documented and deliberately left, because hoisting the enqueue there changes how `PULL_WORKFLOW_MESSAGES` batches and an invariant test said so.

### Found by writing the documentation

Documenting every schema, executor and configuration field against what the code
actually does turned up eight more defects. Six were settings — the one kind of
code whose failure mode is to do nothing at all, which no assertion about a
happy path can catch:

- **`DATABASE_MIGRATE_ON_BOOT=false` silently disabled two unrelated things.** It returned from boot before the seed and both `LISTEN`/`NOTIFY` listeners, so the documented multi-replica pattern — migrate from a job, disable it on the pods — cost every pod its long-poll wake-ups and its live execution stream. Both degrade to a backstop poll rather than failing, so it presented as mild slowness.
- **`NODE_FLOW_MTLS_ENABLED=false` enabled mTLS.** It was the one flag using coercion rather than the strict parser, and under JavaScript truthiness the string `"false"` is true. Every boolean in the schema is now checked by a test that enumerates them, rather than the one that happened to be wrong.
- **Task-level retry settings were dropped at parse.** `retryCount` worked; `retryLogic`, `retryDelaySeconds`, `backoffScaleFactor`, `maxRetryDelaySeconds` and `jitter` were stripped before the engine saw them — no error, no trace. All six are now honoured, layered over the task definition.
- **The README's SDK example was unusable.** `baseUrl` was documented with the `/v1` suffix the client appends itself, so the snippet produced `/v1/v1/…`. Fixed, and the client now tolerates the suffix.
- Two end-to-end checks passed for the wrong reason: a misspelled JWT TTL field that fell back to the default, and a stale password in the human-task section.
- `asyncComplete`, `restartable` and workflow-level `timeoutPolicy` are accepted, stored, and read by nothing. They are now documented as inert rather than left to look supported.

### Conductor compatibility: found by pointing a real project at it

Three defects, all in the same seam, all invisible to the compatibility suite for the same reason — **its definitions are written by hand, so they never carried the fields the SDK's builder always sets, and it authenticated with an API key rather than the credential the SDKs actually use.**

- **Every builder-made workflow without a failure workflow was rejected.** `ConductorWorkflow` initialises `failureWorkflow` to `""` and emits it unconditionally from `toWorkflowDef()`; the schema refused an empty string as too short. Empty now means "none", which is what Conductor means by it. A name that is set but malformed is still refused — accepting it would give you a failure workflow that never runs.
- **A rejected definition said only "workflow definition failed validation".** The offending paths were attached as structured detail and left out of the message, which is fine for a client that reads the whole error body and useless for every one that does not — Conductor's SDKs read `message` and nothing else. Registering sixty workflows failed with a sentence naming neither the workflow nor the field. The message now names the path, the expected type and what arrived.

### Conductor compatibility: the default SDK flow did not authenticate

Every Conductor SDK declares `X-Authorization` as an *apiKey* credential, which in OpenAPI means the raw value with no scheme — so the token minted from `/token` arrives as `eyJhbGci…`, never `Bearer eyJhbGci…`. The guard required the prefix.

The effect was narrow and total: a **service account** — keyId and secret exchanged for a token, which is what `@io-orkes/conductor-javascript` and its siblings do by default — authenticated successfully at `/token` and was then refused on every subsequent call. An API key happened to work, because the guard already tolerated a bare `nf_…`.

The compatibility suite passed throughout, because it authenticated with an API key and never minted a service-account token for a Conductor request — the same shape of blind spot as the engine defects above. There is now a test that sends a bare JWT exactly as the SDKs send it.

### Engine bugs found by driving every feature

A feature-by-feature suite (`scripts/e2e/`) run against the built image found four defects in the decider that the engine's own tests could not, because each test supplied the state whose construction was broken:

- **A `DO_WHILE` with nothing after it hung forever.** The pass that closed the loop scheduled nothing, and "already finished" was read from the frontier as it stood *before* the pass — so the loop task it had just completed still counted as running. Every task terminal, workflow `RUNNING`, and nothing left to trigger another evaluation. Every existing loop test put a task after the loop.
- **`FORK_JOIN_DYNAMIC` never ran at all.** Operators are never queued to a worker and the decider only advances terminal tasks, so a fork that did not settle in the pass that scheduled it sat `SCHEDULED` forever with zero branches materialised. Its tests all began from a fork that was already `COMPLETED`.
- **`EXCLUSIVE_JOIN` returned the wrong thing, and returned it too early.** It emitted a branch map like a plain `JOIN` — making `${join.output.field}` unreadable without already knowing which branch won — and fired off a *skipped* branch while the taken one was still running. Its tests only asserted when it fires, never what it outputs.
- **`SET_VARIABLE` was invisible to the next task.** The command updated the stored variables, but the pass continues straight through an operator and resolved the following task's input against the untouched scope, so `${workflow.variables.x}` read null in the very task it was written to feed.
- **A retried `SUB_WORKFLOW` hung its parent for ever, on the default path.** Three separate causes, each sufficient on its own: the retry never started a new child (only `scheduleNode` did that, and a retry does not go through it); the start was deduplicated on a key that did not include the attempt, so a retry was absorbed as a duplicate of the previous attempt's already-finished child; and the retry path queued the task to a worker, which for an operator means a queue nobody serves. `retryCount` defaults to **3**, so any sub-workflow whose child failed stranded its parent unless the author had written `retryCount: 0`. Its tests had only ever driven a child to success.

### Named semaphores became reachable

`Semaphores` are listed as a differentiator — one cap shared by unrelated tasks across different workflows, which a per-task-definition limit cannot express — and the dispatcher had always honoured them. But `configureSemaphore` was called from nothing except its own repository tests: there was **no way to give a semaphore any permits**.

That is worse than the feature being absent. An unconfigured semaphore does not gate, by design, so a task definition could name one, register without complaint, and run entirely ungated — a declared limit that silently is not one. There is now a `/v1/ns/{ns}/semaphores` API to create, resize, inspect (with the permits currently held) and remove them, and the end-to-end suite proves one permit holds two different task types to a single runner and hands the permit on rather than leaking it.

### Event sources and sinks, against real brokers

Redis Streams, NATS, RabbitMQ and Kafka are exercised end to end rather than stubbed — a message published to a stream or a subject starts a workflow and its payload arrives in the input, a status listener delivers a real completion to NATS and counts it, and an `EVENT` task publishes to a subject that a handler picks up to start a second workflow. Consumer groups, `$`-positioned subscriptions and at-least-once delivery have no meaning against a fake.

Writing the tests surfaced a distinction worth stating plainly: Kafka is **not** an `EVENT` sink. The other brokers are addressed as `<kind>:<connection>:<destination>` and routed by prefix; Kafka is published by `KAFKA_PUBLISH`, which names cluster and topic as separate fields. An `EVENT` sink of `kafka:default:<topic>` matches no handler and dead-letters — visibly, as documented, but it is an easy thing to write by analogy and get silence from.

### The CLI, run as a subprocess

`nf` is exercised the way a person runs it — as a child process, checking exit codes and what lands on stdout and stderr — because importing its modules would test the same code through a different door and miss what is most likely to break: argument parsing, exit codes, and whether the binary runs at all. An unknown command exits non-zero, a missing argument produces a sentence rather than a stack trace, `run --wait` blocks and reports the result, and a bundle re-imported unchanged is not an error.

`nf test` is checked with **no server and no credentials in the environment**, which is the Phase 9 promise. Both halves are asserted: a correct expectation passes, and a wrong one fails — a test runner that cannot fail is not one. It also names the tasks nothing stood in for, so a run that completes with a null output reads as a missing mock rather than a broken workflow.

### Access rules, paired with their denials

Tag-based access and per-resource grants are exercised through a real subject — a person in a group that holds the grant — because tag grants live on groups, not on credentials. Testing them with an API key proves nothing: the key has no grants at all, so every read is refused and the deny case passes for the wrong reason. Each rule now asserts both halves: a team reads its own workflow and not another's, the *listing* hides it too rather than only the direct read, and a grant opens exactly one resource and nothing else.

`JDBC` is covered alongside them, for the property that matters more than the query returning rows: a workflow definition is user input, so it names a datasource the operator configured and cannot supply its own connection string.

### Controls, tested by trying to defeat them

`concurrentExecLimit`, named semaphores, task rate limits, per-key workflow rate limits, the task output cache and `maxConcurrentTasks` are each raced against rather than merely configured — a worker asking for ten when the cap is two, two task types contending for one permit, six runs against a budget of two a minute. All hold.
