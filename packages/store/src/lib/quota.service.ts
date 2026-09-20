import { ErrorCode, NodeFlowError, WorkflowStatus } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, DbTransaction } from './database.js';

/**
 * Per-tenant quotas.
 *
 * Enforced at the **front door** — the point a workflow is started — and not
 * anywhere later. Shedding at admission is the only load-shedding that
 * preserves correctness: rejecting a start costs the caller a 429 and nothing
 * else, while throttling work already in flight leaves half-finished
 * executions holding leases, permits and timers.
 *
 * Quotas live in `Namespaces.settings` rather than their own table. They are
 * one small object per tenant, read on a path that already loads the namespace,
 * and a table would add a join to the hottest write in the system to store four
 * numbers.
 *
 * **Unset means unlimited**, and that is deliberate: a default quota is a
 * number somebody picked without knowing the workload, and the first thing it
 * does is reject legitimate traffic on a Monday morning.
 */

export interface NamespaceQuotas {
  /** Executions running at once. The one that protects the database. */
  maxConcurrentExecutions?: number;
  /** Starts per minute. The one that protects against a runaway caller. */
  maxExecutionsPerMinute?: number;
  /** Registered workflow definitions. Guards against a runaway CI pipeline. */
  maxWorkflowDefinitions?: number;
  /** Cron schedules, which each cost a poller pass forever. */
  maxSchedules?: number;
}

export type QuotaKind = keyof NamespaceQuotas;

/** Thrown when a quota refuses an operation. Carries what a 429 needs. */
export class QuotaExceededError extends NodeFlowError {
  constructor(
    readonly quota: QuotaKind,
    readonly limit: number,
    readonly current: number,
    readonly retryAfterSeconds?: number
  ) {
    super(
      ErrorCode.LIMIT_EXCEEDED,
      `namespace quota "${quota}" exceeded: ${current} of ${limit}`,
      { quota, limit, current, retryAfterSeconds }
    );
  }
}

export class QuotaService {
  constructor(private readonly db: Db) {}

  async quotasFor(namespaceId: string): Promise<NamespaceQuotas> {
    const row = await this.db
      .selectFrom('Namespaces')
      .select('settings')
      .where('id', '=', namespaceId)
      .executeTakeFirst();

    const settings = (row?.settings ?? {}) as { quotas?: NamespaceQuotas };
    return settings.quotas ?? {};
  }

