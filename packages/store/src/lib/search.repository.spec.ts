import { WorkflowStatus } from '@node-flow-dev/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EngineMetrics } from './engine-metrics.js';
import { SearchRepository } from './search.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Execution search, and the gauges built on the same tables.
 *
 * The pagination tests matter most. Offset paging looks correct in a static
 * fixture and silently skips rows the moment anything is being inserted — which
 * on this table is always — so the cursor is tested explicitly against inserts
 * landing mid-page.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let search: SearchRepository;
let metrics: EngineMetrics;
let namespaceId: string;
let otherNamespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  search = new SearchRepository(harness.db);
  // No cache: these tests assert on values that change between reads.
  metrics = new EngineMetrics(harness.db, 0);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db, 'acme');
  otherNamespaceId = await seedNamespace(harness.db, 'other');
});

async function start(options: {
  defName?: string;
  defVersion?: number;
  correlationId?: string;
  namespace?: string;
} = {}) {
  return workflows.start({
    namespaceId: options.namespace ?? namespaceId,
    defName: options.defName ?? 'checkout',
    defVersion: options.defVersion ?? 1,
    correlationId: options.correlationId,
  });
}

const finish = (id: string, status: WorkflowStatus) =>
  harness.db
    .transaction()
    .execute((tx) => workflows.setStatus(id, status, undefined, undefined, tx));

describe('filters', () => {
  it('returns newest first', async () => {
    const first = await start();
    const second = await start();
    const third = await start();

    const { executions } = await search.executions({ namespaceId });
    expect(executions.map((e) => e.id)).toEqual([third.id, second.id, first.id]);
  });

  it('filters by status', async () => {
    const running = await start();
    const done = await start();
    await finish(done.id, WorkflowStatus.COMPLETED);

    const { executions } = await search.executions({
      namespaceId,
      status: [WorkflowStatus.COMPLETED],
    });

    expect(executions.map((e) => e.id)).toEqual([done.id]);
    expect(executions.map((e) => e.id)).not.toContain(running.id);
  });

  it('filters by workflow name and version', async () => {
    await start({ defName: 'checkout', defVersion: 1 });
    const v2 = await start({ defName: 'checkout', defVersion: 2 });
    await start({ defName: 'refund', defVersion: 1 });

    const { executions } = await search.executions({
      namespaceId,
      defName: 'checkout',
      defVersion: 2,
    });

    expect(executions.map((e) => e.id)).toEqual([v2.id]);
  });

  it('filters by correlation id', async () => {
    const mine = await start({ correlationId: 'order-7' });
    await start({ correlationId: 'order-8' });

    const found = await search.byCorrelationId(namespaceId, 'order-7');
    expect(found.map((e) => e.id)).toEqual([mine.id]);
  });

  it('separates finished from live', async () => {
    const running = await start();
    const done = await start();
    await finish(done.id, WorkflowStatus.COMPLETED);

    expect((await search.executions({ namespaceId, finished: true })).executions).toHaveLength(1);
    expect(
      (await search.executions({ namespaceId, finished: false })).executions.map((e) => e.id)
    ).toEqual([running.id]);
  });

  it('filters by start time', async () => {
    await start();
    await sql`UPDATE "WorkflowExecutions" SET "startedAt" = now() - interval '2 days'`.execute(
      harness.db
    );
    const recent = await start();

    const { executions } = await search.executions({
      namespaceId,
      startedAfter: new Date(Date.now() - 3_600_000),
    });

    expect(executions.map((e) => e.id)).toEqual([recent.id]);
  });

  it('combines filters', async () => {
    const target = await start({ defName: 'checkout', correlationId: 'c-1' });
    await finish(target.id, WorkflowStatus.FAILED);
    await start({ defName: 'checkout', correlationId: 'c-2' });

    const { executions } = await search.executions({
      namespaceId,
      defName: 'checkout',
      correlationId: 'c-1',
      status: [WorkflowStatus.FAILED],
    });

    expect(executions.map((e) => e.id)).toEqual([target.id]);
  });
});

describe('namespace isolation', () => {
  // The tenant boundary, and the one filter a caller cannot influence.
  it('never returns another namespace’s executions', async () => {
    await start({ namespace: otherNamespaceId });
    const mine = await start();

    const { executions } = await search.executions({ namespaceId });
    expect(executions.map((e) => e.id)).toEqual([mine.id]);
  });

  it('scopes correlation lookup too', async () => {
    await start({ namespace: otherNamespaceId, correlationId: 'shared' });

    expect(await search.byCorrelationId(namespaceId, 'shared')).toEqual([]);
  });
});

