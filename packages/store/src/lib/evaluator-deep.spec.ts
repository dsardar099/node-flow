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
 * Adversarial end-to-end tests.
 *
 * The existing suites cover the paths that were built deliberately. These probe
 * the ones that were *assumed* to work: retries actually re-running, loops
 * terminating, concurrent deciders, crash recovery, and lease expiry putting
 * real work back on the queue.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
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

  register(tasks: unknown[], name = 'wf', version = 1): Blueprint {
    const bp = compileBlueprint(workflowDefinitionSchema.parse({ name, version, tasks }));
    this.map.set(`${name}:${version}`, bp);
    return bp;
  }

  async load(_ns: string, defName: string, defVersion: number): Promise<Blueprint> {
    const bp = this.map.get(`${defName}:${defVersion}`);
    if (!bp) throw new Error(`no blueprint for ${defName} v${defVersion}`);
    return bp;
  }
}

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    // Retries back off exponentially by default, so a retried task sits
    // invisible in the queue for seconds. Zero delay keeps these tests
    // exercising the real retry path without sleeping through it.
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
  namespaceId = await seedNamespace(harness.db);
});

async function start() {
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'started');
  return wf;
}

/** Runs evaluations until the queue drains, so operator chains settle. */
async function drain(workflowId: string, max = 40): Promise<number> {
  let passes = 0;
  for (let i = 0; i < max; i++) {
    const outcome = await evaluator.evaluate(workflowId);
    if (!outcome.evaluated) break;
    passes++;
  }
  return passes;
}

async function finishTask(queueName: string, status: TaskStatus, output = {}, reason?: string) {
  const [leased] = await taskQueue.lease(queueName, 'worker', 60, 1, namespaceId);
  if (!leased) return undefined;
  await workflows.completeTask(
    leased.workflowId,
    leased.taskId,
    status,
    output as never,
    reason,
    undefined
  );
  await taskQueue.acknowledge(queueName, leased.taskId, leased.leaseToken);
  await decideQueue.enqueue(namespaceId, leased.workflowId, 'task finished');
  return leased;
}

describe('retries actually re-run the task', () => {
  // The decider emits RetryTask correctly — engine tests prove that. What was
  // never checked is whether the evaluator turns it into a task a worker can
  // pick up. It writes at the same (refName, iteration) as the failed attempt,
  // so the identity constraint absorbs it and the retry silently never happens.
  it('puts a failed task back on the queue for a second attempt', async () => {
    blueprints.register([simple('flaky', { retryCount: 2 })]);
    const wf = await start();

    await drain(wf.id);
    await finishTask('flaky', TaskStatus.FAILED, {}, 'transient blip');
    await drain(wf.id);

    // total, not available: a retry may still be serving its backoff delay.
    expect((await taskQueue.depth('flaky', namespaceId)).total).toBe(1);

    const wfNow = await workflows.findById(wf.id);
    expect(wfNow?.status).toBe(WorkflowStatus.RUNNING);
  });

  /**
   * A retried operator must not go on a worker queue.
   *
   * The schedule path has always excluded operators and waiting tasks — they
   * are resolved by the decider or by a timer, and no worker knows what to do
   * with one. The retry path enqueued unconditionally, so a retried
   * `SUB_WORKFLOW` landed on a queue nobody serves and waited there for good,
   * hanging its parent. `retryCount` defaults to 3, so this was the ordinary
   * path rather than an edge case.
   */
  it('does not queue a retried operator to a worker', async () => {
    blueprints.register([
      {
        name: 'child',
        taskReferenceName: 'child',
        type: TaskType.SUB_WORKFLOW,
        retryCount: 2,
        subWorkflowParam: { name: 'fulfilment', version: 1 },
      },
    ]);
    const wf = await start();

    await drain(wf.id);

    // Fail it the way a failed child reports back to its parent: the task is
    // not on a queue, so there is no lease to go through.
    const task = await workflows.findTaskByRef(wf.id, 'child');
    await workflows.completeTask(wf.id, task!.id, TaskStatus.FAILED, {}, 'child failed', undefined);
    await decideQueue.enqueue(namespaceId, wf.id, 'child failed');
    await drain(wf.id);

    expect((await taskQueue.depth('child', namespaceId)).total).toBe(0);
  });

  it('records the retry as a separate attempt', async () => {
    blueprints.register([simple('flaky', { retryCount: 2 })]);
    const wf = await start();

    await drain(wf.id);
    await finishTask('flaky', TaskStatus.FAILED, {}, 'blip');
    await drain(wf.id);

    const { rows } = await sql.raw<never>(`SELECT "attempt", "status" FROM "TaskExecutions"
        WHERE "workflowId" = '${wf.id}' AND "refName" = 'flaky' ORDER BY "attempt"`).execute(harness.db);
    const attempts = rows as { attempt: number; status: string }[];

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0]).toMatchObject({ attempt: 0, status: TaskStatus.FAILED });
    expect(attempts[1]).toMatchObject({ attempt: 1, status: TaskStatus.SCHEDULED });
  });

  it('succeeds on the retry and carries the workflow to completion', async () => {
    blueprints.register([simple('flaky', { retryCount: 2 }), simple('after')]);
    const wf = await start();

    await drain(wf.id);
    await finishTask('flaky', TaskStatus.FAILED, {}, 'blip');
    await drain(wf.id);
    await finishTask('flaky', TaskStatus.COMPLETED, { ok: true });
    await drain(wf.id);
    await finishTask('after', TaskStatus.COMPLETED);
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('fails the workflow only after every attempt is spent', async () => {
    blueprints.register([simple('doomed', { retryCount: 1 })]);
    const wf = await start();

    await drain(wf.id);
    await finishTask('doomed', TaskStatus.FAILED, {}, 'first');
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);

    await finishTask('doomed', TaskStatus.FAILED, {}, 'second and final');
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.FAILED);
  });
});

