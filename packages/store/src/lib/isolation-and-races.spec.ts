import {
  taskDefinitionSchema,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbTransaction } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Multi-tenancy isolation and concurrency races.
 *
 * These probe the seams rather than the happy paths: whether one namespace can
 * see another's work, whether the idempotency claim survives a genuine race,
 * and whether a retried task's output is the one expressions read.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let evaluator: Evaluator;
let nsA: string;
let nsB: string;

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

let blueprints: StubBlueprints;

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    // Zero backoff: retries would otherwise sit invisible in the queue for
    // seconds, and these tests are about correctness rather than timing.
    {
      load: async (_ns, names) =>
        new Map(
          names.map((name) => [
            name,
            taskDefinitionSchema.parse({ name, retryCount: 5, retryDelaySeconds: 0, jitter: 0 }),
          ])
        ),
    }
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  nsA = await seedNamespace(harness.db, 'tenant-a');
  nsB = await seedNamespace(harness.db, 'tenant-b');
});

describe('namespace isolation on the task queue', () => {
  // Two tenants both run a task called "charge". If the queue keys only on
  // task name, tenant A's worker leases tenant B's work — a cross-tenant data
  // leak that no amount of API-layer checking would catch, because it happens
  // below the API entirely.
  it('does not let one tenant lease another tenant\'s task', async () => {
    const taskA = randomUUID();
    const taskB = randomUUID();

    await taskQueue.enqueue({
      namespaceId: nsA,
      queueName: 'charge',
      taskId: taskA,
      workflowId: randomUUID(),
    });
    await taskQueue.enqueue({
      namespaceId: nsB,
      queueName: 'charge',
      taskId: taskB,
      workflowId: randomUUID(),
    });

    const leasedByA = await taskQueue.lease('charge', 'worker-a', 60, 10, nsA);

    expect(leasedByA).toHaveLength(1);
    expect(leasedByA[0].taskId).toBe(taskA);
    expect(leasedByA[0].namespaceId).toBe(nsA);
  });

  it('reports depth per tenant, not globally', async () => {
    await taskQueue.enqueue({
      namespaceId: nsA,
      queueName: 'charge',
      taskId: randomUUID(),
      workflowId: randomUUID(),
    });
    await taskQueue.enqueue({
      namespaceId: nsB,
      queueName: 'charge',
      taskId: randomUUID(),
      workflowId: randomUUID(),
    });
    await taskQueue.enqueue({
      namespaceId: nsB,
      queueName: 'charge',
      taskId: randomUUID(),
      workflowId: randomUUID(),
    });

    expect((await taskQueue.depth('charge', nsA)).total).toBe(1);
    expect((await taskQueue.depth('charge', nsB)).total).toBe(2);
  });

  it('leaves the other tenant\'s work untouched when one drains its queue', async () => {
    for (let i = 0; i < 5; i++) {
      await taskQueue.enqueue({
        namespaceId: nsA,
        queueName: 'shared',
        taskId: randomUUID(),
        workflowId: randomUUID(),
      });
    }
    await taskQueue.enqueue({
      namespaceId: nsB,
      queueName: 'shared',
      taskId: randomUUID(),
      workflowId: randomUUID(),
    });

    const drained = await taskQueue.lease('shared', 'worker-a', 60, 100, nsA);

    expect(drained).toHaveLength(5);
    expect((await taskQueue.depth('shared', nsB)).available).toBe(1);
  });
});

