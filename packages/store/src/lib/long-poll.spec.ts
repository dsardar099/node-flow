import { TaskStatus, TaskType, workflowDefinitionSchema } from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader } from './evaluator.js';
import { LongPollService } from './long-poll.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { QueueNotifier, queueKey } from './queue-notifier.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Long-poll delivery.
 *
 * The property that matters is latency without lost work: a parked worker must
 * wake the instant a task is enqueued, and must still get its work when the
 * notification never arrives at all. The second half is why every wait has a
 * timeout, and it is tested by running with the notifier switched off.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let dispatch: TaskDispatchService;
let notifier: QueueNotifier;
let longPoll: LongPollService;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[]): void {
    this.map.set(
      'wf:1',
      compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }))
    );
  }
  async load(): Promise<Blueprint> {
    const bp = this.map.get('wf:1');
    if (!bp) throw new Error('no blueprint');
    return bp;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints
  );

  notifier = new QueueNotifier({ url: harness.url });
  await notifier.start();
  longPoll = new LongPollService(dispatch, notifier);
}, 240_000);

afterAll(async () => {
  await notifier?.stop();
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

async function enqueueOne(queueName = 'a') {
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  const task = await harness.db.transaction().execute((tx) =>
    workflows.insertTask(
      {
        workflowId: wf.id,
        namespaceId,
        refName: queueName,
        taskDefName: queueName,
        taskType: TaskType.SIMPLE,
        status: TaskStatus.SCHEDULED,
        attempt: 0,
        iteration: 0,
        input: {},
      },
      tx
    )
  );

  await taskQueue.enqueue({
    namespaceId,
    queueName,
    taskId: task!.id,
    workflowId: wf.id,
  });

  return task!.id;
}

describe('the notifier', () => {
  it('connects and listens', () => {
    expect(notifier.connected).toBe(true);
  });

  it('delivers an enqueue to a waiter', async () => {
    const waiting = notifier.waitFor(namespaceId, 'a', 5_000).notified;
    await sleep(50);
    await enqueueOne('a');

    expect(await waiting).toBe(true);
  });

  it('does not wake a waiter on a different queue', async () => {
    const waiting = notifier.waitFor(namespaceId, 'other', 300).notified;
    await enqueueOne('a');

    expect(await waiting).toBe(false);
  });

  // Queue names come from user-chosen task names, so two tenants routinely both
  // have a `charge` queue. A notification must not cross between them.
  it('does not wake a waiter in a different namespace', async () => {
    const otherNamespace = await seedNamespace(harness.db, 'other');
    const waiting = notifier.waitFor(otherNamespace, 'a', 300).notified;
    await enqueueOne('a');

    expect(await waiting).toBe(false);
  });

  it('times out when nothing arrives', async () => {
    expect(await notifier.waitFor(namespaceId, 'a', 150).notified).toBe(false);
  });

  it('unsubscribes when a wait ends', async () => {
    await notifier.waitFor(namespaceId, 'a', 50).notified;
    expect(notifier.waiting(namespaceId, 'a')).toBe(0);
  });

  // Abandoning a wait instead of cancelling it leaves its listener and timer
  // registered for the full duration — one dead closure per lease on a busy
  // queue, and a `waiting()` metric that reads as a stall.
  it('releases a cancelled wait at once', () => {
    const waiter = notifier.waitFor(namespaceId, 'a', 60_000);
    expect(notifier.waiting(namespaceId, 'a')).toBe(1);

    waiter.cancel();
    expect(notifier.waiting(namespaceId, 'a')).toBe(0);
  });

  it('leaves nothing parked after a lease that found work immediately', async () => {
    await enqueueOne('a');
    await longPoll.lease({ namespaceId, queueName: 'a', workerId: 'w1', waitMs: 60_000 });

    expect(notifier.waiting(namespaceId, 'a')).toBe(0);
  });

  // A delayed task is not yet visible, so waking a worker for it would return
  // an empty lease and burn a round trip.
  it('stays silent for a delayed task', async () => {
    const waiting = notifier.waitFor(namespaceId, 'a', 300).notified;

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await taskQueue.enqueue({
      namespaceId,
      queueName: 'a',
      taskId: '00000000-0000-7000-8000-00000000dead',
      workflowId: wf.id,
      delaySeconds: 60,
    });

    expect(await waiting).toBe(false);
  });

  it('builds a namespace-scoped key', () => {
    expect(queueKey('ns-1', 'charge')).toBe('ns-1:charge');
  });
});

describe('long-poll lease', () => {
  it('returns immediately when work is already queued', async () => {
    await enqueueOne('a');

    const started = Date.now();
    const result = await longPoll.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 5_000,
    });

    expect(result.tasks).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  // The point of the whole mechanism: a task enqueued while a worker is parked
  // starts in milliseconds rather than at the next poll.
  it('wakes a parked worker as soon as a task arrives', async () => {
    const leasing = longPoll.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 10_000,
    });

    await sleep(100);
    await enqueueOne('a');

    const result = await leasing;
    expect(result.tasks).toHaveLength(1);
    expect(result.wokenByNotification).toBe(true);
    expect(result.waitedMs).toBeLessThan(3_000);
  });

  it('returns empty after the timeout when no work appears', async () => {
    const started = Date.now();
    const result = await longPoll.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 250,
    });

    expect(result.tasks).toEqual([]);
    expect(result.wokenByNotification).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  // Notify is an optimisation; the timeout is the correctness guarantee. With
  // no notifier at all, a poll must still find work that was there all along.
  it('still returns work with no notifier configured', async () => {
    const withoutNotifier = new LongPollService(dispatch);
    await enqueueOne('a');

    const result = await withoutNotifier.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 5_000,
    });

    expect(result.tasks).toHaveLength(1);
  });

  it('does not wait at all when asked for no wait', async () => {
    const started = Date.now();
    const result = await longPoll.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 0,
    });

    expect(result.tasks).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
  });

  // Two parked workers, one task: exactly one gets it. The other must not
  // receive a duplicate just because both were woken by the same notification.
  it('gives one task to exactly one of several parked workers', async () => {
    const workers = [1, 2, 3].map((n) =>
      longPoll.lease({
        namespaceId,
        queueName: 'a',
        workerId: `w${n}`,
        waitMs: 3_000,
      })
    );

    await sleep(100);
    await enqueueOne('a');

    const results = await Promise.all(workers);
    const leased = results.flatMap((r) => r.tasks);

    expect(leased).toHaveLength(1);
  });

  it('leaves no listener behind after a poll', async () => {
    await longPoll.lease({ namespaceId, queueName: 'a', workerId: 'w1', waitMs: 100 });
    expect(notifier.waiting(namespaceId, 'a')).toBe(0);
  });

  it('does not leak listeners across many polls', async () => {
    for (let i = 0; i < 20; i++) {
      await longPoll.lease({ namespaceId, queueName: 'a', workerId: 'w1', waitMs: 20 });
    }
    expect(notifier.waiting(namespaceId, 'a')).toBe(0);
  });
});

