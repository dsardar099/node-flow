import {
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyRepository } from './concurrency.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { ExecutionControlService } from './execution-control.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { json } from './schema.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowEventsRepository, WorkflowEventType } from './workflow-events.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Operator control: pause, resume, terminate, retry, rerun, skip.
 *
 * These run during incidents, so the tests are about what must *not* happen —
 * a pause that keeps scheduling, a terminate that leaves a task on the queue
 * for a worker to pick up, a rerun silently absorbed by the unique index.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let concurrency: ConcurrencyRepository;
let events: WorkflowEventsRepository;
let dispatch: TaskDispatchService;
let control: ExecutionControlService;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;

const simple = (ref: string) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
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
    new Map(
      names.map((name) => [
        name,
        taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0 }),
      ])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  concurrency = new ConcurrencyRepository(harness.db);
  events = new WorkflowEventsRepository(harness.db);
  dispatch = new TaskDispatchService(
    harness.db,
    workflows,
    taskQueue,
    decideQueue,
    timers,
    concurrency
  );
  control = new ExecutionControlService(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    timers,
    concurrency,
    events
  );
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
});

async function start(definition: Record<string, unknown> = { tasks: [simple('a'), simple('b')] }) {
  blueprints.register(definition);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await drain(wf.id);
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

async function complete(
  workflowId: string,
  queueName: string,
  status: TaskStatus = TaskStatus.COMPLETED
) {
  const [leased] = await dispatch.lease({ namespaceId, queueName, workerId: 'w' });
  if (!leased) throw new Error(`nothing queued on ${queueName}`);
  await dispatch.report({
    namespaceId,
    queueName,
    workflowId,
    taskId: leased.taskId,
    leaseToken: leased.leaseToken,
    status,
    reason: status === TaskStatus.COMPLETED ? undefined : 'boom',
  });
}

const refsOf = async (workflowId: string) =>
  (
    await harness.db
      .selectFrom('TaskExecutions')
      .select('refName')
      .where('workflowId', '=', workflowId)
      .execute()
  ).map((t) => t.refName);

describe('pause and resume', () => {
  it('marks the workflow paused', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.PAUSED);
  });

  // PAUSED is not a terminal status, so without an explicit check the decider
  // happily keeps advancing a paused workflow and pause is decorative.
  it('stops the decider scheduling anything further', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');
    await complete(wf.id, 'a');

    await drain(wf.id);

    expect(await refsOf(wf.id)).toEqual(['a']);
  });

  // The decider claims and discards wakeups while paused, so by resume time
  // there may be completed tasks with nothing queued to react to them. Without
  // the enqueue in resume, the workflow returns to RUNNING and sits forever.
  it('picks up work completed while it was paused', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');
    await complete(wf.id, 'a');
    await drain(wf.id);

    await control.resume(wf.id, 'alice');
    await drain(wf.id);

    expect(await refsOf(wf.id)).toContain('b');
  });

  it('runs to completion after resuming', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');
    await control.resume(wf.id, 'alice');

    await complete(wf.id, 'a');
    await drain(wf.id);
    await complete(wf.id, 'b');
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('is idempotent in both directions', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');
    await expect(control.pause(wf.id, 'alice')).resolves.toBeUndefined();
    await control.resume(wf.id, 'alice');
    await expect(control.resume(wf.id, 'alice')).resolves.toBeUndefined();

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  it('refuses to pause a finished workflow', async () => {
    const wf = await start({ tasks: [simple('a')] });
    await complete(wf.id, 'a');
    await drain(wf.id);

    await expect(control.pause(wf.id, 'alice')).rejects.toThrow(/already COMPLETED/);
  });

  it('records who paused it', async () => {
    const wf = await start();
    await control.pause(wf.id, 'alice');

    const history = await events.history(wf.id);
    const paused = history.find((e) => e.type === WorkflowEventType.WORKFLOW_PAUSED);
    expect(paused?.payload).toMatchObject({ by: 'alice' });
  });
});

