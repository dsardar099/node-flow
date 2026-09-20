import { createHmac } from 'node:crypto';
import {
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyRepository } from './concurrency.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { ExecutionControlService } from './execution-control.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimeoutSweeper } from './timeout-sweeper.js';
import { TimerRepository } from './timer.repository.js';
import { WebhookRepository, hashToken, verifySignature } from './webhook.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * `WAIT_FOR_WEBHOOK` — waiting on a third party.
 *
 * The token in the URL is the authorisation, because a third party cannot hold
 * an API credential. So the tests are about the properties that makes safe:
 * single-use under concurrency, hashed at rest, expiring, and closed when the
 * workflow ends.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let webhooks: WebhookRepository;
let control: ExecutionControlService;
let sweeper: TimeoutSweeper;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;
let taskDefs: Map<string, ReturnType<typeof taskDefinitionSchema.parse>>;

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
        taskDefs.get(name) ??
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
  webhooks = new WebhookRepository(harness.db, workflows, decideQueue);
  sweeper = new TimeoutSweeper(harness.db, timers, workflows, decideQueue);
  control = new ExecutionControlService(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    timers,
    new ConcurrencyRepository(harness.db),
    undefined,
    webhooks
  );
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    defLoader,
    timers,
    undefined,
    undefined,
    undefined,
    webhooks
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  taskDefs = new Map();
});

const waitForWebhook = (ref: string, input: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.WAIT_FOR_WEBHOOK,
  inputParameters: input,
});

async function start(tasks: unknown[]) {
  blueprints.register(tasks);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await drain(wf.id);
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 15; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

/** The token the engine published on the waiting task. */
async function tokenFor(workflowId: string, refName = 'callback'): Promise<string> {
  const row = await harness.db
    .selectFrom('TaskExecutions')
    .select('output')
    .where('workflowId', '=', workflowId)
    .where('refName', '=', refName)
    .executeTakeFirstOrThrow();

  return (row.output as unknown as { callbackToken: string }).callbackToken;
}

const taskState = async (workflowId: string, refName: string) =>
  harness.db
    .selectFrom('TaskExecutions')
    .select(['status', 'output'])
    .where('workflowId', '=', workflowId)
    .where('refName', '=', refName)
    .executeTakeFirstOrThrow();

describe('waiting', () => {
  // Nothing executes it and nothing will pick it up, so a lease would expire
  // long before a third party called back.
  it('never reaches a queue', async () => {
    const wf = await start([waitForWebhook('callback')]);

    expect(
      await harness.db
        .selectFrom('TaskQueues')
        .select('taskId')
        .where('workflowId', '=', wf.id)
        .execute()
    ).toEqual([]);
  });

  it('sits IN_PROGRESS with a callback published', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const state = await taskState(wf.id, 'callback');

    expect(state.status).toBe(TaskStatus.IN_PROGRESS);
    const output = state.output as unknown as Record<string, string>;
    expect(output['callbackToken']).toBeTruthy();
    expect(output['callbackPath']).toContain(output['callbackToken']);
  });

  // A database leak must not hand over the ability to complete live workflows.
  it('stores only a hash of the token', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const token = await tokenFor(wf.id);

    const slot = await harness.db
      .selectFrom('WebhookCallbacks')
      .select('tokenHash')
      .executeTakeFirstOrThrow();

    expect(slot.tokenHash).toBe(hashToken(token));
    expect(slot.tokenHash).not.toContain(token);
  });

  it('issues a distinct token per task', async () => {
    const first = await start([waitForWebhook('callback')]);
    const second = await start([waitForWebhook('callback')]);

    expect(await tokenFor(first.id)).not.toBe(await tokenFor(second.id));
  });

  // `scheduleToStart` means "nobody picked it up", which is permanently true
  // here — it would fire while the task was doing exactly what it was asked.
  it('arms no dispatch deadlines', async () => {
    taskDefs.set(
      'callback',
      taskDefinitionSchema.parse({
        name: 'callback',
        scheduleToStartTimeout: 30,
        startToCloseTimeout: 30,
      })
    );

    const wf = await start([waitForWebhook('callback')]);

    const kinds = (
      await harness.db
        .selectFrom('Timers')
        .select('kind')
        .where('workflowId', '=', wf.id)
        .execute()
    ).map((t) => t.kind);

    expect(kinds).not.toContain('scheduleToStart');
    expect(kinds).not.toContain('startToClose');
  });
});

