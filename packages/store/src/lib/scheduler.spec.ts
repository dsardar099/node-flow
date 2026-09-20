import {
  InvalidArgumentError,
  TaskType,
  WorkflowStatus,
  type JsonValue,
} from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import { QuotaService, QuotaExceededError } from './quota.service.js';
import { ScheduleRepository, nextOccurrence, previewOccurrences, type Schedule } from './schedule.repository.js';
import { SchedulerRunner } from './scheduler.runner.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Cron triggers.
 *
 * The test that justifies the whole design is "two pollers, one firing". Every
 * in-process scheduler passes a single-replica test and fires N times in
 * production; this file is written so that the difference shows up.
 */

let harness: PostgresHarness;
let schedules: ScheduleRepository;
let workflows: WorkflowRepository;
let metadata: MetadataRepository;
let decideQueue: DecideQueueRepository;
let namespaceId: string;

const definition = {
  name: 'nightly',
  version: 1,
  tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.NOOP }],
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  schedules = new ScheduleRepository(harness.db);
  workflows = new WorkflowRepository(harness.db);
  metadata = new MetadataRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  await metadata.registerWorkflow({ namespaceId, definition });
});

const runner = (options = {}) =>
  new SchedulerRunner(harness.db, schedules, workflows, metadata, decideQueue, options);

const create = (overrides: Partial<Parameters<ScheduleRepository['create']>[0]> = {}) =>
  schedules.create({
    namespaceId,
    name: 'nightly-report',
    cron: '0 0 3 * * *',
    defName: 'nightly',
    defVersion: 1,
    ...overrides,
  });

/** Forces a schedule due at a chosen instant, without waiting for a clock. */
async function makeDue(id: string, at: Date): Promise<void> {
  await harness.db
    .updateTable('Schedules')
    .set({ nextRunAt: at })
    .where('id', '=', id)
    .execute();
}

const executions = () =>
  harness.db.selectFrom('WorkflowExecutions').select(['id', 'input']).execute();

