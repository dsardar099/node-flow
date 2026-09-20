import {
  InvalidArgumentError,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  type JsonValue,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { EventDispatcher, type InboundMessage } from './event-dispatcher.js';
import { EventExecutionRepository, MAX_MONITOR_PAYLOAD_BYTES } from './event-execution.repository.js';
import { EventHandlerRepository, type NewEventHandler } from './event-handler.repository.js';
import { toInbound } from './kafka-source.js';
import { MetadataRepository } from './metadata.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Inbound event handlers.
 *
 * The transport is deliberately absent from most of this file: matching,
 * filtering, expression resolution and idempotency are all decided by the
 * dispatcher, and testing them through a broker would only make the same
 * assertions slower and flakier.
 */

let harness: PostgresHarness;
let handlers: EventHandlerRepository;
let workflows: WorkflowRepository;
let metadata: MetadataRepository;
let decideQueue: DecideQueueRepository;
let dispatcher: EventDispatcher;
let namespaceId: string;

const definition = {
  name: 'on-order',
  version: 1,
  tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.NOOP }],
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  handlers = new EventHandlerRepository(harness.db);
  workflows = new WorkflowRepository(harness.db);
  metadata = new MetadataRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  dispatcher = new EventDispatcher(harness.db, handlers, workflows, metadata, decideQueue);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  await metadata.registerWorkflow({ namespaceId, definition });
});

const handler = (overrides: Partial<NewEventHandler> = {}) =>
  handlers.create({
    namespaceId,
    name: 'orders',
    source: 'kafka:default',
    topic: 'orders',
    action: 'START_WORKFLOW',
    defName: 'on-order',
    defVersion: 1,
    ...overrides,
  });

let deliveries = 0;
const message = (payload: Record<string, JsonValue>, overrides: Partial<InboundMessage> = {}) => ({
  source: 'kafka:default',
  topic: 'orders',
  payload,
  deliveryId: `orders:0:${++deliveries}`,
  ...overrides,
});

const executions = () =>
  harness.db.selectFrom('WorkflowExecutions').select(['id', 'input', 'correlationId']).execute();

describe('defining a handler', () => {
  // A handler missing the workflow it starts would look healthy until the first
  // message arrived, then fail once per message with nobody watching.
  it('refuses START_WORKFLOW with no workflow named', async () => {
    await expect(handler({ defName: undefined })).rejects.toThrow(InvalidArgumentError);
  });

  it('refuses a task action that cannot say which task', async () => {
    await expect(handler({ action: 'COMPLETE_TASK' })).rejects.toThrow(InvalidArgumentError);
  });

  it('refuses an unknown action', async () => {
    await expect(handler({ action: 'EXPLODE' as never })).rejects.toThrow(InvalidArgumentError);
  });

  it('refuses a duplicate name', async () => {
    await handler();
    await expect(handler()).rejects.toThrow(/already exists/);
  });

  it('lists the topics a source must subscribe to', async () => {
    await handler({ name: 'a', topic: 'orders' });
    await handler({ name: 'b', topic: 'refunds' });
    await handler({ name: 'c', topic: 'orders' });
    await handler({ name: 'd', topic: 'ignored', enabled: false });

    const topics = await handlers.topicsFor('kafka:default');
    expect(topics.sort()).toEqual(['orders', 'refunds']);
  });
});