describe('terminate', () => {
  it('ends the workflow with its reason', async () => {
    const wf = await start();
    await control.terminate(wf.id, 'cost runaway', 'alice');

    const after = await workflows.findById(wf.id);
    expect(after?.status).toBe(WorkflowStatus.TERMINATED);
    expect(after?.reasonForIncompletion).toBe('cost runaway');
  });

  it('cancels the tasks that were still live', async () => {
    const wf = await start();
    await control.terminate(wf.id, 'stop', 'alice');

    const tasks = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(tasks.every((t) => t.status === TaskStatus.CANCELED)).toBe(true);
  });

  // A queue entry left behind gets leased by a worker, which then runs real
  // work on behalf of a workflow that is already dead.
  it('leaves nothing on the queue for a worker to pick up', async () => {
    const wf = await start();
    await control.terminate(wf.id, 'stop', 'alice');

    expect((await taskQueue.depth('a', namespaceId)).total).toBe(0);
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    expect(leased).toBeUndefined();
  });

  it('disarms the timers it had armed', async () => {
    const wf = await start({ tasks: [simple('a')], timeoutSeconds: 600 });
    expect(await timers.pendingCount()).toBeGreaterThan(0);

    await control.terminate(wf.id, 'stop', 'alice');

    expect(await timers.pendingCount()).toBe(0);
  });

  // An unreleased permit throttles unrelated workflows until its lease expires.
  it('releases the semaphore permits its tasks held', async () => {
    await concurrency.configureSemaphore(namespaceId, 'legacy-api', 1);
    const wf = await start({ tasks: [simple('a')] });

    await dispatch.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w',
      policy: {
        concurrentExecLimit: 0,
        rateLimitPerFrequency: 0,
        rateLimitFrequencySeconds: 60,
        semaphores: ['legacy-api'],
      },
    });

    const held = await harness.db
      .selectFrom('SemaphoreHolders')
      .select('taskId')
      .where('namespaceId', '=', namespaceId)
      .execute();
    expect(held).toHaveLength(1);

    await control.terminate(wf.id, 'stop', 'alice');

    const after = await harness.db
      .selectFrom('SemaphoreHolders')
      .select('taskId')
      .where('namespaceId', '=', namespaceId)
      .execute();
    expect(after).toHaveLength(0);
  });

  it('leaves no pending evaluation behind', async () => {
    const wf = await start();
    await decideQueue.enqueue(namespaceId, wf.id, 'stale');
    await control.terminate(wf.id, 'stop', 'alice');

    expect(await decideQueue.depth()).toBe(0);
  });

  it('refuses to terminate twice', async () => {
    const wf = await start();
    await control.terminate(wf.id, 'stop', 'alice');

    await expect(control.terminate(wf.id, 'again', 'alice')).rejects.toThrow(/already TERMINATED/);
  });
});

