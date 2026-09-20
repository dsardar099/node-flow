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
import { OutboxRepository } from './outbox.repository.js';
import { PartitionManager } from './partition-manager.js';
import { StuckWorkflowSweeper } from './stuck-workflow-sweeper.js';
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
import { WorkflowEventsRepository, WorkflowEventType } from './workflow-events.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Phase 1 hardening: workflow deadlines, audit history, partition maintenance
 * and stuck-workflow recovery.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let events: WorkflowEventsRepository;
let dispatch: TaskDispatchService;
let timeoutSweeper: TimeoutSweeper;
let stuckSweeper: StuckWorkflowSweeper;
let partitions: PartitionManager;
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
  register(definition: Record<string, unknown>): void {
    const parsed = workflowDefinitionSchema.parse({ name: 'wf', version: 1, ...definition });
    this.map.set(`${parsed.name}:${parsed.version}`, compileBlueprint(parsed));
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
  events = new WorkflowEventsRepository(harness.db);
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue, timers);
  timeoutSweeper = new TimeoutSweeper(harness.db, timers, workflows, decideQueue);
  stuckSweeper = new StuckWorkflowSweeper(harness.db, decideQueue);
  partitions = new PartitionManager(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    policyLoader,
    timers,
    events
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

describe('workflow-level timeout', () => {
  it('arms a workflow deadline on the first evaluation', async () => {
    blueprints.register({ timeoutSeconds: 600, tasks: [simple('a')] });

    const wf = await start();
    await drain(wf.id);

    const armed = await harness.db
      .selectFrom('Timers')
      .select(['kind', 'taskId'])
      .where('workflowId', '=', wf.id)
      .where('kind', '=', 'workflowTimeout')
      .execute();

    expect(armed).toHaveLength(1);
    // A workflow deadline belongs to the execution, not to any one task.
    expect(armed[0].taskId).toBeNull();
  });

  // Arming anywhere other than the one guaranteed-once pass either misses
  // executions or accumulates a duplicate timer per evaluation.
  it('arms it exactly once across many evaluations', async () => {
    blueprints.register({ timeoutSeconds: 600, tasks: [simple('a'), simple('b')] });

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

    const armed = await harness.db
      .selectFrom('Timers')
      .select('id')
      .where('workflowId', '=', wf.id)
      .where('kind', '=', 'workflowTimeout')
      .execute();

    expect(armed).toHaveLength(1);
  });

  it('times the workflow out when the deadline passes', async () => {
    blueprints.register({ timeoutSeconds: 600, tasks: [simple('a')] });

    const wf = await start();
    await drain(wf.id);
    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 hour'`.execute(harness.db);

    expect(await timeoutSweeper.sweep()).toBeGreaterThan(0);

    const after = await workflows.findById(wf.id);
    expect(after?.status).toBe(WorkflowStatus.TIMED_OUT);
    expect(after?.reasonForIncompletion).toMatch(/exceeded its timeout/);
  });

  it('arms nothing when the workflow timeout is unbounded', async () => {
    blueprints.register({ timeoutSeconds: 0, tasks: [simple('a')] });

    const wf = await start();
    await drain(wf.id);

    const armed = await harness.db
      .selectFrom('Timers')
      .select('id')
      .where('workflowId', '=', wf.id)
      .where('kind', '=', 'workflowTimeout')
      .execute();

    expect(armed).toHaveLength(0);
  });
});

describe('audit history', () => {
  it('records the order things happened, not just the final state', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b')] });

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

    const history = await events.history(wf.id);
    const types = history.map((e) => e.type);

    expect(types).toContain(WorkflowEventType.TASK_SCHEDULED);
    expect(history.map((e) => e.seq)).toEqual(history.map((_, i) => i + 1));
  });

  // Two events written in one transaction can share a timestamp to microsecond
  // precision, so ordering must come from the sequence, not the clock.
  it('numbers events gap-free and in order', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b'), simple('c')] });

    const wf = await start();
    for (const queue of ['a', 'b', 'c']) {
      await drain(wf.id);
      const [leased] = await dispatch.lease({ namespaceId, queueName: queue, workerId: 'w' });
      if (!leased) break;
      await dispatch.report({
        namespaceId,
        queueName: queue,
        workflowId: wf.id,
        taskId: leased.taskId,
        leaseToken: leased.leaseToken,
        status: TaskStatus.COMPLETED,
      });
    }
    await drain(wf.id);

    const history = await events.history(wf.id);
    expect(history.length).toBeGreaterThan(3);
    expect(history.map((e) => e.seq)).toEqual(
      Array.from({ length: history.length }, (_, i) => i + 1)
    );
  });

  it('records why a switch took the branch it did', async () => {
    blueprints.register({
      tasks: [
        simple('check'),
        {
          name: 'route',
          taskReferenceName: 'route',
          type: TaskType.SWITCH,
          expression: '${check.output.status}',
          decisionCases: { ok: [simple('shipIt')] },
          defaultCase: [simple('escalate')],
        },
      ],
    });

    const wf = await start();
    await drain(wf.id);
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'check', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'check',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.COMPLETED,
      output: { status: 'ok' },
    });
    await drain(wf.id);

    // Later passes re-derive the skip; the history must still say it once.
    const [shipping] = await dispatch.lease({ namespaceId, queueName: 'shipIt', workerId: 'w' });
    await dispatch.report({
      namespaceId,
      queueName: 'shipIt',
      workflowId: wf.id,
      taskId: shipping.taskId,
      leaseToken: shipping.leaseToken,
      status: TaskStatus.COMPLETED,
      output: {},
    });
    await drain(wf.id);

    const history = await events.history(wf.id);
    const skipped = history.filter((e) => e.type === WorkflowEventType.TASK_SKIPPED);
    expect(skipped).toHaveLength(1);
    expect(JSON.stringify(skipped[0].payload)).toMatch(/SWITCH/);
  });

  it('records workflow completion', async () => {
    blueprints.register({ tasks: [simple('a')] });

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

    const history = await events.history(wf.id);
    expect(history.map((e) => e.type)).toContain(WorkflowEventType.WORKFLOW_COMPLETED);
  });

  // History must never disagree with the state it describes.
  it('writes no history when the evaluation rolls back', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');

    const broken = new Evaluator(
      harness.db,
      workflows,
      decideQueue,
      taskQueue,
      outbox,
      {
        load: async () => {
          throw new Error('boom');
        },
      },
      policyLoader,
      timers,
      events
    );

    // Measured as a delta rather than against zero: starting a workflow now
    // writes its own `workflow.started` entry, and the claim here is that the
    // *evaluation* added nothing — not that the execution has no history.
    const before = await events.count(wf.id);
    await expect(broken.evaluate(wf.id)).rejects.toThrow('boom');
    expect(await events.count(wf.id)).toBe(before);
  });
});

