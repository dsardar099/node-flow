import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Fine-grained permissions: a subject (user, group or application) granted
 * specific access to a resource (a workflow or task definition, by name, prefix,
 * tag or `*`). One row per subject and target; its access list is replaced as a
 * whole, so what a row says is exactly what the subject has.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);
  await run(`
    CREATE TABLE "ResourceGrants" (
      "id"           UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"  UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "subjectType"  TEXT NOT NULL,
      "subjectId"    UUID NOT NULL,
      "resourceType" TEXT NOT NULL,
      "resource"     TEXT NOT NULL,
      "access"       TEXT[] NOT NULL,
      "createdBy"    TEXT,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "subjectType", "subjectId", "resourceType", "resource")
    );
  `);
  await run(`CREATE INDEX "ResourceGrants_subject_idx" ON "ResourceGrants" ("namespaceId", "subjectType", "subjectId");`);
  await run(`CREATE INDEX "ResourceGrants_resource_idx" ON "ResourceGrants" ("namespaceId", "resourceType", "resource");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "ResourceGrants"`).execute(db);
}

export const resourceGrants = { name: '0035-resource-grants', up, down };
