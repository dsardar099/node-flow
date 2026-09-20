import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';

/** The channel a decider listens on to be woken the moment an evaluation is queued. */
export const DECIDE_CHANNEL = 'node_flow_decide';

/**
 * The evaluation queue.
 *
 * One row per workflow awaiting a decider pass; the primary key on `workflowId`
 * *is* the dedupe, so a burst of task completions collapses into a single
 * pending evaluation.
 *
 * This file is where the lost-wakeup rule from PLAN.md is enforced. Read
 * `claimForEvaluation` before changing anything here.
 */
export class DecideQueueRepository {
  constructor(private readonly db: Db) {}

  /**
   * Requests an evaluation. Idempotent — a workflow already queued stays queued.
   *
   * Must be called *after* the state change that justifies it commits, or in the
   * same transaction as it. Enqueueing before the change is visible is how a
   * decider reads stale state and concludes there is nothing to do.
   */
  async enqueue(
    namespaceId: string,
    workflowId: string,
    reason: string,
    tx?: Queryable,
  ): Promise<void> {
    await (tx ?? this.db)
      .insertInto('DecideQueues')
      .values({ workflowId, namespaceId, reason })
      // `DO UPDATE`, not `DO NOTHING`, and the difference is a workflow that
      // hangs forever.
      //
      // The row is still a pure dedupe — writing `reason` changes nothing an
      // evaluation reads. What matters is the **lock**: `DO NOTHING` on an
      // already-committed row takes none, so a completion whose insert is a
      // no-op is invisible to everyone until it commits. A decider can then
      // delete the claim and read the task frontier in the gap, miss the
      // completion that is still in flight, and find no row left to tell it to
      // look again. `DO UPDATE` locks the existing row for the rest of the
      // completing transaction, so the claim blocks until the completion is
      // visible — which is exactly the interlock the claim-before-read rule
      // assumes it has.
      //
      // Found by the load harness: a fan-out benchmark left runs with every
      // branch complete and the join never scheduled.
      .onConflict((oc) => oc.column('workflowId').doUpdateSet({ reason }))
      .execute();

    // Wakes a decider now instead of leaving the work to be noticed on the next
    // tick. Postgres holds notifications until commit, so when this runs inside
    // the caller's transaction the wake-up cannot arrive before the row it is
    // about — which is exactly the failure a naive wake-up introduces: a
    // decider that looks, sees nothing, and sleeps through the work it was
    // just told about.
    //
    // Like the task-queue notification, this is an **optimisation and never a
    // guarantee** — a replica mid-reconnect misses it, and the decider's own
    // interval is what makes the system correct without it.
    await sql`SELECT pg_notify(${DECIDE_CHANNEL}, ${workflowId})`.execute(
      tx ?? this.db,
    );
  }

  /**
   * Enqueues without already knowing the namespace, resolving it from the
   * workflow row in the same statement.
   *
   * This exists for **lock ordering**, not convenience. `enqueue` needs a
   * `namespaceId` the caller can only get by reading the workflow, and an
   * operator action reads it under `FOR UPDATE` — so it holds the workflow row
   * and then reaches for the `DecideQueues` row. The evaluator takes the two in
   * the opposite order, claim first and workflow second, because the
   * lost-wakeup rule requires it. Two transactions taking the same pair of
   * locks in opposite orders is a deadlock, and Postgres duly detected one:
   *
   *     Process 142 waits for ShareLock on transaction 901; blocked by 90.
   *       insert into "DecideQueues" ... on conflict do update
   *     Process 90 waits for ShareLock on transaction 900; blocked by 142.
   *       select * from "WorkflowExecutions" where "id" = $1 for update
   *
   * The operator lost, `resume` answered 500, and the run stayed paused. It is
   * rare — it needs an evaluation in flight for the same workflow at the moment
   * of the action — which is exactly why it reached a release candidate.
   *
   * Resolving the namespace by sub-select means the caller can take this row
   * **first**, matching the evaluator, so neither side ever holds one lock
   * while waiting for the other. A workflow that does not exist selects no
   * rows and inserts nothing; the caller's own lookup reports that.
   */
  async enqueueForWorkflow(
    workflowId: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .insertInto('DecideQueues')
      .columns(['workflowId', 'namespaceId', 'reason'])
      .expression((eb) =>
        eb
          .selectFrom('WorkflowExecutions')
          .select([
            'id as workflowId',
            'namespaceId',
            eb.val(reason).as('reason'),
          ])
          .where('id', '=', workflowId),
      )
      // Same reasoning as `enqueue`: `DO UPDATE` so an existing row is locked
      // rather than silently skipped.
      .onConflict((oc) => oc.column('workflowId').doUpdateSet({ reason }))
      .execute();

    await sql`SELECT pg_notify(${DECIDE_CHANNEL}, ${workflowId})`.execute(tx);
  }

  /**
   * Claims a workflow's pending evaluation.
   *
   * **This must run before the evaluation reads any state, inside the same
   * transaction.** The ordering is the whole correctness argument:
   *
   *   1. DELETE the claim row
   *   2. THEN read the workflow and its task frontier
   *   3. Evaluate, apply, commit
   *
   * A completion landing after step 1 finds no row, so its `enqueue` inserts
   * successfully and earns a fresh evaluation. Read state first and that
   * completion is instead swallowed by `ON CONFLICT DO NOTHING` while this pass
   * has already read past it — no further wakeup ever comes and the workflow
   * hangs forever.
   *
   * Keeping the claim inside the transaction is what makes it crash-safe: a
   * rollback restores the row, so a decider dying mid-evaluation loses nothing.
   *
   * @returns true if this caller owns the evaluation.
   */
  async claimForEvaluation(
    workflowId: string,
    tx: DbTransaction,
  ): Promise<boolean> {
    const rows = await tx
      .deleteFrom('DecideQueues')
      .where('workflowId', '=', workflowId)
      .returning('workflowId')
      .execute();

    return rows.length > 0;
  }

  /**
   * Suggests workflows due for evaluation.
   *
   * **Advisory, not exclusive.** Concurrent deciders can and do receive
   * overlapping batches, and that is accepted rather than prevented.
   *
   * `FOR UPDATE SKIP LOCKED` would only skip rows locked by *other in-progress*
   * transactions, and this runs in its own auto-committing statement, so the
   * locks are gone before a second caller looks. Making it genuinely exclusive
   * would mean claiming here, outside the evaluation transaction, and that
   * trades away the property that matters far more: a claim taken inside the
   * evaluation is restored by rollback, so a decider crashing mid-pass loses no
   * wakeup. Distribution is an efficiency concern; a lost wakeup hangs a
   * workflow forever.
   *
   * `claimForEvaluation` is the real gate — exactly one decider wins each
   * workflow. Overlap here costs a wasted round trip, nothing more.
   *
   * Pass `offset` to spread deciders across the queue and reduce that overlap.
   */
  async peekBatch(
    limit: number,
    offset = 0,
  ): Promise<{ workflowId: string; namespaceId: string }[]> {
    return this.db
      .selectFrom('DecideQueues')
      .select(['workflowId', 'namespaceId'])
      .orderBy('enqueuedAt')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  async depth(): Promise<number> {
    const row = await this.db
      .selectFrom('DecideQueues')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
