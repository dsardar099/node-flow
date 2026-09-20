import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * A registry of named, versioned schemas.
 *
 * A contract shared by a dozen task and workflow definitions is written once
 * and referenced as `{ "name": "order", "version": 2 }`, instead of being copied
 * into each and drifting. Versions are immutable, like workflow versions: a
 * definition pinned to version 2 keeps meaning what it meant.
 */
async function up(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(`
    CREATE TABLE "Schemas" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "version"     INTEGER NOT NULL,
      "type"        TEXT NOT NULL DEFAULT 'JSON' CHECK ("type" IN ('JSON')),
      "data"        JSONB NOT NULL,
      "description" TEXT,
      "createdBy"   TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "name", "version")
    );
  `)
    .execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "Schemas"`).execute(db);
}

export const schemas = { name: '0022-schemas', up, down };