describe('editing a handler', () => {
  const edit = (overrides: Partial<Parameters<EventHandlerRepository['update']>[2]> = {}) =>
    handlers.update(namespaceId, 'orders', {
      source: 'kafka:default',
      topic: 'orders-v2',
      action: 'START_WORKFLOW',
      defName: 'on-order',
      ...overrides,
    });

  it('replaces the settings, keeps the counters and clears a stale error', async () => {
    const created = await handler();
    await harness.db
      .updateTable('EventHandlers')
      .set({ eventCount: '12', lastError: 'boom' })
      .where('id', '=', created.id)
      .execute();

    const updated = await edit({ condition: "$.type == 'paid'" });
    expect(updated).toMatchObject({ topic: 'orders-v2', condition: "$.type == 'paid'", eventCount: 12, lastError: null });
    expect(await handlers.topicsFor('kafka:default')).toEqual(['orders-v2']);
  });

  it('holds an edit to the same rules as creation', async () => {
    await handler();
    await expect(edit({ action: 'COMPLETE_TASK' })).rejects.toThrow(InvalidArgumentError);
    expect((await handlers.findByName(namespaceId, 'orders'))?.topic).toBe('orders');
  });

  it('keeps a disabled handler disabled unless told otherwise', async () => {
    await handler({ enabled: false });
    expect((await edit()).enabled).toBe(false);
  });

  it('reports a handler that does not exist', async () => {
    await expect(edit()).rejects.toThrow(/no event handler/);
  });
});

describe('starting a workflow from a message', () => {
  it('starts one and records the delivery', async () => {
    await handler();

    const result = await dispatcher.dispatch(message({ orderId: 'A-1' }));

    expect(result).toMatchObject({ matched: 1, acted: 1 });
    expect(await executions()).toHaveLength(1);

    const [after] = await handlers.list(namespaceId);
    expect(after.eventCount).toBe(1);
    expect(after.lastError).toBeNull();
  });

  // An author who can write a task input parameter can write this without
  // learning anything new.
  it('maps the message into the input with expressions', async () => {
    await handler({
      inputTemplate: { id: '${event.output.orderId}', total: '${event.output.amount}' },
    });

    await dispatcher.dispatch(message({ orderId: 'A-1', amount: 42 }));

    const [execution] = await executions();
    const input = execution.input as Record<string, JsonValue>;
    expect(input['id']).toBe('A-1');
    expect(input['total']).toBe(42);
  });

  // A template that forgot a field is a common mistake and an unrecoverable one
  // if the original message is discarded.
  it('always carries the raw message too', async () => {
    await handler({ inputTemplate: { id: '${event.output.orderId}' } });

    await dispatcher.dispatch(message({ orderId: 'A-1', extra: 'kept' }));

    const [execution] = await executions();
    const event = (execution.input as Record<string, JsonValue>)['_event'] as Record<
      string,
      JsonValue
    >;
    expect((event['payload'] as Record<string, JsonValue>)['extra']).toBe('kept');
    expect(event['topic']).toBe('orders');
  });

  it('resolves a correlation id from the message', async () => {
    await handler({ correlationId: '${event.output.orderId}' });

    await dispatcher.dispatch(message({ orderId: 'A-1' }));

    expect((await executions())[0].correlationId).toBe('A-1');
  });

  it('ignores a message on a topic nothing handles', async () => {
    await handler();

    const result = await dispatcher.dispatch(message({}, { topic: 'unrelated' }));

    expect(result.matched).toBe(0);
    expect(await executions()).toEqual([]);
  });

  it('fans one message out to every matching handler', async () => {
    await handler({ name: 'a' });
    await handler({ name: 'b' });

    const result = await dispatcher.dispatch(message({ orderId: 'A-1' }));

    expect(result.acted).toBe(2);
    expect(await executions()).toHaveLength(2);
  });

  // A single broken handler on a busy topic must not silence every other
  // subscriber to it.
  it('keeps going when one handler is broken', async () => {
    await handler({ name: 'broken', defName: 'no-such-workflow', defVersion: 1 });
    await handler({ name: 'healthy' });

    const result = await dispatcher.dispatch(message({ orderId: 'A-1' }));

    expect(result.failed).toBe(1);
    expect(result.acted).toBe(1);

    const broken = await handlers.findByName(namespaceId, 'broken');
    expect(broken!.lastError).toBeTruthy();
  });
});

/**
 * Consumers are at-least-once: a crash between acting and committing an offset
 * redelivers the message. Without this, a redelivered payment notification
 * starts a second workflow.
 */
