import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { EventDispatcher } from './event-dispatcher.js';
import { EventExecutionRepository } from './event-execution.repository.js';
import { EventHandlerRepository } from './event-handler.repository.js';
import { IncomingWebhookRepository, WEBHOOK_SOURCE } from './incoming-webhook.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import { SecretCipher, parseMasterKeys } from './secret-crypto.js';
import { SecretRepository } from './secret.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Inbound webhooks, end to end below HTTP: a signed request in, a workflow out —
 * and every way a forged, replayed or misdirected request must fail to do that.
 */

let harness: PostgresHarness;
let webhooks: IncomingWebhookRepository;
let handlers: EventHandlerRepository;
let secrets: SecretRepository;
let metadata: MetadataRepository;
let monitor: EventExecutionRepository;
let namespaceId: string;

const SECRET = 'gh-webhook-secret';

beforeAll(async () => {
  harness = await startPostgresHarness();
  secrets = new SecretRepository(harness.db, new SecretCipher(parseMasterKeys(`k1:${randomBytes(32).toString('base64')}`)));
  handlers = new EventHandlerRepository(harness.db);
  metadata = new MetadataRepository(harness.db);
  monitor = new EventExecutionRepository(harness.db);
  const dispatcher = new EventDispatcher(harness.db, handlers, new WorkflowRepository(harness.db), metadata, new DecideQueueRepository(harness.db), { monitor });
  webhooks = new IncomingWebhookRepository(harness.db, secrets, dispatcher);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  await metadata.registerWorkflow({
    namespaceId,
    definition: { name: 'on-push', version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.NOOP }] },
  });
  await secrets.put({ namespaceId, name: 'github-secret', value: SECRET });
});

const github = () => webhooks.create(namespaceId, { name: 'github', verifier: 'GITHUB', secretName: 'github-secret' });
const handler = (overrides: Record<string, unknown> = {}, ns = namespaceId) =>
  handlers.create({
    namespaceId: ns,
    name: 'deploy-on-push',
    source: WEBHOOK_SOURCE,
    topic: 'github',
    action: 'START_WORKFLOW',
    defName: 'on-push',
    inputTemplate: { ref: '${event.output.ref}' },
    ...overrides,
  });

function signed(body: Record<string, JsonValue>, delivery = 'd-1', secret = SECRET) {
  const rawBody = JSON.stringify(body, null, 1);
  return {
    rawBody,
    body,
    headers: {
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
      'x-github-delivery': delivery,
      'x-github-event': 'push',
    },
  };
}

const executions = () => harness.db.selectFrom('WorkflowExecutions').select(['input', 'namespaceId']).execute();

describe('incoming webhooks', () => {
  it('starts a workflow from a verified delivery, with the payload and safe headers', async () => {
    const hook = await github();
    await handler();

    const outcome = await webhooks.receive({ id: hook.id, ...signed({ ref: 'refs/heads/main' }) });

    expect(outcome).toMatchObject({ status: 'accepted', result: { matched: 1, acted: 1 } });
    const [run] = await executions();
    expect(run.input).toMatchObject({ ref: 'refs/heads/main', _event: { source: 'webhook', topic: 'github', key: 'd-1' } });
    expect((await webhooks.get(namespaceId, 'github'))?.receivedCount).toBe(1);
    const [seen] = (await monitor.list(namespaceId)).executions;
    expect(seen).toMatchObject({ outcome: 'ACTED', topic: 'github' });
  });

  it('refuses a forged or tampered delivery and does nothing else', async () => {
    const hook = await github();
    await handler();

    const forged = signed({ ref: 'main' }, 'd-2', 'guessed-secret');
    const tampered = { ...signed({ ref: 'main' }), rawBody: JSON.stringify({ ref: 'evil' }) };

    expect(await webhooks.receive({ id: hook.id, ...forged })).toEqual({ status: 'rejected', reason: 'signature does not match' });
    expect((await webhooks.receive({ id: hook.id, ...tampered })).status).toBe('rejected');
    expect(await executions()).toEqual([]);
    expect((await monitor.list(namespaceId)).executions).toEqual([]);
    expect(await webhooks.get(namespaceId, 'github')).toMatchObject({ rejectedCount: 2, receivedCount: 0 });
  });

  it('starts one workflow however many times the sender retries a delivery', async () => {
    const hook = await github();
    await handler();
    const delivery = signed({ ref: 'main' }, 'same-delivery');

    await webhooks.receive({ id: hook.id, ...delivery });
    await webhooks.receive({ id: hook.id, ...delivery });

    expect(await executions()).toHaveLength(1);
  });

  it('never reaches a handler in another namespace listening to the same name', async () => {
    const hook = await github();
    const other = await seedNamespace(harness.db, 'other');
    await metadata.registerWorkflow({
      namespaceId: other,
      definition: { name: 'on-push', version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.NOOP }] },
    });
    await handler({}, other);

    const outcome = await webhooks.receive({ id: hook.id, ...signed({ ref: 'main' }) });

    expect(outcome).toMatchObject({ status: 'accepted', result: { matched: 0 } });
    expect(await executions()).toEqual([]);
    expect((await webhooks.get(namespaceId, 'github'))?.lastError).toMatch(/no enabled event handler/);
  });

  it('treats an unknown, malformed or disabled webhook alike', async () => {
    const hook = await github();
    await webhooks.update(namespaceId, 'github', { verifier: 'GITHUB', secretName: 'github-secret', enabled: false });

    expect(await webhooks.receive({ id: hook.id, ...signed({}) })).toEqual({ status: 'not_found' });
    expect(await webhooks.receive({ id: '01a0abd8-7713-7f23-926f-4343e84844ed', ...signed({}) })).toEqual({ status: 'not_found' });
    expect(await webhooks.receive({ id: 'not-a-uuid', ...signed({}) })).toEqual({ status: 'not_found' });
  });

  it('answers Slack’s signed URL challenge, and only when signed', async () => {
    await secrets.put({ namespaceId, name: 'slack-secret', value: 'slack' });
    const hook = await webhooks.create(namespaceId, { name: 'slack', verifier: 'SLACK', secretName: 'slack-secret' });
    const body = { type: 'url_verification', challenge: 'abc123' };
    const rawBody = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', 'slack').update(`v0:${ts}:${rawBody}`).digest('hex')}`;

    expect(
      await webhooks.receive({ id: hook.id, rawBody, body, headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': ts } })
    ).toEqual({ status: 'challenge', challenge: 'abc123' });
    expect((await webhooks.receive({ id: hook.id, rawBody, body, headers: { 'x-slack-request-timestamp': ts } })).status).toBe('rejected');
  });

  it('rejects when the named secret does not exist, rather than accepting unsigned', async () => {
    const hook = await webhooks.create(namespaceId, { name: 'dangling', verifier: 'GITHUB', secretName: 'missing' });
    expect((await webhooks.receive({ id: hook.id, ...signed({}) })).status).toBe('rejected');
  });

  it('refuses a definition that could not verify anything', async () => {
    await expect(webhooks.create(namespaceId, { name: 'x', verifier: 'GITHUB' })).rejects.toThrow(/needs a secret/);
    await expect(webhooks.create(namespaceId, { name: 'y', verifier: 'HMAC', secretName: 's' })).rejects.toThrow(/needs the header/);
    await expect(webhooks.create(namespaceId, { name: 'Bad Name', verifier: 'NONE' })).rejects.toThrow(/lower-case/);
    await github();
    await expect(github()).rejects.toThrow(/already exists/);
  });
});
