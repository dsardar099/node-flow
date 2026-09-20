import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * The W3C trace context a run was started with.
 *
 * A workflow is the one place in this system where a trace has to survive a gap
 * that nothing else spans: the request that starts a run finishes in
 * milliseconds, and the work it asked for happens later, in another process,
 * possibly on another machine, sometimes days afterwards. Nothing in-memory
 * bridges that — the context has to be written down with the execution.
 *
 * Stored as the raw `traceparent` header rather than parsed into columns: it is
 * an opaque, versioned string that the W3C spec tells implementations to pass
 * through unchanged, and splitting it into trace and span ids would mean
 * reassembling it — including its flags — every time it is used.
 *
 * Nullable, because most runs do not come from a traced request: a schedule
 * firing, an event handler, a CLI call. A null here means "no parent", not
 * "lost", and the decider starts a fresh trace for those.
 */
async function up(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(`ALTER TABLE "WorkflowExecutions" ADD COLUMN IF NOT EXISTS "traceparent" TEXT`)
    .execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "WorkflowExecutions" DROP COLUMN IF EXISTS "traceparent"`).execute(db);
}

export const traceContext = { name: '0037-trace-context', up, down };
