import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { Cron } from 'croner';
import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';
import { json } from './schema.js';
import { isUniqueViolation } from './pg-errors.js';

/**
 * Cron schedules.
 *
 * The correctness property this exists for: **N replicas must produce one
 * firing.** Everything else here is policy.
 */

export type OverlapPolicy = 'ALLOW' | 'SKIP';
export type CatchupPolicy = 'SKIP' | 'FIRE_ONE' | 'FIRE_ALL';

const OVERLAP_POLICIES: OverlapPolicy[] = ['ALLOW', 'SKIP'];
const CATCHUP_POLICIES: CatchupPolicy[] = ['SKIP', 'FIRE_ONE', 'FIRE_ALL'];

/**
 * Ceiling on a single catch-up burst under `FIRE_ALL`.
 *
 * A minute-by-minute schedule and a day-long outage is 1,440 executions
 * arriving at once, on a system that has just come back up and is least able to
 * absorb them. The rest are dropped and recorded rather than queued.
 */
const MAX_CATCHUP_RUNS = 50;

export interface NewSchedule {
  namespaceId: string;
  name: string;
  description?: string;
  cron: string;
  timezone?: string;
  defName: string;
  defVersion?: number;
  input?: Record<string, JsonValue>;
  correlationId?: string;
  priority?: number;
  paused?: boolean;
  startAt?: Date;
  endAt?: Date;
  overlapPolicy?: OverlapPolicy;
  catchupPolicy?: CatchupPolicy;
}

export type ScheduleRunOutcome = 'STARTED' | 'SKIPPED' | 'FAILED';

export interface NewScheduleRun {
  scheduledFor: Date;
  outcome: ScheduleRunOutcome;
  workflowId?: string;
  reason?: string;
}

export interface ScheduleRun {
  id: string;
  /** The occurrence this firing was for. After downtime it can be well before `firedAt`. */
  scheduledFor: Date;
  firedAt: Date;
  outcome: ScheduleRunOutcome;
  workflowId: string | null;
  reason: string | null;
  /** The started execution's status now. */
  workflowStatus: string | null;
  workflowEndedAt: Date | null;
  workflowVersion: number | null;
}

export interface Schedule {
  id: string;
  namespaceId: string;
  name: string;
  description: string | null;
  cron: string;
  timezone: string;
  defName: string;
  defVersion: number | null;
  input: Record<string, JsonValue>;
  correlationId: string | null;
  priority: number;
  paused: boolean;
  startAt: Date | null;
  endAt: Date | null;
  overlapPolicy: OverlapPolicy;
  catchupPolicy: CatchupPolicy;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastWorkflowId: string | null;
  runCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One firing a poller has claimed. */
export interface DueFiring {
  schedule: Schedule;
  /** The scheduled instant, not the instant it was noticed. */
  scheduledFor: Date;
  /**
   * Deduplicates the start.
   *
   * Derived from the schedule and the scheduled instant rather than from
   * "now", so a retry, a redelivery, or a second poller that somehow got past
   * the row lock all resolve to the same execution.
   */
  idempotencyKey: string;
}

export class ScheduleRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewSchedule): Promise<Schedule> {
    const timezone = input.timezone ?? 'UTC';
    assertValidCron(input.cron, timezone);
    assertPolicy(input.overlapPolicy, OVERLAP_POLICIES, 'overlapPolicy');
    assertPolicy(input.catchupPolicy, CATCHUP_POLICIES, 'catchupPolicy');

    // Computed at creation rather than left null: a schedule with no next run
    // is invisible to the poller's partial index, so a bug that forgot this
    // would produce a schedule that exists and never fires.
    const nextRunAt = nextOccurrence(input.cron, timezone, input.startAt ?? new Date());

