import {
  InvalidDefinitionError,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { RedpandaContainer, type StartedRedpandaContainer } from '@testcontainers/redpanda';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { KafkaJsProducer, kafkaOutboxHandler, type KafkaMessage } from './kafka-sink.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * `KAFKA_PUBLISH`.
 *
 * Two halves, tested separately because they fail differently. The decider half
 * writes the message to the outbox in the same transaction as the task, and is
 * testable with no broker at all. The delivery half is an outbox handler, and
 * is tested against a real Redpanda — the interesting behaviour there is a
 * broker's, and a stub would prove nothing about whether a message is actually
 * consumable.
 */

function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;
  const home = homedir();
  const socket = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ].find((path) => existsSync(path));
  if (!socket) return;
  process.env['DOCKER_HOST'] = `unix://${socket}`;
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[]): void {
    this.map.set(
      'wf:1',
      compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }))
    );
  }
  async load(): Promise<Blueprint> {
    const bp = this.map.get('wf:1');
    if (!bp) throw new Error('no blueprint');
    return bp;
  }
}

const defLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [
        name,
        taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0 }),
      ])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    defLoader,
    timers
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

const publishTask = (ref: string, input: Record<string, unknown>) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.KAFKA_PUBLISH,
  inputParameters: input,
});

async function start(tasks: unknown[]) {
  blueprints.register(tasks);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  for (let i = 0; i < 15; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;
  return wf;
}

const queued = () =>
  harness.db
    .selectFrom('OutboxEvents')
    .select(['topic', 'payload'])
    .where('topic', 'like', 'kafka:%')
    .execute();

describe('queueing a message', () => {
  it('writes it to the outbox and completes the task', async () => {
    const wf = await start([
      publishTask('emit', { topic: 'orders', key: 'A-1', value: { id: 'A-1' } }),
    ]);

    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe('kafka:default');

    const payload = rows[0].payload as Record<string, JsonValue>;
    expect(payload['topic']).toBe('orders');
    expect(payload['key']).toBe('A-1');
    expect(payload['value']).toEqual({ id: 'A-1' });

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  // Nothing executes it, so a queue entry would be reclaimed as abandoned.
  it('never reaches a task queue', async () => {
    const wf = await start([publishTask('emit', { topic: 'orders' })]);

    expect(
      await harness.db
        .selectFrom('TaskQueues')
        .select('taskId')
        .where('workflowId', '=', wf.id)
        .execute()
    ).toEqual([]);
  });

  // So a sink handler claims only its own cluster's messages.
  it('namespaces the sink by cluster', async () => {
    await start([publishTask('emit', { topic: 'orders', cluster: 'eu-west' })]);

    expect((await queued())[0].topic).toBe('kafka:eu-west');
  });

  it('treats the remaining inputs as the message when no value is given', async () => {
    await start([publishTask('emit', { topic: 'orders', id: 'A-1', total: 42 })]);

    const payload = (await queued())[0].payload as Record<string, JsonValue>;
    expect(payload['value']).toEqual({ id: 'A-1', total: 42 });
  });

  it('publishes once however many times the workflow is evaluated', async () => {
    const wf = await start([publishTask('emit', { topic: 'orders' })]);

    for (let i = 0; i < 5; i++) {
      await decideQueue.enqueue(namespaceId, wf.id, 'redundant pass');
      for (let j = 0; j < 5; j++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;
    }

    expect(await queued()).toHaveLength(1);
  });

  it('rejects a definition with no topic', () => {
    expect(() =>
      compileBlueprint(
        workflowDefinitionSchema.parse({
          name: 'wf',
          version: 1,
          tasks: [publishTask('emit', { key: 'A-1' })],
        })
      )
    ).toThrow(InvalidDefinitionError);
  });
});

describe('delivering to a broker', () => {
  let redpanda: StartedRedpandaContainer;
  let brokers: string[];

  beforeAll(async () => {
    ensureDockerHost();
    redpanda = await new RedpandaContainer('redpandadata/redpanda:v24.3.5').start();
    brokers = [`${redpanda.getHost()}:${redpanda.getMappedPort(9092)}`];
  }, 240_000);

  afterAll(async () => {
    await redpanda?.stop();
  }, 60_000);

  /** Reads back what actually landed, so "delivered" means consumable. */
  async function consume(topic: string, expected: number): Promise<KafkaMessage[]> {
    const { Kafka } = await import('kafkajs');
    const client = new Kafka({ clientId: 'test-consumer', brokers });
    const consumer = client.consumer({ groupId: `test-${Date.now()}-${Math.random()}` });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    const seen: KafkaMessage[] = [];
    await consumer.run({
      eachMessage: async ({ message }) => {
        seen.push({
          topic,
          key: message.key ? message.key.toString() : null,
          value: JSON.parse(message.value?.toString() ?? 'null'),
          headers: Object.fromEntries(
            Object.entries(message.headers ?? {}).map(([k, v]) => [k, String(v)])
          ),
        });
      },
    });

    const deadline = Date.now() + 30_000;
    while (seen.length < expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await consumer.disconnect();
    return seen;
  }

  it('delivers a queued message so a consumer can read it', async () => {
    const topic = `orders-${Date.now()}`;
    await start([
      publishTask('emit', { topic, key: 'A-1', value: { id: 'A-1', total: 42 } }),
    ]);

    const producer = new KafkaJsProducer({ brokers });
    const relay = new OutboxRelay(harness.db, outbox);
    relay.on('kafka:default', kafkaOutboxHandler(producer));

    const result = await relay.relay(10);
    expect(result.delivered).toBe(1);
    expect(result.delivered).toBe(1);

    const messages = await consume(topic, 1);
    expect(messages).toHaveLength(1);
    expect(messages[0].key).toBe('A-1');
    expect(messages[0].value).toEqual({ id: 'A-1', total: 42 });

    await producer.disconnect();
  }, 120_000);

  /**
   * The reason delivery is a relay handler rather than a task executor.
   *
   * A broker that is down must delay the message, not fail the workflow — the
   * workflow can do nothing about an outage, and burning its retry budget on
   * one loses work that was already durably recorded.
   */
  it('leaves the message for a retry when the broker is unreachable', async () => {
    await start([publishTask('emit', { topic: 'orders', value: { id: 'A-1' } })]);

    const unreachable = new KafkaJsProducer({
      brokers: ['127.0.0.1:1'],
      requestTimeoutMs: 2_000,
    });
    const relay = new OutboxRelay(harness.db, outbox);
    relay.on('kafka:default', kafkaOutboxHandler(unreachable));

    const result = await relay.relay(10);
    expect(result.delivered).toBe(0);
    expect(result.deadLettered).toBe(0);

    // Still there, and still not dead-lettered, so a later pass delivers it
    // once the broker is back. Asserted on the Kafka row specifically: the
    // engine publishes its own `workflow.completed` through the same outbox,
    // and counting both would measure two unrelated things.
    const remaining = await queued();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].topic).toBe('kafka:default');

    await unreachable.disconnect();
  }, 120_000);
});
