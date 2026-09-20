import { TaskStatus, TaskType, WorkflowStatus, taskDefinitionSchema, workflowDefinitionSchema } from '@node-flow-dev/core';
import { compileBlueprint, rateLimitFor, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { StuckWorkflowSweeper } from './stuck-workflow-sweeper.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Per-key workflow concurrency (`rateLimitConfig`).
 *
 * Each test tries to get one more execution running under a key than the limit
 * allows — by racing, by arriving while a slot is freeing, or by waking a
 * waiting execution some other way.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let dispatch: TaskDispatchService;
let evaluator: Evaluator;
let namespaceId: string;

const blueprint: Blueprint = compileBlueprint(
  workflowDefinitionSchema.parse({
    name: 'wf',
    version: 1,
    tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }],
    rateLimitConfig: { rateLimitKey: '${workflow.input.customer}', concurrentExecLimit: 2 },
  })
);

const policy: TaskDefLoader = {
  load: async (_ns, names) => new Map(names.map((name) => [name, taskDefinitionSchema.parse({ name, retryCount: 0 })])),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db, undefined, {
    rateLimitFor: async (_ns, _name, _version, input) => rateLimitFor(blueprint, input),
  });
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  const timers = new TimerRepository(harness.db);
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue, timers);
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    new OutboxRepository(harness.db),
    { load: async () => blueprint },
    policy,
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

async function start(customer: string) {
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, input: { customer } });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await evaluator.evaluate(wf.id);
  return wf;
}

async function tasksOf(workflowId: string) {
  return harness.db.selectFrom('TaskExecutions').select('status').where('workflowId', '=', workflowId).execute();
}

/** Completes the one queued task belonging to `workflowId`. */
async function finish(workflowId: string) {
  const leased = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w', limit: 50 });
  const mine = leased.find((t) => t.workflowId === workflowId);
  if (!mine) throw new Error(`no task leased for ${workflowId}`);
  // Hand the others back so later leases can find them.
  await sql`UPDATE "TaskQueues" SET "leaseExpiresAt" = NULL, "leaseToken" = NULL WHERE "taskId" <> ${mine.taskId}`.execute(
    harness.db
  );
  await dispatch.report({
    namespaceId,
    queueName: 'a',
    workflowId,
    taskId: mine.taskId,
    leaseToken: mine.leaseToken,
    status: TaskStatus.COMPLETED,
    output: {},
  });
  await evaluator.evaluate(workflowId);
}

describe('workflow rate limit by key', () => {
  it('runs up to the limit per key and holds the rest, whatever wakes them', async () => {
    const a1 = await start('acme');
    const a2 = await start('acme');
    const a3 = await start('acme');
    const b1 = await start('globex');

    expect(await tasksOf(a1.id)).toHaveLength(1);
    expect(await tasksOf(a2.id)).toHaveLength(1);
    expect(await tasksOf(b1.id)).toHaveLength(1);
    expect(await tasksOf(a3.id)).toHaveLength(0);

    const waiting = await workflows.findById(a3.id);
    expect(waiting).toMatchObject({ status: WorkflowStatus.RUNNING, rateLimitKey: 'acme', awaitingAdmission: true });

    // A stray wakeup must not start it.
    await decideQueue.enqueue(namespaceId, a3.id, 'stray');
    expect((await evaluator.evaluate(a3.id)).evaluated).toBe(false);
    expect(await tasksOf(a3.id)).toHaveLength(0);

    // Nothing to admit while both slots are taken.
    expect(await workflows.admitWaiting()).toEqual([]);
  });

  it('admits the oldest waiting execution when a slot frees, and a newcomer does not jump the line', async () => {
    const a1 = await start('acme');
    await start('acme');
    const a3 = await start('acme');

    await finish(a1.id);
    expect((await workflows.findById(a1.id))?.status).toBe(WorkflowStatus.COMPLETED);

    // Arrives after the slot freed but before the admission runner ran.
    const a4 = await start('acme');
    expect(await tasksOf(a4.id)).toHaveLength(0);

    const admitted = await workflows.admitWaiting();
    expect(admitted.map((e) => e.id)).toEqual([a3.id]);
    // What the admission runner does with each admitted execution.
    await decideQueue.enqueue(namespaceId, a3.id, 'admitted');
    await evaluator.evaluate(a3.id);
    expect(await tasksOf(a3.id)).toHaveLength(1);
    expect((await workflows.findById(a4.id))?.awaitingAdmission).toBe(true);
  });

  it('never admits past the limit under concurrent starts', async () => {
    // Each start holds its transaction open a moment after inserting, which is
    // the window in which an unserialised count would still see a free slot.
    const started = await Promise.all(
      Array.from({ length: 12 }, () =>
        harness.db.transaction().execute(async (tx) => {
          const execution = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, input: { customer: 'acme' } }, tx);
          await new Promise((resolve) => setTimeout(resolve, 30));
          return execution;
        })
      )
    );
    expect(started.filter((e) => !e.awaitingAdmission)).toHaveLength(2);
    expect(await workflows.admitWaiting()).toEqual([]);
  });

  it('frees the slot of a terminated execution, and never admits a terminated or paused waiter', async () => {
    const a1 = await start('acme');
    await start('acme');
    const a3 = await start('acme');
    const a4 = await start('acme');
    const a5 = await start('acme');

    await sql`UPDATE "WorkflowExecutions" SET status = 'TERMINATED' WHERE id IN (${a1.id}, ${a3.id})`.execute(harness.db);
    await sql`UPDATE "WorkflowExecutions" SET status = 'PAUSED' WHERE id = ${a4.id}`.execute(harness.db);

    expect((await workflows.admitWaiting()).map((e) => e.id)).toEqual([a5.id]);
  });

  it('is not reported as stuck while it waits', async () => {
    await start('acme');
    await start('acme');
    const a3 = await start('acme');
    await sql`UPDATE "WorkflowExecutions" SET "startedAt" = now() - interval '1 hour'`.execute(harness.db);
    await sql`DELETE FROM "DecideQueues"`.execute(harness.db);

    const stuck = await new StuckWorkflowSweeper(harness.db, decideQueue).find(100, 0);
    expect(stuck.map((s) => s.workflowId)).not.toContain(a3.id);
  });

  it('limits an execution whose key is missing rather than letting it escape', async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, input: {} });
      runs.push(wf);
    }
    expect(runs.map((r) => r.awaitingAdmission)).toEqual([false, false, true]);
    expect(runs[0].rateLimitKey).toBe('${workflow.input.customer}');
  });
});
