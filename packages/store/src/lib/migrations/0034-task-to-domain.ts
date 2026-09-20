import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/** Per-run worker routing: `{ "charge": "eu-west", "*": "canary" }`. */
async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "WorkflowExecutions" ADD COLUMN "taskToDomain" JSONB;`).execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "WorkflowExecutions" DROP COLUMN IF EXISTS "taskToDomain";`).execute(db);
}

export const taskToDomain = { name: '0034-task-to-domain', up, down };
