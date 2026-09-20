/**
 * Event sources and sinks, against real brokers.
 *
 * This is the section that most needs a live broker rather than a fake. The
 * consumer-group semantics are the whole design — a Redis *stream* rather than
 * pub/sub so nothing is dropped while no replica is listening, and a consumer
 * group so two replicas share the work instead of each starting the same
 * workflow — and none of that exists in a stub.
 *
 * Skipped unless the stack has the connections configured; see `index.mjs`.
 */
import { NS, call, check, register, section, unique, until } from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

/** The sources this stack actually has, so a missing broker skips rather than fails. */
async function configuredSources() {
  const response = await call('GET', `/v1/ns/${NS}/event-handlers/sources`, {});
  return new Set((response.body?.sources ?? []).map((s) => s.id));
}

export async function run() {
  const sources = await configuredSources();

  await redisStreamSource(sources);
  await natsSource(sources);
  await natsSink(sources);
  await eventTaskPublishes(sources);
  await amqpRoundTrip(sources);
  await kafkaRoundTrip(sources);
}

/**
 * AMQP and Kafka, proven rather than assumed.
 *
 * These share the source and sink machinery with NATS and Redis, which makes it
 * tempting to call them covered by association. They are not: each has its own
 * client, its own consumer semantics and its own destination grammar — an AMQP
 * sink addresses a queue *or* an exchange and routing key, a Kafka one a topic
 * on a named cluster — and that grammar is exactly the sort of thing that is
 * wrong in a way no shared test would notice.
 *
 * Both are driven the same way: an `EVENT` task publishes, a handler on the
 * same destination starts a second workflow. One round trip exercises the sink
 * and the source together, and needs no client library here.
 */
async function roundTripThrough(sources, { id, label, sinkFor }) {
  section(label);
  if (!sources.has(id)) {
    check(`${id} configured`, false, `no ${id} connection on this stack — see index.mjs`);
    return;
  }

  const destination = unique('roundtrip').replace(/_/g, '.');
  const emitter = unique('e2e_emit');
  const listener = unique('e2e_listen');

  await register({
    name: listener,
    tasks: [inline('note', 'return { got: $.id };', { id: '${workflow.input.orderId}' })],
  });

  const handler = await handlerFor(id, destination, listener);
  check('handler created', handler.status < 300, `${handler.status} ${JSON.stringify(handler.body).slice(0, 200)}`);
  if (handler.status >= 300) return;

  await register({
    name: emitter,
    tasks: [
      {
        name: 'emit',
        taskReferenceName: 'emit',
        type: 'EVENT',
        inputParameters: { sink: sinkFor(destination), orderId: `via-${id}` },
      },
    ],
  });

  let started = { status: 0 };
  const { run } = await publishUntilStarted(async () => {
    started = await call('POST', `/v1/ns/${NS}/executions/${emitter}`, { body: { input: {} } });
    return started.status < 300;
  }, listener);

  check('the emitting workflow started', started.status < 300, `${started.status}`);
  check('a message went through the broker and back', Boolean(run), 'no workflow was started by the event');

  if (run) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${run.workflowId}`, {});
    check('carrying its payload', detail.body?.input?.orderId === `via-${id}`, JSON.stringify(detail.body?.input));
  }

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler.body?.name}`, {});
}

async function amqpRoundTrip(sources) {
  // `amqp:<connection>:<queue>` — the queue form rather than exchange/routingKey.
  await roundTripThrough(sources, {
    id: 'amqp:default',
    label: 'AMQP round trip',
    sinkFor: (destination) => `amqp:default:${destination}`,
  });
}

/**
 * Kafka has its own task, and that is the difference worth recording.
 *
 * The other brokers are `EVENT` sinks addressed as `<kind>:<connection>:<dest>`
 * and routed by prefix. Kafka is not in that list: it is published by
 * `KAFKA_PUBLISH`, which names its cluster and topic as separate fields and is
 * routed to the cluster exactly. Writing `kafka:default:<topic>` as an EVENT
 * sink therefore matches no handler at all — the event dead-letters, visibly,
 * which is the documented behaviour rather than a silent drop.
 */