describe('retry', () => {
  it('re-runs the failed task and keeps what succeeded', async () => {
    const wf = await start();
    await complete(wf.id, 'a');
    await drain(wf.id);
    await complete(wf.id, 'b', TaskStatus.FAILED);
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.FAILED);

    expect(await control.retry(wf.id, 'alice')).toBe(1);
    await drain(wf.id);

    const tasks = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();

    // 'a' keeps its result; only 'b' is runnable again.
    expect(tasks.find((t) => t.refName === 'a')?.status).toBe(TaskStatus.COMPLETED);
    expect(tasks.find((t) => t.refName === 'b')?.status).toBe(TaskStatus.SCHEDULED);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  it('completes normally on the second attempt', async () => {
    const wf = await start({ tasks: [simple('a')] });
    await complete(wf.id, 'a', TaskStatus.FAILED);
    await drain(wf.id);

    await control.retry(wf.id, 'alice');
    await drain(wf.id);
    await complete(wf.id, 'a');
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  // Terminate cancels what was in flight; retrying must run it again rather
  // than let the decider turn the cancellation into a FAILED workflow.
  it('resumes a terminated workflow from the task it cancelled', async () => {
    const wf = await start();
    await complete(wf.id, 'a');
    await drain(wf.id);
    await control.terminate(wf.id, 'stop', 'alice');

    expect(await control.retry(wf.id, 'alice')).toBe(1);
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
    await complete(wf.id, 'b');
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('reopens only the latest attempt of a task that used up its retries', async () => {
    const wf = await start({ tasks: [simple('a')] });
    for (const attempt of [0, 1, 2]) {
      await harness.db
        .insertInto('TaskExecutions')
        .values({
          workflowId: wf.id,
          namespaceId,
          refName: 'a',
          taskDefName: 'a',
          taskType: 'SIMPLE',
          status: TaskStatus.FAILED,
          attempt,
          iteration: 0,
          input: json({}),
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await harness.db.updateTable('TaskExecutions').set({ status: TaskStatus.FAILED }).where('workflowId', '=', wf.id).execute();
    await harness.db.updateTable('WorkflowExecutions').set({ status: WorkflowStatus.FAILED }).where('id', '=', wf.id).execute();

    expect(await control.retry(wf.id, 'alice')).toBe(1);
    const scheduled = await harness.db
      .selectFrom('TaskExecutions')
      .select('attempt')
      .where('workflowId', '=', wf.id)
      .where('status', '=', TaskStatus.SCHEDULED)
      .execute();
    expect(scheduled).toEqual([{ attempt: 2 }]);
  });

  it('refuses a terminal workflow with nothing to retry, leaving it as it was', async () => {
    const wf = await start({ tasks: [simple('a')] });
    await complete(wf.id, 'a');
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);

    await expect(control.retry(wf.id, 'alice')).rejects.toThrow(/nothing to retry|no failed or cancelled task/);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('refuses to retry a workflow that is still running', async () => {
    const wf = await start();
    await expect(control.retry(wf.id, 'alice')).rejects.toThrow(/only a terminal workflow/);
  });
});

describe('rerunFromTask', () => {
  // Reset-in-place would be absorbed by the unique index on
  // (workflowId, refName, iteration, attempt) and the rerun would do nothing.
  it('discards the target task and everything after it', async () => {
    const wf = await start();
    await complete(wf.id, 'a');
    await drain(wf.id);
    expect(await refsOf(wf.id)).toEqual(['a', 'b']);

    const discarded = await control.rerunFromTask(wf.id, 'a', 'alice');
    expect(discarded).toBe(2);

    await drain(wf.id);
    expect(await refsOf(wf.id)).toEqual(['a']);
  });

  it('actually re-runs, rather than being absorbed as a duplicate', async () => {
    const wf = await start({ tasks: [simple('a')] });
    await complete(wf.id, 'a');
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);

    await control.rerunFromTask(wf.id, 'a', 'alice');
    await drain(wf.id);

    // A fresh, runnable task exists and the workflow is live again.
    expect((await taskQueue.depth('a', namespaceId)).available).toBe(1);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  it('reports an unknown task rather than doing nothing', async () => {
    const wf = await start();
    await expect(control.rerunFromTask(wf.id, 'nope', 'alice')).rejects.toThrow(/no task "nope"/);
  });
});

describe('skipTask', () => {
  it('skips a scheduled task and lets the workflow move on', async () => {
    const wf = await start();
    await control.skipTask(wf.id, 'a', 'alice');
    await drain(wf.id);

    const tasks = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(tasks.find((t) => t.refName === 'a')?.status).toBe(TaskStatus.SKIPPED);
    expect(tasks.map((t) => t.refName)).toContain('b');
  });

  it('takes the skipped task off the queue', async () => {
    const wf = await start();
    await control.skipTask(wf.id, 'a', 'alice');

    expect((await taskQueue.depth('a', namespaceId)).total).toBe(0);
  });

  it('reports an unknown task', async () => {
    const wf = await start();
    await expect(control.skipTask(wf.id, 'nope', 'alice')).rejects.toThrow(/no runnable task/);
  });

  it('refuses on a finished workflow', async () => {
    const wf = await start({ tasks: [simple('a')] });
    await complete(wf.id, 'a');
    await drain(wf.id);

    await expect(control.skipTask(wf.id, 'a', 'alice')).rejects.toThrow(/already COMPLETED/);
  });
});

describe('missing workflows', () => {
  const absent = '00000000-0000-7000-8000-000000000000';

  it('reports not found rather than succeeding silently', async () => {
    await expect(control.pause(absent, 'alice')).rejects.toThrow(/no workflow/);
    await expect(control.terminate(absent, 'x', 'alice')).rejects.toThrow(/no workflow/);
    await expect(control.retry(absent, 'alice')).rejects.toThrow(/no workflow/);
  });
});

/**
 * Stopping one task without ending the run.
 *
 * The distinction that matters: a cancelled task is *not* a failed one. A
 * failure is something the definition handles — it spends a retry, may start a
 * failure workflow — and an operator stepping in is none of that.
 */
describe('cancelTask', () => {
  it('cancels the task and pauses the workflow', async () => {
    const wf = await start();

    const result = await control.cancelTask(wf.id, 'a', 'alice');

    expect(result.status).toBe(WorkflowStatus.PAUSED);

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status'])
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'a')
      .executeTakeFirstOrThrow();
    expect(task.status).toBe(TaskStatus.CANCELED);

    const workflow = await harness.db
      .selectFrom('WorkflowExecutions')
      .select('status')
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(workflow.status).toBe(WorkflowStatus.PAUSED);
  });

  /**
   * The pause is the point. Without it the decider carries on with whatever
   * else was runnable, and the operator is racing their own workflow while
   * they work out what went wrong.
   */
  it('stops the workflow making further progress', async () => {
    const wf = await start();
    await control.cancelTask(wf.id, 'a', 'alice');

    await drain(wf.id);

    // `b` follows `a`; a paused workflow must not have scheduled it.
    expect(await refsOf(wf.id)).not.toContain('b');
  });

  it('releases the queue entry so no worker can still pick it up', async () => {
    const wf = await start();
    await control.cancelTask(wf.id, 'a', 'alice');

    const queued = await harness.db
      .selectFrom('TaskQueues')
      .select('id')
      .where('workflowId', '=', wf.id)
      .execute();
    expect(queued).toHaveLength(0);
  });

  it('refuses a task that is not running', async () => {
    const wf = await start();
    await expect(control.cancelTask(wf.id, 'b', 'alice')).rejects.toThrow(/no running task/);
  });

  it('refuses to cancel inside a finished workflow', async () => {
    const wf = await start();
    await control.terminate(wf.id, 'done', 'alice');
    await expect(control.cancelTask(wf.id, 'a', 'alice')).rejects.toThrow();
  });
});

/**
 * Running named tasks again.
 *
 * The behaviour worth pinning down is what `cascade` does and does not touch —
 * that is the difference between a consistent run and a quietly corrupted one,
 * and it is the operator's choice either way.
 */
describe('rerunTasks', () => {
  const linear = { tasks: [simple('a'), simple('b'), simple('c')] };

  async function finished() {
    const wf = await start(linear);
    await complete(wf.id, 'a');
    await drain(wf.id);
    await complete(wf.id, 'b');
    await drain(wf.id);
    await complete(wf.id, 'c');
    await drain(wf.id);
    return wf;
  }

  it('re-runs only the named task by default, and says what is now stale', async () => {
    const wf = await finished();

    const result = await control.rerunTasks(wf.id, ['a'], { by: 'alice', blueprints });

    expect(result.rerun).toEqual(['a']);
    // `b` and `c` still hold outputs derived from the run of `a` being replaced.
    expect(result.staleDownstream).toEqual(['b', 'c']);

    // `a` is re-armed in place rather than deleted — the decider cannot
    // re-derive it while everything downstream is COMPLETED, so its row is put
    // back to SCHEDULED and re-queued.
    const tasks = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(tasks.find((t) => t.refName === 'a')?.status).toBe(TaskStatus.SCHEDULED);
    expect(tasks.find((t) => t.refName === 'b')?.status).toBe(TaskStatus.COMPLETED);
    expect(tasks.find((t) => t.refName === 'c')?.status).toBe(TaskStatus.COMPLETED);

    // And a worker can actually reach it. Without the queue entry it would sit
    // SCHEDULED forever, looking healthy.
    const queued = await harness.db
      .selectFrom('TaskQueues')
      .select('taskId')
      .where('workflowId', '=', wf.id)
      .execute();
    expect(queued).toHaveLength(1);
  });

  it('re-runs the dependents too when asked', async () => {
    const wf = await finished();

    const result = await control.rerunTasks(wf.id, ['a'], {
      cascade: true,
      by: 'alice',
      blueprints,
    });

    expect(result.rerun.sort()).toEqual(['a', 'b', 'c']);
    // Nothing is left holding a stale result, so nothing to report.
    expect(result.staleDownstream).toEqual([]);
    expect(await refsOf(wf.id)).toEqual([]);
  });

  it('reopens the workflow so the decider runs the task again', async () => {
    const wf = await finished();
    await control.rerunTasks(wf.id, ['a'], { by: 'alice', blueprints });

    const workflow = await harness.db
      .selectFrom('WorkflowExecutions')
      .select(['status', 'endedAt'])
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(workflow.status).toBe(WorkflowStatus.RUNNING);
    expect(workflow.endedAt).toBeNull();

    // The re-armed task is queued and reachable, so a worker can run it and the
    // run carries on from there.
    await complete(wf.id, 'a');
    await drain(wf.id);

    const a = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'a')
      .executeTakeFirstOrThrow();
    expect(a.status).toBe(TaskStatus.COMPLETED);
  });

  /**
   * The rule agreed for both of these operations: pause it, then change it.
   * Doing this live races the decider for the frontier and a worker for a row
   * about to be deleted.
   */
  it('refuses while the workflow is running', async () => {
    const wf = await start(linear);
    await expect(control.rerunTasks(wf.id, ['a'], { by: 'alice', blueprints })).rejects.toThrow(
      /pause it before/
    );
  });

  it('allows it once paused', async () => {
    const wf = await start(linear);
    await complete(wf.id, 'a');
    await drain(wf.id);
    await control.pause(wf.id, 'alice');

    const result = await control.rerunTasks(wf.id, ['a'], { by: 'alice', blueprints });
    expect(result.rerun).toEqual(['a']);
  });

  it('names a task the definition does not have', async () => {
    const wf = await finished();
    await expect(
      control.rerunTasks(wf.id, ['nonexistent'], { by: 'alice', blueprints })
    ).rejects.toThrow(/no task "nonexistent"/);
  });

  it('refuses an empty list rather than quietly doing nothing', async () => {
    const wf = await finished();
    await expect(control.rerunTasks(wf.id, [], { by: 'alice', blueprints })).rejects.toThrow(
      /at least one task/
    );
  });
});