describe('DO_WHILE terminates', () => {
  const loopWorkflow = () =>
    blueprints.register([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: '${loop.output.iteration} < 3',
        loopOver: [simple('body')],
      },
      simple('after'),
    ]);

  it('runs the body once per iteration', async () => {
    loopWorkflow();
    const wf = await start();

    await drain(wf.id);
    for (let i = 0; i < 3; i++) {
      const leased = await finishTask('body', TaskStatus.COMPLETED, { i });
      expect(leased, `body should be queued for iteration ${i + 1}`).toBeDefined();
      await drain(wf.id);
    }

    const { rows } = await sql.raw<never>(`SELECT count(*)::int AS c FROM "TaskExecutions"
        WHERE "workflowId" = '${wf.id}' AND "refName" = 'body'`).execute(harness.db);
    expect((rows as { c: number }[])[0].c).toBe(3);
  });

  // The loop-exit path re-schedules the DO_WHILE task at its original identity,
  // which the constraint absorbs — leaving the DO_WHILE row non-terminal
  // forever, so the frontier never empties and the workflow never completes.
  it('completes the DO_WHILE task and the workflow when the loop exits', async () => {
    loopWorkflow();
    const wf = await start();

    await drain(wf.id);
    for (let i = 0; i < 3; i++) {
      await finishTask('body', TaskStatus.COMPLETED, { i });
      await drain(wf.id);
    }
    await finishTask('after', TaskStatus.COMPLETED);
    await drain(wf.id);

    const { rows } = await sql.raw<never>(`SELECT "status" FROM "TaskExecutions"
        WHERE "workflowId" = '${wf.id}' AND "refName" = 'loop'`).execute(harness.db);
    expect((rows as { status: string }[])[0].status).toBe(TaskStatus.COMPLETED);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });
});

describe('optional tasks', () => {
  it('carries on past a failed optional task', async () => {
    blueprints.register([simple('flaky', { optional: true, retryCount: 0 }), simple('after')]);
    const wf = await start();

    await drain(wf.id);
    await finishTask('flaky', TaskStatus.FAILED, {}, 'ignored');
    await drain(wf.id);

    expect((await taskQueue.depth('after', namespaceId)).total).toBe(1);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });
});

describe('concurrent deciders on one workflow', () => {
  // The row lock is the per-workflow serialisation. If it fails, two
  // evaluations interleave and the identity constraint is the only thing left
  // between us and duplicated tasks.
  it('never double-schedules under ten concurrent evaluations', async () => {
    blueprints.register([simple('a'), simple('b'), simple('c')]);
    const wf = await start();

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => evaluator.evaluate(wf.id))
    );

    expect(outcomes.filter((o) => o.evaluated)).toHaveLength(1);

    const { rows } = await sql.raw<never>(`SELECT "refName", count(*)::int AS c FROM "TaskExecutions"
        WHERE "workflowId" = '${wf.id}' GROUP BY "refName"`).execute(harness.db);
    for (const row of rows as { refName: string; c: number }[]) {
      expect(row.c, `${row.refName} scheduled more than once`).toBe(1);
    }
  });

  it('keeps a workflow correct when completions and evaluations race', async () => {
    blueprints.register([simple('a'), simple('b'), simple('c')]);
    const wf = await start();
    await drain(wf.id);

    for (const queue of ['a', 'b', 'c']) {
      const leased = await finishTask(queue, TaskStatus.COMPLETED);
      expect(leased, `expected work on "${queue}"`).toBeDefined();
      // Several deciders wake at once, as they would in a real deployment.
      await Promise.all([
        evaluator.evaluate(wf.id),
        evaluator.evaluate(wf.id),
        evaluator.evaluate(wf.id),
      ]);
    }

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });
});

