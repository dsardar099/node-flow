import {
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyRepository } from './concurrency.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { runnersForRoles } from './engine-runners.js';
import { OutboxRelay } from './outbox-relay.js';
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
import type { RunnerHost } from './background-runner.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The runners against a real database.
 *
 * The unit tests prove the loop mechanics; these prove the wiring. Nothing here
 * calls `evaluate` or `sweep` directly — if a workflow reaches a terminal state
 * it is because the loops drove it there, which is the only claim worth making
 * about this layer.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let concurrency: ConcurrencyRepository;
let dispatch: TaskDispatchService;
let timeoutSweeper: TimeoutSweeper;
let outboxRelay: OutboxRelay;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;
let host: RunnerHost | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await sleep(20);
  }
}

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
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue, timers);
  timeoutSweeper = new TimeoutSweeper(harness.db, timers, workflows, decideQueue);
  outboxRelay = new OutboxRelay(harness.db, outbox);
  // An event with no subscriber is retried and eventually dead-lettered rather
  // than silently marked delivered, so the relay tests need a real subscriber.
  outboxRelay.on('workflow.completed', async () => undefined);
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
});

afterEach(async () => {
  await host?.stop();
  host = undefined;
});

function startHost(roles: Parameters<typeof runnersForRoles>[0]) {
  host = runnersForRoles(
    roles,
    {
      evaluator,
      decideQueue,
      timeoutSweeper,
      outboxRelay,
      dispatch,
      concurrency,
      partitions: new PartitionManager(harness.db),
      stuckWorkflows: new StuckWorkflowSweeper(harness.db, decideQueue),
    },
    { decide: 20, timeouts: 20, outbox: 20, abandonedLeases: 20 }
  );
  host.start();
  return host;
}

/** A worker: leases whatever is on the queue and completes it. */
async function work(queueName: string, workflowId: string): Promise<boolean> {
  const [leased] = await dispatch.lease({ namespaceId, queueName, workerId: 'w' });
  if (!leased) return false;

  await dispatch.report({
    namespaceId,
    queueName,
    workflowId,
    taskId: leased.taskId,
    leaseToken: leased.leaseToken,
    status: TaskStatus.COMPLETED,
  });
  return true;
}

describe('the decider loop', () => {
  it('drives a workflow to completion with no manual evaluation', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b')] });
    startHost(['decider']);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');

    for (const queue of ['a', 'b']) {
      await until(async () => work(queue, wf.id));
    }

    await until(async () => (await workflows.findById(wf.id))?.status === WorkflowStatus.COMPLETED);
  });

  it('drains the decide queue it was given', async () => {
    blueprints.register({ tasks: [simple('a')] });
    startHost(['decider']);

    const started = await Promise.all(
      Array.from({ length: 10 }, () =>
        workflows.start({ namespaceId, defName: 'wf', defVersion: 1 })
      )
    );
    for (const wf of started) await decideQueue.enqueue(namespaceId, wf.id, 'start');

    await until(async () => (await decideQueue.depth()) === 0);
    expect(await taskQueue.depth('a', namespaceId)).toMatchObject({ total: 10 });
  });
});

describe('the poller loop', () => {
  it('fires a task deadline without anyone sweeping by hand', async () => {
    blueprints.register({
      tasks: [{ ...simple('a'), type: TaskType.SIMPLE }],
      timeoutSeconds: 1,
    });
    startHost(['decider', 'poller']);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');

    // Wait for the deadline to be armed, then bring it forward rather than
    // waiting out a real timeout — the loop, not the clock, is under test.
    await until(async () => (await timers.pendingCount()) > 0);
    await sql`UPDATE "Timers" SET "fireAt" = now() - interval '1 minute'`.execute(harness.db);

    await until(async () => (await workflows.findById(wf.id))?.status === WorkflowStatus.TIMED_OUT);
  });

  it('publishes outbox events', async () => {
    startHost(['poller']);
    await outbox.publish(namespaceId, 'workflow.completed', { workflowId: 'x' }, harness.db);

    await until(async () => (await outbox.pendingCount()) === 0);
  });

  it('reclaims a lease its worker abandoned', async () => {
    blueprints.register({ tasks: [simple('a')] });
    startHost(['decider', 'poller']);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await until(async () => (await taskQueue.depth('a', namespaceId)).available > 0);

    const [leased] = await dispatch.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'crashed',
      leaseSeconds: 1,
    });
    expect(leased).toBeDefined();

    await sql`UPDATE "TaskQueues" SET "leaseExpiresAt" = now() - interval '1 minute'`.execute(
      harness.db
    );

    // Back on the ready queue, available to another worker.
    await until(async () => (await taskQueue.depth('a', namespaceId)).available === 1);
  });
});

describe('role isolation', () => {
  it('does not evaluate anything when only the poller runs', async () => {
    blueprints.register({ tasks: [simple('a')] });
    startHost(['poller']);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await sleep(300);

    // The request is still queued: no decider is running to claim it.
    expect(await decideQueue.depth()).toBe(1);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.RUNNING);
  });

  it('starts nothing at all for the api role', async () => {
    const apiOnly = startHost(['api']);
    expect(apiOnly.stats()).toHaveLength(0);
  });
});

describe('shutdown', () => {
  it('leaves no work half-done', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b')] });
    const running = startHost(['decider', 'poller']);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await until(async () => (await taskQueue.depth('a', namespaceId)).available > 0);

    await running.stop();
    host = undefined;

    // Whatever state the shutdown caught, it is a consistent one: the task row
    // and its queue entry agree, because both were written in one transaction.
    const tasks = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ refName: 'a', status: TaskStatus.SCHEDULED });
    expect((await taskQueue.depth('a', namespaceId)).total).toBe(1);
  });

  it('is safe to stop twice', async () => {
    const running = startHost(['decider', 'poller']);
    await running.stop();
    await expect(running.stop()).resolves.toBeUndefined();
    host = undefined;
  });
});