async function kafkaRoundTrip(sources) {
  section('Kafka round trip');
  if (!sources.has('kafka:default')) {
    check('kafka:default configured', false, 'no Kafka cluster on this stack — see index.mjs');
    return;
  }

  const topic = unique('roundtrip').replace(/_/g, '.');
  const emitter = unique('e2e_kafkaemit');
  const listener = unique('e2e_kafkalisten');

  await register({
    name: listener,
    tasks: [inline('note', 'return { got: $.id };', { id: '${workflow.input.orderId}' })],
  });

  const handler = await handlerFor('kafka:default', topic, listener);
  check('handler created', handler.status < 300, `${handler.status} ${JSON.stringify(handler.body).slice(0, 200)}`);
  if (handler.status >= 300) return;

  await register({
    name: emitter,
    tasks: [
      {
        name: 'publish',
        taskReferenceName: 'publish',
        type: 'KAFKA_PUBLISH',
        inputParameters: { cluster: 'default', topic, orderId: 'via-kafka' },
      },
    ],
  });

  let started = { status: 0 };
  const { run } = await publishUntilStarted(async () => {
    started = await call('POST', `/v1/ns/${NS}/executions/${emitter}`, { body: { input: {} } });
    return started.status < 300;
  }, listener);

  check('the publishing workflow started', started.status < 300, `${started.status}`);
  check('a message went through Kafka and back', Boolean(run), 'no workflow was started by the message');

  if (run) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${run.workflowId}`, {});
    check('carrying its payload', detail.body?.input?.orderId === 'via-kafka', JSON.stringify(detail.body?.input));
  }

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler.body?.name}`, {});
}

/** Registers a handler that starts `workflow` when a message lands on `topic`. */
async function handlerFor(source, topic, workflow) {
  return call('POST', `/v1/ns/${NS}/event-handlers`, {
    body: {
      name: unique('e2e_h'),
      source,
      topic,
      action: 'START_WORKFLOW',
      workflow: { name: workflow },
      // Carries a field off the message, so this proves the payload arrives and
      // not merely that something fired.
      inputTemplate: { orderId: '${event.output.orderId}' },
      enabled: true,
    },
  });
}

/**
 * Publishes until the workflow appears, rather than publishing once and hoping.
 *
 * A consumer attaches when the source next polls the handler table, so a single
 * publish is a race — and one that a fixed sleep only hides, because the sleep
 * that is long enough on an idle stack is not long enough on a busy one. This
 * failed exactly that way: the section passed alone and flaked in a full run.
 *
 * Republishing is safe here. NATS is fire and forget, so an early message is
 * simply gone; a Redis entry that a new consumer group never sees is likewise
 * invisible to it. Each delivery that *is* seen carries its own idempotency
 * key, so a duplicate starts one workflow, not two.
 */
async function publishUntilStarted(publish, workflow, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let published = false;

  while (Date.now() < deadline) {
    published = (await publish()) || published;

    const seen = await startedBy(workflow, 6_000);
    if (seen) return { published, run: seen };
  }

  return { published, run: null };
}

async function startedBy(workflow, timeoutMs = 45_000) {
  return until(
    async () => {
      const found = await call('POST', `/v1/ns/${NS}/executions/search`, {
        body: { defName: workflow, limit: 5 },
      });
      return (found.body?.executions ?? [])[0] ?? null;
    },
    timeoutMs,
    `${workflow} to be started by an event`
  ).catch(() => null);
}

