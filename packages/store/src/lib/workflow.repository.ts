import {
  ErrorCode,
  NodeFlowError,
  NON_TERMINAL_TASK_STATUSES,
  TaskStatus,
  WorkflowStatus,
  inlinePayload,
  isTaskSuccessful,
  type JsonValue,
  type TaskExecution,
  type TaskType,
  type WorkflowExecution,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';
import { WorkflowEventType } from './workflow-events.repository.js';
import type { PayloadStore } from './payload-store.js';
import { json, type TaskExecutionRow, type WorkflowExecutionRow } from './schema.js';
import type { StatusChange, StatusEvent } from './status-listener.repository.js';

/**
 * Workflow and task execution state.
 *
 * The queries here are shaped by the two rules the whole engine rests on:
 * serialise per workflow with a row lock rather than a lock service, and never
 * load more of a workflow than an evaluation actually needs.
 */

function toWorkflow(row: WorkflowExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    namespaceId: row.namespaceId,
    defName: row.defName,
    defVersion: row.defVersion,
    status: row.status,
    correlationId: row.correlationId ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    priority: row.priority,
    input: row.inputRef
      ? { kind: 'ref', ref: row.inputRef, sizeBytes: 0 }
      : inlinePayload((row.input as Record<string, JsonValue>) ?? {}),
    output: row.outputRef
      ? { kind: 'ref', ref: row.outputRef, sizeBytes: 0 }
      : row.output
        ? inlinePayload(row.output as Record<string, JsonValue>)
        : undefined,
    variables: (row.variables as Record<string, JsonValue>) ?? {},
    parentWorkflowId: row.parentWorkflowId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
    reasonForIncompletion: row.reasonForIncompletion ?? undefined,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    endedAt: row.endedAt ?? undefined,
    version: Number(row.version),
    rateLimitKey: row.rateLimitKey ?? undefined,
    taskToDomain: (row.taskToDomain as Record<string, string> | null) ?? undefined,
    awaitingAdmission: row.rateLimitKey != null && row.admittedAt == null,
  };
}