describe('partition maintenance', () => {
  it('creates partitions ahead of time', async () => {
    const created = await partitions.ensureAhead(2);
    expect(created.length).toBeGreaterThan(0);
    expect(created.some((n) => n.startsWith('WorkflowExecutions_'))).toBe(true);
    expect(created.some((n) => n.startsWith('Timers_'))).toBe(true);
  });

  it('is safe to run repeatedly', async () => {
    await partitions.ensureAhead(2);
    expect(await partitions.ensureAhead(2)).toEqual([]);
  });

  // The whole reason for partitioning by time: dropping a period must be an
  // instant DROP TABLE, not a DELETE of millions of rows.
  it('drops partitions past the retention window', async () => {
    await sql
      .raw(
        `CREATE TABLE IF NOT EXISTS "Timers_2020010100" PARTITION OF "Timers"
           FOR VALUES FROM ('2020-01-01T00:00:00Z') TO ('2020-01-01T01:00:00Z')`
      )
      .execute(harness.db);

    const dropped = await partitions.dropExpired();
    expect(dropped).toContain('Timers_2020010100');
  });

  it('never drops the default partition', async () => {
    const dropped = await partitions.dropExpired();
    expect(dropped.some((n) => n.endsWith('_default'))).toBe(false);
  });

  // The bug this replaces: on a database where rows had already landed in
  // DEFAULT, `CREATE TABLE ... PARTITION OF` fails with a check violation and
  // the roller fails on that same period forever — so every subsequent row
  // keeps landing in DEFAULT and retention silently stops working.
  it('adopts a period whose rows are already in the default partition', async () => {
    const month = new Date();
    const suffix = `${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, '0')}`;

    // Undo the seeding the migration did, so new rows fall through to DEFAULT.
    await sql.raw(`DROP TABLE IF EXISTS "WorkflowExecutions_${suffix}"`).execute(harness.db);
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });

    const before = await partitions.defaultPartitionRows();
    expect(before.find((c) => c.table === 'WorkflowExecutions')?.rows).toBe(1);

    const created = await partitions.ensureAhead(0);
    expect(created).toContain(`WorkflowExecutions_${suffix}`);

    // The row moved into the new partition rather than being orphaned or lost.
    const after = await partitions.defaultPartitionRows();
    expect(after.find((c) => c.table === 'WorkflowExecutions')?.rows).toBe(0);
    expect((await workflows.findById(wf.id))?.id).toBe(wf.id);
  });

  // Every poller replica runs this loop, so two creating the same partition at
  // once is the normal case rather than an edge one.
  //
  // The assertion is about the *return value*, not just about surviving: with
  // `CREATE TABLE IF NOT EXISTS` the loser no-ops successfully and reports the
  // creation anyway, so every count built on this over-reports.
  it('has exactly one caller claim each partition under concurrency', async () => {
    const results = await Promise.all([
      partitions.ensureAhead(3),
      partitions.ensureAhead(3),
      partitions.ensureAhead(3),
    ]);

    const all = results.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(0);
  });

  // Rows here are not covered by retention and block attaching a partition for
  // that range later, so the count is worth alerting on.
  it('reports rows that landed in a default partition', async () => {
    const counts = await partitions.defaultPartitionRows();
    expect(counts.map((c) => c.table)).toContain('WorkflowExecutions');
    expect(counts.every((c) => typeof c.rows === 'number')).toBe(true);
  });
});

