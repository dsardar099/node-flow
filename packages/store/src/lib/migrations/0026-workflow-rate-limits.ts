import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Per-key workflow concurrency.
 *
 * An execution over its key's limit is created — so it has an id, a history
 * and a place in line — but not admitted: nothing evaluates it until a slot
 * frees. Admission order is arrival order.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);
  await run(`
    ALTER TABLE "WorkflowExecutions"
      ADD COLUMN "rateLimitKey" TEXT,
      ADD COLUMN "rateLimit"    INTEGER,
      ADD COLUMN "admittedAt"   TIMESTAMPTZ;
  `);
  await run(`
    CREATE INDEX "WorkflowExecutions_rate_limit_idx" ON "WorkflowExecutions"
      ("namespaceId", "defName", "rateLimitKey", "startedAt")
      WHERE "rateLimitKey" IS NOT NULL AND "status" IN ('RUNNING', 'PAUSED');
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(`ALTER TABLE "WorkflowExecutions" DROP COLUMN IF EXISTS "rateLimitKey", DROP COLUMN IF EXISTS "rateLimit", DROP COLUMN IF EXISTS "admittedAt"`)
    .execute(db);
}

export const workflowRateLimits = { name: '0026-workflow-rate-limits', up, down };
