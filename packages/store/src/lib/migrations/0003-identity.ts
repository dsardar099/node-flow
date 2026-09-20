import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Service accounts and API keys.
 *
 * Both are namespace-scoped with `ON DELETE CASCADE`, so deleting a tenant
 * cannot leave credentials behind that still authenticate successfully against
 * a namespace that no longer exists.
 *
 * Neither table is partitioned. They are small, read on every request and
 * looked up by a unique credential — exactly the profile partitioning makes
 * worse, since a lookup with no partition key probes every partition.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "ServiceAccounts" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "keyId"       TEXT NOT NULL,
      "secretHash"  TEXT NOT NULL,
      "secretSalt"  TEXT NOT NULL,
      "scopes"      TEXT[] NOT NULL DEFAULT '{}',
      "disabledAt"  TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "lastUsedAt"  TIMESTAMPTZ
    );
  `);

  // Globally unique, not per-namespace: the key id arrives on its own during a
  // token exchange, with no namespace to disambiguate it. Scoping it per
  // namespace would make the credential unresolvable.
  await run(`CREATE UNIQUE INDEX "ServiceAccounts_keyId_key" ON "ServiceAccounts" ("keyId");`);
  await run(`
    CREATE UNIQUE INDEX "ServiceAccounts_name_key"
      ON "ServiceAccounts" ("namespaceId", "name");
  `);

  await run(`
    CREATE TABLE "ApiKeys" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "prefix"      TEXT NOT NULL,
      "tokenHash"   TEXT NOT NULL,
      "scopes"      TEXT[] NOT NULL DEFAULT '{}',
      "expiresAt"   TIMESTAMPTZ,
      "revokedAt"   TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "lastUsedAt"  TIMESTAMPTZ
    );
  `);

  // The hash is the lookup key on every authenticated request, so it is the
  // index rather than an afterthought.
  await run(`CREATE UNIQUE INDEX "ApiKeys_tokenHash_key" ON "ApiKeys" ("tokenHash");`);
  await run(`CREATE INDEX "ApiKeys_namespace_idx" ON "ApiKeys" ("namespaceId");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['ApiKeys', 'ServiceAccounts']) {
    await sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`).execute(db);
  }
}

export const identity = { name: '0003-identity', up, down };