describe('stuck-workflow sweeper', () => {
  // It should never find anything. A hit means one of the wakeup invariants was
  // violated, so the count is a bug report rather than routine maintenance.
  it('finds nothing in a healthy system', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await start();
    await drain(wf.id);

    expect(await stuckSweeper.sweep(100, 0)).toBe(0);
  });

  it('recovers a workflow with no task, timer or pending evaluation', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b')] });
    const wf = await start();
    await drain(wf.id);

    // Simulate the lost wakeup: finish the task but never request evaluation.
    const [leased] = await taskQueue.lease('a', 'w', 60, 1, namespaceId);
    await workflows.completeTask(
      wf.id,
      leased.taskId,
      TaskStatus.COMPLETED,
      {},
      undefined,
      undefined
    );
    await taskQueue.acknowledge('a', leased.taskId, leased.leaseToken);
    await harness.db
      .updateTable('TaskExecutions')
      .set({ deciderSeenAt: sql<Date>`now()` })
      .where('workflowId', '=', wf.id)
      .execute();

    expect(await stuckSweeper.sweep(100, 0)).toBe(1);
    expect(await decideQueue.depth()).toBe(1);
  });

  it('ignores a workflow with work still in flight', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await start();
    await drain(wf.id);

    // 'a' is still scheduled, so nothing is stuck.
    expect(await stuckSweeper.find(100, 0)).toHaveLength(0);
  });

  // A workflow mid-evaluation legitimately has no queued wakeup for the moment
  // its transaction is open; only sustained idleness is genuinely stuck.
  it('ignores a workflow that was only just touched', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await start();
    await drain(wf.id);
    await harness.db
      .updateTable('TaskExecutions')
      .set({ deciderSeenAt: sql<Date>`now()`, status: TaskStatus.COMPLETED, endedAt: sql<Date>`now()` })
      .where('workflowId', '=', wf.id)
      .execute();

    expect(await stuckSweeper.find(100, 3600)).toHaveLength(0);
  });

  it('ignores a terminal workflow', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await start();
    await harness.db
      .transaction()
      .execute((tx) =>
        workflows.setStatus(wf.id, WorkflowStatus.COMPLETED, undefined, undefined, tx)
      );

    expect(await stuckSweeper.find(100, 0)).toHaveLength(0);
  });
});