describe('defining a schedule', () => {
  it('computes the first run when created', async () => {
    const schedule = await create();

    expect(schedule.nextRunAt).toBeInstanceOf(Date);
    expect(schedule.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  // A malformed expression should be a rejected API call, not a schedule that
  // exists and silently never runs.
  it('refuses an expression that cannot be parsed', async () => {
    await expect(create({ name: 'bad', cron: 'not a cron' })).rejects.toThrow(
      InvalidArgumentError
    );
  });

  it('refuses a duplicate name in the same namespace', async () => {
    await create();
    await expect(create()).rejects.toThrow(/already exists/);
  });

  it('refuses an unknown policy', async () => {
    await expect(
      create({ name: 'p', overlapPolicy: 'SOMETIMES' as never })
    ).rejects.toThrow(InvalidArgumentError);
  });

  /**
   * "09:00 in Sydney" and "09:00 UTC" are different instants for most of the
   * year, and a business schedule almost always means the former.
   */
  it('honours the timezone', async () => {
    const utc = nextOccurrence('0 0 9 * * *', 'UTC');
    const sydney = nextOccurrence('0 0 9 * * *', 'Australia/Sydney');

    expect(utc).not.toBeNull();
    expect(sydney).not.toBeNull();
    expect(utc!.getTime()).not.toBe(sydney!.getTime());
  });
});

describe('editing a schedule', () => {
  const edit = (overrides: Partial<Parameters<ScheduleRepository['update']>[2]> = {}) =>
    schedules.update(namespaceId, 'nightly-report', {
      cron: '0 30 4 * * *',
      defName: 'nightly',
      defVersion: 1,
      ...overrides,
    });

  it('replaces the settings and keeps the run history', async () => {
    const created = await create();
    await harness.db
      .updateTable('Schedules')
      .set({ runCount: '7', lastError: 'workflow "nightly" not found' })
      .where('id', '=', created.id)
      .execute();

    const updated = await edit({ description: 'later', priority: 5 });

    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({ cron: '0 30 4 * * *', description: 'later', priority: 5, runCount: 7 });
    expect(updated.lastError).toBeNull();
  });

  // A changed expression must fire on its own timetable, not the old one's.
  it('recomputes the next run from the new expression', async () => {
    await create();
    const updated = await edit({ cron: '0 15 * * * *' });
    expect(updated.nextRunAt?.getTime()).toBe(nextOccurrence('0 15 * * * *', 'UTC')?.getTime());
  });

  it('keeps a paused schedule paused unless told otherwise', async () => {
    await create({ paused: true });
    expect((await edit()).paused).toBe(true);
    expect((await edit({ paused: false })).paused).toBe(false);
  });

  it('refuses an invalid expression and leaves the schedule untouched', async () => {
    await create();
    await expect(edit({ cron: 'every tuesday' })).rejects.toThrow(InvalidArgumentError);
    expect((await schedules.findByName(namespaceId, 'nightly-report'))?.cron).toBe('0 0 3 * * *');
  });

  it('reports a schedule that does not exist', async () => {
    await expect(edit()).rejects.toThrow(/no schedule/);
  });

  it('previews firings with the same validation as saving', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(previewOccurrences('0 0 */6 * * *', 'UTC', 3, from).map((d) => d.toISOString())).toEqual([
      '2026-01-01T06:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
      '2026-01-01T18:00:00.000Z',
    ]);
    expect(() => previewOccurrences('nope', 'UTC')).toThrow(InvalidArgumentError);
  });
});

describe('firing', () => {
  it('starts a workflow when due', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    const result = await runner().tick();

    expect(result.started).toBe(1);
    expect(await executions()).toHaveLength(1);
  });

  it('leaves a schedule that is not yet due alone', async () => {
    await create();

    expect((await runner().tick()).claimed).toBe(0);
    expect(await executions()).toEqual([]);
  });

  it('advances to the next occurrence', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    await runner().tick();

    const after = await schedules.findByName(namespaceId, 'nightly-report');
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after!.runCount).toBe(1);
    expect(after!.lastWorkflowId).toBeTruthy();
  });

  // A catch-up run needs to know which window it is producing, which is not
  // always "now".
  it('tells the workflow which instant it was scheduled for', async () => {
    const due = new Date(Date.now() - 60_000);
    const schedule = await create();
    await makeDue(schedule.id, due);

    await runner().tick();

    const [execution] = await executions();
    const meta = (execution.input as Record<string, JsonValue>)['_schedule'] as Record<
      string,
      JsonValue
    >;
    expect(meta['scheduledFor']).toBe(due.toISOString());
    expect(meta['name']).toBe('nightly-report');
  });

  it('never fires a paused schedule', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    await schedules.setPaused(namespaceId, 'nightly-report', true);

    expect((await runner().tick()).claimed).toBe(0);
  });

  // Pausing is an instruction not to run, not a request to defer — a schedule
  // paused over a weekend must not wake up owing three days of firings.
  it('resumes from now rather than from the backlog', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 86_400_000));
    await schedules.setPaused(namespaceId, 'nightly-report', true);

    const resumed = await schedules.setPaused(namespaceId, 'nightly-report', false);
    expect(resumed.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('stops firing after endAt', async () => {
    const schedule = await create({ endAt: new Date(Date.now() - 1_000) });
    await makeDue(schedule.id, new Date(Date.now() - 2_000));

    expect((await runner().tick()).claimed).toBe(0);
  });
});

/**
 * The property the whole design exists for.
 *
 * An in-process scheduler passes every single-replica test and fires N times in
 * production. These are the ones that tell the difference.
 *
 * Two mechanisms defend different things, and the distinction is worth keeping
 * straight because a mutation test proves it: remove the row lock and both
 * pollers *do the work* — each reports a firing, each advances the schedule —
 * but the execution count stays at one, because the idempotency key catches it
 * downstream. So the lock is what makes it **one firing**, and the key is what
 * makes it **one execution** even if the lock is ever broken by a refactor.
 */
describe('two replicas, one firing', () => {
  it('starts exactly one workflow when two pollers tick together', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    const results = await Promise.all([runner().tick(), runner().tick()]);

    expect(results.reduce((sum, r) => sum + r.started, 0)).toBe(1);
    expect(await executions()).toHaveLength(1);
  });

  it('holds under a wider stampede', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    const results = await Promise.all(Array.from({ length: 8 }, () => runner().tick()));

    expect(results.reduce((sum, r) => sum + r.started, 0)).toBe(1);
    expect(await executions()).toHaveLength(1);
  });

  /**
   * Belt and braces behind the row lock.
   *
   * Even if two pollers somehow both reached the start — a lock released early,
   * a bug in a future refactor — the idempotency key is derived from the
   * schedule and the scheduled instant, so both resolve to one execution.
   */
  it('deduplicates a firing replayed at the same instant', async () => {
    const schedule = await create();
    const due = new Date(Date.now() - 1_000);
    await makeDue(schedule.id, due);

    await runner().tick();
    // Force the same instant to be due again, as a replay would.
    await makeDue(schedule.id, due);
    await runner().tick();

    expect(await executions()).toHaveLength(1);
  });
});

