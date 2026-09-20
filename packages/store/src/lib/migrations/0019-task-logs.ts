import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Lines a worker writes while running a task.
 *
 * The reason they live here and not only in the worker's own log sink: the
 * person looking at a failed task in the dashboard is rarely the person who can
 * search the worker fleet's logs, and "why did this attempt fail?" should be
 * answerable from the attempt itself.
 *
 * Deliberately bounded — per line, per request and per task — because a worker
 * that logs in a tight loop must not be able to fill the database. Ordered by a
 * sequence rather than a timestamp: two lines written in the same millisecond
 * must still read in the order they were written.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "TaskLogs" (
      "id"          BIGSERIAL PRIMARY KEY,
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "workflowId"  UUID NOT NULL,
      "taskId"      UUID NOT NULL,
      "level"       TEXT NOT NULL DEFAULT 'info',
      "message"     TEXT NOT NULL,
      "at"          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Every read is "this task's lines, in order", and the id is the order.
  await run(`CREATE INDEX "TaskLogs_task_idx" ON "TaskLogs" ("taskId", "id");`);

  // Retention runs by age, across all tasks.
  await run(`CREATE INDEX "TaskLogs_at_idx" ON "TaskLogs" ("at");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "TaskLogs"`).execute(db);
}

export const taskLogs = { name: '0019-task-logs', up, down };
