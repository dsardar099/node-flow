import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import { coreSchema } from './migrations/0001-core-schema.js';
import { payloadRefs } from './migrations/0002-payload-refs.js';
import { identity } from './migrations/0003-identity.js';
import { searchIndexes } from './migrations/0004-search-indexes.js';
import { users } from './migrations/0005-users.js';
import { taskDomain } from './migrations/0006-task-domain.js';
import { systemTasks } from './migrations/0007-system-tasks.js';
import { webhookCallbacks } from './migrations/0008-webhook-callbacks.js';
import { humanTasks } from './migrations/0009-human-tasks.js';
import { schedules } from './migrations/0010-schedules.js';
import { eventHandlers } from './migrations/0011-event-handlers.js';
import { secrets } from './migrations/0012-secrets.js';
import { groups } from './migrations/0013-groups.js';
import { audit } from './migrations/0014-audit.js';
import { secretOutputFields } from './migrations/0015-secret-output-fields.js';
import { workloadIdentity } from './migrations/0016-workload-identity.js';
import { resourceTags } from './migrations/0017-resource-tags.js';
import { workflowEventNotify } from './migrations/0018-workflow-event-notify.js';
import { taskLogs } from './migrations/0019-task-logs.js';
import { workerPolls } from './migrations/0020-worker-polls.js';
import { environmentVariables } from './migrations/0021-environment-variables.js';
import { schemas } from './migrations/0022-schemas.js';
import { formTemplates } from './migrations/0023-form-templates.js';
import { humanTaskAssignments } from './migrations/0024-human-task-assignments.js';
import { taskOutputCache } from './migrations/0025-task-output-cache.js';
import { workflowRateLimits } from './migrations/0026-workflow-rate-limits.js';
import { eventExecutions } from './migrations/0027-event-executions.js';
import { incomingWebhooks } from './migrations/0028-incoming-webhooks.js';
import { workflowMessages } from './migrations/0029-workflow-messages.js';
import { humanTaskTriggers } from './migrations/0030-human-task-triggers.js';
import { statusListeners } from './migrations/0031-status-listeners.js';
import { scheduleRuns } from './migrations/0032-schedule-runs.js';
import { executionSearch } from './migrations/0033-execution-search.js';
import { taskToDomain } from './migrations/0034-task-to-domain.js';
import { resourceGrants } from './migrations/0035-resource-grants.js';
import { ai } from './migrations/0036-ai.js';
import { traceContext } from './migrations/0037-trace-context.js';
import type { Database } from './schema.js';

/**
 * Database connection and migrations.
 *
 * Kysely rather than an ORM, deliberately. In this system SQL *is* the design:
 * `FOR UPDATE SKIP LOCKED` inside a CTE, `ON CONFLICT DO NOTHING` as the
 * idempotency guarantee, partition pruning. An ORM cannot express any of that,
 * so it would only ever abstract the easy tenth while adding a second way to do
 * everything. Kysely type-checks the SQL we were already writing by hand.
 *
 * Note there is **no `CamelCasePlugin`**: our columns are genuinely camelCase in
 * the database, not snake_case being translated. The plugin would rewrite
 * `queueName` to `queue_name` and every query would fail.
 */

export type Db = Kysely<Database>;
export type DbTransaction = Transaction<Database>;
/** Accepts either the pool or an open transaction, so repositories compose. */
export type Queryable = Db | DbTransaction;

export interface DatabaseConfig {
  url: string;
  /** Pool ceiling. Deciders hold a connection per in-flight evaluation. */
  maxConnections?: number;
  log?: boolean;
  /** Where to report a pooled connection the server took away. */
  onConnectionError?: (error: Error) => void;
}

/**
 * Creates the connection pool — always with an `error` listener.
 *
 * `pg` reports a failure on an *idle* pooled connection by emitting `error` on
 * the pool. Node throws when an `error` event has no listener, and this one is
 * raised from a socket callback, so the throw is an uncaught exception: the
 * process exits. The triggers are ordinary — a Postgres restart, a failover, an
 * `idle_session_timeout`, a network blip — and for most of this project's life
 * none of them was handled. It was found through a shutdown race in a test,
 * then reproduced by terminating an idle backend.
 *
 * The pool has already discarded the dead client by the time this fires, and
 * the next query opens a fresh one, so there is nothing to recover — only
 * something to report. It is reported, never silently dropped: a steady stream
 * of these is how a flapping database shows up.
 */