/**
 * The server was down and a schedule missed firings. Running all of them on
 * boot is a self-inflicted stampede at the moment the system is least healthy.
 */
describe('catching up after an outage', () => {
  const everyMinute = { name: 'frequent', cron: '0 * * * * *' };
  const threeHoursAgo = () => new Date(Date.now() - 3 * 3600 * 1000);

  it('FIRE_ONE runs once, not once per missed window', async () => {
    const schedule = await create({ ...everyMinute, catchupPolicy: 'FIRE_ONE' });
    await makeDue(schedule.id, threeHoursAgo());

    expect((await runner().tick()).started).toBe(1);
    expect(await executions()).toHaveLength(1);
  });

  // Catching up on a report means producing today's, not the one from three
  // hours ago.
  it('FIRE_ONE runs the most recent missed window', async () => {
    const schedule = await create({ ...everyMinute, catchupPolicy: 'FIRE_ONE' });
    const due = threeHoursAgo();
    await makeDue(schedule.id, due);

    await runner().tick();

    const [execution] = await executions();
    const meta = (execution.input as Record<string, JsonValue>)['_schedule'] as Record<
      string,
      JsonValue
    >;
    expect(new Date(String(meta['scheduledFor'])).getTime()).toBeGreaterThan(due.getTime());
  });

  it('SKIP drops the backlog entirely', async () => {
    const schedule = await create({ ...everyMinute, catchupPolicy: 'SKIP' });
    await makeDue(schedule.id, threeHoursAgo());

    expect((await runner().tick()).started).toBe(0);
    expect(await executions()).toEqual([]);
  });

  // A single on-time occurrence is not a catch-up, and SKIP must not swallow it.
  //
  // Deliberately *not* `everyMinute`. With a once-a-minute cron and a due time
  // one second ago, a minute boundary lands inside that second on roughly one
  // run in sixty — and when it does the window holds two occurrences, which is
  // a real catch-up that SKIP is right to drop. The test would then be
  // asserting where the wall clock happened to be rather than the policy. A
  // daily cron cannot produce a second occurrence inside a one-second window at
  // any time of day, so the fixture means one thing only.
  it('SKIP still fires a schedule that is merely due', async () => {
    const schedule = await create({ catchupPolicy: 'SKIP' });
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    expect((await runner().tick()).started).toBe(1);
  });

  // The behaviour the flaky version of the test above was accidentally
  // asserting, pinned down on purpose: two occurrences in the window is a
  // backlog however narrow the window, and SKIP drops the lot.
  it('SKIP drops a two-occurrence window even when it is barely a second wide', async () => {
    const schedule = await create({ ...everyMinute, catchupPolicy: 'SKIP' });

    // Anchored to a minute boundary rather than to `now`, so the window
    // provably contains the boundary occurrence instead of usually containing
    // it. `plan` is pure, so the clock can simply be handed to it.
    const boundary = new Date(Math.ceil(Date.now() / 60_000) * 60_000);
    const due = new Date(boundary.getTime() - 500);

    const { firings } = schedules.plan(
      { ...schedule, catchupPolicy: 'SKIP', nextRunAt: due },
      new Date(boundary.getTime() + 500)
    );

    expect(firings).toEqual([]);
  });

  it('FIRE_ALL runs the backlog but bounds it', async () => {
    const schedule = await create({
      name: 'busy',
      cron: '0 * * * * *',
      catchupPolicy: 'FIRE_ALL',
    });
    // A day of a minute-by-minute schedule is 1,440 windows.
    await makeDue(schedule.id, new Date(Date.now() - 24 * 3600 * 1000));

    const result = await runner().tick();

    expect(result.started).toBeGreaterThan(1);
    // Bounded, or coming back up would be a self-inflicted denial of service.
    expect(result.started).toBeLessThanOrEqual(51);
  }, 60_000);
});