  async setQuotas(namespaceId: string, quotas: NamespaceQuotas): Promise<NamespaceQuotas> {
    for (const [key, value] of Object.entries(quotas)) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw new NodeFlowError(
          ErrorCode.INVALID_ARGUMENT,
          `quota "${key}" must be a non-negative integer`
        );
      }
    }

    // Merged into `settings` rather than replacing it, so a future setting
    // stored alongside is not silently erased by a quota change.
    await this.db
      .updateTable('Namespaces')
      .set({
        settings: sql`jsonb_set(coalesce("settings", '{}'::jsonb), '{quotas}', ${JSON.stringify(
          quotas
        )}::jsonb, true)`,
      })
      .where('id', '=', namespaceId)
      .execute();

    return quotas;
  }

  /**
   * Checks the quotas that gate starting a workflow.
   *
   * Shares the caller's transaction, and takes an advisory lock before
   * counting. The transaction alone is not enough: it makes the check and the
   * insert commit together, but two concurrent transactions still read the same
   * count. The lock is what serialises them.
   */
  async assertMayStart(namespaceId: string, tx: DbTransaction): Promise<void> {
    const quotas = await this.quotasFor(namespaceId);

    if (quotas.maxConcurrentExecutions !== undefined) {
      // Counting and then inserting against that count is a read-then-write
      // with nothing between them: N concurrent starts all read the same
      // number, all conclude there is room, and the limit is exceeded by
      // however many arrived at once. Sharing a transaction does *not* fix it —
      // two READ COMMITTED transactions see the same snapshot and both insert.
      //
      // A transaction-scoped advisory lock keyed on the namespace does: it
      // releases at commit or rollback with no cleanup path to get wrong, and
      // contends only with other starts in the *same* namespace, for the
      // milliseconds admission takes.
      //
      // Taken only when a concurrency quota exists, so an install with no
      // quotas pays nothing for this — most starts never reach here.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`quota:${namespaceId}`}))`.execute(tx);

      const running = await this.countRunning(namespaceId, tx);
      if (running >= quotas.maxConcurrentExecutions) {
        throw new QuotaExceededError(
          'maxConcurrentExecutions',
          quotas.maxConcurrentExecutions,
          running
        );
      }
    }

    if (quotas.maxExecutionsPerMinute !== undefined) {
      const granted = await this.consumeStartToken(
        namespaceId,
        quotas.maxExecutionsPerMinute,
        tx
      );

      if (!granted) {
        throw new QuotaExceededError(
          'maxExecutionsPerMinute',
          quotas.maxExecutionsPerMinute,
          quotas.maxExecutionsPerMinute,
          // The caller should come back when the window turns over, not
          // immediately — a 429 with no delay is an invitation to hot-loop.
          secondsUntilWindowEnd()
        );
      }
    }
  }

  /**
   * Runs `start` under the namespace's start quotas, in one transaction.
   *
   * The transaction is the point. Checking the count and inserting the row
   * separately lets two concurrent starts both read `limit - 1` running and
   * both proceed, which is exactly the burst a quota exists to prevent — and it
   * only shows up under the load that makes it matter.
   *
   * Exposed as a helper rather than left to each caller so the boundary is
   * visible at the call site, which is how transaction boundaries are treated
   * everywhere else in this codebase.
   */
  async withStartQuota<T>(namespaceId: string, start: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (tx) => {
      await this.assertMayStart(namespaceId, tx);
      return start(tx);
    });
  }

  /** Checks a count-based quota before creating a definition or a schedule. */
  async assertMayCreate(
    namespaceId: string,
    kind: 'maxWorkflowDefinitions' | 'maxSchedules'
  ): Promise<void> {
    const quotas = await this.quotasFor(namespaceId);
    const limit = quotas[kind];
    if (limit === undefined) return;

    const current =
      kind === 'maxSchedules'
        ? await this.countRows('Schedules', namespaceId)
        : await this.countDistinctDefinitions(namespaceId);

    if (current >= limit) throw new QuotaExceededError(kind, limit, current);
  }

  /**
   * Executions that are not finished.
   *
   * Counted rather than tracked in a counter column: a counter has to be
   * decremented on every terminal path — completion, failure, timeout,
   * termination, the reclaimer — and one missed decrement leaks quota forever,
   * which presents as a tenant that mysteriously cannot start anything.
   */
  private async countRunning(namespaceId: string, tx: DbTransaction): Promise<number> {
    const row = await tx
      .selectFrom('WorkflowExecutions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('namespaceId', '=', namespaceId)
      .where('status', 'in', [WorkflowStatus.RUNNING, WorkflowStatus.PAUSED])
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  /**
   * Takes one token from this namespace's start bucket.
   *
   * Reuses the queue rate limiter's table rather than inventing a second
   * mechanism, under a reserved key that cannot collide with a queue name —
   * `queueName` is a task name elsewhere, and those never contain a space.
   */
  private async consumeStartToken(
    namespaceId: string,
    limit: number,
    tx: DbTransaction
  ): Promise<boolean> {
    const key = 'namespace starts';
    const windowStart = sql<Date>`to_timestamp(floor(extract(epoch from now()) / 60) * 60)`;

    await tx
      .insertInto('RateLimitBuckets')
      .values({ namespaceId, queueName: key, windowStart, count: 0 })
      .onConflict((oc) => oc.columns(['namespaceId', 'queueName', 'windowStart']).doNothing())
      .execute();

    const bucket = await tx
      .selectFrom('RateLimitBuckets')
      .select('count')
      .where('namespaceId', '=', namespaceId)
      .where('queueName', '=', key)
      .where('windowStart', '=', windowStart)
      .forUpdate()
      .executeTakeFirst();

    const used = Number(bucket?.count ?? 0);
    if (used >= limit) return false;

    await tx
      .updateTable('RateLimitBuckets')
      .set({ count: used + 1 })
      .where('namespaceId', '=', namespaceId)
      .where('queueName', '=', key)
      .where('windowStart', '=', windowStart)
      .execute();

    return true;
  }

  private async countRows(table: 'Schedules', namespaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('namespaceId', '=', namespaceId)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  /** Distinct names, not rows: versions of one definition are one definition. */
  private async countDistinctDefinitions(namespaceId: string): Promise<number> {
    const rows = await this.db
      .selectFrom('WorkflowDefinitions')
      .select('name')
      .distinct()
      .where('namespaceId', '=', namespaceId)
      .execute();

    return rows.length;
  }
}

/** How long until the current minute-window turns over. */
function secondsUntilWindowEnd(): number {
  return Math.max(1, 60 - Math.floor((Date.now() / 1000) % 60));
}
