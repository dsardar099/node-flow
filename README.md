# node-flow

**Conductor's model, Node's ecosystem, one dependency.**

A workflow orchestrator: you describe a process as a JSON DAG, your workers poll for the steps they own in whatever language they are written in, and node-flow makes sure every step runs, retries, times out and compensates the way you said it should — across restarts, deploys and failures.

Orkes Conductor needs Redis, Cassandra and Elasticsearch to stand up. node-flow needs Postgres.

```bash
docker compose -f docker/docker-compose.yml up
```

That brings up Postgres, the engine and the dashboard, and seeds a `default`
namespace with an administrator to sign in as. Open <http://localhost:3100>:

```
email     you@example.com
password  development-password
```

Further namespaces, users, groups and API keys are created from the dashboard —
**Admin → Namespaces** and **Admin → Users**.

Those credentials come from `docker/docker-compose.yml` and exist to make this
page copy-pasteable. Anywhere real, leave `NODE_FLOW_SEED_PASSWORD` unset: the
server then generates a password per install and prints it once at boot, so no
two deployments share a credential. `NODE_FLOW_SEED=false` turns seeding off
entirely for installs whose accounts come from an identity provider.

The API is at <http://localhost:3000/v1>. The database is published on **5433**,
not 5432, so a Postgres you already run keeps its port — set
`NODE_FLOW_POSTGRES_PORT` to move it.

---

## What it is for

A workflow is a **declarative JSON DAG**, not a program:

```json
{
  "name": "fulfil_order",
  "version": 1,
  "tasks": [
    { "name": "charge", "taskReferenceName": "charge", "type": "SIMPLE" },
    {
      "name": "ship",
      "taskReferenceName": "ship",
      "type": "SIMPLE",
      "inputParameters": { "txn": "${charge.output.txnId}" }
    }
  ]
}
```

`SIMPLE` tasks are yours: a worker in any language leases them, does the work and reports back. Everything else — HTTP calls, branching, parallelism, loops, waits, human approvals, sub-workflows, LLM calls — the engine runs itself.

This matters when work is **long-lived, distributed across teams, or has to survive things going wrong**: a payment that retries with backoff and compensates the booking it already made, an onboarding that waits three days for a human, a pipeline that fans out over a thousand documents.

### Why not a durable-execution library?

Temporal, Inngest, Restate and friends say "write an async function, we make it durable". That is a good model and a crowded one. node-flow is deliberately the *other* model:

- the **diagram is the source of truth**, editable by someone who does not own the codebase;
- **workers are language-agnostic** and hold no orchestrator runtime — they poll a queue;
- an **operator can see and act** on every run without reading code.

If your workflows live entirely inside one team's TypeScript service, use a durable-execution library. If they cross teams, languages or the engineering boundary, that is what this is for.

---

## What you get

| | |
|---|---|
| **Operators** | `SWITCH`, `FORK_JOIN`/`JOIN`, `FORK_JOIN_DYNAMIC`, `DO_WHILE`, `SUB_WORKFLOW`, `DYNAMIC`, `TERMINATE`, `YIELD`, saga `compensateWith` |
| **System tasks** | HTTP, HTTP_POLL, INLINE (sandboxed JS), JQ, SQL, gRPC, events, Kafka publish, signed webhooks, wait-for-webhook, human tasks, business rules, signed JWTs |
| **AI** | LLM text and chat, embeddings, chunking, vector indexes on pgvector-or-SQL, MCP client tasks, a durable `AGENT` loop, image/speech/video generation, guardrails |
| **Triggers** | Leased cron with timezones, inbound webhooks with signature verification, event handlers on Kafka, NATS, AMQP, SQS and Redis Streams |
| **Control plane** | Namespaces, RBAC with groups and tag-based access, resource grants, API keys, service accounts, mTLS, OIDC workload identity, OIDC and SAML SSO, sealed secrets, audit log, quotas |
| **Operations** | Live execution viewer, visual DAG editor, retry/rerun-from-task/terminate, bulk actions, human-task inbox, queue and worker dashboards, saved searches |
| **Developer experience** | `@node-flow-dev/testkit` unit tests with no server, deterministic replay, time travel, `nf` CLI, generated Python/Go/Java/TypeScript clients, BPMN import |
| **Compatibility** | A Conductor wire-compat layer at `/conductor/api` — existing Conductor SDKs work with a base-URL change |

