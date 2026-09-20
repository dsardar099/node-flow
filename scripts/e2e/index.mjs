/**
 * Feature-by-feature end-to-end, against the running image.
 *
 *   docker compose -f docker/docker-compose.yml up -d
 *   export DATABASE_URL=postgres://nodeflow:nodeflow@localhost:5433/nodeflow
 *   pnpm nf bootstrap --namespace default --json     # gives you a token
 *   pnpm nf create-user --namespace default --email you@example.com \
 *     --password '…' --scopes admin                  # for the human-task inbox
 *   KEY=nf_... node scripts/e2e/index.mjs [section ...]
 *
 * With no arguments it runs everything. Naming sections runs only those, which
 * is how you iterate on one without waiting for the rest.
 *
 * Two sections need the stack configured beyond its defaults, and both defaults
 * are the right ones:
 *
 *  - **`tasks`** drives `HTTP` against an echo server on this host, which the
 *    SSRF guard refuses by default. Set `NODE_FLOW_HTTP_ALLOW_PRIVATE=true` on
 *    the server for the run.
 *  - **`operations`** signs in to reach the human-task inbox, which an API key
 *    cannot touch by design. It uses `HUMAN_EMAIL` / `HUMAN_PASSWORD`,
 *    defaulting to the user in the command above.
 *  - **`brokers`** needs a broker to talk to, because consumer-group semantics
 *    do not exist in a stub. Any Redis, NATS, RabbitMQ and Kafka will do:
 *
 *      docker run -d -p 6399:6379 redis:7-alpine
 *      docker run -d -p 4232:4222 nats:2-alpine
 *      docker run -d -p 5682:5672 rabbitmq:3-alpine
 *      docker run -d -p 9099:9092 redpandadata/redpanda \
 *        redpanda start --smp 1 --memory 512M --node-id 0 --check=false \
 *        --kafka-addr PLAINTEXT://0.0.0.0:9092 \
 *        --advertise-kafka-addr PLAINTEXT://host.docker.internal:9099
 *
 *    then point the server at them, remembering that it reaches this host from
 *    inside its container:
 *
 *      NODE_FLOW_REDIS_CONNECTIONS={"default":{"url":"redis://host.docker.internal:6399"}}
 *      NODE_FLOW_NATS_CONNECTIONS={"default":{"servers":"nats://host.docker.internal:4232"}}
 *      NODE_FLOW_AMQP_CONNECTIONS={"default":{"url":"amqp://guest:guest@host.docker.internal:5682"}}
 *      NODE_FLOW_KAFKA_CLUSTERS={"default":{"brokers":["host.docker.internal:9099"]}}
 *
 *    The section reports which sources the stack has and skips what is absent,
 *    rather than failing for a broker nobody asked for.
 *  - **`access`** exercises the `JDBC` task, which runs against a datasource the
 *    *operator* named — a definition is user input and may not supply its own
 *    connection string:
 *
 *      NODE_FLOW_SQL_DATASOURCES={"reporting":"postgres://nodeflow:nodeflow@postgres:5432/nodeflow"}
 */
import { KEY, report } from './harness.mjs';

if (!KEY) {
  console.error('set KEY to an API token with admin scope');
  process.exit(2);
}

const SECTIONS = {
  operators: () => import('./operators.mjs'),
  tasks: () => import('./tasks.mjs'),
  platform: () => import('./platform.mjs'),
  operations: () => import('./operations.mjs'),
  interfaces: () => import('./interfaces.mjs'),
  controls: () => import('./controls.mjs'),
  brokers: () => import('./brokers.mjs'),
  remaining: () => import('./remaining.mjs'),
  access: () => import('./access.mjs'),
  cli: () => import('./cli.mjs'),
  'conductor-sdk': () => import('./conductor-sdk.mjs'),
};

const wanted = process.argv.slice(2);
const chosen = wanted.length ? wanted : Object.keys(SECTIONS);

for (const name of chosen) {
  const load = SECTIONS[name];
  if (!load) {
    console.error(
      `unknown section "${name}" — known: ${Object.keys(SECTIONS).join(', ')}`,
    );
    process.exit(2);
  }
  const module = await load();
  try {
    await module.run();
  } catch (error) {
    // A section that throws must not hide the sections after it, and must not
    // be reported as a pass.
    console.log(`  FAIL ${name} threw — ${error.message}`);
    report.threw = true;
    const { check, section } = await import('./harness.mjs');
    section(name);
    check(`${name} ran to completion`, false, error.message);
  }
}

report();

// Exit explicitly rather than waiting for the event loop to drain.
//
// `report` sets `process.exitCode` and returns, which is the tidy way to end a
// Node program — but only when nothing is left holding the loop open. Some
// section leaves a handle behind (no socket is open by then, so a timer), and
// the result is a suite that prints `every feature check passed` and then sits
// there. Locally that costs a Ctrl-C. In CI it is worse: a runner that never
// returns is indistinguishable from one that hung, so a green run would burn
// the job's whole timeout and be reported as a failure.
//
// The write-then-exit is deliberate: `console.log` to a pipe can be
// asynchronous, and exiting without flushing truncates the summary — which
// would take the count of what passed with it.
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(process.exitCode ?? 0);