async function redisStreamSource(sources) {
  section('Redis Streams source');
  if (!sources.has('redis:default')) {
    check('redis connection configured', false, 'set NODE_FLOW_REDIS_CONNECTIONS — see index.mjs');
    return;
  }

  const workflow = unique('e2e_redis_wf');
  const topic = unique('orders_stream');
  await register({
    name: workflow,
    tasks: [inline('note', 'return { got: $.id };', { id: '${workflow.input.orderId}' })],
    outputParameters: { got: '${note.output.got}' },
  });

  const handler = await handlerFor('redis:default', topic, workflow);
  check('handler created', handler.status < 300, `${handler.status} ${JSON.stringify(handler.body).slice(0, 200)}`);
  if (handler.status >= 300) return;

  // A new consumer group starts at `$`, so it only sees messages published
  // after it exists — replaying history would start a workflow per historical
  // event. Give the consumer a moment to attach before publishing.
  const { published, run } = await publishUntilStarted(
    () => publishToRedis(topic, { orderId: 'redis-1' }),
    workflow
  );
  check('published to the stream', published, 'XADD failed');
  check('a stream message started a workflow', Boolean(run), 'none started');

  if (run) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${run.workflowId}`, {});
    check('the payload reached the workflow input', detail.body?.input?.orderId === 'redis-1', JSON.stringify(detail.body?.input));
  }

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler.body?.name}`, {});
}

async function natsSource(sources) {
  section('NATS source');
  if (!sources.has('nats:default')) {
    check('nats connection configured', false, 'set NODE_FLOW_NATS_CONNECTIONS — see index.mjs');
    return;
  }

  const workflow = unique('e2e_nats_wf');
  const topic = unique('orders.nats');
  await register({
    name: workflow,
    tasks: [inline('note', 'return { got: $.id };', { id: '${workflow.input.orderId}' })],
  });

  const handler = await handlerFor('nats:default', topic, workflow);
  check('handler created', handler.status < 300, `${handler.status} ${JSON.stringify(handler.body).slice(0, 200)}`);
  if (handler.status >= 300) return;

  const { published, run } = await publishUntilStarted(
    () => publishToNats(topic, { orderId: 'nats-1' }),
    workflow
  );
  check('published to the subject', published, 'publish failed');
  check('a subject message started a workflow', Boolean(run), 'none started');

  if (run) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${run.workflowId}`, {});
    check('the payload reached the workflow input', detail.body?.input?.orderId === 'nats-1', JSON.stringify(detail.body?.input));
  }

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler.body?.name}`, {});
}