describe('pagination', () => {
  it('pages through every execution exactly once', async () => {
    const created = [];
    for (let i = 0; i < 12; i++) created.push((await start()).id);

    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await search.executions({ namespaceId, limit: 5, cursor });
      seen.push(...page.executions.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toEqual([...created].reverse());
  });

  it('omits the cursor on the last page', async () => {
    for (let i = 0; i < 3; i++) await start();

    const page = await search.executions({ namespaceId, limit: 10 });
    expect(page.executions).toHaveLength(3);
    expect(page.nextCursor).toBeUndefined();
  });

  /**
   * The reason for keyset rather than `OFFSET`.
   *
   * With an offset, rows inserted between page requests shift everything down,
   * so page two re-shows a row from page one and silently skips another. On a
   * table taking continuous inserts that is not an edge case — it is the normal
   * case, and it is invisible without a test that inserts mid-page.
   */
  it('skips and duplicates nothing when rows are inserted mid-page', async () => {
    const original = [];
    for (let i = 0; i < 6; i++) original.push((await start()).id);

    const first = await search.executions({ namespaceId, limit: 3 });

    // Three more arrive between the two page requests.
    for (let i = 0; i < 3; i++) await start();

    const second = await search.executions({
      namespaceId,
      limit: 3,
      cursor: first.nextCursor,
    });

    const seen = [...first.executions, ...second.executions].map((e) => e.id);
    expect(new Set(seen).size).toBe(seen.length);

    // Six originals, newest first, is [o5 o4 o3 | o2 o1 o0]. Page one took the
    // first three; page two continues strictly below the cursor, so it is the
    // three oldest — and none of the rows inserted in between, which all sort
    // above the cursor.
    expect(first.executions.map((e) => e.id)).toEqual(original.slice(3).reverse());
    expect(second.executions.map((e) => e.id)).toEqual(original.slice(0, 3).reverse());
  });

  it('caps an oversized limit rather than obeying it', async () => {
    for (let i = 0; i < 5; i++) await start();

    const page = await search.executions({ namespaceId, limit: 100_000 });
    expect(page.executions.length).toBeLessThanOrEqual(200);
  });

  // Treating a bad cursor as "start from the beginning" would restart a paging
  // client at page one forever — a loop that looks like a hang, not an error.
  it('rejects a malformed cursor', async () => {
    await expect(
      search.executions({ namespaceId, cursor: 'not-a-cursor' })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('keeps the cursor opaque', async () => {
    await start();
    await start();

    const page = await search.executions({ namespaceId, limit: 1 });
    expect(page.nextCursor).toBeDefined();
    expect(page.nextCursor).not.toContain('|');
  });
});

describe('status counts', () => {
  it('groups by status within the window', async () => {
    const a = await start();
    const b = await start();
    await start();
    await finish(a.id, WorkflowStatus.COMPLETED);
    await finish(b.id, WorkflowStatus.FAILED);

    const counts = await search.statusCounts(namespaceId, new Date(Date.now() - 3_600_000));

    expect(counts).toMatchObject({ COMPLETED: 1, FAILED: 1, RUNNING: 1 });
  });

  it('excludes executions outside the window', async () => {
    await start();
    await sql`UPDATE "WorkflowExecutions" SET "startedAt" = now() - interval '30 days'`.execute(
      harness.db
    );

    expect(await search.statusCounts(namespaceId, new Date(Date.now() - 3_600_000))).toEqual({});
  });
});

describe('engine gauges', () => {
  it('reports zero on an idle install', async () => {
    const gauges = await metrics.gauges();

    expect(gauges.decideQueueDepth).toBe(0);
    expect(gauges.workflowsRunning).toBe(0);
    expect(gauges.outboxDeadLettered).toBe(0);
  });

  it('counts running workflows', async () => {
    await start();
    await start();
    const done = await start();
    await finish(done.id, WorkflowStatus.COMPLETED);

    expect((await metrics.gauges()).workflowsRunning).toBe(2);
  });

  it('counts pending evaluations and their age', async () => {
    const wf = await start();
    await harness.db
      .insertInto('DecideQueues')
      .values({ workflowId: wf.id, namespaceId, reason: 'test' })
      .execute();
    await sql`UPDATE "DecideQueues" SET "enqueuedAt" = now() - interval '90 seconds'`.execute(
      harness.db
    );

    const gauges = await metrics.gauges();
    expect(gauges.decideQueueDepth).toBe(1);
    // Depth alone cannot distinguish a drained burst from a stall; age can.
    expect(gauges.decideQueueOldestSeconds).toBeGreaterThanOrEqual(89);
  });

  // A backing-off task is neither ready nor leased, so it is invisible in both
  // — which is precisely why it has its own gauge.
  it('counts delayed tasks separately from ready ones', async () => {
    const wf = await start();
    await harness.db
      .insertInto('TaskQueues')
      .values({
        namespaceId,
        queueName: 'a',
        taskId: '00000000-0000-7000-8000-000000000001',
        workflowId: wf.id,
        visibleAt: sql<Date>`now() + interval '5 minutes'`,
      })
      .execute();

    const gauges = await metrics.gauges();
    expect(gauges.tasksDelayed).toBe(1);
    expect(gauges.tasksReady).toBe(0);
  });

  it('caches between reads when told to', async () => {
    const cached = new EngineMetrics(harness.db, 60_000);
    const before = await cached.gauges();

    await start();

    expect((await cached.gauges()).workflowsRunning).toBe(before.workflowsRunning);
  });
});

describe('SearchRepository — the filters the executions screen offers', () => {
  it('finds one execution by its exact id', async () => {
    const wanted = await start({});
    await start({});

    const { executions } = await search.executions({ namespaceId, workflowId: wanted.id });
    expect(executions.map((e) => e.id)).toEqual([wanted.id]);
  });

  it('does not find another namespace’s execution by id', async () => {
    const foreign = await workflows.start({
      namespaceId: otherNamespaceId,
      defName: 'wf',
      defVersion: 1,
    });

    const { executions } = await search.executions({ namespaceId, workflowId: foreign.id });
    expect(executions).toEqual([]);
  });

  it('filters by idempotency key', async () => {
    const keyed = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      idempotencyKey: 'order-42',
    });
    await start({});

    const { executions } = await search.executions({ namespaceId, idempotencyKey: 'order-42' });
    expect(executions.map((e) => e.id)).toEqual([keyed.id]);
  });

  it('leaves out sub-workflows when asked, and only then', async () => {
    const parent = await start({});
    const child = await workflows.start({
      namespaceId,
      defName: 'child',
      defVersion: 1,
      parentWorkflowId: parent.id,
    });

    const all = await search.executions({ namespaceId });
    const topLevel = await search.executions({ namespaceId, excludeSubWorkflows: true });

    expect(all.executions.map((e) => e.id)).toContain(child.id);
    expect(topLevel.executions.map((e) => e.id)).toEqual([parent.id]);
  });
});

describe('overview', () => {
  it('counts the window, what is live now, and where failures cluster', async () => {
    const paid = await start({ defName: 'checkout' });
    const failed = await start({ defName: 'checkout' });
    const timedOut = await start({ defName: 'refund' });
    await start({ defName: 'refund' });
    await finish(paid.id, WorkflowStatus.COMPLETED);
    await finish(failed.id, WorkflowStatus.FAILED);
    await finish(timedOut.id, WorkflowStatus.TIMED_OUT);
    await sql`UPDATE "WorkflowExecutions" SET "reasonForIncompletion" = 'card declined' WHERE id = ${failed.id}`.execute(harness.db);
    // Started long ago and still running: live now, outside the window.
    const old = await start({ defName: 'nightly' });
    await sql`UPDATE "WorkflowExecutions" SET "startedAt" = now() - interval '3 days' WHERE id = ${old.id}`.execute(harness.db);
    await start({ namespace: otherNamespaceId });

    const overview = await search.overview(namespaceId, { hours: 24 });

    expect(overview.started).toBe(4);
    expect(overview.byStatus).toMatchObject({ COMPLETED: 1, FAILED: 1, TIMED_OUT: 1, RUNNING: 1 });
    expect(overview.running).toBe(2);
    expect(overview.bucketMinutes).toBe(60);
    const sums = overview.series.reduce(
      (acc, b) => ({ started: acc.started + b.started, completed: acc.completed + b.completed, failed: acc.failed + b.failed }),
      { started: 0, completed: 0, failed: 0 }
    );
    expect(sums).toEqual({ started: 4, completed: 1, failed: 2 });
    expect(overview.series.length).toBeGreaterThanOrEqual(24);
    expect(overview.hotspots.map((h) => [h.defName, h.failed])).toEqual([
      ['checkout', 1],
      ['refund', 1],
    ]);
    expect(overview.recentFailures.map((f) => f.workflowId).sort()).toEqual([failed.id, timedOut.id].sort());
    expect(overview.recentFailures.find((f) => f.workflowId === failed.id)?.reason).toBe('card declined');
    expect(overview.durationMs.p50).not.toBeNull();
  });

  it('leaves out the workflows the caller may not see', async () => {
    const secret = await start({ defName: 'payroll' });
    await finish(secret.id, WorkflowStatus.FAILED);
    await start({ defName: 'checkout' });

    const overview = await search.overview(namespaceId, { hours: 1, excludeDefNames: ['payroll'] });

    expect(overview.started).toBe(1);
    expect(overview.hotspots.map((h) => h.defName)).toEqual(['checkout']);
    expect(overview.recentFailures).toEqual([]);
    expect(overview.series.reduce((n, b) => n + b.failed, 0)).toBe(0);
  });

  it('answers an empty namespace with zeros, not nulls', async () => {
    const overview = await search.overview(namespaceId, { hours: 6 });
    expect(overview).toMatchObject({ started: 0, running: 0, queued: 0, hotspots: [], recentFailures: [], durationMs: { p50: null, p95: null } });
    expect(overview.series.every((b) => b.started === 0)).toBe(true);
  });
});

describe('searching inside executions', () => {
  const run = async (defName: string, input: Record<string, unknown>, extra: { correlationId?: string } = {}) =>
    workflows.start({ namespaceId, defName, defVersion: 1, input: input as never, ...extra });
  const ids = async (query: Parameters<SearchRepository['executions']>[0]) =>
    (await search.executions(query)).executions.map((e) => e.defName).sort();

  it('matches words anywhere, JSON by containment, names by prefix and reasons by text', async () => {
    const gold = await run('checkout_eu', { customer: { tier: 'gold', name: 'Ada Lovelace' }, total: 42 });
    await run('checkout_us', { customer: { tier: 'silver' }, total: '42' });
    const refund = await run('refund', { orderId: 'A-100%' }, { correlationId: 'ticket-9' });
    await harness.db
      .transaction()
      .execute((tx) => workflows.setStatus(refund.id, WorkflowStatus.FAILED, undefined, 'Card declined by issuer', tx));

    expect(await ids({ namespaceId, text: ['lovelace'] })).toEqual(['checkout_eu']);
    expect(await ids({ namespaceId, text: ['ticket-9'] })).toEqual(['refund']);
    // Long enough to pass the timestamp. The first 13 characters of a UUIDv7
    // are its millisecond clock and nothing else, so two executions started in
    // the same millisecond share them — which made this assertion fail roughly
    // whenever the machine was fast.
    expect(await ids({ namespaceId, text: [gold.id.slice(0, 18)] })).toEqual(['checkout_eu']);
    // Every word must appear, not any.
    expect(await ids({ namespaceId, text: ['ada', 'silver'] })).toEqual([]);
    // LIKE wildcards in a word are literal.
    expect(await ids({ namespaceId, text: ['100%'] })).toEqual(['refund']);
    expect(await ids({ namespaceId, text: ['A_1'] })).toEqual([]);

    expect(await ids({ namespaceId, contains: [{ field: 'input', alternatives: [{ customer: { tier: 'gold' } }] }] })).toEqual(['checkout_eu']);
    expect(await ids({ namespaceId, contains: [{ field: 'input', alternatives: [{ total: 42 }, { total: '42' }] }] })).toEqual([
      'checkout_eu',
      'checkout_us',
    ]);
    expect(await ids({ namespaceId, defNamePrefix: 'checkout_' })).toEqual(['checkout_eu', 'checkout_us']);
    expect(await ids({ namespaceId, defNamePrefix: 'checkout%' })).toEqual([]);
    expect(await ids({ namespaceId, reason: 'DECLINED' })).toEqual(['refund']);
  });

  it('stays inside the namespace whatever the words', async () => {
    await workflows.start({ namespaceId: otherNamespaceId, defName: 'secret_flow', defVersion: 1, input: { token: 'zebra' } });
    expect(await ids({ namespaceId, text: ['zebra'] })).toEqual([]);
    expect(await ids({ namespaceId, contains: [{ field: 'input', alternatives: [{ token: 'zebra' }] }] })).toEqual([]);
  });

  it('finds only sub-workflows when asked', async () => {
    const parent = await run('parent', {});
    await workflows.start({ namespaceId, defName: 'child', defVersion: 1, parentWorkflowId: parent.id, parentTaskId: parent.id } as never);
    expect(await ids({ namespaceId, onlySubWorkflows: true })).toEqual(['child']);
    expect(await ids({ namespaceId, excludeSubWorkflows: true })).toEqual(['parent']);
  });
});
