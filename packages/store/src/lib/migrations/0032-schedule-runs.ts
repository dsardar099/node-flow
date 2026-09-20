import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Every firing of a schedule: what started, what was skipped because the last
 * run was still going, and what failed to start — with the occurrence it was
 * for, which after downtime is not the time it fired.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "ScheduleRuns" (
      "id"           BIGSERIAL PRIMARY KEY,
      "namespaceId"  UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "scheduleId"   UUID NOT NULL REFERENCES "Schedules"("id") ON DELETE CASCADE,
      "scheduledFor" TIMESTAMPTZ NOT NULL,
      "firedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      "outcome"      TEXT NOT NULL,
      "workflowId"   UUID,
      "reason"       TEXT
    );
  `);
  await run(`CREATE INDEX "ScheduleRuns_schedule_idx" ON "ScheduleRuns" ("scheduleId", "id" DESC);`);
  await run(`CREATE INDEX "ScheduleRuns_fired_idx" ON "ScheduleRuns" ("firedAt");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "ScheduleRuns"`).execute(db);
}

export const scheduleRuns = { name: '0032-schedule-runs', up, down };
