import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Humans, and their browser sessions.
 *
 * Two tables rather than a stateless token, because **logout has to actually
 * revoke**. A signed session token cannot be withdrawn before it expires, so an
 * offboarded employee or a compromised laptop stays authenticated until the
 * clock runs out. A row can be deleted.
 *
 * That costs one indexed lookup per request. For humans — a handful of requests
 * per minute, not the worker fleet's thousands per second — that is nothing,
 * and it is why workers use bearer tokens and people use sessions.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Users" (
      "id"            UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"   UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "email"         TEXT NOT NULL,
      "name"          TEXT NOT NULL,
      -- Self-describing: algorithm and cost parameters live alongside the
      -- digest, so they can be raised later and old hashes upgraded on the
      -- owner's next successful login. Hard-coding the parameters would freeze
      -- them at whatever was reasonable the year this shipped.
      "passwordHash"  TEXT NOT NULL,
      "scopes"        TEXT[] NOT NULL DEFAULT '{}',
      "disabledAt"    TIMESTAMPTZ,
      -- Failed-login backoff. Counted per account rather than per IP because
      -- an attacker rotates addresses; see the repository for the denial-of-
      -- service trade-off this accepts.
      "failedLogins"  INTEGER NOT NULL DEFAULT 0,
      "lockedUntil"   TIMESTAMPTZ,
      "lastLoginAt"   TIMESTAMPTZ,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Case-insensitive and unique per namespace. Addresses are not
  // case-sensitive in practice, and letting "Ada@x.com" and "ada@x.com" be two
  // accounts is a support ticket and a security hole at once.
  await run(`
    CREATE UNIQUE INDEX "Users_email_key" ON "Users" ("namespaceId", lower("email"));
  `);

  await run(`
    CREATE TABLE "Sessions" (
      "id"           UUID PRIMARY KEY DEFAULT uuidv7(),
      "userId"       UUID NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
      -- SHA-256 of the cookie value. A leaked database backup must not hand
      -- over live sessions; a fast hash is right because the token is 256 bits
      -- of generated entropy with no dictionary to search.
      "tokenHash"    TEXT NOT NULL,
      -- Absolute expiry. A session that only ever slides forward never ends,
      -- so a stolen cookie kept warm is valid indefinitely.
      "expiresAt"    TIMESTAMPTZ NOT NULL,
      -- Idle expiry, moved forward on use. Bounds an abandoned session on a
      -- shared machine without extending the absolute deadline.
      "lastSeenAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "revokedAt"    TIMESTAMPTZ,
      "userAgent"    TEXT,
      "ipAddress"    TEXT,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`CREATE UNIQUE INDEX "Sessions_token_key" ON "Sessions" ("tokenHash");`);
  // "Sign me out everywhere", and the sweep that removes expired rows.
  await run(`CREATE INDEX "Sessions_user_idx" ON "Sessions" ("userId");`);
  await run(`CREATE INDEX "Sessions_expiry_idx" ON "Sessions" ("expiresAt");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['Sessions', 'Users']) {
    await sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`).execute(db);
  }
}

export const users = { name: '0005-users', up, down };
