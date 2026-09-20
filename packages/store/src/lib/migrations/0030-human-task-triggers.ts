import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Human-task auto-claim and state-change triggers.
 *
 * `autoClaim` puts a task straight into its assignee's hands when that assignee
 * is one person, so a task addressed to someone does not wait for a click that
 * says nothing. `triggers` start workflows as the task moves — assigned,
 * claimed, completed — through the outbox, in the transaction that moved it.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`ALTER TABLE "HumanTasks" ADD COLUMN "autoClaim" BOOLEAN NOT NULL DEFAULT false;`);
  await run(`ALTER TABLE "HumanTasks" ADD COLUMN "triggers" JSONB;`);
  // The operator view lists every open task oldest first, across assignees.
  await run(`CREATE INDEX "HumanTasks_namespace_created_idx" ON "HumanTasks" ("namespaceId", "createdAt");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);
  await run(`DROP INDEX IF EXISTS "HumanTasks_namespace_created_idx";`);
  await run(`ALTER TABLE "HumanTasks" DROP COLUMN IF EXISTS "triggers", DROP COLUMN IF EXISTS "autoClaim";`);
}

export const humanTaskTriggers = { name: '0030-human-task-triggers', up, down };