describe('crash recovery', () => {
  it('loses no progress when an evaluation throws mid-flight', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await start();
    await drain(wf.id);
    await finishTask('a', TaskStatus.COMPLETED);

    let failNext = true;
    const flaky = new Evaluator(harness.db, workflows, decideQueue, taskQueue, outbox, {
      load: async (ns, name, version) => {
        if (failNext) {
          failNext = false;
          throw new Error('decider crashed');
        }
        return blueprints.load(ns, name, version);
      },
    });

    await expect(flaky.evaluate(wf.id)).rejects.toThrow('decider crashed');

    // The claim survived, so the completion is not lost.
    expect(await decideQueue.depth()).toBe(1);

    await drain(wf.id);
    expect((await taskQueue.depth('b', namespaceId)).total).toBe(1);
  });

  it('re-processes a completion whose evaluation rolled back', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await start();
    await drain(wf.id);
    await finishTask('a', TaskStatus.COMPLETED);

    const broken = new Evaluator(harness.db, workflows, decideQueue, taskQueue, outbox, {
      load: async () => {
        throw new Error('boom');
      },
    });
    await expect(broken.evaluate(wf.id)).rejects.toThrow('boom');

    // deciderSeenAt must not have been committed, or 'a' is invisible forever.
    const { rows } = await sql.raw<never>(`SELECT count(*)::int AS c FROM "TaskExecutions"
        WHERE "workflowId" = '${wf.id}' AND "endedAt" IS NOT NULL AND "deciderSeenAt" IS NULL`).execute(harness.db);
    expect((rows as { c: number }[])[0].c).toBe(1);
  });
});

describe('lease expiry returns real work to the queue', () => {
  it('lets another worker pick up a task abandoned by a crashed one', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await start();
    await drain(wf.id);

    // A worker takes the task with an already-expired lease, then dies.
    const [abandoned] = await taskQueue.lease('a', 'doomed-worker', -1, 1, namespaceId);
    expect(abandoned).toBeDefined();

    expect(await taskQueue.reclaimExpiredLeases(10)).toHaveLength(1);

    const [recovered] = await taskQueue.lease('a', 'healthy-worker', 60, 1, namespaceId);
    expect(recovered).toBeDefined();
    expect(recovered.taskId).toBe(abandoned.taskId);

    // The abandoned worker returning late must not be able to complete it.
    expect(await taskQueue.acknowledge('a', abandoned.taskId, abandoned.leaseToken)).toBe(false);

    await workflows.completeTask(wf.id, recovered.taskId, TaskStatus.COMPLETED, {}, undefined, undefined);
    await taskQueue.acknowledge('a', recovered.taskId, recovered.leaseToken);
    await decideQueue.enqueue(namespaceId, wf.id, 'recovered');
    await drain(wf.id);

    expect((await taskQueue.depth('b', namespaceId)).total).toBe(1);
  });
});

describe('scale', () => {
  // PLAN.md claims evaluation cost tracks what changed, not workflow size.
  // A long sequential workflow is the cheapest way to check that claim holds
  // once real queries are involved.
  it('keeps per-evaluation cost flat across a 200-step workflow', async () => {
    blueprints.register(Array.from({ length: 200 }, (_, i) => simple(`t${i}`)));
    const wf = await start();
    await drain(wf.id);

    const timings: number[] = [];
    for (let i = 0; i < 200; i++) {
      await finishTask(`t${i}`, TaskStatus.COMPLETED);
      const started = performance.now();
      await drain(wf.id);
      timings.push(performance.now() - started);
    }

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);

    // Compare the first and last tenth: if evaluation cost grew with history,
    // the tail would be markedly slower than the head.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const head = mean(timings.slice(0, 20));
    const tail = mean(timings.slice(-20));

    expect(tail).toBeLessThan(head * 4);
  }, 120_000);
});