describe('the subscribe-before-check ordering', () => {
  /**
   * The window this closes is narrow and entirely invisible to the tests above,
   * because they all enqueue long after the poll has started.
   *
   * The bug: read the queue, find nothing, *then* subscribe. A task enqueued
   * between those two steps notifies nobody, so the worker parks for its full
   * timeout while its work sits ready. Nothing is lost — it is late — but at a
   * 30-second poll that is a 30-second stall on an idle queue.
   *
   * Reproduced deterministically by making the first lease attempt slow and
   * enqueuing while it is in flight. With the subscription registered first the
   * notification is caught and the poll returns at once; registered second, it
   * is missed and the poll runs to timeout.
   */
  it('catches a task enqueued while the first lease attempt is in flight', async () => {
    let attempts = 0;

    const slowDispatch = {
      lease: async () => {
        attempts++;
        if (attempts === 1) {
          // Enqueue *during* the first attempt — exactly the window at issue.
          await enqueueOne('slowq');
          await sleep(150);
          return [];
        }
        return taskQueue.lease('slowq', 'w1', 60, 1, namespaceId);
      },
    } as unknown as TaskDispatchService;

    const service = new LongPollService(slowDispatch, notifier);

    const started = Date.now();
    const result = await service.lease({
      namespaceId,
      queueName: 'slowq',
      workerId: 'w1',
      // Generous, so a missed notification is unmistakable in the timing.
      waitMs: 5_000,
    });
    const elapsed = Date.now() - started;

    expect(result.tasks).toHaveLength(1);
    expect(result.wokenByNotification).toBe(true);
    // Would be ~5s if the subscription were registered after the read.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('the decider driving a parked worker', () => {
  // End to end: nothing polls, and the worker still wakes the moment the
  // decider schedules its task.
  it('wakes a worker when an evaluation schedules a task', async () => {
    blueprints.register([
      { name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE },
    ]);

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');

    const leasing = longPoll.lease({
      namespaceId,
      queueName: 'a',
      workerId: 'w1',
      waitMs: 10_000,
    });

    await sleep(100);
    await evaluator.evaluate(wf.id);

    const result = await leasing;
    expect(result.tasks).toHaveLength(1);
    expect(result.wokenByNotification).toBe(true);
  });
});
