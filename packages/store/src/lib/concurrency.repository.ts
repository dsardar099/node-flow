import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';

/**
 * Admission control: the gates a task must pass before a worker may run it.
 *
 * Four independent limits, each answering a different question:
 *
 *  - **`concurrentExecLimit`** — how many of this task may run at once.
 *  - **Rate limit** — how many may *start* per window. Different from a
 *    concurrency cap: it bounds throughput rather than parallelism, which is
 *    what most third-party APIs actually meter.
 *  - **Named semaphores** — a shared ceiling across *unrelated* tasks, which a
 *    per-definition cap cannot express: "these six different tasks must not
 *    exceed four concurrent hits on one fragile legacy API".
 *  - **Workflow caps** — live executions per definition, and in-flight tasks
 *    within a single execution.
 *
 * All of them are enforced at **dispatch**, not in the worker SDK. A limit
 * enforced client-side is advisory, and will eventually be bypassed by a worker
 * that is older, misconfigured, or simply not ours.
 */

/** A semaphore's configured size and how much of it is currently in use. */
export interface SemaphoreState {
  name: string;
  permits: number;
  /** Holders whose lease has not expired. */
  held: number;
}

export interface DispatchPolicy {
  /** 0 disables. */
  concurrentExecLimit: number;
  /** 0 disables. */
  rateLimitPerFrequency: number;
  rateLimitFrequencySeconds: number;
  /** Named semaphores this task must hold to run. */
  semaphores: string[];
}

export class ConcurrencyRepository {
  constructor(private readonly db: Db) {}

  /**
   * How many tasks may be dispatched right now, given every applicable limit.
   *
   * Returns the *minimum* across all gates — the most restrictive wins, which
   * is the only safe way to combine independent limits. A caller then leases at
   * most this many.
   *
   * Consumes rate-limit tokens as a side effect, so the caller must actually
   * attempt to dispatch what it is granted; unused grants are lost for the
   * window. That is the conservative direction: under-dispatching briefly is
   * recoverable, exceeding a downstream limit may not be.
   */
  async allowance(
    namespaceId: string,
    queueName: string,
    requested: number,
    policy: DispatchPolicy,
    tx: DbTransaction
  ): Promise<number> {
    let allowed = requested;

    if (policy.concurrentExecLimit > 0) {
      // Serialise admission for this queue.
      //
      // Counting in-flight work and then leasing against that count is a
      // read-then-write with nothing between them: ten dispatchers all read
      // zero, all grant themselves the full cap, and the limit is exceeded by
      // an order of magnitude. Every sequential test still passes, which is
      // what makes it dangerous.
      //
      // A transaction-scoped advisory lock keyed on the queue is enough — it
      // releases automatically at commit or rollback (no cleanup path to get
      // wrong), and contends only with other dispatchers of the *same* queue,
      // for the few milliseconds admission takes.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${namespaceId}:${queueName}`}))`.execute(
        tx
      );

      const inFlight = await this.countInFlight(namespaceId, queueName, tx);
      allowed = Math.min(allowed, Math.max(0, policy.concurrentExecLimit - inFlight));
    }

    if (allowed > 0 && policy.rateLimitPerFrequency > 0) {
      allowed = await this.consumeTokens(
        namespaceId,
        queueName,
        allowed,
        policy.rateLimitPerFrequency,
        policy.rateLimitFrequencySeconds,
        tx
      );
    }

