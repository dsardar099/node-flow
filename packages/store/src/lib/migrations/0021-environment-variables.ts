import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Per-namespace configuration a workflow reads as `${workflow.env.name}`.
 *
 * For values that differ between environments and are not secret — a base URL,
 * a bucket name, a feature flag. Credentials belong in secrets, which are
 * sealed; these are stored and shown in clear, deliberately.
 */
async function up(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(`
    CREATE TABLE "EnvironmentVariables" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "type"        TEXT NOT NULL DEFAULT 'TEXT' CHECK ("type" IN ('TEXT', 'JSON')),
      "value"       JSONB NOT NULL,
      "description" TEXT,
      "updatedBy"   TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "name")
    );
  `)
    .execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "EnvironmentVariables"`).execute(db);
}

export const environmentVariables = { name: '0021-environment-variables', up, down };
