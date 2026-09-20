import type { Db } from './database.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TaskLogEntry {
  id: number;
  level: LogLevel;
  message: string;
  at: Date;
}

/** One line may not exceed this; longer lines are cut, and say so. */
export const MAX_LOG_LINE = 8_192;
/** Lines kept per task. A worker logging in a loop stops being recorded, not the database. */
export const MAX_LOGS_PER_TASK = 5_000;

/**
 * Task logs: appended by the worker holding the task, read by anyone who can
 * read the execution.
 */
export class TaskLogRepository {
  constructor(private readonly db: Db) {}

  /**
   * Appends lines for a task — only for the worker that holds it.
   *
   * Fenced on the lease token, like a result report: without that, any process
   * with `tasks:report` could write lines into any task in the namespace, and a
   * log that can be forged is worse than no log during an investigation.
   *
   * Lines beyond the per-task cap are dropped, and a single final line records
   * that they were — silently losing the end of a log is how someone concludes
   * the worker stopped.
   */
  async append(options: {
    namespaceId: string;
    workflowId: string;
    taskId: string;
    leaseToken: string;
    entries: { message: string; level?: LogLevel }[];
  }): Promise<'appended' | 'not_found'> {
    return this.db.transaction().execute(async (tx) => {
      const task = await tx
        .selectFrom('TaskExecutions')
        .select('id')
        .where('id', '=', options.taskId)
        .where('workflowId', '=', options.workflowId)
        .where('namespaceId', '=', options.namespaceId)
        .where('leaseToken', '=', options.leaseToken)
        .forUpdate()
        .executeTakeFirst();
      if (!task) return 'not_found' as const;

      const existing = await tx
        .selectFrom('TaskLogs')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('taskId', '=', options.taskId)
        .executeTakeFirst();
      const room = MAX_LOGS_PER_TASK - Number(existing?.count ?? 0);
      if (room <= 0 || options.entries.length === 0) return 'appended' as const;

      const accepted = options.entries.slice(0, room);
      const rows = accepted.map((entry) => ({
        namespaceId: options.namespaceId,
        workflowId: options.workflowId,
        taskId: options.taskId,
        level: entry.level ?? 'info',
        message:
          entry.message.length > MAX_LOG_LINE
            ? `${entry.message.slice(0, MAX_LOG_LINE)}… [line truncated at ${MAX_LOG_LINE} characters]`
            : entry.message,
      }));

      if (options.entries.length > room) {
        rows[rows.length - 1] = {
          ...rows[rows.length - 1],
          level: 'warn',
          message: `[log limit of ${MAX_LOGS_PER_TASK} lines reached; later lines were not recorded]`,
        };
      }

      await tx.insertInto('TaskLogs').values(rows).execute();
      return 'appended' as const;
    });
  }

  /** A task's lines in the order written, paged by id. */
  async list(
    namespaceId: string,
    taskId: string,
    options: { after?: number; limit?: number } = {}
  ): Promise<TaskLogEntry[]> {
    const limit = Math.min(Math.max(1, options.limit ?? 1000), 2000);
    let query = this.db
      .selectFrom('TaskLogs')
      .select(['id', 'level', 'message', 'at'])
      .where('namespaceId', '=', namespaceId)
      .where('taskId', '=', taskId)
      .orderBy('id')
      .limit(limit);
    if (options.after !== undefined) query = query.where('id', '>', String(options.after) as never);

    const rows = await query.execute();
    return rows.map((row) => ({ ...row, id: Number(row.id), level: row.level as LogLevel }));
  }
}