async function natsSink(sources) {
  section('status listener to NATS');
  if (!sources.has('nats:default')) {
    check('nats connection configured', false, 'skipped');
    return;
  }

  const subject = unique('status.sink');
  const listener = unique('e2e_natslistener');

  const created = await call('POST', `/v1/ns/${NS}/status-listeners`, {
    body: {
      name: listener,
      workflowNames: ['*'],
      events: ['COMPLETED'],
      sink: 'NATS',
      config: { connection: 'default', destination: subject },
    },
  });
  check('listener created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 250)}`);
  if (created.status >= 300) return;

  // "Send test" exists precisely so an operator can prove a sink works without
  // waiting for a real workflow to finish. It delivers synchronously and says
  // so in its own response — and deliberately does not touch the operational
  // counters, which would otherwise show traffic that never happened.
  const tested = await call('POST', `/v1/ns/${NS}/status-listeners/${listener}/test`, { body: {} });
  check('a test delivery is accepted', tested.status < 300, `${tested.status} ${JSON.stringify(tested.body).slice(0, 200)}`);
  check('and reports that it reached the broker', tested.body?.delivered === true, JSON.stringify(tested.body).slice(0, 200));

  // A real run is what moves the counters, through the outbox relay.
  const watched = unique('e2e_watched');
  await register({ name: watched, tasks: [inline('only', 'return { done: true };')] });
  await call('POST', `/v1/ns/${NS}/executions/${watched}`, { body: { input: {} } });

  const state = await until(
    async () => {
      const current = await call('GET', `/v1/ns/${NS}/status-listeners/${listener}`, {});
      const body = current.body ?? {};
      return (body.deliveredCount ?? 0) > 0 || (body.failedCount ?? 0) > 0 ? body : null;
    },
    60_000,
    'a real completion to be delivered'
  ).catch(() => null);

  check('a real completion is counted rather than silently dropped', Boolean(state), 'neither delivered nor failed was recorded');
  check(
    'and it reached the broker rather than failing',
    (state?.deliveredCount ?? 0) > 0,
    `delivered=${state?.deliveredCount} failed=${state?.failedCount} lastError=${state?.lastError}`
  );

  await call('DELETE', `/v1/ns/${NS}/status-listeners/${listener}`, {});
}

async function eventTaskPublishes(sources) {
  section('EVENT task');
  if (!sources.has('nats:default')) {
    check('nats connection configured', false, 'skipped');
    return;
  }

  const subject = unique('emitted.subject');
  const emitter = unique('e2e_emitter');
  const listener = unique('e2e_listener_wf');

  // One workflow publishes, a handler on that subject starts another. Proving
  // the round trip is what shows the EVENT task reaches a real broker rather
  // than writing an outbox row nobody relays.
  await register({
    name: listener,
    tasks: [inline('note', 'return { got: $.id };', { id: '${workflow.input.orderId}' })],
  });

  const handler = await handlerFor('nats:default', subject, listener);
  check('handler created', handler.status < 300, `${handler.status} ${JSON.stringify(handler.body).slice(0, 200)}`);
  if (handler.status >= 300) return;

  await register({
    name: emitter,
    tasks: [
      {
        name: 'emit',
        taskReferenceName: 'emit',
        type: 'EVENT',
        inputParameters: { sink: `nats:default:${subject}`, orderId: 'from-event-task' },
      },
    ],
  });

  // Same race as the direct publishes, one step removed: here the message is
  // emitted by a workflow, so each attempt is a fresh run of the emitter.
  let started = { status: 0 };
  const { run } = await publishUntilStarted(async () => {
    started = await call('POST', `/v1/ns/${NS}/executions/${emitter}`, { body: { input: {} } });
    return started.status < 300;
  }, listener);

  check('the emitting workflow started', started.status < 300, `${started.status}`);
  check('the EVENT task reached the broker and started the listener', Boolean(run), 'none started');

  if (run) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${run.workflowId}`, {});
    check('carrying its payload', detail.body?.input?.orderId === 'from-event-task', JSON.stringify(detail.body?.input));
  }

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler.body?.name}`, {});
}

// --------------------------------------------------------------- publishing
//
// Written against the wire protocols directly rather than pulling in a client,
// so this suite keeps its property of depending on nothing the server depends
// on. Both are trivial for a single publish.

async function publishToRedis(stream, payload) {
  const { createConnection } = await import('node:net');
  const [host, port] = (process.env.REDIS_HOST ?? 'localhost:6399').split(':');

  return new Promise((resolve) => {
    const socket = createConnection({ host, port: Number(port) }, () => {
      // `body` is the field the Redis source reads; anything else is ignored.
      const args = ['XADD', stream, '*', 'body', JSON.stringify(payload)];
      // RESP: an array of bulk strings.
      const command =
        `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('');
      socket.write(command);
    });
    socket.on('data', (data) => {
      socket.end();
      resolve(!data.toString().startsWith('-'));
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
  });
}

async function publishToNats(subject, payload) {
  const { createConnection } = await import('node:net');
  const [host, port] = (process.env.NATS_HOST ?? 'localhost:4232').split(':');

  return new Promise((resolve) => {
    const socket = createConnection({ host, port: Number(port) }, () => undefined);
    let greeted = false;

    socket.on('data', (data) => {
      const text = data.toString();
      // The server speaks first with INFO; CONNECT then PUB completes a publish.
      if (!greeted && text.startsWith('INFO')) {
        greeted = true;
        socket.write('CONNECT {"verbose":false,"pedantic":false}\r\n');
        const body = JSON.stringify(payload);
        socket.write(`PUB ${subject} ${Buffer.byteLength(body)}\r\n${body}\r\n`);
        socket.write('PING\r\n');
        return;
      }
      if (greeted && text.includes('PONG')) {
        socket.end();
        resolve(true);
      }
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
  });
}
