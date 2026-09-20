import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Messages pushed into a running execution, consumed by `PULL_WORKFLOW_MESSAGES`.
 *
 * A queue per execution rather than a signal: a signal completes one waiting
 * task and is gone, while messages accumulate until a pull takes them, in the
 * order they arrived — which is what a workflow reading a stream of updates
 * (bids, sensor readings, chat turns) needs.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "WorkflowMessages" (
      "id"          BIGSERIAL PRIMARY KEY,
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "workflowId"  UUID NOT NULL,
      "payload"     JSONB NOT NULL DEFAULT '{}',
      "receivedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
      "consumedByTaskId" UUID,
      "consumedAt"  TIMESTAMPTZ
    );
  `);
  await run(`CREATE INDEX "WorkflowMessages_pending_idx" ON "WorkflowMessages" ("workflowId", "id") WHERE "consumedAt" IS NULL;`);
  await run(`CREATE INDEX "WorkflowMessages_workflow_idx" ON "WorkflowMessages" ("workflowId", "id");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "WorkflowMessages"`).execute(db);
}

export const workflowMessages = { name: '0029-workflow-messages', up, down };