export function createPool(
  config: DatabaseConfig,
  onError: (error: Error) => void = config.onConnectionError ?? reportPoolError
): Pool {
  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConnections ?? 20,
    // Fail fast rather than queueing forever behind an exhausted pool: a stuck
    // decider should surface as an error, not as unexplained latency.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });

  pool.on('error', onError);
  return pool;
}

/** The default report, for callers without a logger of their own. */
function reportPoolError(error: Error): void {
  process.stderr.write(`[node-flow] database connection lost while idle: ${error.message}\n`);
}

export function createDatabase(config: DatabaseConfig, pool = createPool(config)): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: config.log ? ['query', 'error'] : ['error'],
  });
}

/**
 * Migrations, in order.
 *
 * Kept as raw SQL rather than a builder: partitioning, partial indexes,
 * `uuidv7()` defaults and per-table autovacuum tuning have no query-builder
 * expression, and DDL is exactly where being explicit pays.
 */
const MIGRATIONS = [
  coreSchema,
  payloadRefs,
  identity,
  searchIndexes,
  users,
  taskDomain,
  systemTasks,
  webhookCallbacks,
  humanTasks,
  schedules,
  eventHandlers,
  secrets,
  groups,
  audit,
  secretOutputFields,
  workloadIdentity,
  resourceTags,
  workflowEventNotify,
  taskLogs,
  workerPolls,
  environmentVariables,
  schemas,
  formTemplates,
  humanTaskAssignments,
  taskOutputCache,
  workflowRateLimits,
  eventExecutions,
  incomingWebhooks,
  workflowMessages,
  humanTaskTriggers,
  statusListeners,
  scheduleRuns,
  executionSearch,
  taskToDomain,
  resourceGrants,
  ai,
  traceContext,
];

/**
 * Cheapest possible round trip to the database.
 *
 * Exists so callers outside this package — the health endpoint, chiefly — can
 * check connectivity without importing `kysely` and writing raw SQL. Raw SQL
 * staying inside `store/` is a standing rule, and a health check is exactly the
 * sort of small exception that erodes it.
 */
export async function ping(db: Db): Promise<void> {
  await sql`SELECT 1`.execute(db);
}

/** Applies pending migrations. Returns the names that ran. */
export async function migrate(db: Db): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS "Migrations" (
      "name"      TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  const applied = new Set(
    (await db.selectFrom('Migrations').select('name').execute()).map((r) => r.name)
  );

  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    // Each migration is atomic: DDL is transactional in Postgres, so a failure
    // part-way leaves no half-created schema behind.
    await db.transaction().execute(async (tx) => {
      await migration.up(tx);
      await tx.insertInto('Migrations').values({ name: migration.name }).execute();
    });

    ran.push(migration.name);
  }

  return ran;
}

/**
 * Migrations this build ships that the database has not applied.
 *
 * Exists for the health endpoint, for the same reason `ping` does: the caller
 * needs a fact about the schema and raw SQL does not leave this package. The
 * answer is a list rather than a count because "which one is missing" is the
 * first thing an operator asks, and comparing two counts cannot tell you when a
 * database is *ahead* of the binary — a replica left running through a rollback,
 * which reads as healthy on any count-based check.
 */
export async function pendingMigrations(db: Db): Promise<string[]> {
  const applied = new Set(
    (await db.selectFrom('Migrations').select('name').execute()).map((r) => r.name)
  );
  return MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name);
}

/** Rolls back every migration, newest first. Test teardown only. */
export async function rollbackAll(db: Db): Promise<void> {
  for (const migration of [...MIGRATIONS].reverse()) {
    await db.transaction().execute(async (tx) => {
      await migration.down(tx);
      await tx.deleteFrom('Migrations').where('name', '=', migration.name).execute();
    });
  }
}

/**
 * Verifies the database provides what the schema assumes.
 *
 * Checked at startup rather than discovered on first insert. `uuidv7()` is
 * Postgres 18+, and the data model depends on time-ordered primary keys for
 * index locality.
 */
export async function assertDatabaseCapabilities(db: Db): Promise<void> {
  const result = await sql<{ version: string }>`
    SELECT current_setting('server_version_num') AS version
  `.execute(db);

  const versionNum = Number(result.rows[0]?.version ?? 0);
  if (versionNum < 180000) {
    throw new Error(
      `node-flow requires PostgreSQL 18 or newer for uuidv7() and async I/O; found server_version_num=${versionNum}`
    );
  }

  await sql`SELECT uuidv7()`.execute(db);
}

/** Re-exported so callers need not depend on kysely directly for raw fragments. */
export { sql };
