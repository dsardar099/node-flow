import {
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import {
  HttpTaskExecutor,
  NoopTaskExecutor,
  TaskExecutorRegistry,
  type TaskContext,
  type TaskExecutor,
  type TaskOutcome,
} from '@node-flow-dev/tasks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { SystemTaskRunner } from './system-task.runner.js';
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
 * System tasks, end to end.
 *
 * Before this, every declared type beyond `SIMPLE` and the operators was
 * enqueued for an external worker that by definition does not exist, so it
 * simply hung. These tests are about the whole loop: the decider schedules, the
 * runner leases and executes, the result flows back and the workflow advances.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let dispatch: TaskDispatchService;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;
let sweeper: TimeoutSweeper;

/** A recording executor, so a test can control the outcome. */
class ScriptedExecutor implements TaskExecutor {
  readonly calls: TaskContext[] = [];
  constructor(
    readonly type: TaskType,
    private readonly reply: (context: TaskContext) => TaskOutcome | Promise<TaskOutcome>
  ) {}
  async execute(context: TaskContext): Promise<TaskOutcome> {
    this.calls.push(context);
    return this.reply(context);
  }
}

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[]): void {
    this.map.set('wf:1', compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks })));
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
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue, timers);
  sweeper = new TimeoutSweeper(harness.db, timers, workflows, decideQueue);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    defLoader,
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

function runnerFor(registry: TaskExecutorRegistry): SystemTaskRunner {
  return new SystemTaskRunner(registry, dispatch, workflows, undefined, {
    leaseSeconds: 30,
  });
}

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

const httpTask = (ref: string, input: Record<string, unknown>) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.HTTP,
  inputParameters: input,
});

const statusOf = async (workflowId: string, refName: string) =>
  (
    await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'output', 'reasonForIncompletion'])
      .where('workflowId', '=', workflowId)
      .where('refName', '=', refName)
      .executeTakeFirstOrThrow()
  );

describe('the queue marks system tasks', () => {
  // The runner leases by type, so this column is what makes a system task
  // findable without joining the widest table in the system.
  it('records the task type on the queue row', async () => {
    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);

    const row = await harness.db
      .selectFrom('TaskQueues')
      .select('taskType')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.taskType).toBe(TaskType.HTTP);
  });

  it('still marks a worker task SIMPLE', async () => {
    const wf = await start([{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }]);

    const row = await harness.db
      .selectFrom('TaskQueues')
      .select('taskType')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.taskType).toBe('SIMPLE');
  });

  it('leases only the types the registry can run', async () => {
    await start([httpTask('call', { uri: 'https://example.com' })]);

    const leased = await taskQueue.leaseSystemTasks({
      types: [TaskType.INLINE],
      workerId: 'w',
      leaseSeconds: 30,
      limit: 10,
    });

    expect(leased).toEqual([]);
  });

  // A system-task lease must never take a worker's task.
  it('never leases a SIMPLE task', async () => {
    await start([{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }]);

    const leased = await taskQueue.leaseSystemTasks({
      types: [TaskType.HTTP, TaskType.NOOP],
      workerId: 'w',
      leaseSeconds: 30,
      limit: 10,
    });

    expect(leased).toEqual([]);
  });
});

