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
import { TimeoutSweeper } from './timeout-sweeper.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The runners that make the engine self-driving.
 *
 * Before these, three things were recorded but never acted on: timers fired
 * nothing, the outbox was written but never read, and leasing a task left its
 * row claiming to be merely scheduled. Each was silent — the system looked
 * healthy while deadlines and sub-workflows quietly did nothing.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let sweeper: TimeoutSweeper;
let dispatch: TaskDispatchService;
let evaluator: Evaluator;
let namespaceId: string;
let blueprints: StubBlueprints;

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
  registerDefinition(definition: Record<string, unknown>): void {
    const parsed = workflowDefinitionSchema.parse({ name: 'wf', version: 1, ...definition });
    this.map.set(`${parsed.name}:${parsed.version}`, compileBlueprint(parsed));
  }
  async load(_ns: string, defName: string, defVersion: number): Promise<Blueprint> {
    const bp = this.map.get(`${defName}:${defVersion}`);
    if (!bp) throw new Error(`no blueprint for ${defName} v${defVersion}`);
    return bp;
  }
}

/** Task policy driven per-test, so timeouts can be set to fire immediately. */
let taskPolicy: Record<string, unknown> = {};
const policyLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [name, taskDefinitionSchema.parse({ name, ...taskPolicy })])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  sweeper = new TimeoutSweeper(harness.db, timers, workflows, decideQueue);
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
  taskPolicy = { retryCount: 0, retryDelaySeconds: 0, jitter: 0 };
});