---

## How it is built

Five decisions shape everything else, and each has a cost worth knowing:

**Postgres is the only required dependency.** Queue, timers, state, outbox and search all live in one database, which means one thing to run, back up and understand. The honest ceiling: Postgres-as-queue is comfortable into the low tens of thousands of tasks per second, and WAL volume — not lock contention — is the wall.

**The engine is a pure function.** `decide(blueprint, state) → commands` does no I/O and imports neither NestJS nor Sequelize. That is what makes deterministic replay, time-travel debugging and a millisecond test suite possible, and CI enforces the boundary rather than trusting it.

**No side effect escapes a transaction.** Every outbound action goes through a transactional outbox, so a crash mid-evaluation loses nothing and duplicates nothing that was not already at-least-once.

**Never load the whole workflow.** A definition compiles to a blueprint that records, per task, exactly which other tasks its expressions reference. An evaluation loads the pending frontier plus those refs — so a 30,000-task workflow evaluates as cheaply as a five-task one.

**Redundant evaluations are free; lost ones are fatal.** Every ambiguous case resolves toward scheduling another pass, which is why the decide queue claims *before* it reads.

The long version, including the failures each decision prevents, is in [PLAN.md](PLAN.md).

---

## Running it

### Roles

One image, role-selected with `NODE_FLOW_ROLES`:

| Role | Runs |
|---|---|
| `api` | HTTP, workers polling, the dashboard's backend |
| `decider` | The evaluation loop |
| `poller` | Timers, the outbox relay, schedules, sweepers, system tasks |

`api,decider,poller` in one process is the development default; production scales them separately.

### Configuration

Everything is environment variables, validated at boot — a mistyped role or a missing secret fails the start rather than surfacing later as a cluster where every workflow begins and none progresses.

| | |
|---|---|
| `DATABASE_URL` | Required. No default, deliberately. |
| `NODE_FLOW_JWT_SECRET` | Required, ≥32 characters. No development fallback, because a hardcoded one is the most reliably exploited misconfiguration in this class of system. |
| `NODE_FLOW_ROLES` | Default `api,decider,poller`. |
| `NODE_FLOW_SECRET_KEYS` | `id:base64key`, 32 bytes, comma-separated for rotation. Without it the server refuses to store secrets rather than keeping them in clear. |
| `NODE_FLOW_BLOB_STORE` | `fs` (default) or `s3` for payload offload. |
| `NODE_FLOW_OTEL_ENABLED` | `true` turns on OpenTelemetry; endpoint and headers use the standard `OTEL_*` variables. |

### Writing against it

The engine runs as a container; the pieces you write code against are packages:

```bash
npm install @node-flow-dev/sdk       # workers, the API client, the typed builder
npm install -D @node-flow-dev/testkit # unit-test workflows with no server
```

```ts
import { NodeFlowClient, Worker } from '@node-flow-dev/sdk';

const client = new NodeFlowClient({
  baseUrl: 'http://localhost:3000',
  namespace: 'default',
  apiKey: process.env.NODE_FLOW_API_KEY,
});

new Worker({
  client,
  queue: 'charge',
  handler: async ({ input, log }) => {
    log('charging');
    return { txnId: await charge(input) };
  },
}).start();
```

`@node-flow-dev/core` holds the definition types and zod schemas, and `@node-flow-dev/cli` is the `nf` command. `engine`, `store` and `tasks` are published because the above depend on them, not because they are an API to build against.

### Scaling

The measured shape, from the included harness (`nf-bench`): on a single machine a chain workflow reaches roughly 58 workflows/s with ~78 ms of engine turnaround per step, and at saturation **WAL sits near 1 MB/s while the task queue never exceeds a couple of rows** — the limit is CPU in one Node process, not the database. The lever is therefore the role split above, not a bigger Postgres.

