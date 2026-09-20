import { WorkflowStatus, type JsonValue } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxRepository, type OutboxEvent } from './outbox.repository.js';
import {
  STATUS_LISTENER_TOPIC,
  StatusListenerRepository,
  statusListenerHandler,
  statusSinkSender,
  type StatusListener,
} from './status-listener.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Status listeners: every lifecycle change of an execution, to the sinks that
 * asked for it — written in the transaction that made the change, delivered
 * per listener so one broken sink never holds up another.
 */

let harness: PostgresHarness;
let listeners: StatusListenerRepository;
let workflows: WorkflowRepository;
let outbox: OutboxRepository;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  listeners = new StatusListenerRepository(harness.db);
  workflows = new WorkflowRepository(harness.db, undefined, undefined, listeners);
  outbox = new OutboxRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

const webhook = (name: string, overrides: Record<string, unknown> = {}) =>
  listeners.create(namespaceId, { name, sink: 'WEBHOOK', config: { url: 'https://hooks.example.com/nf' }, ...overrides });

const queued = async () =>
  (
    await harness.db
      .selectFrom('OutboxEvents')
      .select(['topic', 'payload'])
      .where('topic', '=', STATUS_LISTENER_TOPIC)
      .orderBy('id')
      .execute()
  ).map((row) => row.payload as { listenerId: string; event: Record<string, JsonValue> });

const finish = (workflowId: string, status: string, output?: Record<string, JsonValue>, reason?: string) =>
  harness.db.transaction().execute((tx) => workflows.setStatus(workflowId, status as WorkflowStatus, output, reason, tx));