describe('idempotency strategies', () => {
  const start = (strategy: 'RETURN_EXISTING' | 'FAIL' | 'FAIL_ON_RUNNING', key = 'invoice-1') =>
    workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1, idempotencyKey: key, idempotencyStrategy: strategy });

  const finish = (id: string, status: WorkflowStatus) =>
    harness.db.updateTable('WorkflowExecutions').set({ status }).where('id', '=', id).execute();

  it('FAIL refuses any reuse of the key, naming the execution that owns it', async () => {
    const first = await start('FAIL');
    await expect(start('FAIL')).rejects.toMatchObject({ code: 'CONFLICT', details: { workflowId: first.id } });

    await finish(first.id, WorkflowStatus.COMPLETED);
    await expect(start('FAIL')).rejects.toThrow(/already used/);
  });

  it('FAIL_ON_RUNNING refuses while the owner runs, then starts a fresh execution', async () => {
    const first = await start('FAIL_ON_RUNNING');
    await expect(start('FAIL_ON_RUNNING')).rejects.toThrow(/still RUNNING/);

    await finish(first.id, WorkflowStatus.FAILED);
    const second = await start('FAIL_ON_RUNNING');
    expect(second.id).not.toBe(first.id);

    // The key now belongs to the new run.
    await expect(start('FAIL_ON_RUNNING')).rejects.toMatchObject({ details: { workflowId: second.id } });
  });

  // Two retries of a finished job arriving together must not both start it.
  it('FAIL_ON_RUNNING hands a finished key to exactly one of several concurrent starts', async () => {
    const first = await start('FAIL_ON_RUNNING', 'nightly');
    await finish(first.id, WorkflowStatus.COMPLETED);

    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => start('FAIL_ON_RUNNING', 'nightly')));
    const started = outcomes.filter((o) => o.status === 'fulfilled');
    expect(started).toHaveLength(1);

    const rows = await harness.db
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('namespaceId', '=', nsA)
      .where('idempotencyKey', '=', 'nightly')
      .execute();
    expect(rows).toHaveLength(2);
  });

  it('RETURN_EXISTING keeps returning the owner, finished or not', async () => {
    const first = await start('RETURN_EXISTING');
    await finish(first.id, WorkflowStatus.COMPLETED);
    expect((await start('RETURN_EXISTING')).id).toBe(first.id);
  });
});

describe('concurrent idempotent starts', () => {
  // The loser of the claim race must return the winner's workflow. Reading it
  // outside the transaction cannot work: the winner has not committed yet, so
  // the lookup finds nothing and the start fails instead of deduplicating.
  it('returns one shared execution when two starts race the same key', async () => {
    const start = () =>
      workflows.start({
        namespaceId: nsA,
        defName: 'wf',
        defVersion: 1,
        idempotencyKey: 'order-99',
      });

    const [first, second] = await Promise.all([start(), start()]);

    expect(first.id).toBe(second.id);

    const rows = await harness.db
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('namespaceId', '=', nsA)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('creates exactly one execution under ten concurrent starts', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        workflows.start({
          namespaceId: nsA,
          defName: 'wf',
          defVersion: 1,
          idempotencyKey: 'burst',
        })
      )
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);

    const rows = await harness.db
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('namespaceId', '=', nsA)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('keeps the same key independent across tenants', async () => {
    const a = await workflows.start({
      namespaceId: nsA,
      defName: 'wf',
      defVersion: 1,
      idempotencyKey: 'shared-key',
    });
    const b = await workflows.start({
      namespaceId: nsB,
      defName: 'wf',
      defVersion: 1,
      idempotencyKey: 'shared-key',
    });

    expect(a.id).not.toBe(b.id);
  });
});

describe('expression resolution after a retry', () => {
  // `loadTasksByRef` picks one row per refName. After a retry there are several,
  // and the newest by attempt may be the *scheduled* retry with no output yet.
  // Reading that instead of the completed attempt hands downstream tasks an
  // empty input.
  it('reads the completed attempt, not a pending retry', async () => {
    const wf = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });

    await harness.db.transaction().execute(async (tx: DbTransaction) => {
      await workflows.insertTask(
        {
          workflowId: wf.id,
          namespaceId: nsA,
          refName: 'charge',
          taskDefName: 'charge',
          taskType: TaskType.SIMPLE,
          status: TaskStatus.COMPLETED,
          attempt: 0,
          iteration: 0,
          input: {},
          output: { txnId: 'tx-from-attempt-0' },
        },
        tx
      );
      // A later attempt exists but has not run yet.
      await workflows.insertTask(
        {
          workflowId: wf.id,
          namespaceId: nsA,
          refName: 'charge',
          taskDefName: 'charge',
          taskType: TaskType.SIMPLE,
          status: TaskStatus.SCHEDULED,
          attempt: 1,
          iteration: 0,
          input: {},
        },
        tx
      );
    });

    const refs = await workflows.loadTasksByRef(wf.id, ['charge']);
    const charge = refs.get('charge');

    expect(charge?.output).toMatchObject({
      kind: 'inline',
      value: { txnId: 'tx-from-attempt-0' },
    });
  });

  it('threads a retried task output into the next task', async () => {
    blueprints.register([
      simple('flaky', { retryCount: 2 }),
      simple('after', { inputParameters: { got: '${flaky.output.value}' } }),
    ]);

    const wf = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(nsA, wf.id, 'start');

    const drain = async () => {
      for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;
    };

    await drain();

    // First attempt fails.
    const [a1] = await taskQueue.lease('flaky', 'w', 60, 1, nsA);
    await workflows.completeTask(wf.id, a1.taskId, TaskStatus.FAILED, {}, 'blip', undefined);
    await taskQueue.acknowledge('flaky', a1.taskId, a1.leaseToken);
    await decideQueue.enqueue(nsA, wf.id, 'failed');
    await drain();

    // Retry succeeds — its output is what 'after' must receive.
    const [a2] = await taskQueue.lease('flaky', 'w', 60, 1, nsA);
    expect(a2, 'retry should be queued').toBeDefined();
    await workflows.completeTask(
      wf.id,
      a2.taskId,
      TaskStatus.COMPLETED,
      { value: 'from-retry' },
      undefined,
      undefined
    );
    await taskQueue.acknowledge('flaky', a2.taskId, a2.leaseToken);
    await decideQueue.enqueue(nsA, wf.id, 'succeeded');
    await drain();

    const pending = await workflows.loadPendingTasks(wf.id);
    const after = pending.find((t) => t.refName === 'after');
    expect(after?.input).toMatchObject({ kind: 'inline', value: { got: 'from-retry' } });
  });
});

