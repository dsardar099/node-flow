import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * The inbox behind `HUMAN`.
 *
 * A row per task awaiting a person: an approval, a review, a correction that
 * only a human can make. Structurally the same idea as a webhook callback — the
 * engine schedules the task and then waits for something outside itself — and
 * it is deliberately modelled separately rather than reusing that table,
 * because the questions asked of it are entirely different. Nobody queries
 * "which webhooks are waiting for me"; that is the only question anyone asks
 * here.
 *
 * Two columns carry the whole concurrency story:
 *
 *  - **`assigneeId`** is routing: this task is *for* that person. Set when the
 *    workflow names one, null when the task goes to a shared pool.
 *  - **`claimedBy`** is possession: that person is working on it *now*. It is
 *    what makes two people opening the same inbox and both clicking Claim
 *    resolve to one winner rather than two people doing the same work and one
 *    of them losing it.
 *
 * Keeping them apart is what allows a task to be assigned to someone who has
 * not started it, and released back to the pool without losing who it was for.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "HumanTasks" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "workflowId"  UUID NOT NULL,
      "taskId"      UUID NOT NULL,
      "refName"     TEXT NOT NULL,

      -- What the person is being asked to do. Denormalised from the task input
      -- so an inbox listing needs no join to the widest table in the system.
      "title"       TEXT NOT NULL,
      "description" TEXT,
      -- A JSON Schema describing the expected result, so a UI can render a form
      -- and the completion can be validated against something.
      "form"        JSONB,

      "assigneeId"  UUID REFERENCES "Users"("id") ON DELETE SET NULL,
      "claimedBy"   UUID REFERENCES "Users"("id") ON DELETE SET NULL,
      "claimedAt"   TIMESTAMPTZ,

      "completedBy" UUID REFERENCES "Users"("id") ON DELETE SET NULL,
      "completedAt" TIMESTAMPTZ,

      "dueAt"       TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // One row per task. The engine opening the same task twice is a bug, and the
  // database is a better place to find out than an inbox with a duplicate in it.
  await run(`
    CREATE UNIQUE INDEX "HumanTasks_task_key" ON "HumanTasks" ("taskId");
  `);

  // The inbox query: open tasks in my namespace, mine or unclaimed. Partial,
  // because completed tasks accumulate forever and are never what is being
  // asked for.
  await run(`
    CREATE INDEX "HumanTasks_open_idx"
      ON "HumanTasks" ("namespaceId", "assigneeId", "claimedBy")
      WHERE "completedAt" IS NULL;
  `);

  // Ending an execution has to close whatever it left open.
  await run(`
    CREATE INDEX "HumanTasks_workflow_idx" ON "HumanTasks" ("workflowId");
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "HumanTasks" CASCADE`).execute(db);
}

export const humanTasks = { name: '0009-human-tasks', up, down };
