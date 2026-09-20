import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Searching inside executions, and keeping the searches people run often.
 *
 * `jsonb_path_ops` GIN indexes answer `input @> {...}` — the `input.x:y` search
 * terms — without scanning every row's payload. Created on the partitioned
 * parent, so each monthly partition gets its own.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`CREATE INDEX IF NOT EXISTS "WorkflowExecutions_input_gin" ON "WorkflowExecutions" USING GIN ("input" jsonb_path_ops);`);
  await run(`CREATE INDEX IF NOT EXISTS "WorkflowExecutions_output_gin" ON "WorkflowExecutions" USING GIN ("output" jsonb_path_ops);`);

  await run(`
    CREATE TABLE "SavedViews" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "page"        TEXT NOT NULL,
      "ownerId"     TEXT NOT NULL,
      "ownerName"   TEXT,
      "name"        TEXT NOT NULL,
      "state"       JSONB NOT NULL DEFAULT '{}',
      "shared"      BOOLEAN NOT NULL DEFAULT false,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "page", "ownerId", "name")
    );
  `);
  await run(`CREATE INDEX "SavedViews_page_idx" ON "SavedViews" ("namespaceId", "page");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);
  await run(`DROP TABLE IF EXISTS "SavedViews"`);
  await run(`DROP INDEX IF EXISTS "WorkflowExecutions_output_gin"`);
  await run(`DROP INDEX IF EXISTS "WorkflowExecutions_input_gin"`);
}

export const executionSearch = { name: '0033-execution-search', up, down };