describe('workflow-level isolation', () => {
  it('does not surface another tenant\'s execution by id lookup path', async () => {
    blueprints.register([simple('a')]);

    const wfA = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(nsA, wfA.id, 'start');
    await evaluator.evaluate(wfA.id);

    // Tenant B sees nothing of A's work on its own queue.
    expect((await taskQueue.depth('a', nsB)).total).toBe(0);
    expect((await taskQueue.depth('a', nsA)).total).toBe(1);
  });

  it('keeps decide-queue entries attributable to their namespace', async () => {
    const wfA = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });
    const wfB = await workflows.start({ namespaceId: nsB, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(nsA, wfA.id, 'a');
    await decideQueue.enqueue(nsB, wfB.id, 'b');

    const batch = await decideQueue.peekBatch(10);
    const byNs = new Map(batch.map((b) => [b.workflowId, b.namespaceId]));

    expect(byNs.get(wfA.id)).toBe(nsA);
    expect(byNs.get(wfB.id)).toBe(nsB);
  });
});

describe('workflow status transitions', () => {
  it('does not resurrect a terminated workflow', async () => {
    blueprints.register([simple('a'), simple('b')]);

    const wf = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(nsA, wf.id, 'start');
    await evaluator.evaluate(wf.id);

    await harness.db.transaction().execute((tx: DbTransaction) =>
      workflows.setStatus(wf.id, WorkflowStatus.TERMINATED, undefined, 'operator', tx)
    );

    // A task result arriving after termination must change nothing.
    const [leased] = await taskQueue.lease('a', 'w', 60, 1, nsA);
    await workflows.completeTask(wf.id, leased.taskId, TaskStatus.COMPLETED, {}, undefined, undefined);
    await decideQueue.enqueue(nsA, wf.id, 'late result');
    await evaluator.evaluate(wf.id);

    const after = await workflows.findById(wf.id);
    expect(after?.status).toBe(WorkflowStatus.TERMINATED);
    expect((await taskQueue.depth('b', nsA)).total).toBe(0);
  });

  it('records an ended timestamp exactly once on completion', async () => {
    blueprints.register([simple('a')]);

    const wf = await workflows.start({ namespaceId: nsA, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(nsA, wf.id, 'start');
    await evaluator.evaluate(wf.id);

    const [leased] = await taskQueue.lease('a', 'w', 60, 1, nsA);
    await workflows.completeTask(wf.id, leased.taskId, TaskStatus.COMPLETED, {}, undefined, undefined);
    await decideQueue.enqueue(nsA, wf.id, 'done');
    for (let i = 0; i < 5; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;

    const finished = await workflows.findById(wf.id);
    expect(finished?.status).toBe(WorkflowStatus.COMPLETED);
    expect(finished?.endedAt).toBeInstanceOf(Date);
  });
});
