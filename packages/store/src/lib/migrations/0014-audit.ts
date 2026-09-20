import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * The audit log.
 *
 * Answers one question well: **who changed this, and when?** Not "what ran" —
 * `WorkflowEvents` already records that, per execution, and duplicating it here
 * would double the write volume of the busiest path in the system to no end.
 *
 * So this records *control-plane* changes only: definitions registered,
 * schedules edited, secrets written, groups granted scopes, credentials issued
 * and revoked. Those are rare, deliberate and exactly the set that matters
 * after an incident.
 *
 * Append-only by construction — there is no update path in the repository — and
 * range-partitioned by month so retention is a `DROP TABLE` rather than a
 * delete that competes with live traffic.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "AuditEvents" (
      "id"          UUID NOT NULL DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL,

      -- Who. Denormalised rather than a foreign key: the entry has to survive
      -- the principal being deleted, which is often the very thing being
      -- investigated.
      "actorType"   TEXT NOT NULL,
      "actorId"     TEXT NOT NULL,
      "actorName"   TEXT,

      -- What, as "resource.action": "secret.put", "group.scopes-set".
      "action"      TEXT NOT NULL,
      "resource"    TEXT NOT NULL,
      -- Which one, where the resource is named.
      "resourceId"  TEXT,

      -- Enough context to understand the change without being a second copy of
      -- it. Never the value of anything sensitive.
      "detail"      JSONB NOT NULL DEFAULT '{}'::jsonb,

      "ip"          TEXT,
      "userAgent"   TEXT,
      "outcome"     TEXT NOT NULL DEFAULT 'ok',
      "at"          TIMESTAMPTZ NOT NULL DEFAULT now(),

      PRIMARY KEY ("at", "id")
    ) PARTITION BY RANGE ("at");
  `);

  // The current month, so the first write does not land in DEFAULT — the
  // mistake the partition manager had to recover from once already.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const suffix = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`;

  await run(`
    CREATE TABLE "AuditEvents_${suffix}" PARTITION OF "AuditEvents"
      FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}');
  `);

  await run(`
    CREATE TABLE "AuditEvents_default" PARTITION OF "AuditEvents" DEFAULT;
  `);

  // The query an investigation actually runs: this namespace, newest first.
  await run(`
    CREATE INDEX "AuditEvents_ns_idx" ON "AuditEvents" ("namespaceId", "at" DESC);
  `);

  // And the follow-up: everything one person did.
  await run(`
    CREATE INDEX "AuditEvents_actor_idx" ON "AuditEvents" ("namespaceId", "actorId", "at" DESC);
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "AuditEvents" CASCADE`).execute(db);
}

export const audit = { name: '0014-audit', up, down };
