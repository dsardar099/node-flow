import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { TASK_CHANNEL, queueKey } from './queue-notifier.js';

/**
 * The worker task queue.
 *
 * Postgres-native, using `FOR UPDATE SKIP LOCKED`. Comfortable into the low tens
 * of thousands of tasks/sec; the ceiling is WAL volume rather than lock
 * contention, which is why the queue partitions are tuned for aggressive
 * autovacuum in the migration.
 *
 * Written with Kysely's builder rather than SQL strings: every column name here
 * is checked at compile time, which matters because the identifiers are quoted
 * camelCase and a typo would otherwise be a runtime error inside the hot path.
 *
 * **Every read is namespace-scoped.** Queue names are chosen by users, so two
 * tenants will both have a `charge` queue. Keying on name alone lets one
 * tenant's worker lease another's task — a cross-tenant leak that happens
 * below the API, where no amount of request-level authorisation would catch
 * it. The filter belongs here, in the repository, for exactly that reason.
 */

export interface QueuedTask {
  /** Present on a system-task lease; `SIMPLE` for a worker lease. */
  taskType?: string;
  id: string;
  taskId: string;
  workflowId: string;
  namespaceId: string;
  queueName: string;
  priority: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}

export interface EnqueueOptions {
  /** Lets the system-task poll find this row without a join. */
  taskType?: string;
  namespaceId: string;
  queueName: string;
  taskId: string;
  workflowId: string;
  priority?: number;
  /** Deferred visibility — a start delay or a retry backoff. */
  delaySeconds?: number;
}

export class TaskQueueRepository {
  constructor(private readonly db: Db) {}

  async enqueue(options: EnqueueOptions, tx?: Queryable): Promise<void> {
    await (tx ?? this.db)
      .insertInto('TaskQueues')
      .values({
        namespaceId: options.namespaceId,
        queueName: options.queueName,
        taskId: options.taskId,
        workflowId: options.workflowId,
        priority: options.priority ?? 0,
        taskType: options.taskType ?? 'SIMPLE',
        visibleAt: sql<Date>`now() + make_interval(secs => ${options.delaySeconds ?? 0})`,
      })
      // The identity is (queueName, taskId), not taskId alone: a unique index on
      // a partitioned table must include every partition-key column.
      .onConflict((oc) => oc.columns(['queueName', 'taskId']).doNothing())
      .execute();

    await this.notify(options, tx);
  }

  /**
   * Wakes any worker parked on this queue.
   *
   * Issued on the *same* connection as the insert, which makes it part of the
   * transaction: Postgres holds notifications until commit, so a parked worker
   * is never woken for a task that a rollback then removes. Sending it outside
   * the transaction would produce exactly that — a wakeup for work that does
   * not exist.
   *
   * A delayed task is not announced. It is not visible yet, so waking a worker
   * for it would return an empty lease and burn a round trip; the poll timeout
   * covers it, and `visibleAt` is usually seconds or minutes away.
   *
   * Failure here is swallowed deliberately. The notification is a latency
   * optimisation and the task row is already durably enqueued — letting a
   * `NOTIFY` problem roll back a successful enqueue would trade a millisecond
   * of latency for lost work.
   */
  private async notify(options: EnqueueOptions, tx?: Queryable): Promise<void> {
    if ((options.delaySeconds ?? 0) > 0) return;

    try {
      await sql`SELECT pg_notify(${TASK_CHANNEL}, ${queueKey(
        options.namespaceId,
        options.queueName
      )})`.execute(tx ?? this.db);
    } catch {
      // Deliberately ignored; the poll timeout is the guarantee.
    }
  }

