import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { json } from './schema.js';

/**
 * Durable timers.
 *
 * Backs every deadline in the system: task and workflow timeouts, retry
 * backoff, `WAIT` tasks and cron fires. A timer that lives only in a process's
 * memory disappears on restart, and a workflow whose timeout evaporated waits
 * forever with nothing to show why.
 *
 * The table is range-partitioned hourly, so the poller scans only the leading
 * partition and old ones are dropped rather than deleted. Millions of pending
 * timers stay cheap because the working set is always the current hour.
 */

export type TimerKind =
  | 'scheduleToStart'
  | 'startToClose'
  | 'taskTimeout'
  | 'workflowTimeout'
  | 'heartbeat'
  | 'wait';

export interface DueTimer {
  id: string;
  kind: TimerKind;
  namespaceId: string;
  workflowId: string;
  taskId: string | null;
  payload: Record<string, unknown>;
}

export interface ScheduleTimerInput {
  kind: TimerKind;
  namespaceId: string;
  workflowId: string;
  taskId?: string;
  fireAfterSeconds: number;
  payload?: Record<string, unknown>;
}

export class TimerRepository {
  constructor(private readonly db: Db) {}

  /** Schedules a timer. Shares the caller's transaction so it commits atomically. */
  async schedule(input: ScheduleTimerInput, tx?: Queryable): Promise<void> {
    await (tx ?? this.db)
      .insertInto('Timers')
      .values({
        kind: input.kind,
        namespaceId: input.namespaceId,
        workflowId: input.workflowId,
        taskId: input.taskId ?? null,
        fireAt: sql<Date>`now() + make_interval(secs => ${input.fireAfterSeconds})`,
        payload: json(input.payload ?? {}),
      })
      .execute();
  }

  /**
   * Claims timers that are due.
   *
   * `SKIP LOCKED` lets several pollers run without coordination. Claiming marks
   * the row rather than deleting it, so a poller that crashes mid-handling
   * leaves evidence rather than silently dropping a deadline; the row is
   * removed once its effect is committed.
   */
  async claimDue(limit: number, tx: Queryable): Promise<DueTimer[]> {
    const rows = await tx
      .with('due', (qb) =>
        qb
          .selectFrom('Timers')
          .select(['fireAt', 'id'])
          .where('fireAt', '<=', sql<Date>`now()`)
          .where('claimedAt', 'is', null)
          .orderBy('fireAt')
          .forUpdate()
          .skipLocked()
          .limit(limit)
      )
      .updateTable('Timers as t')
      .set({ claimedAt: sql<Date>`now()` })
      .from('due as d')
      .whereRef('t.fireAt', '=', 'd.fireAt')
      .whereRef('t.id', '=', 'd.id')
      .returning([
        't.id as id',
        't.kind as kind',
        't.namespaceId as namespaceId',
        't.workflowId as workflowId',
        't.taskId as taskId',
        't.payload as payload',
      ])
      .execute();

    return rows as unknown as DueTimer[];
  }

  /** Removes handled timers. Same transaction as the effect they produced. */
  async remove(ids: string[], tx: Queryable): Promise<void> {
    if (ids.length === 0) return;
    await tx.deleteFrom('Timers').where('id', 'in', ids).execute();
  }

  /**
   * Cancels every outstanding timer for a task.
   *
   * Called when a task reaches a terminal state: its deadlines no longer mean
   * anything, and leaving them would fire a timeout against a task that already
   * finished.
   */
  async cancelForTask(workflowId: string, taskId: string, tx?: Queryable): Promise<void> {
    await (tx ?? this.db)
      .deleteFrom('Timers')
      .where('workflowId', '=', workflowId)
      .where('taskId', '=', taskId)
      .execute();
  }

  async cancelForWorkflow(workflowId: string, tx?: Queryable): Promise<void> {
    await (tx ?? this.db).deleteFrom('Timers').where('workflowId', '=', workflowId).execute();
  }

  async pendingCount(): Promise<number> {
    const row = await this.db
      .selectFrom('Timers')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('claimedAt', 'is', null)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