    return allowed;
  }

  /** Tasks of this queue currently leased by a worker. */
  async countInFlight(namespaceId: string, queueName: string, tx: Queryable): Promise<number> {
    const row = await tx
      .selectFrom('TaskQueues')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('namespaceId', '=', namespaceId)
      .where('queueName', '=', queueName)
      .where('leaseExpiresAt', 'is not', null)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  /**
   * Takes up to `wanted` tokens from the current window.
   *
   * The window is a fixed bucket rather than a sliding one: `floor(now / size)`.
   * Fixed windows admit a burst at a boundary, but the alternative needs
   * per-event timestamps, and a burst of at most 2× for one window is a fair
   * trade for a single upsert on the dispatch path.
   *
   * The upsert is atomic, so concurrent dispatchers cannot both read the same
   * remaining count and each grant it.
   */
  private async consumeTokens(
    namespaceId: string,
    queueName: string,
    wanted: number,
    limit: number,
    windowSeconds: number,
    tx: DbTransaction
  ): Promise<number> {
    const windowStart = sql<Date>`to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`;

    // Create the window if it is new, then lock it. Read-modify-write under a
    // row lock rather than arithmetic inside one upsert: an upsert can tell you
    // the count *after* your claim but not how much of it was yours, and
    // reconstructing that is where an off-by-one silently over-admits.
    await tx
      .insertInto('RateLimitBuckets')
      .values({ namespaceId, queueName, windowStart, count: 0 })
      .onConflict((oc) => oc.columns(['namespaceId', 'queueName', 'windowStart']).doNothing())
      .execute();

    const bucket = await tx
      .selectFrom('RateLimitBuckets')
      .select('count')
      .where('namespaceId', '=', namespaceId)
      .where('queueName', '=', queueName)
      .where('windowStart', '=', windowStart)
      .forUpdate()
      .executeTakeFirst();

    const used = Number(bucket?.count ?? 0);
    const granted = Math.max(0, Math.min(wanted, limit - used));
    if (granted === 0) return 0;

    await tx
      .updateTable('RateLimitBuckets')
      .set({ count: used + granted })
      .where('namespaceId', '=', namespaceId)
      .where('queueName', '=', queueName)
      .where('windowStart', '=', windowStart)
      .execute();

    return granted;
  }

  /**
   * Acquires every named semaphore a task needs, or none of them.
   *
   * All-or-nothing deliberately: taking a subset and waiting for the rest is
   * how two tasks needing the same two permits deadlock, each holding one.
   *
   * Permits are leased rather than held outright, so a worker that crashes
   * releases its permits on expiry instead of blocking the semaphore forever.
   */
  async acquireAll(
    namespaceId: string,
    names: string[],
    taskId: string,
    workflowId: string,
    leaseSeconds: number,
    tx: DbTransaction
  ): Promise<boolean> {
    if (names.length === 0) return true;

    for (const name of names) {
      const permits = await this.permitsFor(namespaceId, name, tx);
      if (permits === undefined) continue; // Unconfigured semaphore does not gate.

      // Expired holders no longer count — a crashed worker must not hold a
      // permit indefinitely.
      const held = await tx
        .selectFrom('SemaphoreHolders')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .where('leaseExpiresAt', '>', sql<Date>`now()`)
        .executeTakeFirst();

      if (Number(held?.count ?? 0) >= permits) {
        // Roll back everything taken so far in this call.
        await this.releaseAll(taskId, tx);
        return false;
      }

      await tx
        .insertInto('SemaphoreHolders')
        .values({
          namespaceId,
          name,
          taskId,
          workflowId,
          leaseExpiresAt: sql<Date>`now() + make_interval(secs => ${leaseSeconds})`,
        })
        .onConflict((oc) => oc.columns(['namespaceId', 'name', 'taskId']).doNothing())
        .execute();
    }

    return true;
  }

  /** Releases every permit a task holds. Called when it reaches a terminal state. */
  async releaseAll(taskId: string, tx: Queryable): Promise<void> {
    await tx.deleteFrom('SemaphoreHolders').where('taskId', '=', taskId).execute();
  }

  /** Reclaims permits leaked by crashed holders. */
  async expireStaleHolders(tx?: Queryable): Promise<number> {
    const rows = await (tx ?? this.db)
      .deleteFrom('SemaphoreHolders')
      .where('leaseExpiresAt', '<=', sql<Date>`now()`)
      .returning('taskId')
      .execute();

    return rows.length;
  }

  async configureSemaphore(namespaceId: string, name: string, permits: number): Promise<void> {
    await this.db
      .insertInto('Semaphores')
      .values({ namespaceId, name, permits })
      .onConflict((oc) => oc.columns(['namespaceId', 'name']).doUpdateSet({ permits }))
      .execute();
  }

  /**
   * Every semaphore in a namespace, with how many permits are currently held.
   *
   * The held count is the reason this exists rather than a plain listing: a
   * semaphore that is quietly at its limit looks identical to one nobody uses,
   * and "why is my task not running?" has to be answerable without reading the
   * database.
   */
  async listSemaphores(namespaceId: string): Promise<SemaphoreState[]> {
    const rows = await this.db
      .selectFrom('Semaphores as s')
      .select((eb) => [
        's.name',
        's.permits',
        eb
          .selectFrom('SemaphoreHolders as h')
          .select((inner) => inner.fn.countAll<string>().as('held'))
          .whereRef('h.namespaceId', '=', 's.namespaceId')
          .whereRef('h.name', '=', 's.name')
          .where('h.leaseExpiresAt', '>', sql<Date>`now()`)
          .as('held'),
      ])
      .where('s.namespaceId', '=', namespaceId)
      .orderBy('s.name')
      .execute();

    return rows.map((row) => ({
      name: row.name,
      permits: Number(row.permits),
      held: Number(row.held ?? 0),
    }));
  }

  /** One semaphore, or undefined when it has never been configured. */
  async getSemaphore(namespaceId: string, name: string): Promise<SemaphoreState | undefined> {
    const all = await this.listSemaphores(namespaceId);
    return all.find((semaphore) => semaphore.name === name);
  }

  /**
   * Removes a semaphore's configuration, which stops it gating anything.
   *
   * Deliberately not a way to release permits: holders are released by their
   * task finishing or its lease expiring, and deleting the row while tasks hold
   * it would let more through rather than fewer.
   */
  async deleteSemaphore(namespaceId: string, name: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('Semaphores')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0) > 0;
  }

  private async permitsFor(
    namespaceId: string,
    name: string,
    tx: Queryable
  ): Promise<number | undefined> {
    const row = await tx
      .selectFrom('Semaphores')
      .select('permits')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return row?.permits;
  }

  // ------------------------------------------------------------ workflow caps

  /** Live executions of one workflow definition. */
  async countRunningExecutions(
    namespaceId: string,
    defName: string,
    tx?: Queryable
  ): Promise<number> {
    const row = await (tx ?? this.db)
      .selectFrom('WorkflowExecutions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('namespaceId', '=', namespaceId)
      .where('defName', '=', defName)
      .where('status', 'in', ['RUNNING', 'PAUSED'])
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  /** Prunes rate-limit windows that can no longer be consulted. */
  async pruneRateLimitWindows(olderThanSeconds = 3600): Promise<number> {
    const rows = await this.db
      .deleteFrom('RateLimitBuckets')
      .where(
        'windowStart',
        '<',
        sql<Date>`now() - make_interval(secs => ${olderThanSeconds})`
      )
      .returning('queueName')
      .execute();

    return rows.length;
  }
}
