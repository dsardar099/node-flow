import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import type { DbTransaction } from './database.js';

/**
 * The evaluation queue, and specifically the lost-wakeup rule.
 *
 * This is the highest-stakes correctness property in the engine. Get the
 * ordering wrong and workflows hang forever with no error anywhere — the single
 * worst failure mode an orchestrator can have, because it is silent.
 */

let harness: PostgresHarness;
let repo: DecideQueueRepository;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  repo = new DecideQueueRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

describe('DecideQueueRepository — deduplication', () => {
  it('collapses repeated requests for one workflow into a single entry', async () => {
    const workflowId = randomUUID();

    await repo.enqueue(namespaceId, workflowId, 'task-a done');
    await repo.enqueue(namespaceId, workflowId, 'task-b done');
    await repo.enqueue(namespaceId, workflowId, 'task-c done');

    expect(await repo.depth()).toBe(1);
  });

  it('keeps separate entries for separate workflows', async () => {
    await repo.enqueue(namespaceId, randomUUID(), 'x');
    await repo.enqueue(namespaceId, randomUUID(), 'y');

    expect(await repo.depth()).toBe(2);
  });

  it('grants the claim to exactly one caller', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'ready');

    const first = await harness.db.transaction().execute((tx: DbTransaction) =>
      repo.claimForEvaluation(workflowId, tx)
    );
    const second = await harness.db.transaction().execute((tx: DbTransaction) =>
      repo.claimForEvaluation(workflowId, tx)
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe('DecideQueueRepository — the lost-wakeup rule', () => {
  /**
   * The failure this prevents:
   *
   *   Task A completes and enqueues. A decider begins evaluating. Task C (a
   *   parallel branch) completes and tries to enqueue — but if the claim row is
   *   still present, `ON CONFLICT DO NOTHING` swallows it. The decider finishes
   *   having never seen C, and no further wakeup ever comes.
   *
   * Claiming *before* reading state is what makes C's enqueue succeed.
   */
  it('accepts a new request that arrives after the claim', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'task-a done');

    await harness.db.transaction().execute(async (tx: DbTransaction) => {
      // Step 1: claim, before any state is read.
      expect(await repo.claimForEvaluation(workflowId, tx)).toBe(true);
    });

    // Step 2: a parallel branch finishes mid-evaluation.
    await repo.enqueue(namespaceId, workflowId, 'task-c done');

    // It must be queued, not swallowed — this is the wakeup that would be lost.
    expect(await repo.depth()).toBe(1);
  });

  /**
   * The inverse, demonstrating what goes wrong with the opposite ordering.
   *
   * While a claim is still held (uncommitted), a concurrent enqueue must not
   * quietly disappear. Postgres blocks the inserter on the unique index until
   * the deleting transaction commits, after which the insert succeeds — so the
   * wakeup survives rather than being absorbed.
   */
  it('does not swallow a concurrent request issued while a claim is uncommitted', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'initial');

    let releaseClaim: () => void = () => undefined;
    const claimHeld = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });

    const claimTx = harness.db.transaction().execute(async (tx: DbTransaction) => {
      await repo.claimForEvaluation(workflowId, tx);
      await claimHeld; // hold the transaction open
    });

    // Give the claim time to take its row lock, then race an enqueue against it.
    await new Promise((r) => setTimeout(r, 100));
    const concurrentEnqueue = repo.enqueue(namespaceId, workflowId, 'arrived mid-evaluation');

    releaseClaim();
    await claimTx;
    await concurrentEnqueue;

    // The evaluation that follows will see the work that arrived late.
    expect(await repo.depth()).toBe(1);
  });

  /**
   * Crash safety. Claiming inside the evaluation transaction means a rollback
   * restores the row, so a decider dying mid-pass loses no wakeup.
   */
  it('restores the claim when the evaluation transaction rolls back', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'ready');

    await expect(
      harness.db.transaction().execute(async (tx: DbTransaction) => {
        await repo.claimForEvaluation(workflowId, tx);
        throw new Error('decider crashed mid-evaluation');
      })
    ).rejects.toThrow('decider crashed');

    // Still queued: another decider will pick it up.
    expect(await repo.depth()).toBe(1);
  });
});