describe('redelivery', () => {
  it('starts one workflow however many times a message is delivered', async () => {
    await handler();
    const delivered = message({ orderId: 'A-1' });

    await dispatcher.dispatch(delivered);
    await dispatcher.dispatch(delivered);
    await dispatcher.dispatch(delivered);

    expect(await executions()).toHaveLength(1);
  });

  it('treats a different delivery as a different event', async () => {
    await handler();

    await dispatcher.dispatch(message({ orderId: 'A-1' }));
    await dispatcher.dispatch(message({ orderId: 'A-2' }));

    expect(await executions()).toHaveLength(2);
  });

  // Two handlers on one message are two independent actions, so they must not
  // deduplicate against each other.
  it('does not collapse two handlers seeing the same delivery', async () => {
    await handler({ name: 'a' });
    await handler({ name: 'b' });
    const delivered = message({ orderId: 'A-1' });

    await dispatcher.dispatch(delivered);

    expect(await executions()).toHaveLength(2);
  });
});

describe('conditions', () => {
  it('acts only when the condition holds', async () => {
    await handler({ condition: 'return $.status === "PAID"' });

    await dispatcher.dispatch(message({ status: 'PENDING' }));
    expect(await executions()).toEqual([]);

    await dispatcher.dispatch(message({ status: 'PAID' }));
    expect(await executions()).toHaveLength(1);
  });

  it('reports a skip rather than an action', async () => {
    await handler({ condition: 'return false' });

    expect(await dispatcher.dispatch(message({}))).toMatchObject({ matched: 1, skipped: 1 });
  });

  // A filter that cannot decide must not start a workflow.
  it('does not act when the condition cannot be evaluated', async () => {
    await handler({ condition: 'return $.nope.deeper === 1' });

    const result = await dispatcher.dispatch(message({}));

    expect(result.failed).toBe(1);
    expect(await executions()).toEqual([]);
  });

  // The condition is user-supplied code arriving through an API, so it runs in
  // the same sandbox as INLINE — a runaway one must fail, not hang the consumer.
  it('bounds a condition that never returns', async () => {
    await handler({ condition: 'while (true) {}' });

    const result = await dispatcher.dispatch(message({}));

    expect(result.failed).toBe(1);
    expect(await executions()).toEqual([]);
  }, 30_000);
});

/**
 * The other half: a workflow that waits, and a message that finishes it.
 */