describe('running a system task', () => {
  it('executes it and completes the workflow', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'COMPLETED',
      output: { status: 200 },
    }));
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);

    expect(await runner.runBatch()).toBe(1);
    await runner.drain();
    await drain(wf.id);

    expect((await statusOf(wf.id, 'call')).status).toBe(TaskStatus.COMPLETED);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('hands the executor the task’s resolved input', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({ status: 'COMPLETED' }));
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    await start([httpTask('call', { uri: 'https://example.com/x', method: 'POST' })]);
    await runner.runBatch();
    await runner.drain();

    expect(executor.calls[0].input).toMatchObject({
      uri: 'https://example.com/x',
      method: 'POST',
    });
  });

  it('passes one system task’s output into the next task', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'COMPLETED',
      output: { body: { token: 'abc' } as unknown as JsonValue },
    }));
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    const wf = await start([
      httpTask('call', { uri: 'https://example.com' }),
      {
        name: 'use',
        taskReferenceName: 'use',
        type: TaskType.SIMPLE,
        inputParameters: { token: '${call.output.body.token}' },
      },
    ]);

    await runner.runBatch();
    await runner.drain();
    await drain(wf.id);

    const use = await harness.db
      .selectFrom('TaskExecutions')
      .select('input')
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'use')
      .executeTakeFirstOrThrow();

    expect(use.input).toEqual({ token: 'abc' });
  });

  it('records a failure and its reason', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'FAILED',
      reason: 'upstream said no',
      terminal: true,
    }));
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);
    await runner.runBatch();
    await runner.drain();

    const task = await statusOf(wf.id, 'call');
    expect(task.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(task.reasonForIncompletion).toBe('upstream said no');
  });

  it('marks a non-terminal failure as retryable', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'FAILED',
      reason: 'gateway timeout',
    }));
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);
    await runner.runBatch();
    await runner.drain();

    expect((await statusOf(wf.id, 'call')).status).toBe(TaskStatus.FAILED);
  });

  // An executor throwing rather than returning a failure is a bug in the
  // executor, not a reason to lose the task.
  it('records a thrown error instead of dropping the task', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => {
      throw new Error('executor exploded');
    });
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);
    await runner.runBatch();
    await runner.drain();

    const task = await statusOf(wf.id, 'call');
    expect(task.status).toBe(TaskStatus.FAILED);
    expect(task.reasonForIncompletion).toContain('executor exploded');
  });

  /**
   * Leasing something with no executor and leaving it to expire would have the
   * task retried forever by a server that will never be able to run it.
   */
  it('fails a task whose type has no executor', async () => {
    const registry = new TaskExecutorRegistry().register(new NoopTaskExecutor());
    // Force a lease of a type the registry does not implement.
    const runner = new SystemTaskRunner(
      { types: [TaskType.HTTP], get: () => undefined } as unknown as TaskExecutorRegistry,
      dispatch,
      workflows
    );
    expect(registry.has(TaskType.HTTP)).toBe(false);

    const wf = await start([httpTask('call', { uri: 'https://example.com' })]);
    await runner.runBatch();
    await runner.drain();

    const task = await statusOf(wf.id, 'call');
    expect(task.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(task.reasonForIncompletion).toMatch(/no executor registered/);
  });

  // Holding leases on tasks nothing is working on makes a busy server look
  // broken: the reclaimer eventually takes them back as abandoned.
  it('leases no more than its concurrency', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const executor = new ScriptedExecutor(TaskType.HTTP, async () => {
      await gate;
      return { status: 'COMPLETED' };
    });

    const runner = new SystemTaskRunner(
      new TaskExecutorRegistry().register(executor),
      dispatch,
      workflows,
      undefined,
      { concurrency: 2, leaseSeconds: 30 }
    );

    blueprints.register([httpTask('call', { uri: 'https://example.com' })]);
    for (let i = 0; i < 5; i++) {
      const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
      await decideQueue.enqueue(namespaceId, wf.id, 'start');
      await drain(wf.id);
    }

    expect(await runner.runBatch()).toBe(2);
    expect(await runner.runBatch()).toBe(0);

    release();
    await runner.drain();
  });

  it('drains in-flight work on shutdown', async () => {
    let finished = false;
    const executor = new ScriptedExecutor(TaskType.HTTP, async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      finished = true;
      return { status: 'COMPLETED' };
    });
    const runner = runnerFor(new TaskExecutorRegistry().register(executor));

    await start([httpTask('call', { uri: 'https://example.com' })]);
    await runner.runBatch();
    await runner.drain();

    expect(finished).toBe(true);
    expect(runner.running).toBe(0);
  });
});

