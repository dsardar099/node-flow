import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Secrets, and environment variables.
 *
 * One table for both, because they differ in exactly one respect — whether the
 * value is sealed — and splitting them would duplicate the naming, listing,
 * namespacing and audit columns to express that single bit.
 *
 * The value column holds the **sealed envelope**, never plaintext: ciphertext,
 * the wrapped data key and the id of the master key that wrapped it. A database
 * dump therefore yields nothing without the master key, which lives only in the
 * process environment.
 *
 * What is deliberately *not* here is any record of a value being read. Reads
 * happen on the dispatch path for every task that references a secret, so
 * logging them would write a row per task execution to answer a question
 * ("which workflow used this credential?") that the execution history already
 * answers.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Secrets" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "description" TEXT,

      -- false for an environment variable, which is stored in clear because it
      -- is not a credential and being readable is the point.
      "sealed"      BOOLEAN NOT NULL DEFAULT true,
      -- The envelope for a sealed value, or the plain string for a variable.
      "value"       JSONB NOT NULL,

      -- Denormalised from the envelope so a rotation can find what it has to
      -- re-seal with an index rather than by opening every row.
      "keyId"       TEXT,

      "createdBy"   TEXT,
      "updatedBy"   TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`
    CREATE UNIQUE INDEX "Secrets_name_key" ON "Secrets" ("namespaceId", "name");
  `);

  // Drives rotation: everything still sealed by a retired key.
  await run(`
    CREATE INDEX "Secrets_key_idx" ON "Secrets" ("keyId") WHERE "sealed";
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "Secrets" CASCADE`).execute(db);
}

export const secrets = { name: '0012-secrets', up, down };