---

## Developing

```bash
pnpm install
docker compose -f docker/docker-compose.yml up postgres   # just the database
pnpm nx run-many -t build test lint typecheck
```

Tests run against a real Postgres via Testcontainers, because the failures that matter here — a lost wakeup, a permit that leaks, a lease that expires into a double execution — do not exist in a mock.

There is a second gate, for what a test suite structurally cannot see. `pnpm smoke` drives the **built image** over HTTP — registering a workflow, leasing a task as a worker, completing it with a fencing token, reading the run back, storing a secret, and waiting for a cron schedule to fire so the poller role has to be alive and not merely configured:

```bash
docker compose -f docker/docker-compose.yml up -d
export DATABASE_URL=postgres://nodeflow:nodeflow@localhost:5433/nodeflow
pnpm nf bootstrap --namespace default --json     # gives you a token
KEY=nf_... pnpm smoke
```

It imports nothing from this repository on purpose. The suite exercises the source; a release ships an artefact, and every defect found in the images before 1.0.0 lived in that gap — a module webpack left out of the bundle, a readiness probe that passed against the wrong schema, an expression that resolved to null instead of raising.

The schedule check costs a cron boundary; `SMOKE_SKIP_SCHEDULE=1` leaves it out.

Behind it sits a longer feature suite, `scripts/e2e/`, which drives every operator, system task, failure path, execution control, control-plane surface, interface, broker, waiting task, access rule and CLI command against the same image — 242 checks across ten sections:

```bash
KEY=nf_... pnpm e2e              # everything
KEY=nf_... pnpm e2e operators    # or one section
```

The event sources run against a real Redis, NATS, RabbitMQ and Kafka, because consumer-group semantics do not exist in a stub. Every access rule is paired with the denial it exists to produce — a permission system that grants everything passes any allow test ever written. The execution controls are raced against rather than configured — a worker asking for ten when the cap is two, two task types contending for one permit — because a control with no test that tries to break it is not implemented. It is where the operator bugs listed in the changelog were found. Smoke answers "is this artefact wired up at all?" in a couple of minutes and gates every tag; this answers "does each feature behave?" and is run deliberately.

| Package | |
|---|---|
| `core` | Types, zod schemas, the JSON DSL. Zero dependencies. |
| `engine` | The pure decider. No framework, no I/O. |
| `store` | Repositories, migrations, the queue. All SQL lives here. |
| `tasks` | System task implementations. |
| `server` | The NestJS application. |
| `sdk` | Worker SDK, typed workflow builder, API client. |
| `ui` | Next.js dashboard. |
| `cli` | `nf` — bootstrap, migrate, run, tail, test. |
| `testkit` | Unit-test workflows with no server; deterministic replay. |
| `bpmn` | BPMN 2.0 import. |
| `bench` | The load harness. |

---

## Renaming the npm scope

The packages publish under `@node-flow-dev/*`. If you fork this, or publish it
somewhere of your own, one command moves every name:

```bash
node scripts/rename-scope.mjs @acme        # @acme/core, @acme/sdk, …
node scripts/rename-scope.mjs nodeflow-    # nodeflow-core, nodeflow-sdk, …
node scripts/rename-scope.mjs @acme --dry-run
```

Then `pnpm install && pnpm nx reset`. It leaves the lockfile alone — that is
derived, and `pnpm install` rewrites it — and it leaves the Nx project names
alone, since those are internal to the task graph rather than anything npm
sees.

---

## Licence

**Source available — not open source.** See [LICENSE](LICENSE).

Run it for anything, including commercially, including inside a product you
sell. Redistribute it unmodified. Patch your own deployment when you need to.

What it does not grant is the right to publish your own version: no forks as
separate projects, no distributing or selling modified copies. Improvements come
back here — fork to open a pull request and that is expressly allowed.

Terms beyond these are available by agreement: <https://node-flow.dev>.
