import { TaskStatus, TaskType, workflowDefinitionSchema } from '@node-flow-dev/core';
import { compileBlueprint } from '@node-flow-dev/engine';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyRepository,
  type DispatchPolicy,
} from './concurrency.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
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
 * Admission control.
 *
 * Every one of these limits is enforced at dispatch rather than in the worker
 * SDK, so the tests drive them the way the system does — by asking for more
 * work than the policy allows and checking what comes back.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let timers: TimerRepository;
let concurrency: ConcurrencyRepository;
let dispatch: TaskDispatchService;
let namespaceId: string;
let workflowId: string;

const policy = (overrides: Partial<DispatchPolicy> = {}): DispatchPolicy => ({
  concurrentExecLimit: 0,
  rateLimitPerFrequency: 0,
  rateLimitFrequencySeconds: 60,
  semaphores: [],
  ...overrides,
});

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  timers = new TimerRepository(harness.db);
  concurrency = new ConcurrencyRepository(harness.db);
  dispatch = new TaskDispatchService(
    harness.db,
    workflows,
    taskQueue,
    decideQueue,
    timers,
    concurrency
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  workflowId = wf.id;
});

/** Queues `n` real tasks so dispatch has something to lease. */
async function enqueue(queueName: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const task = await harness.db.transaction().execute((tx) =>
      workflows.insertTask(
        {
          workflowId,
          namespaceId,
          refName: `${queueName}-${randomUUID()}`,
          taskDefName: queueName,
          taskType: TaskType.SIMPLE,
          status: TaskStatus.SCHEDULED,
          attempt: 0,
          iteration: i,
          input: {},
        },
        tx
      )
    );
    await taskQueue.enqueue({
      namespaceId,
      queueName,
      taskId: task!.id,
      workflowId,
    });
  }
}

describe('concurrentExecLimit', () => {
  it('never hands out more than the cap allows', async () => {
    await enqueue('charge', 10);

    const leased = await dispatch.lease({
      namespaceId,
      queueName: 'charge',
      workerId: 'w',
      limit: 10,
      policy: policy({ concurrentExecLimit: 3 }),
    });

    expect(leased).toHaveLength(3);
  });

  it('counts work already in flight against the cap', async () => {
    await enqueue('charge', 10);
    const p = policy({ concurrentExecLimit: 3 });

    await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w1', limit: 2, policy: p });
    const second = await dispatch.lease({
      namespaceId,
      queueName: 'charge',
      workerId: 'w2',
      limit: 5,
      policy: p,
    });

    expect(second).toHaveLength(1);
  });

  it('frees capacity as tasks complete', async () => {
    await enqueue('charge', 5);
    const p = policy({ concurrentExecLimit: 2 });

    const first = await dispatch.lease({
      namespaceId,
      queueName: 'charge',
      workerId: 'w',
      limit: 2,
      policy: p,
    });
    expect(
      await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w2', limit: 2, policy: p })
    ).toHaveLength(0);

    await dispatch.report({
      namespaceId,
      queueName: 'charge',
      workflowId,
      taskId: first[0].taskId,
      leaseToken: first[0].leaseToken,
      status: TaskStatus.COMPLETED,
    });

    expect(
      await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w3', limit: 2, policy: p })
    ).toHaveLength(1);
  });

  // The property that matters: many workers asking at once must not collectively
  // exceed the cap. A non-atomic check passes every sequential test above.
  it('holds the cap under ten concurrent workers', async () => {
    await enqueue('charge', 50);
    const p = policy({ concurrentExecLimit: 5 });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        dispatch.lease({
          namespaceId,
          queueName: 'charge',
          workerId: `w${i}`,
          limit: 5,
          policy: p,
        })
      )
    );

    expect(results.flat().length).toBeLessThanOrEqual(5);
  });
});