async function start() {
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

/**
 * Makes every armed timer due.
 *
 * The policy schema rejects negative timeouts, and sleeping through a real one
 * makes the test slow and flaky. Winding the clock back on the rows instead
 * exercises the whole path — decider arms, sweeper fires — deterministically.
 */
async function makeTimersDue(): Promise<void> {
  await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 hour'`.execute(harness.db);
}

describe('timers are armed when a task is scheduled', () => {
  it('writes a durable timer for each configured deadline', async () => {
    taskPolicy = { scheduleToStartTimeout: 30, startToCloseTimeout: 60, timeoutSeconds: 90 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);

    const rows = await harness.db
      .selectFrom('Timers')
      .select(['kind', 'workflowId', 'taskId'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(rows.map((r) => r.kind).sort()).toEqual([
      'scheduleToStart',
      'startToClose',
      'taskTimeout',
    ]);
    // Each timer must point at the task it guards, or the sweeper cannot tell
    // whether the deadline still applies.
    expect(rows.every((r) => r.taskId !== null)).toBe(true);
  });

  it('arms nothing when every timeout is unbounded', async () => {
    taskPolicy = { scheduleToStartTimeout: 0, startToCloseTimeout: 0, timeoutSeconds: 0 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);

    expect(await timers.pendingCount()).toBe(0);
  });

  // A deadline outliving the task it guards would mark completed work TIMED_OUT.
  it('cancels a task\'s deadlines once it finishes', async () => {
    taskPolicy = { scheduleToStartTimeout: 300, timeoutSeconds: 300 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    expect(await timers.pendingCount()).toBeGreaterThan(0);

    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'a',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
    });

    expect(await timers.pendingCount()).toBe(0);
  });
});

describe('the sweeper fires deadlines', () => {
  it('times out a task nobody picked up', async () => {
    taskPolicy = { scheduleToStartTimeout: 300, retryCount: 0 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    await makeTimersDue();

    expect(await sweeper.sweep()).toBe(1);
    await drain(wf.id);

    const after = await workflows.findById(wf.id);
    expect(after?.status).toBe(WorkflowStatus.TIMED_OUT);
    expect(after?.reasonForIncompletion).toMatch(/scheduleToStartTimeout/);
  });

  it('retries a timed-out task when the policy allows', async () => {
    taskPolicy = { scheduleToStartTimeout: 300, retryCount: 2, retryDelaySeconds: 0, jitter: 0, timeoutPolicy: 'RETRY' };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    await makeTimersDue();
    await sweeper.sweep();
    await drain(wf.id);

    const attempts = await harness.db
      .selectFrom('TaskExecutions')
      .select(['attempt', 'status'])
      .where('workflowId', '=', wf.id)
      .orderBy('attempt')
      .execute();

    expect(attempts[0]).toMatchObject({ attempt: 0, status: TaskStatus.TIMED_OUT });
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  it('fails the workflow under TIME_OUT_WF even with retries left', async () => {
    taskPolicy = { startToCloseTimeout: 300, retryCount: 2, retryDelaySeconds: 0, jitter: 0, timeoutPolicy: 'TIME_OUT_WF' };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    await makeTimersDue();
    await sweeper.sweep();
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.TIMED_OUT);
    const attempts = await harness.db.selectFrom('TaskExecutions').select('attempt').where('workflowId', '=', wf.id).execute();
    expect(attempts).toHaveLength(1);
  });

  // Found live: a worker finishing one second after its deadline still held a
  // matching lease token, and its report turned TIMED_OUT into COMPLETED after
  // the retry was already scheduled — two attempts, both claiming the result.
  it('refuses a late report for a task that already timed out', async () => {
    taskPolicy = { startToCloseTimeout: 300, retryCount: 2, retryDelaySeconds: 0, jitter: 0, timeoutPolicy: 'RETRY' };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'slow' });
    await makeTimersDue();
    expect(await sweeper.sweep()).toBe(1);
    await drain(wf.id);

    const accepted = await dispatch.report({
      namespaceId,
      queueName: 'a',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
      output: { late: true },
    });

    expect(accepted).toBe(false);
    const first = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'output'])
      .where('id', '=', leased.taskId)
      .executeTakeFirstOrThrow();
    expect(first.status).toBe(TaskStatus.TIMED_OUT);
    expect(first.output).not.toEqual({ late: true });
  });

  // The common case: a deadline armed at schedule time usually outlives its
  // usefulness. Firing it against finished work would invent a failure.
  it('does not time out a task that already completed', async () => {
    taskPolicy = { scheduleToStartTimeout: 300 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    await makeTimersDue();

    // Complete it directly, leaving the due timer in place.
    const [leased] = await taskQueue.lease('a', 'w', 60, 1, namespaceId);
    await workflows.completeTask(
      wf.id,
      leased.taskId,
      TaskStatus.COMPLETED,
      {},
      undefined,
      undefined
    );

    expect(await sweeper.sweep()).toBe(0);

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirst();
    expect(task?.status).toBe(TaskStatus.COMPLETED);
  });

  it('leaves timers that are not yet due alone', async () => {
    taskPolicy = { timeoutSeconds: 3600 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);

    expect(await sweeper.sweep()).toBe(0);
    expect(await timers.pendingCount()).toBe(1);
  });

  it('ignores deadlines for a workflow that already ended', async () => {
    taskPolicy = { scheduleToStartTimeout: 300 };
    blueprints.register([simple('a')]);

    const wf = await start();
    await drain(wf.id);
    await makeTimersDue();
    await harness.db
      .transaction()
      .execute((tx) =>
        workflows.setStatus(wf.id, WorkflowStatus.TERMINATED, undefined, 'operator', tx)
      );

    expect(await sweeper.sweep()).toBe(0);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.TERMINATED);
  });
});

describe('task output cache', () => {
  const lookup = { name: 'geocode', taskReferenceName: 'geocode', type: TaskType.SIMPLE, cacheConfig: { key: '${workflow.input.address}', ttlInSecond: 3600 } };

  const runOnce = async (address: string) => {
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, input: { address } });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);
    return wf;
  };

  it('reuses a recent output for the same key instead of running the task again', async () => {
    blueprints.registerDefinition({ tasks: [lookup] });

    const first = await runOnce('1 Infinite Loop');
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'geocode', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'geocode',
      workflowId: first.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
      output: { lat: 37.33, lng: -122.03 },
    });
    await drain(first.id);

    const second = await runOnce('1 Infinite Loop');
    expect((await taskQueue.depth('geocode', namespaceId)).total).toBe(0);
    expect((await workflows.findById(second.id))?.status).toBe(WorkflowStatus.COMPLETED);
    const cachedTask = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'output'])
      .where('workflowId', '=', second.id)
      .executeTakeFirstOrThrow();
    expect(cachedTask).toMatchObject({ status: TaskStatus.COMPLETED, output: { lat: 37.33, lng: -122.03 } });
  });

  it('runs the task for a different key, and after the entry expires', async () => {
    blueprints.registerDefinition({ tasks: [lookup] });
    await harness.db
      .insertInto('TaskOutputCache')
      .values({ namespaceId, taskDefName: 'geocode', key: 'stale', output: '{"lat":0}', expiresAt: new Date(Date.now() - 1000) })
      .execute();

    await runOnce('elsewhere');
    await runOnce('stale');
    expect((await taskQueue.depth('geocode', namespaceId)).total).toBe(2);
  });
});

