import {
  taskDefinitionSchema,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskDispatchService } from './task-dispatch.service.js';
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
 * Policies that were stored and silently ignored.
 *
 * Each of these had configuration, documentation and a database column, and did
 * nothing. That is the worst shape a bug can take: the operator sets the knob,
 * the system accepts it, and behaviour never changes.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let dispatch: TaskDispatchService;
let evaluator: Evaluator;
let namespaceId: string;
let blueprints: StubBlueprints;
let taskPolicy: Record<string, unknown> = {};

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[], name = 'wf', version = 1): void {
    this.map.set(
      `${name}:${version}`,
      compileBlueprint(workflowDefinitionSchema.parse({ name, version, tasks }))
    );
  }
  async load(_ns: string, defName: string, defVersion: number): Promise<Blueprint> {
    const bp = this.map.get(`${defName}:${defVersion}`);
    if (!bp) throw new Error(`no blueprint for ${defName} v${defVersion}`);
    return bp;
  }
}

const policyLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(names.map((name) => [name, taskDefinitionSchema.parse({ name, ...taskPolicy })])),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue, timers);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    policyLoader,
    timers
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  taskPolicy = { retryCount: 3, retryDelaySeconds: 0, jitter: 0 };
});

async function start() {
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

async function failTask(wf: string, queue: string, reason: string) {
  const [leased] = await dispatch.lease({ namespaceId, queueName: queue, workerId: 'w' });
  if (!leased) return false;
  await dispatch.report({
    namespaceId,
    queueName: queue,
    workflowId: wf,
    taskId: leased.taskId,
    leaseToken: leased.leaseToken,
    status: TaskStatus.FAILED,
    reason,
  });
  return true;
}

describe('nonRetryableErrors', () => {
  // Marking an error non-retryable and watching it retry anyway is worse than
  // having no such setting: it looks like protection that is not there.
  it('does not retry an error the policy declares permanent', async () => {
    taskPolicy = { retryCount: 5, retryDelaySeconds: 0, jitter: 0, nonRetryableErrors: ['CARD_DECLINED'] };
    blueprints.register([simple('charge')]);

    const wf = await start();
    await drain(wf.id);
    await failTask(wf.id, 'charge', 'CARD_DECLINED: do not try again');
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.FAILED);
    expect((await taskQueue.depth('charge', namespaceId)).total).toBe(0);
  });

  it('still retries an error that is not listed', async () => {
    taskPolicy = { retryCount: 5, retryDelaySeconds: 0, jitter: 0, nonRetryableErrors: ['CARD_DECLINED'] };
    blueprints.register([simple('charge')]);

    const wf = await start();
    await drain(wf.id);
    await failTask(wf.id, 'charge', 'GATEWAY_TIMEOUT: transient');
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
    expect((await taskQueue.depth('charge', namespaceId)).total).toBe(1);
  });
});

describe('timeoutPolicy', () => {
  // ALERT_ONLY means "tell me, but keep going". Treating it as fatal — which is
  // what happened while the policy was ignored — turns a monitoring signal into
  // an outage.
  it('ALERT_ONLY lets the workflow continue past a timeout', async () => {
    taskPolicy = { retryCount: 0, timeoutPolicy: 'ALERT_ONLY' };
    blueprints.register([simple('slow'), simple('after')]);

    const wf = await start();
    await drain(wf.id);

    const [leased] = await dispatch.lease({ namespaceId, queueName: 'slow', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'slow',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.TIMED_OUT,
      reason: 'took too long',
    });
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
    expect((await taskQueue.depth('after', namespaceId)).total).toBe(1);
  });

  it('TIME_OUT_WF still fails the workflow', async () => {
    taskPolicy = { retryCount: 0, timeoutPolicy: 'TIME_OUT_WF' };
    blueprints.register([simple('slow'), simple('after')]);

    const wf = await start();
    await drain(wf.id);

    const [leased] = await dispatch.lease({ namespaceId, queueName: 'slow', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'slow',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.TIMED_OUT,
      reason: 'took too long',
    });
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.TIMED_OUT);
  });
});