describe('rate limits', () => {
  it('admits at most the window allowance', async () => {
    await enqueue('sms', 20);

    const leased = await dispatch.lease({
      namespaceId,
      queueName: 'sms',
      workerId: 'w',
      limit: 20,
      policy: policy({ rateLimitPerFrequency: 4, rateLimitFrequencySeconds: 3600 }),
    });

    expect(leased).toHaveLength(4);
  });

  // A rate limit bounds *throughput*, not parallelism: completing work does not
  // buy back tokens the way it frees a concurrency slot.
  it('does not refill when tasks complete within the window', async () => {
    await enqueue('sms', 20);
    const p = policy({ rateLimitPerFrequency: 2, rateLimitFrequencySeconds: 3600 });

    const first = await dispatch.lease({
      namespaceId,
      queueName: 'sms',
      workerId: 'w',
      limit: 2,
      policy: p,
    });
    for (const task of first) {
      await dispatch.report({
        namespaceId,
        queueName: 'sms',
        workflowId,
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        status: TaskStatus.COMPLETED,
      });
    }

    expect(
      await dispatch.lease({ namespaceId, queueName: 'sms', workerId: 'w2', limit: 2, policy: p })
    ).toHaveLength(0);
  });

  it('keeps separate budgets per queue', async () => {
    await enqueue('sms', 5);
    await enqueue('email', 5);
    const p = policy({ rateLimitPerFrequency: 2, rateLimitFrequencySeconds: 3600 });

    expect(
      await dispatch.lease({ namespaceId, queueName: 'sms', workerId: 'w', limit: 5, policy: p })
    ).toHaveLength(2);
    expect(
      await dispatch.lease({ namespaceId, queueName: 'email', workerId: 'w', limit: 5, policy: p })
    ).toHaveLength(2);
  });

  it('does not exceed the allowance under concurrent dispatchers', async () => {
    await enqueue('sms', 50);
    const p = policy({ rateLimitPerFrequency: 6, rateLimitFrequencySeconds: 3600 });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        dispatch.lease({ namespaceId, queueName: 'sms', workerId: `w${i}`, limit: 6, policy: p })
      )
    );

    expect(results.flat().length).toBeLessThanOrEqual(6);
  });
});

describe('named semaphores', () => {
  // The case a per-task-definition cap cannot express: unrelated tasks sharing
  // one ceiling on a fragile dependency.
  it('caps unrelated queues sharing one permit pool', async () => {
    await concurrency.configureSemaphore(namespaceId, 'legacy-api', 2);
    await enqueue('reportA', 5);
    await enqueue('reportB', 5);
    const p = policy({ semaphores: ['legacy-api'] });

    const a = await dispatch.lease({
      namespaceId,
      queueName: 'reportA',
      workerId: 'w',
      limit: 5,
      policy: p,
    });
    const b = await dispatch.lease({
      namespaceId,
      queueName: 'reportB',
      workerId: 'w',
      limit: 5,
      policy: p,
    });

    expect(a.length + b.length).toBe(2);
  });

  it('returns the permit when the task finishes', async () => {
    await concurrency.configureSemaphore(namespaceId, 'legacy-api', 1);
    await enqueue('reportA', 3);
    const p = policy({ semaphores: ['legacy-api'] });

    const [held] = await dispatch.lease({
      namespaceId,
      queueName: 'reportA',
      workerId: 'w',
      limit: 3,
      policy: p,
    });
    expect(
      await dispatch.lease({ namespaceId, queueName: 'reportA', workerId: 'w2', limit: 1, policy: p })
    ).toHaveLength(0);

    await dispatch.report({
      namespaceId,
      queueName: 'reportA',
      workflowId,
      taskId: held.taskId,
      leaseToken: held.leaseToken,
      status: TaskStatus.COMPLETED,
    });

    expect(
      await dispatch.lease({ namespaceId, queueName: 'reportA', workerId: 'w3', limit: 1, policy: p })
    ).toHaveLength(1);
  });

  // Without this a crashed worker drains one permit per crash until the
  // semaphore is permanently empty and nothing can run.
  it('reclaims a permit leaked by a crashed holder', async () => {
    await concurrency.configureSemaphore(namespaceId, 'legacy-api', 1);
    await enqueue('reportA', 3);
    const p = policy({ semaphores: ['legacy-api'] });

    await dispatch.lease({
      namespaceId,
      queueName: 'reportA',
      workerId: 'doomed',
      limit: 1,
      leaseSeconds: -1,
      policy: p,
    });

    expect(await concurrency.expireStaleHolders()).toBe(1);
    await dispatch.reclaimAbandoned();

    expect(
      await dispatch.lease({ namespaceId, queueName: 'reportA', workerId: 'fresh', limit: 1, policy: p })
    ).toHaveLength(1);
  });

  it('puts a task straight back when its permit is unavailable', async () => {
    await concurrency.configureSemaphore(namespaceId, 'legacy-api', 1);
    await enqueue('reportA', 2);
    const p = policy({ semaphores: ['legacy-api'] });

    await dispatch.lease({ namespaceId, queueName: 'reportA', workerId: 'w', limit: 1, policy: p });
    await dispatch.lease({ namespaceId, queueName: 'reportA', workerId: 'w2', limit: 1, policy: p });

    // The refused task must be immediately available again, not held for the
    // full lease duration.
    const depth = await taskQueue.depth('reportA', namespaceId);
    expect(depth.available).toBe(1);
  });

  it('does not gate on an unconfigured semaphore', async () => {
    await enqueue('reportA', 3);

    const leased = await dispatch.lease({
      namespaceId,
      queueName: 'reportA',
      workerId: 'w',
      limit: 3,
      policy: policy({ semaphores: ['never-configured'] }),
    });

    expect(leased).toHaveLength(3);
  });
});