describe('failure workflows', () => {
  /** Captures what the relay would start, without needing real definitions. */
  const captureStarts = () => {
    const starts: Record<string, unknown>[] = [];
    const relay = new OutboxRelay(harness.db, outbox).on('workflow.start', async (event) => {
      starts.push(event.payload as Record<string, unknown>);
    });
    return { starts, relay };
  };

  // Declared, accepted, and silently never run — until this.
  it('starts the declared failure workflow when a run fails', async () => {
    taskPolicy = { retryCount: 0 };
    blueprints.registerDefinition({ failureWorkflow: 'refund', tasks: [simple('charge')] });
    const { starts, relay } = captureStarts();

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, input: { orderId: 'A-7' } });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'charge',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.FAILED_WITH_TERMINAL_ERROR,
      reason: 'card declined',
    });
    await drain(wf.id);
    await relay.relay();

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.FAILED);
    expect(starts).toEqual([
      expect.objectContaining({
        defName: 'refund',
        input: expect.objectContaining({ orderId: 'A-7', workflowId: wf.id, failureStatus: 'FAILED', reason: 'card declined' }),
      }),
    ]);
  });

  // A whole-workflow timeout is fired by the sweeper, not decided by the engine.
  it('starts it when the workflow overruns its own timeout', async () => {
    blueprints.registerDefinition({ failureWorkflow: 'alert', timeoutSeconds: 60, tasks: [simple('slow')] });
    const { starts, relay } = captureStarts();
    const withFailures = new TimeoutSweeper(harness.db, timers, workflows, decideQueue, { blueprints, outbox });

    const wf = await start();
    await drain(wf.id);
    await makeTimersDue();
    await withFailures.sweep();
    await relay.relay();

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.TIMED_OUT);
    expect(starts).toEqual([
      expect.objectContaining({ defName: 'alert', input: expect.objectContaining({ failureStatus: 'TIMED_OUT' }) }),
    ]);
  });
});

describe('lease marks the task running', () => {
  // Without this the task row says SCHEDULED while a worker executes it, and
  // the fencing check on report can never match because no token was stored.
  it('records worker and fencing token on the task row', async () => {
    blueprints.register([simple('a')]);
    const wf = await start();
    await drain(wf.id);

    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'worker-7' });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'workerId', 'leaseToken', 'startedAt'])
      .where('id', '=', leased.taskId)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.IN_PROGRESS);
    expect(row.workerId).toBe('worker-7');
    expect(row.leaseToken).toBe(leased.leaseToken);
    expect(row.startedAt).toBeInstanceOf(Date);
  });

  it('accepts a report carrying the matching token', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await start();
    await drain(wf.id);

    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    const accepted = await dispatch.report({
      namespaceId,
      queueName: 'a',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
      output: { ok: true },
    });

    expect(accepted).toBe(true);
    await drain(wf.id);
    expect((await taskQueue.depth('b', namespaceId)).total).toBe(1);
  });

  // The whole point of the fencing token: a worker whose lease was reclaimed
  // must not be able to overwrite the result of the worker that replaced it.
  it('rejects a report from a worker whose lease was reclaimed', async () => {
    blueprints.register([simple('a')]);
    const wf = await start();
    await drain(wf.id);

    const [stale] = await dispatch.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'stalled',
      leaseSeconds: -1,
    });
    await taskQueue.reclaimExpiredLeases(10);
    await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'fresh' });

    const accepted = await dispatch.report({
      namespaceId,
      queueName: 'a',
      workflowId: wf.id,
      taskId: stale.taskId,
      leaseToken: stale.leaseToken,
      status: TaskStatus.COMPLETED,
      output: { from: 'stale worker' },
    });

    expect(accepted).toBe(false);
  });
});

