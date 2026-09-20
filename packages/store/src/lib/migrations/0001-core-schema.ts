import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Core schema.
 *
 * Written as raw SQL rather than through Sequelize's DDL builder, because none
 * of what makes this schema work is expressible in an ORM: declarative
 * partitioning, partial indexes, `uuidv7()` column defaults, and per-table
 * autovacuum tuning.
 *
 * **Every identifier is double-quoted.** PostgreSQL folds unquoted identifiers
 * to lowercase, so `TaskQueues` silently becomes `taskqueues` and camelCase
 * columns stop matching what Sequelize looks for. This is the single easiest
 * way to break this codebase.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Namespaces" (
      "id"        UUID PRIMARY KEY DEFAULT uuidv7(),
      "slug"      TEXT NOT NULL UNIQUE,
      "settings"  JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Definitions are immutable per (name, version). That immutability is what
  // lets the blueprint cache key on those two columns and never invalidate.
  await run(`
    CREATE TABLE "WorkflowDefinitions" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "version"     INTEGER NOT NULL,
      "definition"  JSONB NOT NULL,
      "blueprint"   JSONB NOT NULL,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "createdBy"   TEXT,
      PRIMARY KEY ("namespaceId", "name", "version")
    );
  `);

  await run(`
    CREATE TABLE "TaskDefinitions" (
      "namespaceId"               UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"                      TEXT NOT NULL,
      "description"               TEXT,
      "retryCount"                INTEGER NOT NULL DEFAULT 3,
      "retryLogic"                TEXT NOT NULL DEFAULT 'EXPONENTIAL_BACKOFF',
      "retryDelaySeconds"         DOUBLE PRECISION NOT NULL DEFAULT 1,
      "backoffScaleFactor"        DOUBLE PRECISION NOT NULL DEFAULT 2,
      "maxRetryDelaySeconds"      DOUBLE PRECISION NOT NULL DEFAULT 3600,
      "jitter"                    DOUBLE PRECISION NOT NULL DEFAULT 0.2,
      "retryBudget"               DOUBLE PRECISION NOT NULL DEFAULT 0.3,
      "nonRetryableErrors"        JSONB NOT NULL DEFAULT '[]'::jsonb,
      "timeoutSeconds"            DOUBLE PRECISION NOT NULL DEFAULT 0,
      "scheduleToStartTimeout"    DOUBLE PRECISION NOT NULL DEFAULT 0,
      "startToCloseTimeout"       DOUBLE PRECISION NOT NULL DEFAULT 0,
      "heartbeatTimeout"          DOUBLE PRECISION NOT NULL DEFAULT 0,
      "responseTimeoutSeconds"    DOUBLE PRECISION NOT NULL DEFAULT 3600,
      "pollTimeoutSeconds"        DOUBLE PRECISION NOT NULL DEFAULT 30,
      "timeoutPolicy"             TEXT NOT NULL DEFAULT 'TIME_OUT_WF',
      "concurrentExecLimit"       INTEGER NOT NULL DEFAULT 0,
      "rateLimitPerFrequency"     INTEGER NOT NULL DEFAULT 0,
      "rateLimitFrequencySeconds" INTEGER NOT NULL DEFAULT 1,
      "semaphores"                JSONB NOT NULL DEFAULT '[]'::jsonb,
      "inputKeys"                 JSONB NOT NULL DEFAULT '[]'::jsonb,
      "outputKeys"                JSONB NOT NULL DEFAULT '[]'::jsonb,
      "inputSchema"               JSONB,
      "outputSchema"              JSONB,
      "ownerEmail"                TEXT,
      "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "name")
    );
  `);

  // Range-partitioned monthly. Old executions are dropped a partition at a
  // time, which is near-instant, instead of a DELETE that has to be vacuumed.
  await run(`
    CREATE TABLE "WorkflowExecutions" (
      "id"                    UUID NOT NULL DEFAULT uuidv7(),
      "namespaceId"           UUID NOT NULL,
      "defName"               TEXT NOT NULL,
      "defVersion"            INTEGER NOT NULL,
      "status"                TEXT NOT NULL,
      "correlationId"         TEXT,
      "idempotencyKey"        TEXT,
      "priority"              SMALLINT NOT NULL DEFAULT 0,
      "input"                 JSONB,
      "inputRef"              TEXT,
      "output"                JSONB,
      "outputRef"             TEXT,
      "variables"             JSONB NOT NULL DEFAULT '{}'::jsonb,
      "parentWorkflowId"      UUID,
      "parentTaskId"          UUID,
      "reasonForIncompletion" TEXT,
      "startedAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
      "endedAt"               TIMESTAMPTZ,
      -- Watermark for "which tasks finished since the last decider pass".
      -- Comparing task endedAt against this is what keeps an evaluation
      -- proportional to what changed rather than to workflow history. Compared
      -- with >= rather than >, so a task ending exactly on the boundary is seen
      -- twice rather than missed: a duplicate is absorbed by the task identity
      -- constraint, a miss strands the workflow.
      "version"               BIGINT NOT NULL DEFAULT 1,
      PRIMARY KEY ("id", "startedAt")
    ) PARTITION BY RANGE ("startedAt");
  `);

  await run(`
    CREATE INDEX "WorkflowExecutions_ns_status_idx"
      ON "WorkflowExecutions" ("namespaceId", "status", "startedAt" DESC);
  `);
  await run(`
    CREATE INDEX "WorkflowExecutions_correlation_idx"
      ON "WorkflowExecutions" ("namespaceId", "correlationId")
      WHERE "correlationId" IS NOT NULL;
  `);
  await run(`
    CREATE INDEX "WorkflowExecutions_idempotency_idx"
      ON "WorkflowExecutions" ("namespaceId", "idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL;
  `);

  // Idempotent starts live in their own unpartitioned table, and the reason is
  // subtle enough to be worth stating plainly:
  //
  // A unique index on a partitioned table must include every partition-key
  // column. "WorkflowExecutions" is partitioned on "startedAt", which defaults
  // to now() — so a unique index over ("namespaceId","idempotencyKey","startedAt")
  // is unique on a value that differs on every insert and therefore never
  // conflicts. It looks like a working idempotency guarantee and silently
  // creates duplicate executions instead.
  //
  // This table is not partitioned, so its constraint actually constrains.
  await run(`
    CREATE TABLE "IdempotencyKeys" (
      "namespaceId" UUID NOT NULL,
      "key"         TEXT NOT NULL,
      "workflowId"  UUID NOT NULL,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "key")
    );
  `);

  // Hash-partitioned by workflow so one workflow's tasks stay co-located and
  // the frontier query touches a single partition.
  await run(`
    CREATE TABLE "TaskExecutions" (
      "id"                    UUID NOT NULL DEFAULT uuidv7(),
      "workflowId"            UUID NOT NULL,
      "namespaceId"           UUID NOT NULL,
      "refName"               TEXT NOT NULL,
      "taskDefName"           TEXT NOT NULL,
      "taskType"              TEXT NOT NULL,
      "status"                TEXT NOT NULL,
      "attempt"               INTEGER NOT NULL DEFAULT 0,
      "iteration"             INTEGER NOT NULL DEFAULT 0,
      "parentRefName"         TEXT,
      "input"                 JSONB,
      "inputRef"              TEXT,
      "output"                JSONB,
      "outputRef"             TEXT,
      "reasonForIncompletion" TEXT,
      "workerId"              TEXT,
      "leaseToken"            UUID,
      -- Set when the decider has reacted to this task reaching a terminal
      -- state. Replaces a time-based watermark, which is unsound here: a task
      -- whose transaction begins before an evaluation but commits after its
      -- SELECT gets a timestamp below the new watermark and is never seen
      -- again, stalling the workflow permanently. Explicit per-task
      -- bookkeeping has no clock in it and cannot lose a completion.
      "deciderSeenAt"         TIMESTAMPTZ,
      "scheduledAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
      "startedAt"             TIMESTAMPTZ,
      "endedAt"               TIMESTAMPTZ,
      PRIMARY KEY ("workflowId", "id")
    ) PARTITION BY HASH ("workflowId");
  `);

  for (let i = 0; i < 16; i++) {
    await run(`
      CREATE TABLE "TaskExecutions_p${i}" PARTITION OF "TaskExecutions"
        FOR VALUES WITH (MODULUS 16, REMAINDER ${i});
    `);
  }

  // Task identity. This constraint is what makes the decider safe to re-run:
  // a duplicate evaluation cannot schedule the same task twice.
  //
  // `attempt` is part of the identity, not incidental to it. Without it a retry
  // writes at the same slot as the failed attempt it supersedes, ON CONFLICT DO
  // NOTHING absorbs it, and the retry silently never runs — while the decider
  // reports that it scheduled one. Including it also preserves the full attempt
  // history, which is what makes a flaky task diagnosable after the fact.
  await run(`
    CREATE UNIQUE INDEX "TaskExecutions_identity_idx"
      ON "TaskExecutions" ("workflowId", "refName", "iteration", "attempt");
  `);

  // Terminal tasks the decider has not yet reacted to. Partial, so it holds
  // only the handful awaiting processing rather than all history.
  await run(`
    CREATE INDEX "TaskExecutions_unprocessed_idx"
      ON "TaskExecutions" ("workflowId")
      WHERE "endedAt" IS NOT NULL AND "deciderSeenAt" IS NULL;
  `);

  // Supports the retry-budget check: recent attempts for one task definition.
  // Without it, every retry decision would sequentially scan task history.
  await run(`
    CREATE INDEX "TaskExecutions_recent_by_def_idx"
      ON "TaskExecutions" ("namespaceId", "taskDefName", "scheduledAt" DESC);
  `);

  // The pending frontier. Partial, so its size tracks in-flight work rather
  // than total history — the index stays small however long a workflow lives.
  await run(`
    CREATE INDEX "TaskExecutions_frontier_idx"
      ON "TaskExecutions" ("workflowId")
      WHERE "status" NOT IN
        ('COMPLETED','FAILED','FAILED_WITH_TERMINAL_ERROR','TIMED_OUT','CANCELED','SKIPPED','COMPLETED_WITH_ERRORS');
  `);

  await run(`
    CREATE TABLE "TaskQueues" (
      "id"             BIGSERIAL,
      "namespaceId"    UUID NOT NULL,
      "queueName"      TEXT NOT NULL,
      "taskId"         UUID NOT NULL,
      "workflowId"     UUID NOT NULL,
      "priority"       SMALLINT NOT NULL DEFAULT 0,
      "visibleAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      "leaseExpiresAt" TIMESTAMPTZ,
      "leaseToken"     UUID,
      "workerId"       TEXT,
      "enqueuedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("queueName", "id")
    ) PARTITION BY HASH ("queueName");
  `);

  for (let i = 0; i < 8; i++) {
    await run(`
      CREATE TABLE "TaskQueues_p${i}" PARTITION OF "TaskQueues"
        FOR VALUES WITH (MODULUS 8, REMAINDER ${i});
    `);
  }

  // The dequeue path. Partial on unleased rows so leased work leaves the index
  // entirely rather than being scanned past on every poll.
  await run(`
    CREATE INDEX "TaskQueues_dequeue_idx"
      ON "TaskQueues" ("queueName", "priority" DESC, "id")
      WHERE "leaseExpiresAt" IS NULL;
  `);
  // Drives the lease-expiry sweeper.
  await run(`
    CREATE INDEX "TaskQueues_lease_idx"
      ON "TaskQueues" ("leaseExpiresAt")
      WHERE "leaseExpiresAt" IS NOT NULL;
  `);
  // PostgreSQL requires a unique index on a partitioned table to include every
  // partition-key column, so this is ("queueName", "taskId") rather than
  // ("taskId") alone. No looseness results: a task belongs to exactly one queue,
  // so the pair is unique wherever the id is.
  //
  // The consequence is an API one: every lookup by task must also carry its
  // queue name, or it degenerates into a scan across all eight partitions.
  await run(`
    CREATE UNIQUE INDEX "TaskQueues_task_idx" ON "TaskQueues" ("queueName", "taskId");
  `);

  // The queue is the highest-churn table in the system. Stock autovacuum
  // settings let dead tuples accumulate faster than they are reclaimed, and
  // dequeue latency degrades steadily until someone notices.
  for (let i = 0; i < 8; i++) {
    await run(`
      ALTER TABLE "TaskQueues_p${i}" SET (
        autovacuum_vacuum_scale_factor = 0.01,
        autovacuum_vacuum_cost_limit = 2000,
        fillfactor = 70
      );
    `);
  }

  // One row per workflow awaiting evaluation. The primary key *is* the dedupe:
  // many completions collapse into a single pending evaluation.
  await run(`
    CREATE TABLE "DecideQueues" (
      "workflowId" UUID PRIMARY KEY,
      "namespaceId" UUID NOT NULL,
      "enqueuedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "reason"     TEXT
    );
  `);
  await run(`
    CREATE INDEX "DecideQueues_enqueued_idx" ON "DecideQueues" ("enqueuedAt");
  `);
  await run(`
    ALTER TABLE "DecideQueues" SET (
      autovacuum_vacuum_scale_factor = 0.01,
      autovacuum_vacuum_cost_limit = 2000,
      fillfactor = 70
    );
  `);

  await run(`
    CREATE TABLE "Timers" (
      "id"         UUID NOT NULL DEFAULT uuidv7(),
      "fireAt"     TIMESTAMPTZ NOT NULL,
      "kind"       TEXT NOT NULL,
      "namespaceId" UUID NOT NULL,
      "workflowId" UUID NOT NULL,
      "taskId"     UUID,
      "payload"    JSONB NOT NULL DEFAULT '{}'::jsonb,
      "claimedAt"  TIMESTAMPTZ,
      PRIMARY KEY ("fireAt", "id")
    ) PARTITION BY RANGE ("fireAt");
  `);
  await run(`
    CREATE INDEX "Timers_due_idx" ON "Timers" ("fireAt") WHERE "claimedAt" IS NULL;
  `);

  // Transactional outbox: written in the same transaction as the state change
  // it describes, published afterwards. Nothing leaves the process until the
  // transaction that justified it has committed.
  await run(`
    CREATE TABLE "OutboxEvents" (
      "id"             BIGSERIAL PRIMARY KEY,
      "namespaceId"    UUID NOT NULL,
      "topic"          TEXT NOT NULL,
      "payload"        JSONB NOT NULL,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      "publishedAt"    TIMESTAMPTZ,
      -- Delivery bookkeeping. An event that cannot be delivered must not be
      -- silently discarded: the relay is what starts sub-workflows, so a
      -- dropped event leaves a parent workflow waiting forever with no trace.
      -- It also must not be retried unboundedly, or one poison row is
      -- reprocessed on every pass. Both are handled by backing off and, past a
      -- limit, moving it to the dead letter where it stays inspectable.
      "attempts"       INTEGER NOT NULL DEFAULT 0,
      "nextAttemptAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
      "lastError"      TEXT,
      "deadLetteredAt" TIMESTAMPTZ
    );
  `);
  // The relay's hot path: deliverable events only. Dead-lettered and published
  // rows leave the index entirely rather than being scanned past every pass.
  await run(`
    CREATE INDEX "OutboxEvents_deliverable_idx"
      ON "OutboxEvents" ("nextAttemptAt", "id")
      WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL;
  `);
  await run(`
    CREATE INDEX "OutboxEvents_deadletter_idx"
      ON "OutboxEvents" ("deadLetteredAt") WHERE "deadLetteredAt" IS NOT NULL;
  `);

  await run(`
    CREATE TABLE "WorkflowEvents" (
      "id"         BIGSERIAL,
      "workflowId" UUID NOT NULL,
      "seq"        INTEGER NOT NULL,
      "type"       TEXT NOT NULL,
      "payload"    JSONB NOT NULL DEFAULT '{}'::jsonb,
      "at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("at", "id")
    ) PARTITION BY RANGE ("at");
  `);
  await run(`
    CREATE INDEX "WorkflowEvents_workflow_idx" ON "WorkflowEvents" ("workflowId", "seq");
  `);

  // Token buckets for per-task-definition rate limits.
  //
  // A separate table rather than counting queue rows, because those are deleted
  // on acknowledgement — the history a rate limit needs is exactly what the
  // queue throws away. One row per (queue, window); old windows are pruned.
  await run(`
    CREATE TABLE "RateLimitBuckets" (
      "namespaceId" UUID NOT NULL,
      "queueName"   TEXT NOT NULL,
      "windowStart" TIMESTAMPTZ NOT NULL,
      "count"       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("namespaceId", "queueName", "windowStart")
    );
  `);
  await run(`
    CREATE INDEX "RateLimitBuckets_window_idx" ON "RateLimitBuckets" ("windowStart");
  `);
  await run(`
    ALTER TABLE "RateLimitBuckets" SET (
      autovacuum_vacuum_scale_factor = 0.02,
      fillfactor = 70
    );
  `);

  // Named semaphores: concurrency limits spanning unrelated tasks, which a
  // per-task-definition limit cannot express.
  await run(`
    CREATE TABLE "Semaphores" (
      "namespaceId"    UUID NOT NULL,
      "name"           TEXT NOT NULL,
      "permits"        INTEGER NOT NULL,
      PRIMARY KEY ("namespaceId", "name")
    );
  `);
  await run(`
    CREATE TABLE "SemaphoreHolders" (
      "namespaceId"    UUID NOT NULL,
      "name"           TEXT NOT NULL,
      "taskId"         UUID NOT NULL,
      "workflowId"     UUID NOT NULL,
      "acquiredAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      "leaseExpiresAt" TIMESTAMPTZ NOT NULL,
      PRIMARY KEY ("namespaceId", "name", "taskId")
    );
  `);
  // Counting current holders is the hot path of every acquire.
  await run(`
    CREATE INDEX "SemaphoreHolders_holders_idx"
      ON "SemaphoreHolders" ("namespaceId", "name");
  `);
  // Drives expiry of permits leaked by a crashed holder.
  await run(`
    CREATE INDEX "SemaphoreHolders_expiry_idx" ON "SemaphoreHolders" ("leaseExpiresAt");
  `);

  // A range-partitioned table rejects any row with no matching partition, so a
  // DEFAULT partition on each is the difference between "works out of the box"
  // and "every insert fails until an operator runs a partition job".
  //
  // DEFAULT is a safety net, not the plan: rows landing here cannot be dropped
  // by detaching a partition, and attaching a new partition must scan it. The
  // scheduled roller below keeps proper time-bounded partitions ahead of now,
  // and the default should stay empty in a healthy system.
  await run(`
    CREATE TABLE "WorkflowExecutions_default" PARTITION OF "WorkflowExecutions" DEFAULT;
  `);
  await run(`CREATE TABLE "Timers_default" PARTITION OF "Timers" DEFAULT;`);
  await run(`CREATE TABLE "WorkflowEvents_default" PARTITION OF "WorkflowEvents" DEFAULT;`);

  // Seed the current period so a fresh database never writes to DEFAULT at all.
  //
  // Without this, every row from the first insert until the roller's first pass
  // lands in DEFAULT — and the roller then cannot create that period's
  // partition, because Postgres refuses to orphan rows that belong in it. The
  // manager can recover from that by relocating them, but a fresh install
  // should never need to.
  const now = new Date();
  const hour = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
  );
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const pad = (value: number) => String(value).padStart(2, '0');
  const monthSuffix = `${month.getUTCFullYear()}${pad(month.getUTCMonth() + 1)}`;
  const hourSuffix = `${monthSuffix}${pad(hour.getUTCDate())}${pad(hour.getUTCHours())}`;

  await ensureRangePartition(
    db,
    'Timers',
    hourSuffix,
    hour,
    new Date(hour.getTime() + 3_600_000)
  );
  for (const table of ['WorkflowExecutions', 'WorkflowEvents']) {
    await ensureRangePartition(
      db,
      table,
      monthSuffix,
      month,
      new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))
    );
  }
}

/**
 * Creates a time-bounded partition if it does not already exist.
 *
 * Called ahead of time by the partition roller so rows land in a real partition
 * rather than the DEFAULT one. Safe to call repeatedly.
 */
export async function ensureRangePartition(
  db: Kysely<Database>,
  table: string,
  suffix: string,
  from: Date,
  to: Date
): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE IF NOT EXISTS "${table}_${suffix}" PARTITION OF "${table}"
         FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`
    )
    .execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  for (const table of [
    'RateLimitBuckets',
    'IdempotencyKeys',
    'SemaphoreHolders',
    'Semaphores',
    'WorkflowEvents',
    'OutboxEvents',
    'Timers',
    'DecideQueues',
    'TaskQueues',
    'TaskExecutions',
    'WorkflowExecutions',
    'TaskDefinitions',
    'WorkflowDefinitions',
    'Namespaces',
  ]) {
    await sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`).execute(db);
  }
}

/** The core schema migration, in the shape the migrator expects. */
export const coreSchema = { name: '0001-core-schema', up, down };