describe('the real HTTP executor in the loop', () => {
  // The guard is on by default, so a workflow cannot reach the metadata service
  // even when the whole engine is driving it.
  it('refuses a blocked address and fails the task terminally', async () => {
    const runner = runnerFor(new TaskExecutorRegistry().register(new HttpTaskExecutor()));

    const wf = await start([
      httpTask('call', { uri: 'http://169.254.169.254/latest/meta-data/' }),
    ]);
    await runner.runBatch();
    await runner.drain();

    const task = await statusOf(wf.id, 'call');
    expect(task.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(task.reasonForIncompletion).toMatch(/blocked/);
  });
});

describe('the registry', () => {
  it('refuses a duplicate registration', () => {
    const registry = new TaskExecutorRegistry().register(new NoopTaskExecutor());
    expect(() => registry.register(new NoopTaskExecutor())).toThrow(/already registered/);
  });

  it('allows a deliberate override', () => {
    const registry = new TaskExecutorRegistry().register(new NoopTaskExecutor());
    const replacement = new ScriptedExecutor(TaskType.NOOP, () => ({ status: 'COMPLETED' }));

    registry.override(replacement);
    expect(registry.get(TaskType.NOOP)).toBe(replacement);
  });

  it('reports what this install can run', () => {
    const registry = new TaskExecutorRegistry()
      .register(new NoopTaskExecutor())
      .register(new HttpTaskExecutor());

    expect(registry.types).toEqual([TaskType.NOOP, TaskType.HTTP]);
  });
});

describe('WAIT is completed by the clock', () => {
  const waitTask = (ref: string, input: Record<string, unknown>) => ({
    name: ref,
    taskReferenceName: ref,
    type: TaskType.WAIT,
    inputParameters: input,
  });

  /**
   * The reason WAIT is not queued.
   *
   * A queued task holds a lease, and a lease must be heartbeated or it expires
   * — so a seven-day wait would either hold an execution slot for a week or be
   * reclaimed as abandoned within the minute. Neither is a wait.
   */
  it('never reaches a queue', async () => {
    const wf = await start([waitTask('pause', { seconds: 3600 })]);

    const queued = await harness.db
      .selectFrom('TaskQueues')
      .select('taskId')
      .where('workflowId', '=', wf.id)
      .execute();

    expect(queued).toEqual([]);
  });

  // Nothing will ever pick it up, so SCHEDULED would misreport it as waiting
  // for a worker in every view an operator looks at.
  it('sits IN_PROGRESS, not SCHEDULED', async () => {
    const wf = await start([waitTask('pause', { seconds: 3600 })]);
    expect((await statusOf(wf.id, 'pause')).status).toBe(TaskStatus.IN_PROGRESS);
  });

  it('arms a wait timer', async () => {
    const wf = await start([waitTask('pause', { seconds: 3600 })]);

    const armed = await harness.db
      .selectFrom('Timers')
      .select(['kind', 'taskId'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(armed.map((t) => t.kind)).toEqual(['wait']);
    expect(armed[0].taskId).not.toBeNull();
  });

  /**
   * A WAIT is never dispatched, so `scheduleToStart` would fire while it is
   * legitimately waiting and mark it TIMED_OUT — turning the feature into a bug
   * that looks like one of the engine's own guarantees.
   */
  it('arms no dispatch deadlines', async () => {
    const wf = await start([waitTask('pause', { seconds: 3600 })]);

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

  it('completes when the timer fires, and the workflow moves on', async () => {
    const wf = await start([
      waitTask('pause', { seconds: 3600 }),
      { name: 'after', taskReferenceName: 'after', type: TaskType.SIMPLE },
    ]);

    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 minute'`.execute(harness.db);
    expect(await sweeper.sweep()).toBeGreaterThan(0);
    await drain(wf.id);

    expect((await statusOf(wf.id, 'pause')).status).toBe(TaskStatus.COMPLETED);
    expect((await taskQueue.depth('after', namespaceId)).available).toBe(1);
  });

  // A fired wait is a *success* — the task did exactly what it was asked to.
  it('completes rather than timing out', async () => {
    const wf = await start([waitTask('pause', { seconds: 3600 })]);

    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 minute'`.execute(harness.db);
    await sweeper.sweep();

    const task = await statusOf(wf.id, 'pause');
    expect(task.status).not.toBe(TaskStatus.TIMED_OUT);
    expect(task.output).toEqual({ waited: true });
  });

  it('accepts an absolute instant', async () => {
    const wf = await start([
      waitTask('pause', { until: new Date(Date.now() + 3_600_000).toISOString() }),
    ]);

    const armed = await harness.db
      .selectFrom('Timers')
      .select('fireAt')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(armed.fireAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
  });

  // A typo in a date should not produce a dead workflow; the value is visible
  // in the task input either way.
  it('treats an unparseable instant as no wait', async () => {
    const wf = await start([waitTask('pause', { until: 'not-a-date' })]);

    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 second'`.execute(harness.db);
    await sweeper.sweep();

    expect((await statusOf(wf.id, 'pause')).status).toBe(TaskStatus.COMPLETED);
  });
});

/**
 * A task that is not finished and asks to be looked at again.
 *
 * The machinery `HTTP_POLL` needs, and the one outcome that is neither success
 * nor failure. What makes it worth testing at this level rather than in
 * `tasks` is that every interesting property is about rows: the slot really is
 * given back, the progress really does survive, the attempt really is not
 * burned, and a runner whose lease expired really cannot write over the runner
 * that replaced it.
 */
describe('a task that asks to be resumed later', () => {
  const pollingTask = (ref: string) => ({
    name: ref,
    taskReferenceName: ref,
    type: TaskType.HTTP,
    inputParameters: {},
  });

  const queueRow = (workflowId: string) =>
    harness.db
      .selectFrom('TaskQueues')
      .select(['leaseToken', 'leaseExpiresAt', 'visibleAt'])
      .where('workflowId', '=', workflowId)
      .executeTakeFirstOrThrow();

  /** Drives one lease-execute-report cycle to completion. */
  const pass = async (registry: TaskExecutorRegistry) => {
    const runner = runnerFor(registry);
    await runner.runBatch();
    await runner.drain();
  };

  it('releases its execution slot rather than holding it', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'IN_PROGRESS',
      callbackAfterSeconds: 60,
    }));
    const wf = await start([pollingTask('poll')]);

    await pass(new TaskExecutorRegistry().register(executor));

    const row = await queueRow(wf.id);
    // Unleased, so nothing is holding a slot — and invisible, so nothing picks
    // it up before it is due.
    expect(row.leaseToken).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    expect(row.visibleAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it('stays IN_PROGRESS and keeps the workflow running', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'IN_PROGRESS',
      callbackAfterSeconds: 1,
    }));
    const wf = await start([pollingTask('poll')]);

    await pass(new TaskExecutorRegistry().register(executor));
    await drain(wf.id);

    expect((await statusOf(wf.id, 'poll')).status).toBe(TaskStatus.IN_PROGRESS);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  // The next pass may run in a different process, so anything the task needs to
  // remember has to be on the row.
  it('persists progress before giving up the slot', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'IN_PROGRESS',
      callbackAfterSeconds: 1,
      output: { pollCount: 3, cursor: 'abc' },
    }));
    const wf = await start([pollingTask('poll')]);

    await pass(new TaskExecutorRegistry().register(executor));

    const state = (await statusOf(wf.id, 'poll')).output as Record<string, JsonValue>;
    expect(state['pollCount']).toBe(3);
    expect(state['cursor']).toBe('abc');
  });

  it('hands that progress back as state on the next pass', async () => {
    let seen: JsonValue | undefined;
    const executor = new ScriptedExecutor(TaskType.HTTP, (context) => {
      seen = context.state['pollCount'];
      return { status: 'IN_PROGRESS', callbackAfterSeconds: 0, output: { pollCount: 7 } };
    });
    const registry = new TaskExecutorRegistry().register(executor);
    await start([pollingTask('poll')]);

    await pass(registry);
    expect(seen).toBeUndefined();

    // Zero-second callback, so it is immediately visible again.
    await pass(registry);
    expect(seen).toBe(7);
  });

  // Nothing failed, so nothing may be charged against the retry budget. Getting
  // this wrong would cap any poll at `retryCount` attempts and fail the task
  // for a reason that never appears in its history.
  it('does not consume an attempt', async () => {
    const executor = new ScriptedExecutor(TaskType.HTTP, () => ({
      status: 'IN_PROGRESS',
      callbackAfterSeconds: 0,
    }));
    const registry = new TaskExecutorRegistry().register(executor);
    const wf = await start([pollingTask('poll')]);

    await pass(registry);
    await pass(registry);
    await pass(registry);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['attempt'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.attempt).toBe(0);
    expect(executor.calls).toHaveLength(3);
  });

  it('completes normally on a later pass', async () => {
    let passes = 0;
    const executor = new ScriptedExecutor(TaskType.HTTP, (): TaskOutcome =>
      ++passes < 3
        ? { status: 'IN_PROGRESS', callbackAfterSeconds: 0, output: { passes } }
        : { status: 'COMPLETED', output: { done: true, passes } }
    );
    const registry = new TaskExecutorRegistry().register(executor);
    const wf = await start([pollingTask('poll')]);

    for (let i = 0; i < 3; i++) await pass(registry);
    await drain(wf.id);

    const task = await statusOf(wf.id, 'poll');
    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect((task.output as Record<string, JsonValue>)['done']).toBe(true);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  /**
   * The fencing case.
   *
   * A runner that stalled long enough to lose its lease must not be able to
   * defer — by then another runner owns the task, and writing state would
   * clobber progress that runner has already made.
   */
  it('refuses to defer on an expired lease', async () => {
    const wf = await start([pollingTask('poll')]);

    const [leased] = await dispatch.leaseSystemTasks({
      types: [TaskType.HTTP],
      workerId: 'runner-a',
      leaseSeconds: 30,
      limit: 1,
    });

    const stolen = await dispatch.reschedule({
      queueName: leased.queueName,
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: '00000000-0000-0000-0000-000000000000',
      delaySeconds: 10,
      output: { pollCount: 99 },
    });

    expect(stolen).toBe(false);

    // And the impostor's state was not written.
    const state = (await statusOf(wf.id, 'poll')).output as Record<string, JsonValue> | null;
    expect(state?.['pollCount']).toBeUndefined();
  });
});
