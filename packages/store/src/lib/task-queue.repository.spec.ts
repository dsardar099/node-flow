import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';

/**
 * Queue behaviour against real Postgres.
 *
 * These tests exist to break the queue, not to demonstrate it: concurrent
 * workers racing the same rows, expired leases, stale workers reporting late.
 * Every one of them passes trivially against a single-threaded caller, which is
 * exactly why they are written with contention.
 */

let harness: PostgresHarness;
let repo: TaskQueueRepository;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  repo = new TaskQueueRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

const enqueue = (queueName: string, overrides: Partial<{ priority: number; delaySeconds: number }> = {}) =>
  repo.enqueue({
    namespaceId,
    queueName,
    taskId: randomUUID(),
    workflowId: randomUUID(),
    ...overrides,
  });

describe('TaskQueueRepository — leasing', () => {
  it('leases available tasks and returns a fencing token', async () => {
    await enqueue('email');

    const leased = await repo.lease('email', 'worker-1', 30, 10, namespaceId);

    expect(leased).toHaveLength(1);
    expect(leased[0].leaseToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(leased[0].leaseExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not lease the same task twice', async () => {
    await enqueue('email');

    const first = await repo.lease('email', 'worker-1', 30, 10, namespaceId);
    const second = await repo.lease('email', 'worker-2', 30, 10, namespaceId);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('respects priority ordering', async () => {
    await enqueue('email', { priority: 1 });
    await enqueue('email', { priority: 9 });
    await enqueue('email', { priority: 5 });

    const leased = await repo.lease('email', 'worker-1', 30, 3, namespaceId);
    expect(leased.map((l) => l.priority)).toEqual([9, 5, 1]);
  });

  it('does not lease a task before its visibility time', async () => {
    await enqueue('email', { delaySeconds: 60 });
    expect(await repo.lease('email', 'worker-1', 30, 10, namespaceId)).toHaveLength(0);
  });

  it('keeps queues isolated from one another', async () => {
    await enqueue('email');
    await enqueue('sms');

    expect(await repo.lease('email', 'w', 30, 10, namespaceId)).toHaveLength(1);
    expect(await repo.lease('sms', 'w', 30, 10, namespaceId)).toHaveLength(1);
  });
});

describe('TaskQueueRepository — concurrency', () => {
  // The property the whole queue rests on: N workers pulling simultaneously
  // must partition the work, never duplicate it. A non-atomic
  // select-then-update passes every single-threaded test above and fails here.
  it('never hands the same task to two of twenty concurrent workers', async () => {
    const TASKS = 200;
    const WORKERS = 20;

    await Promise.all(Array.from({ length: TASKS }, () => enqueue('bulk')));

    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => repo.lease('bulk', `worker-${i}`, 30, 25, namespaceId))
    );

    const leasedIds = results.flat().map((r) => r.taskId);
    const unique = new Set(leasedIds);

    expect(leasedIds).toHaveLength(unique.size);
    expect(unique.size).toBeLessThanOrEqual(TASKS);
  });

  it('drains the queue exactly once across repeated concurrent rounds', async () => {
    const TASKS = 120;
    await Promise.all(Array.from({ length: TASKS }, () => enqueue('drain')));

    const seen = new Set<string>();
    for (let round = 0; round < 6; round++) {
      const batches = await Promise.all(
        Array.from({ length: 8 }, (_, i) => repo.lease('drain', `w-${i}`, 300, 10, namespaceId))
      );
      for (const task of batches.flat()) {
        expect(seen.has(task.taskId)).toBe(false);
        seen.add(task.taskId);
      }
    }

    expect(seen.size).toBe(TASKS);
  });
});

describe('TaskQueueRepository — lease expiry and fencing', () => {
  it('reclaims a lease that has expired', async () => {
    await enqueue('slow');
    await repo.lease('slow', 'crashed-worker', -1, 10, namespaceId); // already expired

    const reclaimed = await repo.reclaimExpiredLeases(10);
    expect(reclaimed).toHaveLength(1);

    // Back on the queue for someone else.
    expect(await repo.lease('slow', 'worker-2', 30, 10, namespaceId)).toHaveLength(1);
  });

  // Fencing is what makes reclaiming safe. Without it, a worker that stalled
  // past its lease could acknowledge a task another worker is now running,
  // and the result of real work would be silently discarded.
  it('rejects an acknowledgement from a worker whose lease was reclaimed', async () => {
    await enqueue('slow');
    const [stale] = await repo.lease('slow', 'stalled-worker', -1, 10, namespaceId);

    await repo.reclaimExpiredLeases(10);
    const [fresh] = await repo.lease('slow', 'new-worker', 30, 10, namespaceId);

    expect(await repo.acknowledge('slow', stale.taskId, stale.leaseToken)).toBe(false);
    expect(await repo.acknowledge('slow', fresh.taskId, fresh.leaseToken)).toBe(true);
  });

  it('rejects a lease renewal after the lease has expired', async () => {
    await enqueue('slow');
    const [leased] = await repo.lease('slow', 'worker-1', -1, 10, namespaceId);

    expect(await repo.renewLease('slow', leased.taskId, leased.leaseToken, 30)).toBe(false);
  });

  it('extends a live lease for a worker still working', async () => {
    await enqueue('slow');
    const [leased] = await repo.lease('slow', 'worker-1', 30, 10, namespaceId);

    expect(await repo.renewLease('slow', leased.taskId, leased.leaseToken, 120)).toBe(true);
  });

  it('does not reclaim leases that are still valid', async () => {
    await enqueue('slow');
    await repo.lease('slow', 'worker-1', 300, 10, namespaceId);

    expect(await repo.reclaimExpiredLeases(10)).toHaveLength(0);
  });
});

describe('TaskQueueRepository — acknowledgement and depth', () => {
  it('removes the task from the queue on acknowledgement', async () => {
    await enqueue('email');
    const [leased] = await repo.lease('email', 'worker-1', 30, 10, namespaceId);

    expect(await repo.acknowledge('email', leased.taskId, leased.leaseToken)).toBe(true);
    expect(await repo.depth('email', namespaceId)).toMatchObject({ available: 0, leased: 0 });
  });

  it('reports available and leased counts separately', async () => {
    await Promise.all([enqueue('email'), enqueue('email'), enqueue('email')]);
    await repo.lease('email', 'worker-1', 30, 1, namespaceId);

    expect(await repo.depth('email', namespaceId)).toMatchObject({ available: 2, leased: 1 });
  });

  it('ignores a duplicate enqueue of the same task', async () => {
    const taskId = randomUUID();
    const workflowId = randomUUID();
    const opts = { namespaceId, queueName: 'email', taskId, workflowId };

    await repo.enqueue(opts);
    await repo.enqueue(opts);

    expect(await repo.depth('email', namespaceId)).toMatchObject({ available: 1, leased: 0 });
  });
});

describe('TaskQueueRepository — overview', () => {
  it('splits each queue the same way depth does, and counts lease holders', async () => {
    await enqueue('email');
    await enqueue('email');
    await enqueue('email');
    await enqueue('email', { delaySeconds: 600 });
    await enqueue('charge');

    // One worker holds *two* leases and the other holds one. That asymmetry is
    // the whole point of the fixture: with a lease each, counting leases and
    // counting holders agree, and a `count(workerId)` that forgot DISTINCT
    // would pass. Here it reports 3 workers where there are 2.
    await repo.lease('email', 'worker-1', 30, 2, namespaceId);
    await repo.lease('email', 'worker-2', 30, 1, namespaceId);

    const rows = await repo.overview(namespaceId);
    const email = rows.find((row) => row.queueName === 'email');
    const charge = rows.find((row) => row.queueName === 'charge');

    expect(email).toMatchObject({
      available: 0,
      leased: 3,
      delayed: 1,
      total: 4,
      workers: 2,
    });
    expect(charge).toMatchObject({ available: 1, leased: 0, delayed: 0, total: 1, workers: 0 });

    // Sorted by name, so `charge` precedes `email` regardless of insert order.
    expect(rows.map((row) => row.queueName)).toEqual(['charge', 'email']);
  });

  it('reports the oldest runnable task, ignoring leased and delayed ones', async () => {
    // The trap this is built to catch: the oldest row in the table is one a
    // worker is already running. An unfiltered `min("visibleAt")` picks it and
    // reports an hour of starvation on a queue that is being served — the
    // number an operator would page someone over.
    await enqueue('email', { delaySeconds: -3600 });
    await repo.lease('email', 'worker-1', 30, 1, namespaceId);

    await enqueue('email', { delaySeconds: -60 });
    await enqueue('email', { delaySeconds: 3600 });

    const [email] = await repo.overview(namespaceId);
    expect(email.oldestAvailableAt).toBeInstanceOf(Date);

    const waitingSeconds = (Date.now() - email.oldestAvailableAt!.getTime()) / 1000;
    expect(waitingSeconds).toBeGreaterThan(30);
    expect(waitingSeconds).toBeLessThan(600);
  });

  it('omits a queue that has fully drained rather than reporting zeros', async () => {
    await enqueue('email');
    const [leased] = await repo.lease('email', 'worker-1', 30, 1, namespaceId);
    await repo.acknowledge('email', leased.taskId, leased.leaseToken);

    expect(await repo.overview(namespaceId)).toEqual([]);
  });

  it('does not count another namespace’s queues', async () => {
    const other = await seedNamespace(harness.db, 'other');
    await repo.enqueue({
      namespaceId: other,
      queueName: 'email',
      taskId: randomUUID(),
      workflowId: randomUUID(),
    });
    await enqueue('email');

    const [email] = await repo.overview(namespaceId);
    expect(email.total).toBe(1);
  });
});