describe('overlap', () => {
  /**
   * Starting another run is right for an independent job and catastrophic for
   * one that holds a lock or reconciles a balance.
   */
  it('SKIP does not start while the previous run is live', async () => {
    const schedule = await create({ overlapPolicy: 'SKIP' });
    await makeDue(schedule.id, new Date(Date.now() - 1_000));

    await runner().tick();
    expect(await executions()).toHaveLength(1);

    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    const second = await runner().tick();

    expect(second.started).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('SKIP starts again once the previous run has finished', async () => {
    const schedule = await create({ overlapPolicy: 'SKIP' });
    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    await runner().tick();

    const after = await schedules.findByName(namespaceId, 'nightly-report');
    await workflows.setStatus(
      after!.lastWorkflowId!,
      WorkflowStatus.COMPLETED,
      {},
      undefined,
      harness.db
    );

    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    expect((await runner().tick()).started).toBe(1);
  });

  it('ALLOW starts regardless', async () => {
    const schedule = await create({ overlapPolicy: 'ALLOW' });

    for (let i = 0; i < 2; i++) {
      await makeDue(schedule.id, new Date(Date.now() - 1_000 - i));
      await runner().tick();
    }

    expect(await executions()).toHaveLength(2);
  });
});

describe('when a schedule is broken', () => {
  /**
   * One schedule pointing at a deleted definition must not stop every other
   * schedule in the install — which is what a throw aborting the batch would do.
   */
  // Checked for a pinned version too, not only an unpinned one: the first
  // version of this let a pinned schedule start an execution that failed later
  // for an unrelated-looking reason, while an unpinned one recorded a clear
  // error. The same question deserves the same answer.
  it('records the failure and keeps the rest of the batch running', async () => {
    const broken = await create({ name: 'broken', defName: 'no-such-workflow', defVersion: 1 });
    const healthy = await create({ name: 'healthy' });
    await makeDue(broken.id, new Date(Date.now() - 1_000));
    await makeDue(healthy.id, new Date(Date.now() - 1_000));

    const result = await runner().tick();

    expect(result.failed).toBe(1);
    expect(result.started).toBe(1);

    const after = await schedules.findByName(namespaceId, 'broken');
    expect(after!.lastError).toBeTruthy();
  });

  // Leaving nextRunAt in the past makes the poller re-claim it every pass
  // forever, which turns one broken schedule into a busy loop.
  it('still advances a schedule that failed', async () => {
    const broken = await create({ name: 'broken', defName: 'no-such-workflow', defVersion: 1 });
    await makeDue(broken.id, new Date(Date.now() - 1_000));

    await runner().tick();

    const after = await schedules.findByName(namespaceId, 'broken');
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('run history', () => {
  it('records what started, what was skipped and what failed, newest first', async () => {
    const schedule = await create({ overlapPolicy: 'SKIP' });
    const at = new Date(Date.now() - 1_000);
    await makeDue(schedule.id, at);
    await runner().tick();

    // Still running, so the next firing is skipped.
    await makeDue(schedule.id, new Date(Date.now() - 500));
    await runner().tick();

    const history = await schedules.runs(namespaceId, 'nightly-report');
    expect(history!.runs.map((r) => r.outcome)).toEqual(['SKIPPED', 'STARTED']);
    const [skipped, started] = history!.runs;
    expect(started).toMatchObject({ workflowStatus: 'RUNNING', workflowVersion: 1, scheduledFor: at });
    expect(started.workflowId).toBe((await executions())[0].id);
    expect(skipped.reason).toContain(started.workflowId);

    const broken = await create({ name: 'broken', defName: 'no-such-workflow', defVersion: 1 });
    await makeDue(broken.id, new Date(Date.now() - 1_000));
    await runner().tick();
    const failed = await schedules.runs(namespaceId, 'broken');
    expect(failed!.runs).toMatchObject([{ outcome: 'FAILED', workflowId: null, reason: 'no workflow definition "no-such-workflow" version 1' }]);
  });

  it('records each occurrence of a catch-up burst, and pages', async () => {
    const schedule = await create({ cron: '*/10 * * * * *', catchupPolicy: 'FIRE_ALL' });
    await makeDue(schedule.id, new Date(Date.now() - 45_000));
    await runner().tick();

    const all = await schedules.runs(namespaceId, 'nightly-report');
    expect(all!.runs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(all!.runs.map((r) => r.scheduledFor.toISOString())).size).toBe(all!.runs.length);

    const first = await schedules.runs(namespaceId, 'nightly-report', { limit: 2 });
    const second = await schedules.runs(namespaceId, 'nightly-report', { limit: 2, before: first!.nextCursor });
    expect(first!.runs).toHaveLength(2);
    expect(second!.runs[0].id).not.toBe(first!.runs[1].id);
    expect(Number(second!.runs[0].id)).toBeLessThan(Number(first!.runs[1].id));
    expect(await schedules.runs(namespaceId, 'missing')).toBeUndefined();
  });

  it('writes no history for a tick that rolled back', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    // The run is started and recorded, then the schedule update fails: the whole
    // tick rolls back, and the history must not claim a run that never happened.
    const failingSchedules = Object.create(schedules) as ScheduleRepository;
    failingSchedules.recordRun = async () => {
      throw new Error('database went away');
    };
    await expect(new SchedulerRunner(harness.db, failingSchedules, workflows, metadata, decideQueue).tick()).rejects.toThrow();
    expect((await schedules.runs(namespaceId, 'nightly-report'))!.runs).toEqual([]);
    expect(await executions()).toEqual([]);
  });

  it('prunes history past its retention window', async () => {
    const schedule = await create();
    await makeDue(schedule.id, new Date(Date.now() - 1_000));
    await runner().tick();
    await harness.db.updateTable('ScheduleRuns').set({ firedAt: new Date(Date.now() - 40 * 86_400_000) }).execute();
    expect(await schedules.pruneRuns(30)).toBe(1);
    expect((await schedules.runs(namespaceId, 'nightly-report'))!.runs).toEqual([]);
  });
});

describe('planning, without a database', () => {
  const base: Schedule = {
    id: 'sched-1',
    namespaceId: 'ns',
    name: 's',
    description: null,
    cron: '0 * * * * *',
    timezone: 'UTC',
    defName: 'wf',
    defVersion: 1,
    input: {},
    correlationId: null,
    priority: 0,
    paused: false,
    startAt: null,
    endAt: null,
    overlapPolicy: 'ALLOW',
    catchupPolicy: 'FIRE_ONE',
    nextRunAt: null,
    lastRunAt: null,
    lastWorkflowId: null,
    runCount: 0,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('plans nothing for a schedule with no next run', () => {
    expect(schedules.plan(base).firings).toEqual([]);
  });

  it('derives the idempotency key from the scheduled instant', () => {
    const due = new Date('2026-01-01T00:00:00.000Z');
    const { firings } = schedules.plan(
      { ...base, nextRunAt: due },
      new Date('2026-01-01T00:00:30.000Z')
    );

    expect(firings).toHaveLength(1);
    expect(firings[0].idempotencyKey).toBe('schedule:sched-1:2026-01-01T00:00:00.000Z');
  });

  /**
   * A daily cron, not the per-minute one the other cases use.
   *
   * With `0 * * * * *` the next occurrence is between 0 and 60 seconds away, so
   * an `endAt` a second out passed or failed depending on where in the minute
   * the suite happened to run — it failed once, for real. A flaky test is an
   * undiagnosed race, and this one was in the fixture: a daily schedule's next
   * run is unambiguously beyond an `endAt` an hour from now.
   */
  it('stops planning past endAt', () => {
    // Daily at 03:00, ending a second from now. The window used to be an hour,
    // which failed every day between 02:00 and 03:00 UTC, when the next 03:00
    // really was inside it.
    const { nextRunAt } = schedules.plan({
      ...base,
      cron: '0 0 3 * * *',
      nextRunAt: new Date(Date.now() - 1_000),
      endAt: new Date(Date.now() + 1_000),
    });

    expect(nextRunAt).toBeNull();
  });
});

/**
 * Per-tenant quotas, raced directly.
 *
 * At this level the transactions are real and concurrent, which the HTTP-level
 * test only approximates — that one passed with the serialisation removed, so
 * it proves the happy path and not the property. This one is the difference
 * between "counting" and "deciding".
 */
describe('namespace quotas under concurrency', () => {
  let quotas: QuotaService;

  beforeAll(() => {
    quotas = new QuotaService(harness.db);
  });

  const start = () =>
    quotas.withStartQuota(namespaceId, (tx) =>
      workflows.start({ namespaceId, defName: 'nightly', defVersion: 1 }, tx)
    );

  it('admits exactly the limit when starts race', async () => {
    await quotas.setQuotas(namespaceId, { maxConcurrentExecutions: 3 });

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => start()));
    const admitted = results.filter((r) => r.status === 'fulfilled').length;

    expect(admitted).toBe(3);

    const rows = await harness.db
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('namespaceId', '=', namespaceId)
      .execute();
    expect(rows).toHaveLength(3);
  }, 60_000);

  it('admits everything when no quota is set', async () => {
    await quotas.setQuotas(namespaceId, {});

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => start()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  }, 60_000);

  it('rate-limits starts per minute and says when to return', async () => {
    await quotas.setQuotas(namespaceId, { maxExecutionsPerMinute: 2 });

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => start()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((refused.reason as QuotaExceededError).retryAfterSeconds).toBeGreaterThan(0);
  }, 60_000);
});