describe('retryBudget', () => {
  // The control that stops a degraded dependency being held down by the retry
  // traffic its own degradation caused.
  it('stops retrying once retries dominate recent traffic', async () => {
    const budgets = new Map([['charge', 0.3]]);

    // 30 recent executions, 25 of them retries — well past a 30% budget.
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    for (let i = 0; i < 30; i++) {
      await harness.db
        .insertInto('TaskExecutions')
        .values({
          workflowId: wf.id,
          namespaceId,
          refName: `t${i}`,
          taskDefName: 'charge',
          taskType: TaskType.SIMPLE,
          status: TaskStatus.FAILED,
          attempt: i < 25 ? 1 : 0,
          iteration: i,
          input: sql`'{}'::jsonb`,
        })
        .execute();
    }

    const exhausted = await workflows.findExhaustedRetryBudgets(
      namespaceId,
      ['charge'],
      budgets
    );
    expect(exhausted.has('charge')).toBe(true);
  });

  it('leaves the budget intact when retries are a small share', async () => {
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    for (let i = 0; i < 30; i++) {
      await harness.db
        .insertInto('TaskExecutions')
        .values({
          workflowId: wf.id,
          namespaceId,
          refName: `t${i}`,
          taskDefName: 'charge',
          taskType: TaskType.SIMPLE,
          status: TaskStatus.COMPLETED,
          attempt: i < 2 ? 1 : 0,
          iteration: i,
          input: sql`'{}'::jsonb`,
        })
        .execute();
    }

    const exhausted = await workflows.findExhaustedRetryBudgets(
      namespaceId,
      ['charge'],
      new Map([['charge', 0.3]])
    );
    expect(exhausted.has('charge')).toBe(false);
  });

  // A budget that trips on the first couple of retries would make any new task
  // definition unusable before it has meaningful traffic.
  it('ignores a sample too small to be meaningful', async () => {
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    for (let i = 0; i < 3; i++) {
      await harness.db
        .insertInto('TaskExecutions')
        .values({
          workflowId: wf.id,
          namespaceId,
          refName: `t${i}`,
          taskDefName: 'charge',
          taskType: TaskType.SIMPLE,
          status: TaskStatus.FAILED,
          attempt: 1,
          iteration: i,
          input: sql`'{}'::jsonb`,
        })
        .execute();
    }

    const exhausted = await workflows.findExhaustedRetryBudgets(
      namespaceId,
      ['charge'],
      new Map([['charge', 0.3]])
    );
    expect(exhausted.has('charge')).toBe(false);
  });
});

describe('reclaim leaves no stale task row', () => {
  // A reclaimed task that still says IN_PROGRESS with a dead worker's name is
  // exactly the state an operator would be trying to diagnose.
  it('resets the task row, not just the queue row', async () => {
    blueprints.register([simple('a')]);
    const wf = await start();
    await drain(wf.id);

    const [abandoned] = await dispatch.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'doomed',
      leaseSeconds: -1,
    });

    expect(await dispatch.reclaimAbandoned()).toBe(1);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'workerId', 'leaseToken'])
      .where('id', '=', abandoned.taskId)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.SCHEDULED);
    expect(row.workerId).toBeNull();
    expect(row.leaseToken).toBeNull();
  });

  it('lets a fresh worker take the reclaimed task cleanly', async () => {
    blueprints.register([simple('a')]);
    const wf = await start();
    await drain(wf.id);

    await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'doomed', leaseSeconds: -1 });
    await dispatch.reclaimAbandoned();

    const [fresh] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'healthy' });
    expect(fresh).toBeDefined();

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'workerId'])
      .where('id', '=', fresh.taskId)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.IN_PROGRESS);
    expect(row.workerId).toBe('healthy');
  });
});

describe('outbox dead letter', () => {
  // The bug this replaces: an event with no handler was marked delivered, so a
  // handler that had not registered yet meant the work was silently lost — and
  // since the relay starts sub-workflows, the parent hung forever.
  it('retries an unhandled event rather than discarding it', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 3 });
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'not.yet.registered', { a: 1 }, tx));

    const result = await relay.relay();

    expect(result).toMatchObject({ delivered: 0, failed: 1, deadLettered: 0 });
    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.deadLetterCount()).toBe(0);
  });

  it('delivers once a late handler registers', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 5 });
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'late.handler', { a: 1 }, tx));

    await relay.relay();

    // The subscriber turns up — a module that finished starting.
    const seen: string[] = [];
    relay.on('late.handler', async (e) => {
      seen.push(e.topic);
    });

    await makeDeliverable();
    expect(await relay.relay()).toMatchObject({ delivered: 1 });
    expect(seen).toEqual(['late.handler']);
  });

  it('dead-letters after the attempt limit, keeping the event', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 2 });
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'never.handled', { a: 1 }, tx));

    await relay.relay();
    await makeDeliverable();
    expect(await relay.relay()).toMatchObject({ deadLettered: 1 });

    expect(await outbox.pendingCount()).toBe(0);
    const dead = await outbox.listDeadLettered();
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toMatch(/no handler registered/);
  });

  it('replays a dead-lettered event once the handler exists', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 1 });
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'recoverable', { a: 1 }, tx));

    await relay.relay();
    const dead = await outbox.listDeadLettered();
    expect(dead).toHaveLength(1);

    const seen: string[] = [];
    relay.on('recoverable', async (e) => {
      seen.push(e.topic);
    });

    expect(await outbox.replayDeadLettered([dead[0].id])).toBe(1);
    expect(await relay.relay()).toMatchObject({ delivered: 1 });
    expect(seen).toEqual(['recoverable']);
  });

  // A permanently failing handler must not be reprocessed on every pass.
  it('backs a failing event off instead of busy-looping', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 10 }).on(
      'explodes',
      async () => {
        throw new Error('handler exploded');
      }
    );
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'explodes', {}, tx));

    expect(await relay.relay()).toMatchObject({ failed: 1 });
    // Immediately claimable again would mean no backoff at all.
    expect(await relay.relay()).toMatchObject({ delivered: 0, failed: 0 });
  });

  /** Clears any backoff so the next relay pass sees the event. */
  async function makeDeliverable(): Promise<void> {
    await sql`UPDATE "OutboxEvents" SET "nextAttemptAt" = now() - interval '1 minute'`.execute(
      harness.db
    );
  }
});
