import {
  InvalidArgumentError,
  WorkflowStatus,
  type JsonValue,
  type WorkflowExecution,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';

/**
 * Finding executions.
 *
 * Structured filters rather than a query-string DSL. Conductor's search accepts
 * a Lucene-ish string, which reads well in a demo and then has to be parsed,
 * escaped and injection-proofed — and every client reimplements the escaping.
 * A typed object needs none of that and is what a UI actually builds anyway.
 *
 * The search box's `status:FAILED input.tier:gold` syntax does not change that:
 * `parseExecutionQuery` turns it into these same fields on the server, and
 * every value still reaches SQL as a bound parameter.
 */

export interface ExecutionSearchQuery {
  namespaceId: string;
  status?: WorkflowStatus[];
  defName?: string;
  defVersion?: number;
  correlationId?: string;
  /** An exact execution id: the one search every operator does from a log line. */
  workflowId?: string;
  idempotencyKey?: string;
  /** Top-level runs only — sub-workflows otherwise crowd out the runs people started. */
  excludeSubWorkflows?: boolean;
  startedAfter?: Date;
  startedBefore?: Date;
  /** Definitions whose executions the caller may not see — tag access. */
  excludeDefNames?: string[];
  /** Only executions that have finished, or only those still running. */
  finished?: boolean;
  /** Workflow names starting with this. */
  defNamePrefix?: string;
  /** Only sub-workflows. `excludeSubWorkflows` is the opposite. */
  onlySubWorkflows?: boolean;
  /** Case-insensitive text in the failure reason. */
  reason?: string;
  /**
   * JSON containment on input or output; every entry must match, any of an
   * entry's alternatives may. Offloaded payloads are not searched.
   */
  contains?: { field: 'input' | 'output'; alternatives: Record<string, JsonValue>[] }[];
  /**
   * Words, each of which must appear somewhere: execution id, workflow name,
   * correlation id, idempotency key, failure reason, input or output.
   */
  text?: string[];
  limit?: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
}

export interface ExecutionOverview {
  hours: number;
  bucketMinutes: number;
  /** Executions started in the window, by their status now. */
  byStatus: Record<string, number>;
  started: number;
  running: number;
  paused: number;
  /** Waiting for a rate-limit slot. */
  queued: number;
  oldestRunningAt: Date | null;
  series: { at: Date; started: number; completed: number; failed: number }[];
  durationMs: { p50: number | null; p95: number | null };
  hotspots: { defName: string; total: number; failed: number; completed: number }[];
  recentFailures: {
    workflowId: string;
    defName: string;
    status: string;
    reason: string | null;
    endedAt: Date;
    failedTask: string | null;
  }[];
}

export interface ExecutionSearchResult {
  executions: WorkflowExecution[];
  /** Pass back as `cursor` for the next page. Absent when the page is the last. */
  nextCursor?: string;
}

/**
 * The maximum a caller may ask for.
 *
 * An unbounded page is a denial-of-service against your own API: one client
 * asking for everything holds a connection, builds a huge result in memory and
 * serialises it, all while the pool is shared with the decider.
 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export class SearchRepository {
  constructor(private readonly db: Db) {}

  /**
   * Searches executions, newest first.
   *
   * **Keyset pagination, not `OFFSET`.** Offset has two problems here and the
   * second is the serious one: it re-scans and discards every skipped row, so
   * page 500 is 500 times the work of page 1 — and because this table receives
   * continuous inserts, rows shift between requests, so paging with an offset
   * silently skips and duplicates executions. A cursor on `(startedAt, id)` is
   * stable under concurrent inserts and costs the same on every page.
   *
   * `startedAt` leads the cursor deliberately: the table is range-partitioned
   * on it, so the planner can prune partitions instead of probing all of them.
   */
  async executions(query: ExecutionSearchQuery): Promise<ExecutionSearchResult> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    let builder = this.db
      .selectFrom('WorkflowExecutions')
      .selectAll()
      // `startedAt` as text, at full precision.
      //
      // The cursor cannot be built from the parsed `Date`: `timestamptz` holds
      // microseconds and a JavaScript Date holds milliseconds, so round-tripping
      // it truncates. The truncated value sorts *before* the row it came from,
      // and a `<` comparison against it then skips every row sharing that
      // millisecond — which under rapid inserts is most of them. Silent, and
      // invisible in any fixture that creates rows slowly.
      .select(sql<string>`"startedAt"::text`.as('cursorAt'))
      // Never optional, never overridable by the caller. Every other filter is
      // a convenience; this one is the tenant boundary.
      .where('namespaceId', '=', query.namespaceId);

    if (query.status?.length) builder = builder.where('status', 'in', query.status);
    if (query.defName) builder = builder.where('defName', '=', query.defName);
    if (query.excludeDefNames?.length) builder = builder.where('defName', 'not in', query.excludeDefNames);
    if (query.defVersion !== undefined) {
      builder = builder.where('defVersion', '=', query.defVersion);
    }
    if (query.correlationId) {
      builder = builder.where('correlationId', '=', query.correlationId);
    }
    if (query.workflowId) builder = builder.where('id', '=', query.workflowId);
    if (query.idempotencyKey) {
      builder = builder.where('idempotencyKey', '=', query.idempotencyKey);
    }
    if (query.excludeSubWorkflows) builder = builder.where('parentWorkflowId', 'is', null);
    if (query.onlySubWorkflows) builder = builder.where('parentWorkflowId', 'is not', null);
    if (query.defNamePrefix) builder = builder.where('defName', 'like', `${escapeLike(query.defNamePrefix)}%`);
    if (query.reason) builder = builder.where('reasonForIncompletion', 'ilike', `%${escapeLike(query.reason)}%`);
    for (const condition of query.contains ?? []) {
      // `@>` so the GIN index on each column can answer it. The column name is
      // one of two literals, never caller text.
      const column = sql.ref(condition.field === 'input' ? 'input' : 'output');
      builder = builder.where(({ or }) =>
        or(condition.alternatives.map((value) => sql<boolean>`${column} @> ${JSON.stringify(value)}::jsonb`))
      );
    }
    for (const word of query.text ?? []) {
      const pattern = `%${escapeLike(word)}%`;
      builder = builder.where(
        sql<boolean>`(
          "id"::text ILIKE ${pattern} OR "defName" ILIKE ${pattern} OR "correlationId" ILIKE ${pattern}
          OR "idempotencyKey" ILIKE ${pattern} OR "reasonForIncompletion" ILIKE ${pattern}
          OR "input"::text ILIKE ${pattern} OR "output"::text ILIKE ${pattern}
        )`
      );
    }
    if (query.startedAfter) builder = builder.where('startedAt', '>=', query.startedAfter);
    if (query.startedBefore) builder = builder.where('startedAt', '<', query.startedBefore);
    if (query.finished !== undefined) {
      builder = query.finished
        ? builder.where('endedAt', 'is not', null)
        : builder.where('endedAt', 'is', null);
    }

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      // Row-value comparison, not `startedAt < x OR (startedAt = x AND id < y)`.
      // The tuple form is what lets the planner use the index as a single range
      // scan; the OR form makes it two.
      //
      // Both sides are cast explicitly: an untyped parameter compared against
      // `timestamptz`/`uuid` leaves the cast to inference, and inference here
      // has been known to pick text — which orders UUIDs lexically and quietly
      // returns the wrong page.
      builder = builder.where(
        sql<boolean>`("startedAt", "id") < (${cursor.startedAt}::timestamptz, ${cursor.id}::uuid)`
      );
    }

    // One extra row, purely to learn whether another page exists. A separate
    // COUNT would double the work and still be wrong by the time it returned.
    const rows = await builder
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      executions: page.map(toExecution),
      nextCursor:
        rows.length > limit && last ? encodeCursor(last.cursorAt, last.id) : undefined,
    };
  }

  /**
   * Executions matching a correlation id.
   *
   * A first-class lookup rather than a search filter because it is how a caller
   * finds "the workflow for order 12345" without having kept the id — the
   * single most common question asked of an orchestrator from outside it.
   */
  async byCorrelationId(
    namespaceId: string,
    correlationId: string,
    limit = DEFAULT_LIMIT
  ): Promise<WorkflowExecution[]> {
    const { executions } = await this.executions({ namespaceId, correlationId, limit });
    return executions;
  }

  /**
   * The shape of the last few hours, for the overview page.
   *
   * One round of aggregate queries over the window's partitions rather than a
   * dozen endpoints the page stitches together: the numbers on a dashboard have
   * to agree with each other, and separate requests race.
   */
  async overview(
    namespaceId: string,
    options: { hours: number; excludeDefNames?: string[] }
  ): Promise<ExecutionOverview> {
    const hours = Math.min(Math.max(options.hours, 1), 24 * 7);
    // Around 24–48 buckets whatever the window, so the chart reads the same.
    const bucketMinutes = hours <= 1 ? 5 : hours <= 6 ? 15 : hours <= 24 ? 60 : 360;
    const since = new Date(Date.now() - hours * 3_600_000);
    // An empty name stands for "hide nothing": no definition can be named that,
    // and an empty array parameter would need an explicit type to compare against.
    const hidden = options.excludeDefNames?.length ? options.excludeDefNames : [''];

    const [totals, live, series, durations, hotspots, failures] = await Promise.all([
      sql<{ status: string; count: string }>`
        SELECT status, count(*) AS count FROM "WorkflowExecutions"
        WHERE "namespaceId" = ${namespaceId} AND "startedAt" >= ${since} AND "defName" <> ALL(${hidden})
        GROUP BY status
      `.execute(this.db),
      // "Now", not "in the window": a run started last week and still going is running today.
      sql<{ running: string; paused: string; queued: string; oldest: Date | null }>`
        SELECT count(*) FILTER (WHERE status = 'RUNNING' AND ("rateLimitKey" IS NULL OR "admittedAt" IS NOT NULL)) AS running,
               count(*) FILTER (WHERE status = 'PAUSED') AS paused,
               count(*) FILTER (WHERE status = 'RUNNING' AND "rateLimitKey" IS NOT NULL AND "admittedAt" IS NULL) AS queued,
               min("startedAt") FILTER (WHERE status = 'RUNNING') AS oldest
        FROM "WorkflowExecutions"
        WHERE "namespaceId" = ${namespaceId} AND status IN ('RUNNING', 'PAUSED') AND "defName" <> ALL(${hidden})
      `.execute(this.db),
      sql<{ at: Date; started: string; completed: string; failed: string }>`
        WITH buckets AS (
          SELECT generate_series(
            date_bin(make_interval(mins => ${bucketMinutes}), ${since}::timestamptz, 'epoch'),
            now(),
            make_interval(mins => ${bucketMinutes})
          ) AS at
        ),
        started AS (
          SELECT date_bin(make_interval(mins => ${bucketMinutes}), "startedAt", 'epoch') AS at, count(*) AS n
          FROM "WorkflowExecutions"
          WHERE "namespaceId" = ${namespaceId} AND "startedAt" >= ${since} AND "defName" <> ALL(${hidden})
          GROUP BY 1
        ),
        ended AS (
          SELECT date_bin(make_interval(mins => ${bucketMinutes}), "endedAt", 'epoch') AS at,
                 count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                 count(*) FILTER (WHERE status IN ('FAILED', 'TIMED_OUT')) AS failed
          FROM "WorkflowExecutions"
          WHERE "namespaceId" = ${namespaceId} AND "startedAt" >= ${since} AND "endedAt" >= ${since}
            AND "defName" <> ALL(${hidden})
          GROUP BY 1
        )
        SELECT b.at, COALESCE(s.n, 0) AS started, COALESCE(e.completed, 0) AS completed, COALESCE(e.failed, 0) AS failed
        FROM buckets b LEFT JOIN started s USING (at) LEFT JOIN ended e USING (at)
        ORDER BY b.at
      `.execute(this.db),
      sql<{ p50: number | null; p95: number | null }>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "endedAt" - "startedAt") * 1000) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM "endedAt" - "startedAt") * 1000) AS p95
        FROM "WorkflowExecutions"
        WHERE "namespaceId" = ${namespaceId} AND "startedAt" >= ${since} AND status = 'COMPLETED'
          AND "defName" <> ALL(${hidden})
      `.execute(this.db),
      sql<{ defName: string; total: string; failed: string; completed: string }>`
        SELECT "defName", count(*) AS total,
               count(*) FILTER (WHERE status IN ('FAILED', 'TIMED_OUT')) AS failed,
               count(*) FILTER (WHERE status = 'COMPLETED') AS completed
        FROM "WorkflowExecutions"
        WHERE "namespaceId" = ${namespaceId} AND "startedAt" >= ${since} AND "defName" <> ALL(${hidden})
        GROUP BY "defName"
        ORDER BY count(*) FILTER (WHERE status IN ('FAILED', 'TIMED_OUT')) DESC, count(*) DESC
        LIMIT 8
      `.execute(this.db),
      sql<{ id: string; defName: string; status: string; reason: string | null; endedAt: Date; failedTask: string | null }>`
        SELECT w.id, w."defName", w.status, w."reasonForIncompletion" AS reason, w."endedAt",
               (SELECT t."refName" FROM "TaskExecutions" t
                 WHERE t."workflowId" = w.id AND t.status IN ('FAILED', 'FAILED_WITH_TERMINAL_ERROR', 'TIMED_OUT')
                 ORDER BY t."endedAt" DESC NULLS LAST LIMIT 1) AS "failedTask"
        FROM "WorkflowExecutions" w
        WHERE w."namespaceId" = ${namespaceId} AND w."startedAt" >= ${since}
          AND w.status IN ('FAILED', 'TIMED_OUT') AND w."defName" <> ALL(${hidden})
        ORDER BY w."endedAt" DESC NULLS LAST
        LIMIT 8
      `.execute(this.db),
    ]);

    const byStatus = Object.fromEntries(totals.rows.map((row) => [row.status, Number(row.count)]));
    const liveRow = live.rows[0];

    return {
      hours,
      bucketMinutes,
      byStatus,
      started: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      running: Number(liveRow?.running ?? 0),
      paused: Number(liveRow?.paused ?? 0),
      queued: Number(liveRow?.queued ?? 0),
      oldestRunningAt: liveRow?.oldest ?? null,
      series: series.rows.map((row) => ({
        at: row.at,
        started: Number(row.started),
        completed: Number(row.completed),
        failed: Number(row.failed),
      })),
      durationMs: {
        p50: durations.rows[0]?.p50 === null ? null : Math.round(Number(durations.rows[0]?.p50)),
        p95: durations.rows[0]?.p95 === null ? null : Math.round(Number(durations.rows[0]?.p95)),
      },
      hotspots: hotspots.rows.map((row) => ({
        defName: row.defName,
        total: Number(row.total),
        failed: Number(row.failed),
        completed: Number(row.completed),
      })),
      recentFailures: failures.rows.map((row) => ({
        workflowId: row.id,
        defName: row.defName,
        status: row.status,
        reason: row.reason,
        endedAt: row.endedAt,
        failedTask: row.failedTask,
      })),
    };
  }

  /**
   * How many executions are in each status.
   *
   * Bounded by a time window on purpose. Without one this counts every
   * execution ever recorded, which is a full scan across every partition — and
   * the number it returns is dominated by ancient history nobody is asking
   * about. A dashboard wants "how are we doing today", not "since inception".
   */
  async statusCounts(
    namespaceId: string,
    since: Date
  ): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('WorkflowExecutions')
      .select(['status', (eb) => eb.fn.countAll<string>().as('count')])
      .where('namespaceId', '=', namespaceId)
      .where('startedAt', '>=', since)
      .groupBy('status')
      .execute();

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }
}

/**
 * Cursors are opaque base64.
 *
 * Not because the contents are secret — they are a timestamp and an id the
 * caller already has — but because an obviously-structured cursor invites
 * clients to construct their own, and then the encoding cannot change without
 * breaking them.
 */
function encodeCursor(startedAt: string, id: string): string {
  return Buffer.from(`${startedAt}|${id}`, 'utf8').toString('base64url');
}

/**
 * The timestamp stays a **string** all the way back to Postgres.
 *
 * Parsing it into a `Date` to validate it would discard the microseconds that
 * make the cursor exact, so it is checked by shape and handed straight back for
 * the database to cast.
 */
function decodeCursor(cursor?: string): { startedAt: string; id: string } | undefined {
  if (!cursor) return undefined;

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  const startedAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);

  // A malformed cursor must not silently become "from the beginning" — that
  // would restart a paging client at page one forever, which looks like a hang
  // rather than an error.
  const looksLikeTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?)?$/;
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (separator === -1 || !looksLikeTimestamp.test(startedAt) || !looksLikeUuid.test(id)) {
    // A coded error, not a bare `Error`: the API layer maps this to 400. A
    // plain throw would surface as a 500 and be logged as a server fault, which
    // is both wrong and noisy — a bad cursor is ordinary client input.
    throw new InvalidArgumentError('cursor is not a valid pagination cursor');
  }

  return { startedAt, id };
}

/** Row → domain object. Payloads stay as refs; search results are summaries. */
function toExecution(row: Record<string, unknown>): WorkflowExecution {
  return {
    id: row['id'] as string,
    namespaceId: row['namespaceId'] as string,
    defName: row['defName'] as string,
    defVersion: row['defVersion'] as number,
    status: row['status'] as WorkflowStatus,
    correlationId: (row['correlationId'] as string) ?? undefined,
    idempotencyKey: (row['idempotencyKey'] as string) ?? undefined,
    priority: row['priority'] as number,
    input: { kind: 'inline', value: {} },
    variables: {},
    parentWorkflowId: (row['parentWorkflowId'] as string) ?? undefined,
    parentTaskId: (row['parentTaskId'] as string) ?? undefined,
    reasonForIncompletion: (row['reasonForIncompletion'] as string) ?? undefined,
    startedAt: row['startedAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
    endedAt: (row['endedAt'] as Date) ?? undefined,
    version: Number(row['version']),
    rateLimitKey: (row['rateLimitKey'] as string) ?? undefined,
    awaitingAdmission: row['rateLimitKey'] != null && row['admittedAt'] == null,
  };
}

/** Makes `%`, `_` and `\` literal inside a LIKE pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
