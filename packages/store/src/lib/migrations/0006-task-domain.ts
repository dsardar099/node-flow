import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Records the worker pool a task was routed to.
 *
 * The queue name already encodes it (`taskDefName:domain`), but a queue entry
 * is deleted the moment the task is acknowledged — so by the time an operator
 * retries a failed task, the only record of where it belonged is gone and the
 * retry lands on the shared pool instead. Keeping it on the task row is also
 * what lets the execution view answer "which fleet ran this?".
 */

async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "TaskExecutions" ADD COLUMN "domain" TEXT`).execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "TaskExecutions" DROP COLUMN IF EXISTS "domain"`).execute(db);
}

export const taskDomain = { name: '0006-task-domain', up, down };
