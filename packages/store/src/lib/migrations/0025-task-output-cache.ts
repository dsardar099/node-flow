import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Reused task outputs.
 *
 * A task with `cacheConfig` that already succeeded for the same key, recently
 * enough, is not run again: an address lookup, an exchange rate, an expensive
 * model call for the same prompt. Keyed per task definition, so two different
 * tasks that happen to share a key never share a result.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "TaskOutputCache" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "taskDefName" TEXT NOT NULL,
      "key"         TEXT NOT NULL,
      "output"      JSONB NOT NULL,
      "expiresAt"   TIMESTAMPTZ NOT NULL,
      "storedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "taskDefName", "key")
    );
  `);
  await run(`CREATE INDEX "TaskOutputCache_expiry_idx" ON "TaskOutputCache" ("expiresAt");`);

  // What to store under when the task succeeds.
  await run(`ALTER TABLE "TaskExecutions" ADD COLUMN "cacheKey" TEXT, ADD COLUMN "cacheTtlSeconds" INTEGER;`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "TaskExecutions" DROP COLUMN IF EXISTS "cacheKey", DROP COLUMN IF EXISTS "cacheTtlSeconds"`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "TaskOutputCache"`).execute(db);
}

export const taskOutputCache = { name: '0025-task-output-cache', up, down };