describe('DecideQueueRepository — concurrent deciders', () => {
  // Many deciders, one workflow: exactly one may win, or the same workflow gets
  // evaluated twice in parallel and the row lock is the only thing left
  // preventing corruption.
  it('lets only one of ten concurrent deciders claim a workflow', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'ready');

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        harness.db
          .transaction()
          .setIsolationLevel('read committed')
          .execute((tx: DbTransaction) => repo.claimForEvaluation(workflowId, tx))
      )
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  // peekBatch is advisory: concurrent deciders may see the same workflows,
  // because its row locks die with the statement. What must hold is that the
  // *claim* is exclusive — overlap costs a wasted round trip, never a double
  // evaluation.
  it('claims each workflow exactly once even when peeks overlap', async () => {
    const ids = Array.from({ length: 30 }, () => randomUUID());
    await Promise.all(ids.map((id) => repo.enqueue(namespaceId, id, 'ready')));

    // Five deciders deliberately peeking the same head of the queue.
    const batches = await Promise.all(Array.from({ length: 5 }, () => repo.peekBatch(30)));
    const peeked = batches.flat().map((b) => b.workflowId);
    expect(peeked.length).toBeGreaterThan(new Set(peeked).size); // overlap is expected

    const claims = await Promise.all(
      batches.flat().map((b) =>
        harness.db.transaction().execute((tx: DbTransaction) => repo.claimForEvaluation(b.workflowId, tx))
      )
    );

    // Every workflow claimed once and only once, despite the overlapping peeks.
    expect(claims.filter(Boolean)).toHaveLength(ids.length);
    expect(await repo.depth()).toBe(0);
  });

  it('spreads deciders across the queue when given an offset', async () => {
    const ids = Array.from({ length: 20 }, () => randomUUID());
    for (const id of ids) await repo.enqueue(namespaceId, id, 'ready');

    const first = await repo.peekBatch(10, 0);
    const second = await repo.peekBatch(10, 10);

    const overlap = first.filter((f) => second.some((s) => s.workflowId === f.workflowId));
    expect(overlap).toHaveLength(0);
  });
});

/**
 * The interlock between a completion and a claim.
 *
 * The claim-before-read rule assumes that a completion intending to wake the
 * decider is *visible* to the decider's claim — either because its row is
 * still there, or because the claim has to wait for it. A dedupe insert that
 * quietly does nothing breaks that assumption without changing any behaviour
 * anyone would notice in a test that runs one thing at a time.
 *
 * The symptom in production is a workflow with every branch complete and the
 * join never scheduled, and nothing in any log.
 */
describe('DecideQueueRepository — the claim waits for an in-flight completion', () => {
  it('blocks a claim while another transaction is enqueueing the same workflow', async () => {
    const workflowId = randomUUID();
    // Already queued, so the completing transaction's insert is a conflict —
    // which is the case that used to take no lock at all.
    await repo.enqueue(namespaceId, workflowId, 'an earlier branch');

    let completionReturnedAt = 0;
    let claimedAt = 0;

    // A completion that has enqueued but not yet committed.
    const completion = harness.db
      .transaction()
      .execute(async (tx: DbTransaction) => {
        await repo.enqueue(namespaceId, workflowId, 'the last branch', tx);
        await new Promise((resolve) => setTimeout(resolve, 300));
      })
      .then(() => {
        completionReturnedAt = Date.now();
      });

    // Give the completion time to take its lock before the claim is attempted.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const startedAt = Date.now();

    const claim = harness.db.transaction().execute(async (tx: DbTransaction) => {
      const claimed = await repo.claimForEvaluation(workflowId, tx);
      claimedAt = Date.now();
      return claimed;
    });

    const [, claimed] = await Promise.all([completion, claim]);

    // The claim succeeded — but only *after* the completion committed. That
    // ordering is the entire property: without the lock the claim returns at
    // once, reads a frontier missing that branch, and leaves no row behind to
    // wake anyone again.
    expect(claimed).toBe(true);
    // 250ms of the completion's 300ms sleep still to run when the claim was
    // attempted, so anything prompt is the bug.
    expect(claimedAt - startedAt).toBeGreaterThan(200);
    expect(claimedAt).toBeGreaterThanOrEqual(completionReturnedAt - 50);
  });

  it('still collapses repeated requests into one row', async () => {
    const workflowId = randomUUID();
    await repo.enqueue(namespaceId, workflowId, 'first');
    await repo.enqueue(namespaceId, workflowId, 'second');

    expect(await repo.depth()).toBe(1);
  });
});