  /**
   * Leases system tasks — the ones the server executes itself.
   *
   * Differs from {@link lease} in two ways, both forced by what a system task
   * is. It selects by *type* rather than by queue, because the server runs
   * every `HTTP` task regardless of which user-named queue it landed on. And it
   * spans namespaces, because the engine executing its own task types is not
   * acting on behalf of a tenant — namespace scoping exists to stop one
   * tenant's *worker* reaching another's queue, which does not apply here.
   *
   * A fairness caveat worth naming: ordering is by priority then id, so a
   * tenant that floods the queue is served in arrival order like everyone else
   * and can crowd others out. Per-namespace round-robin is the fix if that
   * becomes real; it needs a window function and is not worth the complexity
   * on speculation.
   */
  async leaseSystemTasks(options: {
    types: string[];
    workerId: string;
    leaseSeconds: number;
    limit: number;
  }): Promise<QueuedTask[]> {
    if (options.types.length === 0) return [];

    const rows = await this.db
      .with('candidates', (qb) =>
        qb
          .selectFrom('TaskQueues')
          .select('id')
          .where('taskType', 'in', options.types)
          .where('visibleAt', '<=', sql<Date>`now()`)
          .where('leaseExpiresAt', 'is', null)
          .orderBy('priority', 'desc')
          .orderBy('id')
          .forUpdate()
          .skipLocked()
          .limit(options.limit)
      )
      .updateTable('TaskQueues as q')
      .set({
        leaseExpiresAt: sql<Date>`now() + make_interval(secs => ${options.leaseSeconds})`,
        leaseToken: sql<string>`gen_random_uuid()`,
        workerId: options.workerId,
      })
      .from('candidates as c')
      .whereRef('q.id', '=', 'c.id')
      .returning([
        sql<string>`q."id"::text`.as('id'),
        'q.taskId as taskId',
        'q.workflowId as workflowId',
        'q.namespaceId as namespaceId',
        'q.queueName as queueName',
        'q.taskType as taskType',
        'q.priority as priority',
        'q.leaseToken as leaseToken',
        'q.leaseExpiresAt as leaseExpiresAt',
      ])
      .execute();

    return byPriority(rows as unknown as QueuedTask[]);
  }

  /**
   * Leases up to `limit` tasks for a worker.
   *
   * One atomic statement: the CTE selects candidates with `SKIP LOCKED` so
   * concurrent workers step over each other's rows rather than serialising, and
   * the UPDATE stamps the lease in the same round trip. Splitting select from
   * update would open a window where two workers claim the same task.
   *
   * `leaseToken` is a fencing token — a worker whose lease has expired cannot
   * report a result, which is what makes expiry safe to act on.
   */
  async lease(
    queueName: string,
    workerId: string,
    leaseSeconds: number,
    limit: number,
    namespaceId: string
  ): Promise<QueuedTask[]> {
    const rows = await this.db
      .with('candidates', (qb) =>
        qb
          .selectFrom('TaskQueues')
          .select('id')
          .where('queueName', '=', queueName)
          .where('namespaceId', '=', namespaceId)
          .where('visibleAt', '<=', sql<Date>`now()`)
          .where('leaseExpiresAt', 'is', null)
          .orderBy('priority', 'desc')
          .orderBy('id')
          .forUpdate()
          .skipLocked()
          .limit(limit)
      )
      .updateTable('TaskQueues as q')
      .set({
        leaseExpiresAt: sql<Date>`now() + make_interval(secs => ${leaseSeconds})`,
        leaseToken: sql<string>`gen_random_uuid()`,
        workerId,
      })
      .from('candidates as c')
      .whereRef('q.id', '=', 'c.id')
      // Partition pruning: without this the update scans all eight partitions.
      .where('q.queueName', '=', queueName)
      .where('q.namespaceId', '=', namespaceId)
      .returning([
        sql<string>`q."id"::text`.as('id'),
        'q.taskId as taskId',
        'q.workflowId as workflowId',
        'q.namespaceId as namespaceId',
        'q.queueName as queueName',
        'q.priority as priority',
        'q.leaseToken as leaseToken',
        'q.leaseExpiresAt as leaseExpiresAt',
      ])
      .execute();

    return byPriority(rows as unknown as QueuedTask[]);
  }

  /**
   * Extends a lease for a worker still making progress.
   *
   * Takes `queueName` because TaskQueues is partitioned on it — without it the
   * update scans every partition instead of one.
   *
   * Gated on the fencing token: a worker whose lease already expired and was
   * reclaimed cannot extend it back into existence.
   */
  async renewLease(
    queueName: string,
    taskId: string,
    leaseToken: string,
    leaseSeconds: number
  ): Promise<boolean> {
    const rows = await this.db
      .updateTable('TaskQueues')
      .set({ leaseExpiresAt: sql<Date>`now() + make_interval(secs => ${leaseSeconds})` })
      .where('queueName', '=', queueName)
      .where('taskId', '=', taskId)
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', sql<Date>`now()`)
      .returning('taskId')
      .execute();

    return rows.length > 0;
  }

