import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Wakes a live execution stream the instant an event is appended.
 *
 * The notification is raised by a **trigger**, not by the application. That is
 * the whole point of the design rather than an implementation detail: this
 * codebase has now silently disabled three separate features because a call
 * site forgot to pass something, and each was invisible to every unit test. A
 * `NOTIFY` that every writer must remember to issue is the same shape of bug
 * waiting to happen — and its symptom would be the worst kind, a dashboard that
 * works during development and goes quiet under whichever code path was
 * forgotten. A trigger cannot be forgotten. The decider, the timeout sweeper, an
 * operator action and a migration backfill all raise it identically.
 *
 * `NOTIFY` fires at **commit**, so a listener is never woken for an event that
 * later rolls back — which a notify issued from application code after a commit
 * could not promise, since the process may die in between.
 *
 * The payload is `workflowId:seq` and nothing else. Two reasons, both binding:
 * Postgres caps a notification at 8000 bytes and task payloads are unbounded,
 * so carrying the event itself would fail on exactly the large payloads most
 * worth watching; and a listener that must read the row anyway can read *every*
 * row it has missed, which is what makes a dropped notification self-healing
 * rather than a permanent gap.
 *
 * One channel for the whole cluster, routed in process — the same reasoning as
 * `QueueNotifier`: channel names are global, and a `LISTEN` per watched
 * execution would mean thousands of them per replica.
 */

const CHANNEL = 'node_flow_workflow_events';

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  // `pg_notify(text, text)` rather than the `NOTIFY` statement: the statement
  // takes a literal channel name and cannot be written against a computed one,
  // and the function form is what allows the payload to be built from the row.
  await run(`
    CREATE OR REPLACE FUNCTION "nodeFlowNotifyWorkflowEvent"() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('${CHANNEL}', NEW."workflowId"::text || ':' || NEW."seq"::text);
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // AFTER INSERT, FOR EACH ROW, on the partitioned parent — Postgres propagates
  // a row trigger declared here to every partition, including ones created
  // later by the partition roller. Declaring it per-partition instead would
  // work until the next month rolled over and then stop, silently.
  //
  // The trigger returns NULL because an AFTER trigger's return value is
  // ignored; it exists to do the notify, not to alter the row.
  await run(`
    CREATE TRIGGER "WorkflowEvents_notify"
      AFTER INSERT ON "WorkflowEvents"
      FOR EACH ROW
      EXECUTE FUNCTION "nodeFlowNotifyWorkflowEvent"();
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TRIGGER IF EXISTS "WorkflowEvents_notify" ON "WorkflowEvents"`).execute(db);
  await sql.raw(`DROP FUNCTION IF EXISTS "nodeFlowNotifyWorkflowEvent"()`).execute(db);
}

export const workflowEventNotify = { name: '0018-workflow-event-notify', up, down };
