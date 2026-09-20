import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Cron triggers.
 *
 * Database-backed and leased, never in-process. `@nestjs/schedule` and every
 * library like it hold the schedule in memory and fire on a local timer, which
 * means N replicas fire N times — the single most common way a "run this
 * nightly" job becomes "bill every customer four times".
 *
 * Here the row *is* the schedule. A poller claims due rows with
 * `FOR UPDATE SKIP LOCKED`, starts the workflow and advances `nextRunAt` in one
 * transaction, so two pollers racing produce exactly one firing and the loser
 * finds nothing to claim.
 *
 * Two policies exist because the interesting questions about cron are not about
 * cron syntax, and Conductor answers neither:
 *
 *  - **`overlapPolicy`** — the previous run is still going. Starting another is
 *    right for an independent job and catastrophic for one that holds a lock or
 *    reconciles a balance.
 *  - **`catchupPolicy`** — the server was down for three hours and a five-minute
 *    schedule missed thirty-six firings. Running all thirty-six on boot is a
 *    self-inflicted stampede at exactly the moment the system is least healthy.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Schedules" (
      "id"            UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"   UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"          TEXT NOT NULL,
      "description"   TEXT,

      "cron"          TEXT NOT NULL,
      -- IANA zone. Stored rather than assumed UTC because "09:00 in Sydney"
      -- and "09:00 UTC" are different instants for most of the year, and a
      -- business schedule almost always means the former.
      "timezone"      TEXT NOT NULL DEFAULT 'UTC',

      "defName"       TEXT NOT NULL,
      -- Null means "whatever is latest when it fires", which is what most
      -- people want from a schedule and the opposite of what they want from a
      -- running execution.
      "defVersion"    INTEGER,
      "input"         JSONB NOT NULL DEFAULT '{}'::jsonb,
      "correlationId" TEXT,
      "priority"      INTEGER NOT NULL DEFAULT 0,

      "paused"        BOOLEAN NOT NULL DEFAULT false,
      "startAt"       TIMESTAMPTZ,
      "endAt"         TIMESTAMPTZ,

      -- ALLOW: start regardless. SKIP: do not start while the last run is live.
      "overlapPolicy" TEXT NOT NULL DEFAULT 'ALLOW',
      -- SKIP: drop missed firings. FIRE_ONE: one catch-up run. FIRE_ALL: every
      -- missed occurrence, bounded so a long outage cannot produce thousands.
      "catchupPolicy" TEXT NOT NULL DEFAULT 'FIRE_ONE',

      "nextRunAt"     TIMESTAMPTZ,
      "lastRunAt"     TIMESTAMPTZ,
      "lastWorkflowId" UUID,
      "runCount"      BIGINT NOT NULL DEFAULT 0,
      "lastError"     TEXT,

      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`
    CREATE UNIQUE INDEX "Schedules_name_key" ON "Schedules" ("namespaceId", "name");
  `);

  // The poller's only query. Partial, because a paused or finished schedule is
  // never due and would otherwise sit in the index forever.
  await run(`
    CREATE INDEX "Schedules_due_idx" ON "Schedules" ("nextRunAt")
      WHERE NOT "paused" AND "nextRunAt" IS NOT NULL;
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "Schedules" CASCADE`).execute(db);
}

export const schedules = { name: '0010-schedules', up, down };