  /**
   * Removes a task from the queue once its result is recorded.
   *
   * Fenced: a stale worker returning late cannot delete the row that a newer
   * attempt now owns.
   */
  async acknowledge(
    queueName: string,
    taskId: string,
    leaseToken: string,
    tx?: Queryable
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .deleteFrom('TaskQueues')
      .where('queueName', '=', queueName)
      .where('taskId', '=', taskId)
      .where('leaseToken', '=', leaseToken)
      .returning('taskId')
      .execute();

    return rows.length > 0;
  }

  /**
   * Returns a leased task to the queue without recording a result.
   *
   * Used when admission control grants a lease and then a later gate — a
   * semaphore with no free permit — refuses it. The task must go back
   * immediately rather than wait out its lease, or a contended semaphore would
   * idle the queue for the full lease duration on every miss.
   */
  async releaseLease(
    queueName: string,
    taskId: string,
    leaseToken: string,
    tx?: Queryable
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .updateTable('TaskQueues')
      .set({ leaseExpiresAt: null, leaseToken: null, workerId: null })
      .where('queueName', '=', queueName)
      .where('taskId', '=', taskId)
      .where('leaseToken', '=', leaseToken)
      .returning('taskId')
      .execute();

    return rows.length > 0;
  }

  /**
   * Releases a lease and hides the row until `delaySeconds` have passed.
   *
   * What a task returning `IN_PROGRESS` needs: it keeps its row and its
   * attempt, but stops occupying an execution slot between polls. The lease is
   * cleared in the same statement that moves `visibleAt`, so there is no window
   * in which the row is both visible and leased — a second runner would pick it
   * up immediately and poll in parallel with the first.
   *
   * The `leaseToken` predicate is the fencing check: a runner whose lease
   * already expired cannot defer a task another runner now owns.
   */
  async defer(
    queueName: string,
    taskId: string,
    leaseToken: string,
    delaySeconds: number,
    tx?: Queryable
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .updateTable('TaskQueues')
      .set({
        leaseExpiresAt: null,
        leaseToken: null,
        workerId: null,
        visibleAt: sql<Date>`now() + make_interval(secs => ${delaySeconds})`,
      })
      .where('queueName', '=', queueName)
      .where('taskId', '=', taskId)
      .where('leaseToken', '=', leaseToken)
      .returning('taskId')
      .execute();

    return rows.length > 0;
  }

  /**
   * Reclaims tasks whose lease expired — a worker crashed or hung.
   *
   * Clearing `leaseToken` is what invalidates the old worker: if it wakes up and
   * reports a result, its token no longer matches and the update is rejected.
   *
   * Note this resets only the *queue* row. The matching `TaskExecutions` row
   * still names the dead worker and says IN_PROGRESS, so callers must reset it
   * too — see `TaskDispatchService.reclaim`. Leaving it is how a crashed
   * worker's task appears to be running forever while nothing is executing it.
   */
  async reclaimExpiredLeases(limit: number): Promise<{ taskId: string; workflowId: string }[]> {
    return this.db
      .with('expired', (qb) =>
        qb
          .selectFrom('TaskQueues')
          .select(['queueName', 'id'])
          .where('leaseExpiresAt', 'is not', null)
          .where('leaseExpiresAt', '<=', sql<Date>`now()`)
          .orderBy('leaseExpiresAt')
          .forUpdate()
          .skipLocked()
          .limit(limit)
      )
      .updateTable('TaskQueues as q')
      .set({
        leaseExpiresAt: null,
        leaseToken: null,
        workerId: null,
        visibleAt: sql<Date>`now()`,
      })
      .from('expired as e')
      .whereRef('q.queueName', '=', 'e.queueName')
      .whereRef('q.id', '=', 'e.id')
      .returning(['q.taskId as taskId', 'q.workflowId as workflowId'])
      .execute();
  }