function toTask(row: TaskExecutionRow): TaskExecution {
  return {
    id: row.id,
    workflowId: row.workflowId,
    refName: row.refName,
    taskDefName: row.taskDefName,
    taskType: row.taskType,
    status: row.status,
    attempt: row.attempt,
    iteration: row.iteration,
    parentRefName: row.parentRefName ?? undefined,
    domain: row.domain ?? undefined,
    input: row.inputRef
      ? { kind: 'ref', ref: row.inputRef, sizeBytes: 0 }
      : inlinePayload((row.input as Record<string, JsonValue>) ?? {}),
    output: row.outputRef
      ? { kind: 'ref', ref: row.outputRef, sizeBytes: 0 }
      : row.output
        ? inlinePayload(row.output as Record<string, JsonValue>)
        : undefined,
    reasonForIncompletion: row.reasonForIncompletion ?? undefined,
    workerId: row.workerId ?? undefined,
    leaseToken: row.leaseToken ?? undefined,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

export type IdempotencyStrategy = 'RETURN_EXISTING' | 'FAIL' | 'FAIL_ON_RUNNING';

export interface StartWorkflowInput {
  namespaceId: string;
  defName: string;
  defVersion: number;
  /** Routes this run's worker tasks to domains: `{ "charge": "eu", "*": "canary" }`. */
  taskToDomain?: Record<string, string>;
  /**
   * The W3C `traceparent` of the request that asked for this run.
   *
   * Written down because a workflow outlives the request that started it —
   * often by days — so nothing in memory can carry the trace across to the
   * worker that eventually does the work.
   */
  traceparent?: string;
  input?: Record<string, JsonValue>;
  correlationId?: string;
  idempotencyKey?: string;
  /**
   * What a repeated key means. `RETURN_EXISTING` (the default) hands back the
   * execution that owns the key; `FAIL` refuses; `FAIL_ON_RUNNING` refuses only
   * while that execution is still live, and starts a new one once it finished.
   */
  idempotencyStrategy?: IdempotencyStrategy;
  /**
   * Per-key concurrency: with `limit` executions of this definition already
   * running under `key`, the new one is created waiting and admitted later.
   */
  rateLimit?: { key: string; limit: number };
  priority?: number;
  parentWorkflowId?: string;
  parentTaskId?: string;
  variables?: Record<string, JsonValue>;
}

export interface InsertTaskInput {
  workflowId: string;
  namespaceId: string;
  refName: string;
  taskDefName: string;
  taskType: TaskType;
  status: TaskStatus;
  attempt: number;
  iteration: number;
  parentRefName?: string;
  /** Worker pool, if the definition routes this task to one. */
  domain?: string;
  input: Record<string, JsonValue>;
  output?: Record<string, JsonValue>;
  /** Why, for a task inserted already-terminal. */
  reason?: string;
  /** Output cache slot to fill when this task succeeds. */
  cache?: { key: string; ttlSeconds: number };
  /**
   * The decider already continued through this task in the pass that created it —
   * an operator resolved in-pass. Left unseen, the next pass would react to its
   * completion again and re-run its successors' side effects.
   */
  seenByDecider?: boolean;
}

export class WorkflowRepository {
  /**
   * `payloads` is optional so the repository still works with everything
   * inline. When absent nothing is offloaded and no `*Ref` column is ever
   * written, which keeps single-node and test setups free of a second store to
   * keep consistent.
   */
  constructor(
    private readonly db: Db,
    private readonly payloads?: PayloadStore,
    /**
     * Finds the rate-limit bucket for a start that did not name one. Injected
     * rather than left to callers because there are five ways a workflow
     * starts, and a limit only four of them honour is not a limit.
     */
    private readonly rateLimits?: {
      rateLimitFor(
        namespaceId: string,
        defName: string,
        defVersion: number,
        input: Record<string, JsonValue> | undefined
      ): Promise<{ key: string; limit: number } | undefined>;
    }
,
    /**
     * Told about every status change, in the transaction that made it — the
     * source for status listeners. Called from here because an execution's
     * status changes in five places, and a feed that misses one is worse than
     * none.
     */
    private readonly statusChanges?: { onStatusChange(change: StatusChange, tx: Queryable): Promise<void> }
  ) {}

  /** Reports a status change made outside `setStatus`, such as an operator reopening a finished run. */
  async recordStatusChange(change: StatusChange, tx: Queryable): Promise<void> {
    await this.statusChanges?.onStatusChange(change, tx);
  }

  /**
   * Splits a payload into what goes in the row and what goes in blob storage.
   *
   * When offloaded the JSONB column holds `{}` rather than the value: `toTask`
   * and `toWorkflow` read the ref in preference, so the column is unused, and
   * leaving the original there would defeat the entire point.
   */
  private async split(
    value: Record<string, JsonValue> | undefined,
    resolveNamespace: () => Promise<string>
  ): Promise<{ value: Record<string, JsonValue> | null; ref: string | null }> {
    if (value === undefined) return { value: null, ref: null };
    if (!this.payloads || !this.payloads.exceedsThreshold(value)) {
      return { value, ref: null };
    }

    const result = await this.payloads.externalise(await resolveNamespace(), value);
    return result.ref ? { value: {}, ref: result.ref } : { value: result.inline ?? {}, ref: null };
  }

  /**
   * The namespace owning a workflow.
   *
   * `completeTask` and `setStatus` are addressed by workflow id alone, and
   * threading a namespace through every call site of both would touch a lot of
   * code to serve a branch that only runs for oversized payloads. Looked up
   * on demand instead — one indexed read on a path that is already about to
   * write megabytes.
   */
  private async namespaceOf(workflowId: string, tx?: Queryable): Promise<string> {
    const row = await (tx ?? this.db)
      .selectFrom('WorkflowExecutions')
      .select('namespaceId')
      .where('id', '=', workflowId)
      .executeTakeFirst();

    if (!row) throw new Error(`workflow ${workflowId} not found`);
    return row.namespaceId;
  }


  /** Creates an execution, or returns the existing one for a repeated idempotency key. */
  async start(input: StartWorkflowInput, tx?: Queryable): Promise<WorkflowExecution> {
    if (!input.rateLimit && this.rateLimits) {
      const rateLimit = await this.rateLimits.rateLimitFor(input.namespaceId, input.defName, input.defVersion, input.input);
      if (rateLimit) input = { ...input, rateLimit };
    }
    if (!input.idempotencyKey) {
      // The rate-limit check takes a transaction-scoped lock, so it needs one.
      if (input.rateLimit && !tx) return this.db.transaction().execute((t) => this.insertWorkflow(input, t));
      return this.insertWorkflow(input, tx ?? this.db);
    }

    const key = input.idempotencyKey;

    const run = async (t: DbTransaction): Promise<WorkflowExecution | undefined> => {
      // Claim the key first. The claim lives in the unpartitioned
      // `IdempotencyKeys` table rather than a unique index on
      // `WorkflowExecutions`: that table is partitioned on `startedAt`, a unique
      // index there must include it, and since it defaults to now() such an
      // index never conflicts — silently permitting the duplicate executions it
      // appears to prevent.
      const claimed = await t
        .insertInto('IdempotencyKeys')
        .values({ namespaceId: input.namespaceId, key, workflowId: sql<string>`uuidv7()` })
        .onConflict((oc) => oc.columns(['namespaceId', 'key']).doNothing())
        .returning('workflowId')
        .executeTakeFirst();

      // Lost the race. The winner's workflow is very likely still uncommitted,
      // so it cannot be read from *this* transaction at any isolation level —
      // reading it here is how a concurrent duplicate start fails outright
      // instead of deduplicating. Return nothing and look it up after this
      // transaction ends, by which point the winner has committed.
      if (!claimed) return undefined;

      // The claim reserved an id; create the execution with it so the two agree.
      return this.insertWorkflow(input, t, claimed.workflowId);
    };

    const created = tx ? await run(tx as DbTransaction) : await this.db.transaction().execute(run);
    if (created) return created;

    const existing = await this.awaitIdempotentWinner(input.namespaceId, key);
    const strategy = input.idempotencyStrategy ?? 'RETURN_EXISTING';
    if (strategy === 'RETURN_EXISTING') return existing;

    const live = existing.status === WorkflowStatus.RUNNING || existing.status === WorkflowStatus.PAUSED;
    if (strategy === 'FAIL' || live) {
      throw new NodeFlowError(
        ErrorCode.CONFLICT,
        strategy === 'FAIL'
          ? `idempotency key "${key}" was already used by execution ${existing.id}`
          : `idempotency key "${key}" belongs to execution ${existing.id}, which is still ${existing.status}`,
        { workflowId: existing.id, status: existing.status }
      );
    }

    // FAIL_ON_RUNNING, and the owner has finished: the key passes to a new run.
    // Conditional on the owner not having changed, so two callers arriving
    // together cannot both take it — the second finds a different owner, and
    // that one is running.
    const takeOver = async (t: DbTransaction): Promise<WorkflowExecution | undefined> => {
      const reassigned = await t
        .updateTable('IdempotencyKeys')
        .set({ workflowId: sql<string>`uuidv7()`, createdAt: sql<Date>`now()` })
        .where('namespaceId', '=', input.namespaceId)
        .where('key', '=', key)
        .where('workflowId', '=', existing.id)
        .returning('workflowId')
        .executeTakeFirst();
      return reassigned ? this.insertWorkflow(input, t, reassigned.workflowId) : undefined;
    };
    const restarted = tx ? await takeOver(tx as DbTransaction) : await this.db.transaction().execute(takeOver);
    if (restarted) return restarted;

    const winner = await this.awaitIdempotentWinner(input.namespaceId, key);
    throw new NodeFlowError(
      ErrorCode.CONFLICT,
      `idempotency key "${key}" was just taken by execution ${winner.id}`,
      { workflowId: winner.id, status: winner.status }
    );
  }

  /**
   * Resolves the workflow that won an idempotency race.
   *
   * The winner may not have committed at the moment we lost, so a single read
   * can legitimately find the claim row but not yet the execution it points at.
   * A brief bounded retry closes that window; failing outright would turn a
   * successful deduplication into an error for the caller who merely arrived
   * second.
   */
  private async awaitIdempotentWinner(
    namespaceId: string,
    key: string,
    attempts = 20
  ): Promise<WorkflowExecution> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const owner = await this.db
        .selectFrom('IdempotencyKeys')
        .select('workflowId')
        .where('namespaceId', '=', namespaceId)
        .where('key', '=', key)
        .executeTakeFirst();

      if (owner) {
        const existing = await this.findById(owner.workflowId);
        if (existing) return existing;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(
      `idempotency key "${key}" was claimed but its workflow never became visible`
    );
  }

  private async insertWorkflow(
    input: StartWorkflowInput,
    executor: Queryable,
    id?: string
  ): Promise<WorkflowExecution> {
    const wfInput = await this.split(input.input ?? {}, async () => input.namespaceId);

    // Admitted now if the key has room and nobody is already waiting on it;
    // otherwise created waiting, in arrival order. Serialised per key so two
    // simultaneous starts cannot both take the last free slot.
    let admitted = true;
    if (input.rateLimit) {
      const { key, limit } = input.rateLimit;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`rate:${input.namespaceId}:${input.defName}:${key}`}))`.execute(
        executor
      );
      const counts = await sql<{ active: string; waiting: string }>`
        SELECT count(*) FILTER (WHERE "admittedAt" IS NOT NULL) AS active,
               count(*) FILTER (WHERE "admittedAt" IS NULL AND status = 'RUNNING') AS waiting
        FROM "WorkflowExecutions"
        WHERE "namespaceId" = ${input.namespaceId} AND "defName" = ${input.defName}
          AND "rateLimitKey" = ${key} AND status IN ('RUNNING', 'PAUSED')
      `.execute(executor);
      const row = counts.rows[0];
      admitted = Number(row?.waiting ?? 0) === 0 && Number(row?.active ?? 0) < limit;
    }

    const row = await executor
      .insertInto('WorkflowExecutions')
      .values({
        ...(id ? { id } : {}),
        namespaceId: input.namespaceId,
        defName: input.defName,
        defVersion: input.defVersion,
        status: WorkflowStatus.RUNNING,
        correlationId: input.correlationId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        priority: input.priority ?? 0,
        input: json(wfInput.value ?? {}),
        inputRef: wfInput.ref,
        variables: json(input.variables ?? {}),
        parentWorkflowId: input.parentWorkflowId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        taskToDomain: input.taskToDomain && Object.keys(input.taskToDomain).length ? json(input.taskToDomain) : null,
        traceparent: input.traceparent ?? null,
        rateLimitKey: input.rateLimit?.key ?? null,
        rateLimit: input.rateLimit?.limit ?? null,
        admittedAt: admitted ? sql<Date>`now()` : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // The first entry in every execution's history.
    //
    // Written here rather than by the caller because there are four ways a
    // workflow starts — the API, the cron scheduler, an event handler and a
    // parent's `SUB_WORKFLOW` — and an event only three of them remember to
    // append is worse than no event at all: the history would be complete
    // except on whichever path nobody tested.
    //
    // `seq` is 1 without consulting the table: the row was created one
    // statement ago and provably has no events yet. The payload carries
    // identity and lineage but never the input, which may be megabytes or may
    // have been offloaded to blob storage entirely.
    await executor
      .insertInto('WorkflowEvents')
      .values({
        workflowId: row.id,
        seq: 1,
        type: WorkflowEventType.WORKFLOW_STARTED,
        payload: json({
          defName: input.defName,
          defVersion: input.defVersion,
          correlationId: input.correlationId ?? null,
          parentWorkflowId: input.parentWorkflowId ?? null,
          priority: input.priority ?? 0,
        }),
      })
      .execute();

    await this.statusChanges?.onStatusChange({ workflowId: row.id, event: 'STARTED' }, executor);

    return toWorkflow(row);
  }

  /**
   * Loads a workflow and takes an exclusive row lock on it.
   *
   * This lock *is* the per-workflow serialisation. Postgres coordinates it, so
   * there is no lock service, no lease renewal and no split-brain to reason
   * about — and a crashed decider releases it automatically when its connection
   * drops.
   *
   * The table is range-partitioned on `startedAt`, so a lookup by id alone
   * probes every partition's index rather than one. Each probe is cheap and the
   * partition count is small; if it shows up in profiles, carry `startedAt`
   * alongside the id so the planner can prune.
   */
  async lockForEvaluation(
    workflowId: string,
    tx: DbTransaction
  ): Promise<WorkflowExecution | undefined> {
    const row = await tx
      .selectFrom('WorkflowExecutions')
      .selectAll()
      .where('id', '=', workflowId)
      .forUpdate()
      .executeTakeFirst();

    return row ? toWorkflow(row) : undefined;
  }

  /** A cached successful output for this task definition and key, if still fresh. */
  async cachedOutput(
    namespaceId: string,
    taskDefName: string,
    key: string,
    tx: Queryable
  ): Promise<Record<string, JsonValue> | undefined> {
    const row = await tx
      .selectFrom('TaskOutputCache')
      .select('output')
      .where('namespaceId', '=', namespaceId)
      .where('taskDefName', '=', taskDefName)
      .where('key', '=', key)
      .where('expiresAt', '>', sql<Date>`now()`)
      .executeTakeFirst();
    return row ? (row.output as Record<string, JsonValue>) : undefined;
  }

  /**
   * Lets waiting executions in as their keys free up, oldest first.
   *
   * Each key is handled under the same lock a start takes, so a start and an
   * admission can never both fill the last slot. Returns the admitted
   * executions so the caller can wake them.
   */
  async admitWaiting(limit = 200): Promise<{ id: string; namespaceId: string }[]> {
    const groups = await sql<{ namespaceId: string; defName: string; rateLimitKey: string }>`
      SELECT DISTINCT "namespaceId", "defName", "rateLimitKey" FROM "WorkflowExecutions"
      WHERE "rateLimitKey" IS NOT NULL AND "admittedAt" IS NULL AND status = 'RUNNING'
      LIMIT ${limit}
    `.execute(this.db);

    const admitted: { id: string; namespaceId: string }[] = [];
    for (const group of groups.rows) {
      const ids = await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`rate:${group.namespaceId}:${group.defName}:${group.rateLimitKey}`}))`.execute(
          tx
        );
        const result = await sql<{ id: string }>`
          WITH scope AS (
            SELECT id, status, "admittedAt", "rateLimit", "startedAt" FROM "WorkflowExecutions"
            WHERE "namespaceId" = ${group.namespaceId} AND "defName" = ${group.defName}
              AND "rateLimitKey" = ${group.rateLimitKey} AND status IN ('RUNNING', 'PAUSED')
          ),
          room AS (
            SELECT GREATEST(
              COALESCE((SELECT max("rateLimit") FROM scope WHERE "admittedAt" IS NULL), 0)
                - (SELECT count(*) FROM scope WHERE "admittedAt" IS NOT NULL),
              0) AS n
          ),
          next AS (
            SELECT id FROM scope WHERE "admittedAt" IS NULL AND status = 'RUNNING'
            ORDER BY "startedAt", id LIMIT (SELECT n FROM room)
          )
          UPDATE "WorkflowExecutions" w SET "admittedAt" = now()
          FROM next WHERE w.id = next.id AND w."admittedAt" IS NULL
          RETURNING w.id
        `.execute(tx);
        return result.rows.map((r) => r.id);
      });
      for (const id of ids) admitted.push({ id, namespaceId: group.namespaceId });
    }
    return admitted;
  }

  /** Deletes expired cache entries, a bounded batch at a time. For the poller. */
  async pruneTaskOutputCache(limit = 1000): Promise<number> {
    const result = await sql<{ n: number }>`
      WITH doomed AS (
        SELECT "namespaceId", "taskDefName", "key" FROM "TaskOutputCache"
        WHERE "expiresAt" <= now() LIMIT ${limit}
      )
      DELETE FROM "TaskOutputCache" c USING doomed d
      WHERE c."namespaceId" = d."namespaceId" AND c."taskDefName" = d."taskDefName" AND c."key" = d."key"
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0);
  }

  /** Running children of an execution — sub-workflows it is waiting on. */
  async runningChildren(parentWorkflowId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('parentWorkflowId', '=', parentWorkflowId)
      .where('status', 'in', [WorkflowStatus.RUNNING, WorkflowStatus.PAUSED])
      .execute();
    return rows.map((row) => row.id);
  }

  /**
   * The stored `traceparent` for several runs at once.
   *
   * Batched because it is read on the lease path, which is the highest-volume
   * endpoint in the system: a worker leasing ten tasks must not cost ten extra
   * round trips to decorate them. Runs with no trace are simply absent from the
   * map rather than present as null — the caller's question is "is there one?".
   */
  async traceparentsFor(workflowIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(workflowIds)];
    if (unique.length === 0) return new Map();

    const rows = await this.db
      .selectFrom('WorkflowExecutions')
      .select(['id', 'traceparent'])
      .where('id', 'in', unique)
      .execute();

    return new Map(
      rows
        .filter((row): row is { id: string; traceparent: string } => typeof row.traceparent === 'string' && row.traceparent !== '')
        .map((row) => [row.id, row.traceparent])
    );
  }

  async findById(workflowId: string): Promise<WorkflowExecution | undefined> {
    const row = await this.db
      .selectFrom('WorkflowExecutions')
      .selectAll()
      .where('id', '=', workflowId)
      .executeTakeFirst();

    return row ? toWorkflow(row) : undefined;
  }

  /**
   * Status alone, without payloads.
   *
   * The read a live stream makes on every drain to decide whether to close, so
   * it stays a single indexed column rather than a whole row whose input and
   * output may each be a quarter-megabyte of JSON.
   */
  async statusOf(workflowId: string): Promise<WorkflowStatus | undefined> {
    const row = await this.db
      .selectFrom('WorkflowExecutions')
      .select('status')
      .where('id', '=', workflowId)
      .executeTakeFirst();

    return row?.status as WorkflowStatus | undefined;
  }

  async findByIdempotencyKey(
    namespaceId: string,
    idempotencyKey: string
  ): Promise<WorkflowExecution | undefined> {
    const row = await this.db
      .selectFrom('WorkflowExecutions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('idempotencyKey', '=', idempotencyKey)
      .executeTakeFirst();

    return row ? toWorkflow(row) : undefined;
  }

  /**
   * The pending frontier: every task not yet in a terminal state.
   *
   * Served by a partial index covering only non-terminal rows, so its cost
   * tracks in-flight work rather than total history. A workflow with 30,000
   * completed tasks and three running ones reads three rows.
   */
  async loadPendingTasks(workflowId: string, tx?: Queryable): Promise<TaskExecution[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('workflowId', '=', workflowId)
      .where('status', 'in', NON_TERMINAL_TASK_STATUSES as unknown as TaskStatus[])
      .orderBy('scheduledAt')
      .execute();

    return rows.map(toTask);
  }

  /** Whether this workflow has ever scheduled a task. A `LIMIT 1` existence probe. */
  async hasAnyTask(workflowId: string, tx?: Queryable): Promise<boolean> {
    const row = await (tx ?? this.db)
      .selectFrom('TaskExecutions')
      .select('id')
      .where('workflowId', '=', workflowId)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Terminal tasks the decider has not yet reacted to.
   *
   * Replaces a time-based watermark, which was unsound: a task whose
   * transaction begins before an evaluation but commits after its SELECT ends
   * up with a timestamp below the newly-written watermark, so it is never seen
   * again and the workflow stalls with no error. Marking each task explicitly
   * removes the clock from the problem entirely.
   */
  async loadUnprocessedTerminalTasks(
    workflowId: string,
    tx?: Queryable
  ): Promise<TaskExecution[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('workflowId', '=', workflowId)
      .where('endedAt', 'is not', null)
      .where('deciderSeenAt', 'is', null)
      .orderBy('endedAt')
      .execute();

    return rows.map(toTask);
  }

  /**
   * Marks terminal tasks as reacted to.
   *
   * Runs in the evaluation transaction, so a rollback leaves them unprocessed
   * and the next pass picks them up again.
   */
  async markTasksProcessed(
    workflowId: string,
    taskIds: string[],
    tx: Queryable
  ): Promise<void> {
    if (taskIds.length === 0) return;

    await tx
      .updateTable('TaskExecutions')
      .set({ deciderSeenAt: sql<Date>`now()` })
      .where('workflowId', '=', workflowId)
      .where('id', 'in', taskIds)
      .execute();
  }

  /**
   * Loads specific tasks by reference name.
   *
   * Driven by the blueprint's static reference analysis: an evaluation asks for
   * exactly the refs its expressions and joins read, and gets a batched index
   * lookup rather than a scan of the workflow's history.
   *
   * `DISTINCT ON` keeps one row per name, and the ordering decides which.
   * **Finished attempts come first**, then the newest iteration and attempt.
   * Ordering by attempt alone picks a *pending retry* over the completed
   * attempt it supersedes — and a pending task has no output, so every
   * expression reading that reference silently resolves to nothing and the
   * next task receives an empty input.
   */
  async loadTasksByRef(
    workflowId: string,
    refNames: string[],
    tx?: Queryable
  ): Promise<Map<string, TaskExecution>> {
    if (refNames.length === 0) return new Map();

    const rows = await (tx ?? this.db)
      .selectFrom('TaskExecutions')
      .selectAll()
      .distinctOn('refName')
      .where('workflowId', '=', workflowId)
      .where('refName', 'in', refNames)
      .orderBy('refName')
      // false (finished) sorts before true (still running).
      .orderBy(sql`("endedAt" IS NULL)`)
      .orderBy('iteration', 'desc')
      .orderBy('attempt', 'desc')
      .execute();

    return new Map(rows.map((row) => [row.refName, toTask(row)]));
  }

  /**
   * Inserts a task execution.
   *
   * `ON CONFLICT DO NOTHING` against the
   * `(workflowId, refName, iteration, attempt)` unique index is what makes
   * evaluation safe to repeat: a redundant pass re-issues the same schedules and
   * they are absorbed rather than duplicated. `attempt` belongs in that identity
   * so a retry is a *new* row rather than a collision with the attempt it
   * replaces — without it, retries silently never run.
   *
   * Returns the row when this call created it, undefined when it already existed.
   */
  async insertTask(input: InsertTaskInput, tx: Queryable): Promise<TaskExecution | undefined> {
    const terminal =
      input.status !== TaskStatus.SCHEDULED && input.status !== TaskStatus.IN_PROGRESS;

    const namespace = async () => input.namespaceId;
    const taskInput = await this.split(input.input, namespace);
    const taskOutput = await this.split(input.output, namespace);

    const row = await tx
      .insertInto('TaskExecutions')
      .values({
        workflowId: input.workflowId,
        namespaceId: input.namespaceId,
        refName: input.refName,
        taskDefName: input.taskDefName,
        taskType: input.taskType,
        status: input.status,
        attempt: input.attempt,
        iteration: input.iteration,
        parentRefName: input.parentRefName ?? null,
        domain: input.domain ?? null,
        input: json(taskInput.value ?? {}),
        inputRef: taskInput.ref,
        output: input.output === undefined ? null : json(taskOutput.value ?? {}),
        outputRef: taskOutput.ref,
        // A task inserted already-failed — a schema violation, unsupported
        // routing — has a reason, and the task row is the first place anyone
        // looks for it. Leaving it only in the event history means the view an
        // operator opens says FAILED_WITH_TERMINAL_ERROR and nothing else.
        reasonForIncompletion: input.reason ?? null,
        endedAt: terminal ? sql<Date>`now()` : null,
        deciderSeenAt: terminal && input.seenByDecider ? sql<Date>`now()` : null,
        cacheKey: input.cache?.key ?? null,
        cacheTtlSeconds: input.cache?.ttlSeconds ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['workflowId', 'refName', 'iteration', 'attempt']).doNothing()
      )
      .returningAll()
      .executeTakeFirst();

    return row ? toTask(row) : undefined;
  }

  /** One task by id. Keyed on the workflow so the partition can be pruned. */
  async findTaskById(workflowId: string, taskId: string): Promise<TaskExecution | undefined> {
    const row = await this.db
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      .executeTakeFirst();

    return row ? toTask(row) : undefined;
  }

  /**
   * A task by id alone, within one namespace.
   *
   * For callers that have only the task id — the Conductor API's `GET
   * /tasks/{taskId}` carries no workflow id. Scoped to the namespace so an id
   * from another tenant is simply not found, rather than found and then hidden.
   */
  async findTaskInNamespace(namespaceId: string, taskId: string): Promise<TaskExecution | undefined> {
    const row = await this.db
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', taskId)
      .executeTakeFirst();

    return row ? toTask(row) : undefined;
  }

  /**
   * The newest attempt of a task, by its reference name.
   *
   * Newest because a retried task has several rows, and the one a caller means
   * is the live one — an older attempt is a record of something that already
   * finished.
   */
  async findTaskByRef(workflowId: string, refName: string): Promise<TaskExecution | undefined> {
    const row = await this.db
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('workflowId', '=', workflowId)
      .where('refName', '=', refName)
      .orderBy('iteration', 'desc')
      .orderBy('attempt', 'desc')
      .executeTakeFirst();

    return row ? toTask(row) : undefined;
  }

  /**
   * Every task of one workflow, for the API and the UI.
   *
   * This is the one place the "never load the whole workflow" rule is
   * deliberately relaxed, and the distinction matters: the *decider* must never
   * do this, because it runs on every wakeup and would make a 30,000-task
   * workflow quadratic. A human asking to see an execution has asked for
   * exactly this, once.
   *
   * Still bounded. Without a limit, one pathological workflow turns a UI
   * request into a multi-hundred-megabyte response and an out-of-memory server;
   * the caller is told when the list was cut short rather than being handed a
   * silently partial history.
   */
  async loadAllTasks(
    workflowId: string,
    limit = 1000
  ): Promise<{ tasks: TaskExecution[]; truncated: boolean }> {
    const rows = await this.db
      .selectFrom('TaskExecutions')
      .selectAll()
      .where('workflowId', '=', workflowId)
      .orderBy('scheduledAt')
      .orderBy('attempt')
      .limit(limit + 1)
      .execute();

    return {
      tasks: rows.slice(0, limit).map(toTask),
      truncated: rows.length > limit,
    };
  }

  /**
   * Task definitions whose retry budget is spent.
   *
   * The budget bounds the *share* of recent executions that may be retries.
   * Once exceeded, further retries fail fast — the control that stops a
   * degraded dependency being held down by the retry traffic its own
   * degradation caused.
   *
   * Measured over a short window rather than all history, so a service that
   * recovers is not punished for a burst an hour ago. Served by
   * `TaskExecutions_recent_by_def_idx`.
   */
  async findExhaustedRetryBudgets(
    namespaceId: string,
    taskDefNames: string[],
    budgets: Map<string, number>,
    windowSeconds = 300,
    tx?: Queryable
  ): Promise<Set<string>> {
    const exhausted = new Set<string>();
    if (taskDefNames.length === 0) return exhausted;

    const rows = await (tx ?? this.db)
      .selectFrom('TaskExecutions')
      .select((eb) => [
        'taskDefName',
        eb.fn.countAll<string>().as('total'),
        sql<string>`count(*) FILTER (WHERE "attempt" > 0)`.as('retries'),
      ])
      .where('namespaceId', '=', namespaceId)
      .where('taskDefName', 'in', taskDefNames)
      .where('scheduledAt', '>', sql<Date>`now() - make_interval(secs => ${windowSeconds})`)
      .groupBy('taskDefName')
      .execute();

    for (const row of rows) {
      const budget = budgets.get(row.taskDefName);
      // 1 disables the budget; a tiny sample would otherwise trip it on the
      // first retry, before there is enough traffic to mean anything.
      if (budget === undefined || budget >= 1) continue;

      const total = Number(row.total);
      if (total < 20) continue;

      if (Number(row.retries) / total > budget) exhausted.add(row.taskDefName);
    }

    return exhausted;
  }

  /** Records a task's outcome. Fenced on `leaseToken` when one is supplied. */
  async completeTask(
    workflowId: string,
    taskId: string,
    status: TaskStatus,
    output: Record<string, JsonValue> | undefined,
    reason: string | undefined,
    leaseToken: string | undefined,
    tx?: Queryable
  ): Promise<boolean> {
    const taskOutput = await this.split(output, () => this.namespaceOf(workflowId, tx));

    // A caller that supplied no transaction gets one, rather than running the
    // update and its history entry as two independent statements.
    //
    // This is not tidiness. The `seq` allocation below takes a transaction-
    // scoped advisory lock, and `pg_advisory_xact_lock` outside a transaction
    // is released the instant its own statement ends — so it would look like
    // protection and provide none, which is worse than having omitted it. The
    // same trap as `SET LOCAL` outside a transaction, and it fails just as
    // quietly.
    if (!tx) {
      return this.db
        .transaction()
        .execute((opened) =>
          this.completeTaskIn(opened, workflowId, taskId, status, taskOutput, reason, leaseToken)
        );
    }

    return this.completeTaskIn(tx, workflowId, taskId, status, taskOutput, reason, leaseToken);
  }

  private async completeTaskIn(
    tx: Queryable,
    workflowId: string,
    taskId: string,
    status: TaskStatus,
    taskOutput: { value: Record<string, JsonValue> | null; ref: string | null },
    reason: string | undefined,
    leaseToken: string | undefined
  ): Promise<boolean> {
    const output = taskOutput.value;

    let query = tx
      .updateTable('TaskExecutions')
      .set({
        status,
        ...(output !== undefined
          ? { output: json(taskOutput.value ?? {}), outputRef: taskOutput.ref }
          : {}),
        ...(reason !== undefined ? { reasonForIncompletion: reason } : {}),
        endedAt: sql<Date>`now()`,
      })
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      // A finished task stays finished. The lease token alone does not
      // guarantee it: a timeout ends the task without revoking the token, so a
      // worker reporting a second late still matched — and overwrote TIMED_OUT
      // with COMPLETED after the retry had already been scheduled, leaving two
      // attempts that both claimed the result.
      .where('status', 'in', [...NON_TERMINAL_TASK_STATUSES]);

    if (leaseToken !== undefined) query = query.where('leaseToken', '=', leaseToken);

    const rows = await query
      .returning(['id', 'refName', 'attempt', 'namespaceId', 'taskDefName', 'cacheKey', 'cacheTtlSeconds'])
      .execute();
    if (rows.length === 0) return false;

    // A success fills the cache slot the task was scheduled with. Only inline
    // outputs: an offloaded one is a reference to a blob with its own lifetime,
    // and caching the reference would outlive what it points at.
    const done = rows[0];
    if (status === TaskStatus.COMPLETED && done.cacheKey && done.cacheTtlSeconds && taskOutput.ref === null) {
      await tx
        .insertInto('TaskOutputCache')
        .values({
          namespaceId: done.namespaceId,
          taskDefName: done.taskDefName,
          key: done.cacheKey,
          output: json(output ?? {}),
          expiresAt: sql<Date>`now() + make_interval(secs => ${done.cacheTtlSeconds})`,
        })
        .onConflict((oc) =>
          oc.columns(['namespaceId', 'taskDefName', 'key']).doUpdateSet({
            output: json(output ?? {}),
            expiresAt: sql<Date>`now() + make_interval(secs => ${done.cacheTtlSeconds})`,
            storedAt: sql<Date>`now()`,
          })
        )
        .execute();
    }

    await this.recordTaskOutcome(workflowId, rows[0], status, reason, tx);
    return true;
  }

  /**
   * Writes the history entry for a task a worker finished.
   *
   * This belongs here rather than in the dispatch service because there are
   * several ways a task reaches a terminal state — a worker reporting, a system
   * task executing in-process, a human responding, a webhook arriving — and all
   * of them come through `completeTask`. An event appended by the callers is an
   * event some caller will not append, and the symptom is the worst kind: a
   * history that is complete except on whichever path nobody watched.
   *
   * Until now nothing recorded this at all. `task.completed` and `task.failed`
   * were defined and never written, so an execution's history showed tasks
   * being scheduled and never finishing — which reads as a stuck workflow, on
   * every workflow.
   */
  private async recordTaskOutcome(
    workflowId: string,
    task: { id: string; refName: string; attempt: number },
    status: TaskStatus,
    reason: string | undefined,
    executor: Queryable
  ): Promise<void> {
    // Serialises `seq` allocation for this workflow.
    //
    // The decider holds a row lock while it appends, but a worker reporting a
    // result does not, and two workers finishing two branches of a fork at the
    // same instant would otherwise both read the same `max(seq)` and write the
    // same number. Nothing rejects that — the index is not unique — and the
    // damage surfaces much later: a live stream reading `seq > cursor` skips
    // whichever duplicate landed in an earlier batch, so an event is lost from
    // a log whose entire value is being complete.
    //
    // Advisory rather than a row lock because it is cheaper than re-locking the
    // execution and is released with the transaction either way.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${workflowId}))`.execute(executor);

    await executor
      .insertInto('WorkflowEvents')
      .values({
        workflowId,
        seq: sql<number>`(
          SELECT COALESCE(MAX("seq"), 0) + 1
          FROM "WorkflowEvents" WHERE "workflowId" = ${workflowId}
        )`,
        type: isTaskSuccessful(status)
          ? WorkflowEventType.TASK_COMPLETED
          : status === TaskStatus.TIMED_OUT
            ? WorkflowEventType.TASK_TIMED_OUT
            : WorkflowEventType.TASK_FAILED,
        payload: json({
          refName: task.refName,
          taskId: task.id,
          attempt: task.attempt,
          status,
          ...(reason === undefined ? {} : { reason }),
        }),
      })
      .execute();
  }

  /**
   * Writes a task's output **without** ending it.
   *
   * `completeTask` always stamps `endedAt` and a terminal status, which is
   * right for a result. This is for a task that has something to publish while
   * it is still running — a `WAIT_FOR_WEBHOOK` needs to expose the URL a third
   * party should call, and cannot do that by finishing.
   */
  async setTaskOutput(
    workflowId: string,
    taskId: string,
    output: Record<string, JsonValue>,
    tx: Queryable
  ): Promise<void> {
    const split = await this.split(output, () => this.namespaceOf(workflowId, tx));

    await tx
      .updateTable('TaskExecutions')
      .set({ output: json(split.value ?? {}), outputRef: split.ref })
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      .execute();
  }

  /** Marks a task as picked up by a worker, stamping its fencing token. */
  async markTaskStarted(
    workflowId: string,
    taskId: string,
    workerId: string,
    leaseToken: string,
    tx?: Queryable
  ): Promise<void> {
    await (tx ?? this.db)
      .updateTable('TaskExecutions')
      .set({
        status: TaskStatus.IN_PROGRESS,
        workerId,
        leaseToken,
        startedAt: sql<Date>`now()`,
      })
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      .execute();
  }

  async setStatus(
    workflowId: string,
    status: WorkflowStatus,
    output: Record<string, JsonValue> | undefined,
    reason: string | undefined,
    tx: Queryable
  ): Promise<void> {
    const terminal = status !== WorkflowStatus.RUNNING && status !== WorkflowStatus.PAUSED;
    const wfOutput = await this.split(output, () => this.namespaceOf(workflowId, tx));

    await tx
      .updateTable('WorkflowExecutions')
      .set({
        status,
        ...(output !== undefined
          ? { output: json(wfOutput.value ?? {}), outputRef: wfOutput.ref }
          : {}),
        ...(reason !== undefined ? { reasonForIncompletion: reason } : {}),
        updatedAt: sql<Date>`now()`,
        ...(terminal ? { endedAt: sql<Date>`now()` } : {}),
        version: sql<string>`"version" + 1`,
      })
      .where('id', '=', workflowId)
      .execute();

    await this.statusChanges?.onStatusChange({ workflowId, event: STATUS_EVENT_FOR[status], reason, output }, tx);
  }

  async mergeVariables(
    workflowId: string,
    values: Record<string, JsonValue>,
    tx: Queryable
  ): Promise<void> {
    await tx
      .updateTable('WorkflowExecutions')
      .set({
        variables: sql<string>`"variables" || ${json(values)}::jsonb`,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', workflowId)
      .execute();
  }
}

/** The lifecycle event a status change represents. RUNNING via `setStatus` is only ever a resume. */
const STATUS_EVENT_FOR: Record<WorkflowStatus, StatusEvent> = {
  [WorkflowStatus.RUNNING]: 'RESUMED',
  [WorkflowStatus.PAUSED]: 'PAUSED',
  [WorkflowStatus.COMPLETED]: 'COMPLETED',
  [WorkflowStatus.FAILED]: 'FAILED',
  [WorkflowStatus.TIMED_OUT]: 'TIMED_OUT',
  [WorkflowStatus.TERMINATED]: 'TERMINATED',
};
