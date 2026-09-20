import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Inbound event handlers — the mirror of the outbox.
 *
 * The outbox is how a workflow tells the world something happened. This is how
 * the world tells a workflow: a message arrives on a broker and starts an
 * execution, or completes a task that was waiting for it.
 *
 * Deliberately a **row per handler** rather than configuration in a file. A
 * handler is an operational thing — enabled, disabled, edited when a topic is
 * renamed, inspected when "why didn't my workflow start?" is asked — and every
 * one of those is a database operation, not a redeploy.
 *
 * `lastError` and `eventCount` are on the row for the same reason they are on a
 * schedule: the first question is always "is it receiving anything?", and an
 * answer that lives only in server logs is not an answer.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "EventHandlers" (
      "id"            UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"   UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"          TEXT NOT NULL,
      "description"   TEXT,

      -- Which configured source, e.g. 'kafka:default'. Named by the operator
      -- for the same reason datasources are: a handler must not be able to
      -- point the server at a broker of its own choosing.
      "source"        TEXT NOT NULL,
      -- Topic, queue or subject within that source.
      "topic"         TEXT NOT NULL,

      -- Optional JavaScript predicate over the message. Sandboxed exactly like
      -- an INLINE task, because it is user-supplied code arriving through an API.
      "condition"     TEXT,

      -- START_WORKFLOW | COMPLETE_TASK | FAIL_TASK
      "action"        TEXT NOT NULL,

      "defName"       TEXT,
      "defVersion"    INTEGER,
      -- Expressions of the event.output form, resolved against the message.
      "inputTemplate" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "correlationId" TEXT,

      -- For the task actions: which execution and which task the message is about.
      "workflowIdExpr" TEXT,
      "taskRefExpr"    TEXT,

      "enabled"       BOOLEAN NOT NULL DEFAULT true,
      "eventCount"    BIGINT NOT NULL DEFAULT 0,
      "lastEventAt"   TIMESTAMPTZ,
      "lastError"     TEXT,

      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`
    CREATE UNIQUE INDEX "EventHandlers_name_key" ON "EventHandlers" ("namespaceId", "name");
  `);

  // The dispatch lookup: every enabled handler for one source and topic. Not
  // namespaced, because a message arrives before anyone knows whose it is —
  // the handler row is what assigns it to a namespace.
  await run(`
    CREATE INDEX "EventHandlers_dispatch_idx"
      ON "EventHandlers" ("source", "topic") WHERE "enabled";
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "EventHandlers" CASCADE`).execute(db);
}

export const eventHandlers = { name: '0011-event-handlers', up, down };