describe('the outbox relay delivers', () => {
  it('hands each event to its topic handler exactly once', async () => {
    const seen: string[] = [];
    const relay = new OutboxRelay(harness.db, outbox).on('orders.shipped', async (e) => {
      seen.push(e.topic);
    });

    await harness.db.transaction().execute((tx) => outbox.publish(namespaceId, 'orders.shipped', { id: 'A-1' }, tx));

    expect(await relay.relay()).toMatchObject({ delivered: 1, failed: 0 });
    expect(seen).toEqual(['orders.shipped']);

    // Nothing left to deliver on a second pass.
    expect(await relay.relay()).toMatchObject({ delivered: 0 });
  });

  // A broker sink claims every destination on its connection, but an exact
  // subscription still wins and the longest prefix beats a shorter one.
  it('routes by prefix when no exact handler claims the topic', async () => {
    const seen: string[] = [];
    const relay = new OutboxRelay(harness.db, outbox)
      .onPrefix('nats:', async (e) => void seen.push(`short ${e.topic}`))
      .onPrefix('nats:default:', async (e) => void seen.push(`long ${e.topic}`))
      .on('nats:default:exact', async (e) => void seen.push(`exact ${e.topic}`));

    await harness.db.transaction().execute(async (tx) => {
      await outbox.publish(namespaceId, 'nats:default:orders.created', {}, tx);
      await outbox.publish(namespaceId, 'nats:default:exact', {}, tx);
      await outbox.publish(namespaceId, 'nats:other:x', {}, tx);
      // A topic that is only a prefix names no destination, so nothing claims it.
      await outbox.publish(namespaceId, 'nats:', {}, tx);
    });

    expect(await relay.relay()).toMatchObject({ delivered: 3, failed: 1 });
    expect(seen.sort()).toEqual(['exact nats:default:exact', 'long nats:default:orders.created', 'short nats:other:x']);
  });

  // An unhandled event is retried, then dead-lettered — never marked delivered.
  // Marking it delivered would silently lose work whenever a handler simply had
  // not registered yet, and the full reasoning lives in policy-enforcement.spec.
  it('retries an unhandled event rather than discarding it', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 3 });
    await harness.db
      .transaction()
      .execute((tx) => outbox.publish(namespaceId, 'nobody.listens', { a: 1 }, tx));

    expect(await relay.relay()).toMatchObject({ delivered: 0, failed: 1 });
    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.deadLetterCount()).toBe(0);
  });

  // One broken subscriber must not stall every other topic.
  it('leaves a failing event pending without blocking the batch', async () => {
    const relay = new OutboxRelay(harness.db, outbox, { maxAttempts: 10 })
      .on('bad', async () => {
        throw new Error('handler exploded');
      })
      .on('good', async () => undefined);

    await harness.db.transaction().execute(async (tx) => {
      await outbox.publish(namespaceId, 'bad', {}, tx);
      await outbox.publish(namespaceId, 'good', {}, tx);
    });

    expect(await relay.relay()).toMatchObject({ delivered: 1, failed: 1 });
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('starts a sub-workflow from the event the decider emitted', async () => {
    blueprints.register([simple('child-a')], 'child', 1);
    blueprints.register([
      simple('a'),
      {
        name: 'child',
        taskReferenceName: 'child',
        type: TaskType.SUB_WORKFLOW,
        subWorkflowParam: { name: 'child', version: 1 },
      },
    ]);

    const started: string[] = [];
    const relay = new OutboxRelay(harness.db, outbox).on('subworkflow.start', async (event) => {
      const payload = event.payload as unknown as { defName: string };
      const child = await workflows.start({
        namespaceId,
        defName: payload.defName,
        defVersion: 1,
      });
      started.push(child.id);
      await decideQueue.enqueue(namespaceId, child.id, 'sub-workflow started');
    });

    const wf = await start();
    await drain(wf.id);
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'a',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
    });
    await drain(wf.id);

    expect(await relay.relay()).toMatchObject({ delivered: 1, failed: 0 });
    expect(started).toHaveLength(1);

    // The child really runs.
    await drain(started[0]);
    expect((await taskQueue.depth('child-a', namespaceId)).total).toBe(1);
  });
});