describe('workflow-level caps', () => {
  it('bounds fan-out within one execution', () => {
    const blueprint = compileBlueprint(
      workflowDefinitionSchema.parse({
        name: 'wide',
        version: 1,
        maxConcurrentTasks: 2,
        tasks: [
          {
            name: 'fork',
            taskReferenceName: 'fork',
            type: TaskType.FORK_JOIN,
            forkTasks: [
              [{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }],
              [{ name: 'b', taskReferenceName: 'b', type: TaskType.SIMPLE }],
              [{ name: 'c', taskReferenceName: 'c', type: TaskType.SIMPLE }],
              [{ name: 'd', taskReferenceName: 'd', type: TaskType.SIMPLE }],
            ],
          },
          { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['a', 'b', 'c', 'd'] },
        ],
      })
    );

    expect(blueprint.maxConcurrentTasks).toBe(2);
  });

  it('reports live executions for the start-time cap', async () => {
    await workflows.start({ namespaceId, defName: 'nightly', defVersion: 1 });
    await workflows.start({ namespaceId, defName: 'nightly', defVersion: 1 });
    await workflows.start({ namespaceId, defName: 'other', defVersion: 1 });

    expect(await concurrency.countRunningExecutions(namespaceId, 'nightly')).toBe(2);
    expect(await concurrency.countRunningExecutions(namespaceId, 'other')).toBe(1);
  });

  it('counts executions per namespace', async () => {
    const other = await seedNamespace(harness.db, 'other-tenant');
    await workflows.start({ namespaceId, defName: 'nightly', defVersion: 1 });
    await workflows.start({ namespaceId: other, defName: 'nightly', defVersion: 1 });

    expect(await concurrency.countRunningExecutions(namespaceId, 'nightly')).toBe(1);
    expect(await concurrency.countRunningExecutions(other, 'nightly')).toBe(1);
  });
});

describe('housekeeping', () => {
  it('prunes rate-limit windows that can no longer be consulted', async () => {
    await harness.db
      .insertInto('RateLimitBuckets')
      .values({
        namespaceId,
        queueName: 'old',
        windowStart: new Date(Date.now() - 86_400_000),
        count: 5,
      })
      .execute();

    expect(await concurrency.pruneRateLimitWindows(3600)).toBe(1);
  });
});
