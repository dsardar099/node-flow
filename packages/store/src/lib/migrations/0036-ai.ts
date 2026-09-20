import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * AI orchestration: integrations, prompts and a vector store.
 *
 * - **Integrations** name a provider a workflow may use — an LLM API or an MCP
 *   server — with its address and the *name* of the secret holding its key.
 *   Configured by an administrator and referenced by name, for the reason the
 *   `JDBC` datasources are: a definition is user input, and one carrying its own
 *   endpoint and key would put credentials in a stored, versioned, listed
 *   document and let any author point the server anywhere.
 * - **Prompts** are versioned templates with `${variable}` placeholders, so the
 *   wording can change without editing every workflow that uses it.
 * - **Vector documents** hold embedded text for retrieval. The embedding is a
 *   plain `real[]`, so the store works on stock Postgres; where the `vector`
 *   extension is installed, search casts to it and distance is computed in C.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Integrations" (
      "id"           UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"  UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"         TEXT NOT NULL,
      "kind"         TEXT NOT NULL,
      "provider"     TEXT NOT NULL,
      "description"  TEXT,
      "baseUrl"      TEXT,
      "apiKeySecret" TEXT,
      "models"       TEXT[] NOT NULL DEFAULT '{}',
      "config"       JSONB NOT NULL DEFAULT '{}',
      "enabled"      BOOLEAN NOT NULL DEFAULT true,
      "createdBy"    TEXT,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "name")
    );
  `);

  await run(`
    CREATE TABLE "Prompts" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "version"     INT NOT NULL,
      "description" TEXT,
      "template"    TEXT NOT NULL,
      "variables"   TEXT[] NOT NULL DEFAULT '{}',
      "models"      TEXT[] NOT NULL DEFAULT '{}',
      "createdBy"   TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "name", "version")
    );
  `);

  await run(`
    CREATE TABLE "VectorDocuments" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "indexName"   TEXT NOT NULL,
      "docId"       TEXT NOT NULL,
      "chunk"       INT NOT NULL DEFAULT 0,
      "text"        TEXT NOT NULL,
      "metadata"    JSONB NOT NULL DEFAULT '{}',
      "embedding"   REAL[] NOT NULL,
      "dimensions"  INT NOT NULL,
      "model"       TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "indexName", "docId", "chunk")
    );
  `);
  await run(`CREATE INDEX "VectorDocuments_index_idx" ON "VectorDocuments" ("namespaceId", "indexName");`);

  // Best effort: an install whose Postgres ships pgvector gets native distance.
  // One that does not — the stock image — keeps working on the SQL fallback,
  // because Postgres being the only dependency is the point.
  await run(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        CREATE EXTENSION IF NOT EXISTS vector;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'pgvector is available but could not be created; using the SQL fallback';
    END $$;
  `);

  // Cosine similarity over real[] for the fallback. IMMUTABLE and PARALLEL SAFE
  // so the planner may use it freely; NULL for mismatched or zero vectors.
  await run(`
    CREATE OR REPLACE FUNCTION nf_cosine_similarity(a REAL[], b REAL[]) RETURNS DOUBLE PRECISION
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT CASE
        WHEN cardinality(a) <> cardinality(b) OR cardinality(a) = 0 THEN NULL
        ELSE (
          SELECT CASE WHEN sqrt(sum(x * x)) * sqrt(sum(y * y)) = 0 THEN NULL
                      ELSE sum(x * y) / (sqrt(sum(x * x)) * sqrt(sum(y * y))) END
          FROM unnest(a, b) AS t(x, y)
        )
      END
    $fn$;
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP FUNCTION IF EXISTS nf_cosine_similarity(REAL[], REAL[])`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "VectorDocuments"`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "Prompts"`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "Integrations"`).execute(db);
}

export const ai = { name: '0036-ai', up, down };