    const row = await this.db
      .insertInto('Schedules')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        description: input.description ?? null,
        cron: input.cron,
        timezone,
        defName: input.defName,
        defVersion: input.defVersion ?? null,
        input: json(input.input ?? {}),
        correlationId: input.correlationId ?? null,
        priority: input.priority ?? 0,
        paused: input.paused ?? false,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        overlapPolicy: input.overlapPolicy ?? 'ALLOW',
        catchupPolicy: input.catchupPolicy ?? 'FIRE_ONE',
        nextRunAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(
            ErrorCode.CONFLICT,
            `a schedule named "${input.name}" already exists`
          );
        }
        throw error;
      });

    return toSchedule(row);
  }

  async list(namespaceId: string): Promise<Schedule[]> {
    const rows = await this.db
      .selectFrom('Schedules')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name', 'asc')
      .execute();

    return rows.map(toSchedule);
  }

  async findByName(namespaceId: string, name: string): Promise<Schedule | undefined> {
    const row = await this.db
      .selectFrom('Schedules')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return row ? toSchedule(row) : undefined;
  }

  /**
   * Pauses or resumes.
   *
   * Resuming recomputes `nextRunAt` from now, so a schedule paused over a
   * weekend does not wake up owing three days of firings — pausing is an
   * instruction not to run, not a request to defer.
   */
  async setPaused(namespaceId: string, name: string, paused: boolean): Promise<Schedule> {
    const existing = await this.findByName(namespaceId, name);
    if (!existing) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no schedule "${name}"`);

    const row = await this.db
      .updateTable('Schedules')
      .set({
        paused,
        nextRunAt: paused ? existing.nextRunAt : nextOccurrence(existing.cron, existing.timezone),
        updatedAt: sql<Date>`now()`,
      })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirstOrThrow();

    return toSchedule(row);
  }

  /**
   * Replaces a schedule's settings, keeping its identity and run history.
   *
   * `nextRunAt` is recomputed from now (or from `startAt`, if that is later):
   * a changed expression must not fire on the old one's timetable, and an edit
   * is not a request to replay what the old expression would have missed. A
   * paused schedule stays paused unless the edit says otherwise.
   */
  async update(
    namespaceId: string,
    name: string,
    input: Omit<NewSchedule, 'namespaceId' | 'name'>
  ): Promise<Schedule> {
    const timezone = input.timezone ?? 'UTC';
    assertValidCron(input.cron, timezone);
    assertPolicy(input.overlapPolicy, OVERLAP_POLICIES, 'overlapPolicy');
    assertPolicy(input.catchupPolicy, CATCHUP_POLICIES, 'catchupPolicy');

    const now = new Date();
    const from = input.startAt && input.startAt > now ? input.startAt : now;

    const row = await this.db
      .updateTable('Schedules')
      .set({
        description: input.description ?? null,
        cron: input.cron,
        timezone,
        defName: input.defName,
        defVersion: input.defVersion ?? null,
        input: json(input.input ?? {}),
        correlationId: input.correlationId ?? null,
        priority: input.priority ?? 0,
        ...(input.paused === undefined ? {} : { paused: input.paused }),
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        overlapPolicy: input.overlapPolicy ?? 'ALLOW',
        catchupPolicy: input.catchupPolicy ?? 'FIRE_ONE',
        nextRunAt: nextOccurrence(input.cron, timezone, from),
        // The error described the previous settings; keeping it would blame
        // the new ones for a failure they have not had.
        lastError: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();

    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no schedule "${name}"`);
    return toSchedule(row);
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom('Schedules')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  /**
   * Claims every schedule that is due, inside the caller's transaction.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes several pollers safe: the first to
   * reach a row holds it until its transaction commits, and the others step
   * over it rather than queueing behind it. Combined with advancing
   * `nextRunAt` in that same transaction, a firing cannot be produced twice.
   *
   * The rows are returned, not fired — starting a workflow is the caller's job,
   * because this layer must not know what a workflow is.
   */
  async claimDue(limit: number, tx: DbTransaction, now = new Date()): Promise<Schedule[]> {
    const rows = await tx
      .selectFrom('Schedules')
      .selectAll()
      .where('paused', '=', false)
      .where('nextRunAt', 'is not', null)
      .where('nextRunAt', '<=', now)
      .where((eb) => eb.or([eb('endAt', 'is', null), eb('endAt', '>', now)]))
      .orderBy('nextRunAt', 'asc')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();

    return rows.map(toSchedule);
  }

  /**
   * Works out what a due schedule should actually run.
   *
   * Separated from claiming because it is pure policy, and policy is the part
   * worth testing exhaustively without a database.
   */
  plan(schedule: Schedule, now = new Date()): { firings: DueFiring[]; nextRunAt: Date | null } {
    const due = schedule.nextRunAt;
    if (!due) return { firings: [], nextRunAt: null };

    const missed = collectOccurrences(schedule, due, now);
    const upcoming = nextOccurrence(schedule.cron, schedule.timezone, now);

    // Past `endAt` there is no next run, and the row leaves the poller's index.
    const nextRunAt =
      schedule.endAt && upcoming && upcoming > schedule.endAt ? null : upcoming;

    const chosen = selectFirings(schedule.catchupPolicy, missed);

    return {
      firings: chosen.map((scheduledFor) => ({
        schedule,
        scheduledFor,
        idempotencyKey: `schedule:${schedule.id}:${scheduledFor.toISOString()}`,
      })),
      nextRunAt,
    };
  }

  /**
   * Records individual firings — started, skipped or failed — in the poller's
   * transaction, so the history never shows a run that rolled back.
   */
  async recordFirings(schedule: Pick<Schedule, 'id' | 'namespaceId'>, firings: NewScheduleRun[], tx: Queryable): Promise<void> {
    if (firings.length === 0) return;
    await tx
      .insertInto('ScheduleRuns')
      .values(
        firings.map((firing) => ({
          namespaceId: schedule.namespaceId,
          scheduleId: schedule.id,
          scheduledFor: firing.scheduledFor,
          outcome: firing.outcome,
          workflowId: firing.workflowId ?? null,
          reason: firing.reason?.slice(0, 2000) ?? null,
        }))
      )
      .execute();
  }

  /**
   * A schedule's firings, newest first, with each started execution's current
   * status — so the history answers "did it work", not only "did it start".
   */
  async runs(
    namespaceId: string,
    name: string,
    options: { limit?: number; before?: string; outcome?: ScheduleRunOutcome } = {}
  ): Promise<{ runs: ScheduleRun[]; nextCursor?: string } | undefined> {
    const schedule = await this.findByName(namespaceId, name);
    if (!schedule) return undefined;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    const rows = await this.db
      .selectFrom('ScheduleRuns as r')
      .leftJoin('WorkflowExecutions as w', 'w.id', 'r.workflowId')
      .select([
        'r.id',
        'r.scheduledFor',
        'r.firedAt',
        'r.outcome',
        'r.workflowId',
        'r.reason',
        'w.status as workflowStatus',
        'w.endedAt as workflowEndedAt',
        'w.defVersion as workflowVersion',
      ])
      .where('r.scheduleId', '=', schedule.id)
      .$if(options.outcome !== undefined, (q) => q.where('r.outcome', '=', options.outcome as string))
      .$if(/^\d+$/.test(options.before ?? ''), (q) => q.where('r.id', '<', options.before as string))
      .orderBy('r.id', 'desc')
      .limit(limit + 1)
      .execute();

    const page = rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      scheduledFor: row.scheduledFor,
      firedAt: row.firedAt,
      outcome: row.outcome as ScheduleRunOutcome,
      workflowId: row.workflowId,
      reason: row.reason,
      workflowStatus: row.workflowStatus ?? null,
      workflowEndedAt: row.workflowEndedAt ?? null,
      workflowVersion: row.workflowVersion ?? null,
    }));
    return { runs: page, ...(rows.length > limit ? { nextCursor: page[page.length - 1].id } : {}) };
  }

  /** Drops firings older than the retention window, a batch at a time. */
  async pruneRuns(retentionDays = 30, limit = 5000): Promise<number> {
    const result = await sql<{ count: string }>`
      WITH doomed AS (
        SELECT "id" FROM "ScheduleRuns"
        WHERE "firedAt" < now() - make_interval(days => ${retentionDays})
        LIMIT ${limit}
      )
      DELETE FROM "ScheduleRuns" WHERE "id" IN (SELECT "id" FROM doomed)
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0);
  }

  /** Records the outcome of a firing. Shares the poller's transaction. */
  async recordRun(
    id: string,
    update: { nextRunAt: Date | null; ranAt?: Date; workflowId?: string; error?: string; fired: number },
    tx: Queryable
  ): Promise<void> {
    await tx
      .updateTable('Schedules')
      .set({
        nextRunAt: update.nextRunAt,
        ...(update.ranAt ? { lastRunAt: update.ranAt } : {}),
        ...(update.workflowId ? { lastWorkflowId: update.workflowId } : {}),
        lastError: update.error ?? null,
        runCount: sql<string>`"runCount" + ${update.fired}`,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .execute();
  }
}

/**
 * Every occurrence between the due time and now, inclusive of the due time.
 *
 * Bounded: a schedule that has been due since last year would otherwise walk
 * millions of occurrences before the poller got to decide it wanted one.
 */
function collectOccurrences(schedule: Schedule, due: Date, now: Date): Date[] {
  const occurrences: Date[] = [due];
  if (due > now) return occurrences;

  let cursor = due;
  while (occurrences.length <= MAX_CATCHUP_RUNS) {
    const next = nextOccurrence(schedule.cron, schedule.timezone, cursor);
    if (!next || next > now) break;
    occurrences.push(next);
    cursor = next;
  }

  return occurrences;
}

/**
 * Which of the missed firings actually run.
 *
 * `SKIP` drops them all — the schedule simply resumes. `FIRE_ONE` runs the
 * *most recent*, not the oldest: catching up on a report means producing
 * today's, not the one from three days ago. `FIRE_ALL` runs everything, bounded.
 */
function selectFirings(policy: CatchupPolicy, missed: Date[]): Date[] {
  if (missed.length === 0) return [];

  switch (policy) {
    case 'SKIP':
      // Still fires when nothing was actually missed: a single on-time
      // occurrence is not a catch-up.
      return missed.length === 1 ? missed : [];
    case 'FIRE_ALL':
      return missed;
    default:
      return [missed[missed.length - 1]];
  }
}

/** The next time this expression fires strictly after `from`. */
export function nextOccurrence(
  expression: string,
  timezone: string,
  from: Date = new Date()
): Date | null {
  try {
    return new Cron(expression, { timezone }).nextRun(from);
  } catch {
    return null;
  }
}

/**
 * The next `count` firings of an expression, for checking it before saving.
 *
 * Throws the same `InvalidArgumentError` creation would, so a form previewing
 * an expression and the API rejecting it can never disagree.
 */
export function previewOccurrences(
  expression: string,
  timezone: string,
  count = 5,
  from: Date = new Date()
): Date[] {
  assertValidCron(expression, timezone);
  const runs: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(expression, timezone, cursor);
    if (!next) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

function assertValidCron(expression: string, timezone: string): void {
  let cron: Cron;

  try {
    cron = new Cron(expression, { timezone });
  } catch (error) {
    // At creation, not at firing time: a malformed expression should be a
    // rejected API call, not a schedule that exists and silently never runs.
    throw new InvalidArgumentError(
      `invalid cron expression "${expression}": ${(error as Error).message}`
    );
  }

  if (!cron.nextRun()) {
    throw new InvalidArgumentError(`cron expression "${expression}" will never fire`);
  }
}

function assertPolicy<T extends string>(
  value: T | undefined,
  allowed: T[],
  field: string
): void {
  if (value !== undefined && !allowed.includes(value)) {
    throw new InvalidArgumentError(`${field} must be one of ${allowed.join(', ')}`);
  }
}


function toSchedule(row: Record<string, unknown>): Schedule {
  return {
    ...(row as unknown as Schedule),
    input: (row['input'] ?? {}) as Record<string, JsonValue>,
    runCount: Number(row['runCount'] ?? 0),
    overlapPolicy: row['overlapPolicy'] as OverlapPolicy,
    catchupPolicy: row['catchupPolicy'] as CatchupPolicy,
  };
}
