import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Lets the queue tell a system task from a worker task.
 *
 * The task type is on `TaskExecutions`, so this is denormalised — deliberately.
 * The alternative is a join on every system-task poll, and `TaskQueues` is the
 * hottest table in the system: the whole reason it is a separate, narrow,
 * aggressively-vacuumed table is that leasing must not touch anything wide.
 *
 * It is written once at enqueue and never updated, so the usual objection to
 * denormalisation — two copies drifting — does not arise.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`ALTER TABLE "TaskQueues" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'SIMPLE'`);

  // The system-task poll asks for "anything runnable that is not SIMPLE",
  // across every queue. Partial, because system tasks are a small minority of
  // rows and the index should not carry the rest.
  await run(`
    CREATE INDEX "TaskQueues_system_idx"
      ON "TaskQueues" ("taskType", "priority" DESC, "id")
      WHERE "leaseExpiresAt" IS NULL AND "taskType" <> 'SIMPLE'
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP INDEX IF EXISTS "TaskQueues_system_idx"`).execute(db);
  await sql.raw(`ALTER TABLE "TaskQueues" DROP COLUMN IF EXISTS "taskType"`).execute(db);
}

export const systemTasks = { name: '0007-system-tasks', up, down };