describe('status listeners', () => {
  it('refuses a listener it could never deliver', async () => {
    await expect(webhook('Bad Name')).rejects.toThrow(/lowercase/);
    await expect(listeners.create(namespaceId, { name: 'x', sink: 'WEBHOOK', config: { url: 'ftp://nope' } })).rejects.toThrow(/http or https/);
    await expect(listeners.create(namespaceId, { name: 'x', sink: 'KAFKA', config: { cluster: 'main' } as never })).rejects.toThrow(/topic/);
    await expect(webhook('x', { events: ['EXPLODED'] })).rejects.toThrow(/not a status event/);
    await webhook('dupe');
    await expect(webhook('dupe')).rejects.toThrow(/already exists/);
  });

  it('records a change once per matching listener, with who, what and why', async () => {
    const all = await webhook('everything');
    const failures = await webhook('failures', { events: ['FAILED', 'TIMED_OUT'], workflowNames: ['billing_*'] });
    await webhook('other-workflows', { workflowNames: ['shipping'] });
    await webhook('off', { enabled: false });

    const wf = await workflows.start({ namespaceId, defName: 'billing_run', defVersion: 3, correlationId: 'inv-7' });
    await finish(wf.id, WorkflowStatus.FAILED, undefined, 'card declined');

    const events = await queued();
    expect(events.map((e) => [e.listenerId, e.event['event']])).toEqual([
      [all.id, 'STARTED'],
      [all.id, 'FAILED'],
      [failures.id, 'FAILED'],
    ]);
    expect(events[1].event).toMatchObject({
      type: 'workflow.status',
      status: 'FAILED',
      workflowId: wf.id,
      workflowName: 'billing_run',
      workflowVersion: 3,
      correlationId: 'inv-7',
      reason: 'card declined',
    });
    // One change, one id, whichever listener receives it — so a receiver
    // subscribed twice can deduplicate.
    expect(events[1].event['id']).toBe(events[2].event['id']);
  });

  it('writes nothing for a change that rolled back', async () => {
    await webhook('everything');
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    const before = (await queued()).length;

    await expect(
      harness.db.transaction().execute(async (tx) => {
        await workflows.setStatus(wf.id, WorkflowStatus.COMPLETED, {}, undefined, tx);
        throw new Error('evaluation failed after the status write');
      })
    ).rejects.toThrow();

    expect(await queued()).toHaveLength(before);
  });

  it('names pause, resume and restart as such', async () => {
    await webhook('everything', { events: ['PAUSED', 'RESUMED', 'RESTARTED'] });
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await finish(wf.id, WorkflowStatus.PAUSED);
    await finish(wf.id, WorkflowStatus.RUNNING);
    await harness.db.transaction().execute((tx) => workflows.recordStatusChange({ workflowId: wf.id, event: 'RESTARTED' }, tx));

    expect((await queued()).map((e) => e.event['event'])).toEqual(['PAUSED', 'RESUMED', 'RESTARTED']);
  });

  it('includes output only when asked, and masks it', async () => {
    await webhook('plain');
    await webhook('with-output', { includeOutput: true });
    const wf = await workflows.start({ namespaceId, defName: 'payments', defVersion: 1 });
    await finish(wf.id, WorkflowStatus.COMPLETED, { amount: 42, card: '4242424242424242' });

    const [plain, withOutput] = (await queued()).filter((e) => e.event['event'] === 'COMPLETED');
    expect(plain.event['output']).toBeUndefined();
    expect(withOutput.event['output']).toEqual({ amount: 42, card: '4242424242424242' });

    const sent: Record<string, JsonValue>[] = [];
    const handler = statusListenerHandler(listeners, async (_listener, event) => void sent.push(event), async () => ['card']);
    await handler({ id: '1', namespaceId, topic: STATUS_LISTENER_TOPIC, payload: withOutput as never, createdAt: new Date(), attempts: 0 });
    expect(sent[0]['output']).toEqual({ amount: 42, card: '***' });
  });

  it('delivers each listener on its own: one failing sink does not hold up another', async () => {
    const good = await webhook('good');
    const bad = await webhook('bad');
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await finish(wf.id, WorkflowStatus.COMPLETED, {});

    const delivered: string[] = [];
    const send = async (listener: StatusListener, event: Record<string, JsonValue>) => {
      if (listener.name === 'bad') throw new Error('503 from receiver');
      delivered.push(`${listener.name}:${event['event']}`);
    };
    const relay = new OutboxRelay(harness.db, outbox).on(STATUS_LISTENER_TOPIC, statusListenerHandler(listeners, send));

    expect(await relay.relay()).toMatchObject({ delivered: 2, failed: 2 });
    expect(delivered).toEqual(['good:STARTED', 'good:COMPLETED']);

    expect(await listeners.get(namespaceId, 'good')).toMatchObject({ deliveredCount: 2, failedCount: 0, lastError: null });
    expect(await listeners.get(namespaceId, 'bad')).toMatchObject({ deliveredCount: 0, failedCount: 2, lastError: '503 from receiver' });
    expect(good.id).not.toBe(bad.id);
  });

  it('drops events for a listener disabled or deleted since, instead of retrying them', async () => {
    await webhook('soon-off');
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await listeners.update(namespaceId, 'soon-off', { sink: 'WEBHOOK', config: { url: 'https://hooks.example.com/nf' }, enabled: false });

    let calls = 0;
    const relay = new OutboxRelay(harness.db, outbox).on(STATUS_LISTENER_TOPIC, statusListenerHandler(listeners, async () => void calls++));
    expect(await relay.relay()).toMatchObject({ delivered: 1, failed: 0 });
    expect(calls).toBe(0);
    expect(wf.id).toBeTruthy();
  });

  it('signs webhook deliveries with the named secret and sends Kafka keyed by execution', async () => {
    const hook = await webhook('signed', { config: { url: 'https://hooks.example.com/nf', secretName: 'hook-key', headers: { 'x-team': 'payments' } } });
    const kafka = await listeners.create(namespaceId, { name: 'stream', sink: 'KAFKA', config: { cluster: 'main', topic: 'wf-status' } });

    const requests: unknown[] = [];
    const messages: unknown[] = [];
    const send = statusSinkSender({
      secrets: { resolve: async (_ns, names) => Object.fromEntries(names.map((n) => [n, `secret-of-${n}`])) },
      kafka: new Map([['main', { send: async (m) => void messages.push(m), disconnect: async () => undefined }]]),
      webhook: async (request) => void requests.push(request),
    });
    const event = { id: 'evt-1', workflowId: 'wf-9', event: 'COMPLETED' };

    await send(hook, event);
    await send(kafka, event);
    expect(requests).toEqual([{ url: 'https://hooks.example.com/nf', event, secret: 'secret-of-hook-key', headers: { 'x-team': 'payments' }, deliveryId: 'evt-1' }]);
    expect(messages).toEqual([{ topic: 'wf-status', key: 'wf-9', value: event, headers: { 'x-nodeflow-event-id': 'evt-1' } }]);

    const unconfigured = await listeners.create(namespaceId, { name: 'elsewhere', sink: 'KAFKA', config: { cluster: 'other', topic: 't' } });
    await expect(send(unconfigured, event)).rejects.toThrow(/no Kafka cluster "other"/);
  });

  it('publishes to a NATS, AMQP or SQS connection by its sink prefix, keyed by execution', async () => {
    const sent: unknown[] = [];
    const broker = (kind: string) => ({ send: async (...args: unknown[]) => void sent.push([kind, ...args]) });
    const send = statusSinkSender({
      brokers: new Map([
        ['nats:default:', broker('nats')],
        ['sqs:aws:', broker('sqs')],
      ]),
      webhook: async () => undefined,
    });
    const event = { id: 'evt-2', workflowId: 'wf-3', event: 'FAILED' };

    const nats = await listeners.create(namespaceId, { name: 'nats', sink: 'NATS', config: { connection: ' default ', destination: 'wf.status' } });
    expect(nats.config).toEqual({ connection: 'default', destination: 'wf.status' });
    await send(nats, event);
    await send(await listeners.create(namespaceId, { name: 'sqs', sink: 'SQS', config: { connection: 'aws', destination: 'status.fifo' } }), event);
    expect(sent).toEqual([
      ['nats', 'wf.status', JSON.stringify(event), 'evt-2', 'wf-3'],
      ['sqs', 'status.fifo', JSON.stringify(event), 'evt-2', 'wf-3'],
    ]);

    // Same connection name, different kind: never delivered to the wrong broker.
    const amqp = await listeners.create(namespaceId, { name: 'amqp', sink: 'AMQP', config: { connection: 'default', destination: 'q' } });
    await expect(send(amqp, event)).rejects.toThrow(/no AMQP connection "default"/);
    await expect(listeners.create(namespaceId, { name: 'bad', sink: 'NATS', config: { connection: 'default' } as never })).rejects.toThrow(/destination/);
  });
});

// Keeps the import used when the relay type changes shape.
export type _Event = OutboxEvent;
