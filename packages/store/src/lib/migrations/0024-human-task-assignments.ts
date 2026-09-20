import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Assignment chains for human tasks.
 *
 * A task can name who owns it first and how long they have to pick it up
 * before it moves on — "the on-call reviewer for 30 minutes, then the payments
 * team, then the finance lead" — instead of sitting unclaimed in one inbox.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    ALTER TABLE "HumanTasks"
      ADD COLUMN "assignments"        JSONB,
      ADD COLUMN "assignmentIndex"    INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "assignedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN "completionStrategy" TEXT NOT NULL DEFAULT 'LEAVE_OPEN'
        CHECK ("completionStrategy" IN ('LEAVE_OPEN', 'TERMINATE')),
      ADD COLUMN "skippedReason"      TEXT;
  `);

  // The escalation sweep reads only open, unclaimed tasks that have a chain.
  await run(`
    CREATE INDEX "HumanTasks_escalation_idx" ON "HumanTasks" ("assignedAt")
      WHERE "completedAt" IS NULL AND "claimedBy" IS NULL AND "assignments" IS NOT NULL;
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE "HumanTasks" DROP COLUMN IF EXISTS "assignments", DROP COLUMN IF EXISTS "assignmentIndex",
       DROP COLUMN IF EXISTS "assignedAt", DROP COLUMN IF EXISTS "completionStrategy", DROP COLUMN IF EXISTS "skippedReason"`
    )
    .execute(db);
}

export const humanTaskAssignments = { name: '0024-human-task-assignments', up, down };