describe('delivery', () => {
  it('completes the task and moves the workflow on', async () => {
    const wf = await start([
      waitForWebhook('callback'),
      { name: 'after', taskReferenceName: 'after', type: TaskType.SIMPLE },
    ]);

    const result = await webhooks.deliver({
      token: await tokenFor(wf.id),
      payload: { approved: true },
    });

    expect(result).toMatchObject({ ok: true, refName: 'callback' });
    await drain(wf.id);

    const state = await taskState(wf.id, 'callback');
    expect(state.status).toBe(TaskStatus.COMPLETED);
    expect(state.output).toEqual({ approved: true });
    expect((await taskQueue.depth('after', namespaceId)).available).toBe(1);
  });

  /**
   * Every webhook sender retries. Without single-use delivery a retried
   * confirmation completes the task twice — which for a payment means shipping
   * the order twice.
   */
  it('accepts a delivery exactly once', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const token = await tokenFor(wf.id);

    expect((await webhooks.deliver({ token, payload: { n: 1 } })).ok).toBe(true);

    const second = await webhooks.deliver({ token, payload: { n: 2 } });
    expect(second).toEqual({ ok: false, reason: 'consumed' });

    // The first payload stands; the retry changed nothing.
    expect((await taskState(wf.id, 'callback')).output).toEqual({ n: 1 });
  });

  // The claim is a conditional update rather than a read-then-write, so two
  // simultaneous deliveries cannot both see an unconsumed slot.
  it('accepts exactly one of several concurrent deliveries', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const token = await tokenFor(wf.id);

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => webhooks.deliver({ token, payload: { n } }))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('refuses a token that was never issued', async () => {
    expect(await webhooks.deliver({ token: 'made-up', payload: {} })).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('refuses an expired callback', async () => {
    const wf = await start([waitForWebhook('callback', { expiresInSeconds: 60 })]);
    const token = await tokenFor(wf.id);

    await sql`UPDATE "WebhookCallbacks" SET "expiresAt" = now() - interval '1 second'`.execute(
      harness.db
    );

    expect(await webhooks.deliver({ token, payload: {} })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  // A 200 for a no-op would leave the sender believing its callback landed.
  it('refuses when the task is no longer waiting', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const token = await tokenFor(wf.id);

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select('id')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    await harness.db
      .transaction()
      .execute((tx) =>
        workflows.completeTask(
          wf.id,
          task.id,
          TaskStatus.TIMED_OUT,
          undefined,
          'gone',
          undefined,
          tx
        )
      );

    expect(await webhooks.deliver({ token, payload: {} })).toEqual({
      ok: false,
      reason: 'not_waiting',
    });
  });
});

describe('signed deliveries', () => {
  const SECRET = 'shared-secret';
  const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

  it('accepts a correctly signed delivery', async () => {
    const wf = await start([waitForWebhook('callback', { signingKey: SECRET })]);
    const body = JSON.stringify({ ok: true });

    const result = await webhooks.deliver({
      token: await tokenFor(wf.id),
      payload: { ok: true },
      rawBody: body,
      signature: sign(body),
    });

    expect(result.ok).toBe(true);
  });

  it('accepts the sha256= prefixed spelling', async () => {
    const wf = await start([waitForWebhook('callback', { signingKey: SECRET })]);
    const body = JSON.stringify({ ok: true });

    const result = await webhooks.deliver({
      token: await tokenFor(wf.id),
      payload: { ok: true },
      rawBody: body,
      signature: `sha256=${sign(body)}`,
    });

    expect(result.ok).toBe(true);
  });

  // Without this, knowing the URL is enough to complete the task — which is
  // the whole reason a sender signs.
  it('refuses an unsigned delivery when a key is configured', async () => {
    const wf = await start([waitForWebhook('callback', { signingKey: SECRET })]);

    expect(
      await webhooks.deliver({ token: await tokenFor(wf.id), payload: {}, rawBody: '{}' })
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a signature over different bytes', async () => {
    const wf = await start([waitForWebhook('callback', { signingKey: SECRET })]);

    expect(
      await webhooks.deliver({
        token: await tokenFor(wf.id),
        payload: { tampered: true },
        rawBody: JSON.stringify({ tampered: true }),
        signature: sign(JSON.stringify({ original: true })),
      })
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  // A refused signature must not consume the slot, or one forged attempt would
  // permanently deny the real sender.
  it('leaves the callback usable after a bad signature', async () => {
    const wf = await start([waitForWebhook('callback', { signingKey: SECRET })]);
    const token = await tokenFor(wf.id);
    const body = JSON.stringify({ ok: true });

    await webhooks.deliver({ token, payload: {}, rawBody: body, signature: 'wrong' });

    expect(
      (await webhooks.deliver({ token, payload: { ok: true }, rawBody: body, signature: sign(body) }))
        .ok
    ).toBe(true);
  });

  it('does not throw on a wrong-length signature', () => {
    // `timingSafeEqual` throws on a length mismatch, which would turn a
    // malformed signature into a 500.
    expect(verifySignature(SECRET, 'body', 'short')).toBe(false);
    expect(verifySignature(SECRET, 'body', undefined)).toBe(false);
  });
});

describe('lifecycle', () => {
  // A callback arriving hours later must not find a live token for a workflow
  // that ended.
  it('closes open slots when the workflow is terminated', async () => {
    const wf = await start([waitForWebhook('callback')]);
    const token = await tokenFor(wf.id);

    await control.terminate(wf.id, 'no longer needed', 'alice');

    expect(await webhooks.deliver({ token, payload: {} })).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  /**
   * `taskTimeout` is the only thing that ends a callback which never arrives —
   * the dispatch deadlines do not apply, so without it a workflow waits forever.
   */
  it('times out when no callback ever arrives', async () => {
    taskDefs.set(
      'callback',
      taskDefinitionSchema.parse({ name: 'callback', timeoutSeconds: 60, retryCount: 0 })
    );

    const wf = await start([waitForWebhook('callback')]);

    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 minute'`.execute(harness.db);
    expect(await sweeper.sweep()).toBeGreaterThan(0);
    await drain(wf.id);

    expect((await taskState(wf.id, 'callback')).status).toBe(TaskStatus.TIMED_OUT);
    // TIMED_OUT rather than FAILED: the default `timeoutPolicy` is
    // TIME_OUT_WF, and a workflow that ran out of time reads differently from
    // one whose work failed.
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.TIMED_OUT);
  });

  it('prunes expired and long-consumed slots', async () => {
    await start([waitForWebhook('callback', { expiresInSeconds: 60 })]);
    await sql`UPDATE "WebhookCallbacks" SET "expiresAt" = now() - interval '1 day'`.execute(
      harness.db
    );

    expect(await webhooks.prune()).toBe(1);
  });
});