  /**
   * Queue depth, split by why each task is or is not runnable.
   *
   * `delayed` is reported separately rather than folded into `available`, and
   * counting it matters: a task waiting out a retry backoff is neither
   * available nor leased, so without this a queue full of backing-off retries
   * reports depth zero — blank during exactly the incident where an operator
   * most needs the number.
   */
  async depth(
    queueName: string,
    namespaceId: string
  ): Promise<{ available: number; leased: number; delayed: number; total: number }> {
    const row = await this.db
      .selectFrom('TaskQueues')
      .where('queueName', '=', queueName)
      .where('namespaceId', '=', namespaceId)
      .select([
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NULL AND "visibleAt" <= now())`.as(
          'available'
        ),
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NOT NULL)`.as('leased'),
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NULL AND "visibleAt" > now())`.as(
          'delayed'
        ),
        sql<string>`count(*)`.as('total'),
      ])
      .executeTakeFirst();

    return {
      available: Number(row?.available ?? 0),
      leased: Number(row?.leased ?? 0),
      delayed: Number(row?.delayed ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  /**
   * Every queue in the namespace that currently holds anything, with the same
   * split as `depth`.
   *
   * Derived from the rows rather than from a registry of queue names, because
   * there is no registry: a queue exists because something was pushed to it.
   * The consequence to know is that a queue which has fully drained disappears
   * from this list rather than reporting zeros — it is a picture of outstanding
   * work, not an inventory of every name ever used.
   *
   * `oldestAvailableAt` is the number an operator actually acts on. Depth alone
   * cannot distinguish a queue of 500 that arrived a second ago from a queue of
   * 5 that nothing has picked up in an hour, and the second is the incident.
   */
  async overview(namespaceId: string): Promise<QueueOverviewRow[]> {
    const rows = await this.db
      .selectFrom('TaskQueues')
      .where('namespaceId', '=', namespaceId)
      .groupBy('queueName')
      .select([
        'queueName',
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NULL AND "visibleAt" <= now())`.as(
          'available'
        ),
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NOT NULL)`.as('leased'),
        sql<string>`count(*) FILTER (WHERE "leaseExpiresAt" IS NULL AND "visibleAt" > now())`.as(
          'delayed'
        ),
        sql<string>`count(*)`.as('total'),
        sql<Date | null>`min("visibleAt") FILTER (WHERE "leaseExpiresAt" IS NULL AND "visibleAt" <= now())`.as(
          'oldestAvailableAt'
        ),
        // Distinct workers holding a lease right now — the closest thing to a
        // live worker count without workers registering themselves, which they
        // deliberately do not have to do.
        sql<string>`count(DISTINCT "workerId") FILTER (WHERE "leaseExpiresAt" IS NOT NULL)`.as(
          'workers'
        ),
      ])
      .orderBy('queueName')
      .execute();

    return rows.map((row) => ({
      queueName: row.queueName,
      available: Number(row.available),
      leased: Number(row.leased),
      delayed: Number(row.delayed),
      total: Number(row.total),
      workers: Number(row.workers),
      oldestAvailableAt: row.oldestAvailableAt ?? null,
    }));
  }
}

export interface QueueOverviewRow {
  queueName: string;
  available: number;
  leased: number;
  delayed: number;
  total: number;
  /** Distinct worker ids currently holding a lease on this queue. */
  workers: number;
  /** When the longest-waiting runnable task became visible; null if none are. */
  oldestAvailableAt: Date | null;
}

/**
 * Orders a leased batch highest-priority first.
 *
 * `UPDATE … RETURNING` returns rows in whatever order the executor happened to
 * touch them — the `ORDER BY` in the CTE decides *which* rows are leased, not
 * the order they come back in. Relying on the two coinciding worked until an
 * unrelated index changed the plan, at which point a worker silently began
 * processing its batch lowest-priority first.
 *
 * Sorting here makes the guarantee real. The batch is at most a hundred rows,
 * so the cost is nothing next to the round trip that produced it.
 */
function byPriority(tasks: QueuedTask[]): QueuedTask[] {
  return [...tasks].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || Number(a.id) - Number(b.id)
  );
}