describe('completing a task from a message', () => {
  async function waitingWorkflow() {
    const wf = await workflows.start({ namespaceId, defName: 'on-order', defVersion: 1 });
    await workflows.insertTask(
      {
        workflowId: wf.id,
        namespaceId,
        refName: 'await-payment',
        taskDefName: 'await-payment',
        taskType: TaskType.WAIT_FOR_WEBHOOK,
        status: TaskStatus.IN_PROGRESS,
        attempt: 0,
        iteration: 0,
        input: {},
      },
      harness.db
    );
    return wf;
  }

  const taskHandler = (overrides: Partial<NewEventHandler> = {}) =>
    handler({
      name: 'payments',
      topic: 'payments',
      action: 'COMPLETE_TASK',
      workflowIdExpr: '${event.output.workflowId}',
      taskRefExpr: '${event.output.taskRef}',
      ...overrides,
    });

  it('completes the named task and wakes the workflow', async () => {
    const wf = await waitingWorkflow();
    await taskHandler();

    const result = await dispatcher.dispatch(
      message(
        { workflowId: wf.id, taskRef: 'await-payment', paid: true },
        { topic: 'payments' }
      )
    );

    expect(result.acted).toBe(1);

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'output'])
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'await-payment')
      .executeTakeFirstOrThrow();

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect((task.output as Record<string, JsonValue>)['paid']).toBe(true);
  });

  it('fails the task when the handler says so', async () => {
    const wf = await waitingWorkflow();
    await taskHandler({ action: 'FAIL_TASK' });

    await dispatcher.dispatch(
      message({ workflowId: wf.id, taskRef: 'await-payment' }, { topic: 'payments' })
    );

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(task.status).toBe(TaskStatus.FAILED);
    expect(task.reasonForIncompletion).toContain('event');
  });

  // The shape of a redelivery, and not an error.
  it('is quiet when the task has already finished', async () => {
    const wf = await waitingWorkflow();
    await taskHandler();
    const delivered = message(
      { workflowId: wf.id, taskRef: 'await-payment' },
      { topic: 'payments' }
    );

    await dispatcher.dispatch(delivered);
    const second = await dispatcher.dispatch(delivered);

    expect(second.failed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  // Found by the event monitor: this surfaced Postgres's own uuid syntax error.
  it('reports a malformed workflow id as no such workflow', async () => {
    await taskHandler();
    const monitor = new EventExecutionRepository(harness.db);
    const withMonitor = new EventDispatcher(harness.db, handlers, workflows, metadata, decideQueue, { monitor });

    const result = await withMonitor.dispatch(message({ workflowId: 'not-a-uuid', taskRef: 'x' }, { topic: 'payments' }));

    expect(result.failed).toBe(1);
    const [row] = (await monitor.list(namespaceId)).executions;
    expect(row.detail).toBe('no workflow not-a-uuid in this namespace');
  });

  /**
   * Ids are unguessable, but that is not access control.
   *
   * A handler in one namespace must not be able to complete another namespace's
   * task by naming its id in a message.
   */
  it('refuses to touch another namespace’s workflow', async () => {
    const other = await seedNamespace(harness.db, 'other');
    const foreign = await workflows.start({
      namespaceId: other,
      defName: 'on-order',
      defVersion: 1,
    });

    // The foreign workflow gets a task with the *same* ref name, so the only
    // thing standing between the handler and completing it is the namespace
    // check. An earlier version of this test omitted the task, and passed
    // because the lookup failed first — it survived deleting the check.
    await workflows.insertTask(
      {
        workflowId: foreign.id,
        namespaceId: other,
        refName: 'await-payment',
        taskDefName: 'await-payment',
        taskType: TaskType.WAIT_FOR_WEBHOOK,
        status: TaskStatus.IN_PROGRESS,
        attempt: 0,
        iteration: 0,
        input: {},
      },
      harness.db
    );

    await taskHandler();

    const result = await dispatcher.dispatch(
      message({ workflowId: foreign.id, taskRef: 'await-payment' }, { topic: 'payments' })
    );

    expect(result.failed).toBe(1);

    // Untouched.
    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', foreign.id)
      .executeTakeFirstOrThrow();
    expect(task.status).toBe(TaskStatus.IN_PROGRESS);
    expect((await workflows.findById(foreign.id))?.status).toBe(WorkflowStatus.RUNNING);
  });
});

/**
 * Turning a Kafka record into something the dispatcher understands.
 *
 * Pure, so it is tested here rather than against a broker.
 */
describe('reading a Kafka record', () => {
  const record = (value: string | null, offset = '7') => ({
    key: Buffer.from('k-1'),
    value: value === null ? null : Buffer.from(value),
    offset,
    headers: { trace: 'abc' },
  });

  it('parses a JSON body', () => {
    const inbound = toInbound('kafka:default', 'orders', 2, record('{"orderId":"A-1"}'));

    expect(inbound.payload).toEqual({ orderId: 'A-1' });
    expect(inbound.key).toBe('k-1');
    expect(inbound.headers).toEqual({ trace: 'abc' });
  });

  // Partition and offset identify a record exactly, and survive the redelivery
  // an uncommitted offset causes.
  it('identifies the delivery by partition and offset', () => {
    expect(toInbound('kafka:default', 'orders', 2, record('{}', '99')).deliveryId).toBe(
      'orders:2:99'
    );
  });

  // Plenty of real topics carry plain text, and a condition can still read it.
  it('carries a non-JSON body rather than rejecting it', () => {
    expect(toInbound('kafka:default', 'orders', 0, record('not json')).payload).toEqual({
      body: 'not json',
    });
  });

  it('handles an empty message', () => {
    expect(toInbound('kafka:default', 'orders', 0, record(null)).payload).toEqual({ body: null });
  });
});

describe('the event monitor', () => {
  let monitor: EventExecutionRepository;
  let monitored: EventDispatcher;

  beforeAll(() => {
    monitor = new EventExecutionRepository(harness.db);
    monitored = new EventDispatcher(harness.db, handlers, workflows, metadata, decideQueue, { monitor });
  });

  it('records what each handler did with each message, and why', async () => {
    await handler({ name: 'paid', condition: 'return $.status === "PAID"' });
    await handler({ name: 'all' });

    await monitored.dispatch(message({ status: 'PENDING' }, { key: 'order-1' }));
    await monitored.dispatch(message({ status: 'PAID' }));

    const { executions: rows } = await monitor.list(namespaceId);
    expect(rows).toHaveLength(4);
    const byHandler = (name: string) => rows.filter((r) => r.handlerName === name).map((r) => r.outcome).sort();
    expect(byHandler('paid')).toEqual(['ACTED', 'SKIPPED']);
    expect(byHandler('all')).toEqual(['ACTED', 'ACTED']);

    const skipped = rows.find((r) => r.outcome === 'SKIPPED');
    expect(skipped).toMatchObject({ detail: 'condition did not match', messageKey: 'order-1', payload: { status: 'PENDING' } });
    const acted = rows.find((r) => r.handlerName === 'paid' && r.outcome === 'ACTED');
    expect(acted?.workflowId).toBe((await executions()).find((e) => (e.input as { _event: { payload: { status?: string } } })._event.payload.status === 'PAID')?.id);
  });

  it('records a failure with its reason, and summarises activity per handler', async () => {
    await handler({ condition: 'return $.nope.deeper === 1' });
    await monitored.dispatch(message({}));
    await monitored.dispatch(message({}));

    const { executions: rows } = await monitor.list(namespaceId, { outcome: 'FAILED' });
    expect(rows).toHaveLength(2);
    expect(rows[0].detail).toMatch(/condition failed to evaluate/);

    expect(await monitor.activity(namespaceId)).toMatchObject([{ handlerName: 'orders', acted: 0, skipped: 0, failed: 2 }]);
  });

  it('pages newest first without repeating or dropping a row', async () => {
    await handler();
    for (let i = 0; i < 5; i++) await monitored.dispatch(message({ i }));

    const first = await monitor.list(namespaceId, { limit: 2 });
    const second = await monitor.list(namespaceId, { limit: 2, before: first.nextCursor });
    const third = await monitor.list(namespaceId, { limit: 2, before: second.nextCursor });

    const seen = [...first.executions, ...second.executions, ...third.executions].map((r) => r.payload['i']);
    expect(seen).toEqual([4, 3, 2, 1, 0]);
    expect(third.nextCursor).toBeUndefined();
  });

  it('summarises an oversized payload instead of storing it', async () => {
    await handler();
    await monitored.dispatch(message({ blob: 'x'.repeat(MAX_MONITOR_PAYLOAD_BYTES + 10) }));

    const [row] = (await monitor.list(namespaceId)).executions;
    expect(row.payload).toMatchObject({ _truncated: true });
    // The workflow itself still received the whole message.
    const [started] = await executions();
    expect(((started.input as { _event: { payload: { blob: string } } })._event.payload.blob).length).toBeGreaterThan(MAX_MONITOR_PAYLOAD_BYTES);
  });

  it('never shows one namespace another namespace’s events', async () => {
    await handler();
    await monitored.dispatch(message({}));
    const other = await seedNamespace(harness.db, 'other');
    expect((await monitor.list(other)).executions).toEqual([]);
    expect(await monitor.activity(other)).toEqual([]);
  });

  it('prunes rows past the retention window only', async () => {
    await handler();
    await monitored.dispatch(message({ old: true }));
    await monitored.dispatch(message({ old: false }));
    await sql`UPDATE "EventExecutions" SET at = now() - interval '8 days' WHERE payload->>'old' = 'true'`.execute(harness.db);

    expect(await monitor.prune(7)).toBe(1);
    const { executions: rows } = await monitor.list(namespaceId);
    expect(rows.map((r) => r.payload['old'])).toEqual([false]);
  });
});
