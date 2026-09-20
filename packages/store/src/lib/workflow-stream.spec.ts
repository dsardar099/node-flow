import { randomUUID } from 'node:crypto';
import { TaskStatus, TaskType } from '@node-flow-dev/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowRepository } from './workflow.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowEventNotifier } from './workflow-event-notifier.js';
import { WorkflowEventsRepository, WorkflowEventType } from './workflow-events.repository.js';

/**
 * The live execution stream, end to end against real Postgres.
 *
 * The properties worth breaking here are the two the design leans on: that the
 * notification is raised by the *database* so no writer can forget it, and that
 * a subscriber reading from its own cursor loses nothing when a notification
 * never arrives. The second is tested by never delivering one.
 */

let harness: PostgresHarness;
let events: WorkflowEventsRepository;
let notifier: WorkflowEventNotifier;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  events = new WorkflowEventsRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await notifier?.stop();
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

/** A workflow row, because `WorkflowEvents` is meaningless without one. */
async function startWorkflow(): Promise<string> {
  const row = await harness.db
    .insertInto('WorkflowExecutions')
    .values({
      namespaceId,
      defName: 'streamed',
      defVersion: 1,
      status: 'RUNNING',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

const append = (workflowId: string, type: WorkflowEventType = WorkflowEventType.TASK_SCHEDULED) =>
  events.append(workflowId, [{ type, payload: { ref: 'charge' } }], harness.db);

/** Resolves with the first notification for `workflowId`, or rejects on timeout. */
function nextNotification(workflowId: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`no notification for ${workflowId} within ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = notifier.subscribe(workflowId, (seq) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(seq);
    });
  });
}

describe('WorkflowEventNotifier', () => {
  beforeEach(async () => {
    notifier = new WorkflowEventNotifier({ url: harness.url });
    await notifier.start();
  });

  it('notifies on an append nobody asked it to announce', async () => {
    const workflowId = await startWorkflow();
    const arrived = nextNotification(workflowId);

    // Straight through the repository — no notify call anywhere in sight. If
    // this passes, the trigger is doing it, which is the entire claim.
    await append(workflowId);

    expect(await arrived).toBe(1);
  });

  it('carries the sequence number, so a subscriber knows how far ahead the log is', async () => {
    const workflowId = await startWorkflow();

    // Waits for the notification to *reach* 3 rather than taking the first one
    // that arrives. Delivery is asynchronous, so notifications for the earlier
    // appends can land after this subscription registers — and a test that
    // asserted on the first arrival would be asserting delivery timing, which
    // the notifier does not promise. What it does promise is the one thing a
    // subscriber relies on: the number tells you how far ahead the log is.
    const reachedThree = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error('never saw the log reach seq 3'));
      }, 5_000);

      const unsubscribe = notifier.subscribe(workflowId, (seq) => {
        if (seq < 3) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(seq);
      });
    });

    await append(workflowId);
    await append(workflowId);
    await append(workflowId);

    expect(await reachedThree).toBe(3);
  });

  it('does not wake a subscriber watching a different execution', async () => {
    const watched = await startWorkflow();
    const other = await startWorkflow();

    const seen: number[] = [];
    const unsubscribe = notifier.subscribe(watched, (seq) => seen.push(seq));

    // Subscribed *before* the appends, which is this codebase's own ordering
    // rule and not a detail: a waiter registered afterwards misses the
    // notification that already fired and then waits out its whole timeout,
    // which is a passing test that proves nothing and takes five seconds to
    // do it.
    const arrived = nextNotification(watched, 5_000);

    // The watched execution's own event proves the listener was live
    // throughout — without it, an empty `seen` would also be what a broken
    // connection looks like. Appended second, so the foreign notification has
    // had its chance to arrive by the time this one does.
    await append(other);
    await append(watched);
    await arrived;

    unsubscribe();
    expect(seen).toEqual([1]);
  });

  it('stops delivering once unsubscribed', async () => {
    const workflowId = await startWorkflow();
    const seen: number[] = [];

    const unsubscribe = notifier.subscribe(workflowId, (seq) => seen.push(seq));
    unsubscribe();

    await append(workflowId);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(seen).toEqual([]);
    expect(notifier.watching(workflowId)).toBe(0);
  });

  it('survives a malformed payload rather than killing every stream', async () => {
    const workflowId = await startWorkflow();

    // Raised directly on the channel, bypassing the trigger — the shape a
    // future writer or an unrelated tool might send. A throw in the pg client's
    // notification handler would take the connection down with it.
    await sql`SELECT pg_notify('node_flow_workflow_events', 'not-a-cursor')`.execute(harness.db);

    const arrived = nextNotification(workflowId);
    await append(workflowId);

    expect(await arrived).toBe(1);
    expect(notifier.connected).toBe(true);
  });
});

describe('reading from a cursor', () => {
  it('returns only what the subscriber has not seen', async () => {
    const workflowId = await startWorkflow();
    await append(workflowId, WorkflowEventType.WORKFLOW_STARTED);
    await append(workflowId, WorkflowEventType.TASK_SCHEDULED);
    await append(workflowId, WorkflowEventType.TASK_COMPLETED);

    const since = await events.since(workflowId, 1);

    expect(since.map((event) => event.seq)).toEqual([2, 3]);
    expect(since[0].type).toBe(WorkflowEventType.TASK_SCHEDULED);
  });

  it('returns the whole gap when notifications were missed entirely', async () => {
    // The dropped-connection case, without needing to drop a connection: the
    // subscriber's cursor is what it reads from, so three unannounced appends
    // come back together. This is the property that makes a missed
    // notification cost latency and nothing else.
    const workflowId = await startWorkflow();
    await append(workflowId);
    await append(workflowId);
    await append(workflowId);

    expect((await events.since(workflowId, 0)).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('bounds what one read can return', async () => {
    const workflowId = await startWorkflow();
    for (let i = 0; i < 5; i++) await append(workflowId);

    expect(await events.since(workflowId, 0, 2)).toHaveLength(2);
  });

  it('is empty once the subscriber is caught up', async () => {
    const workflowId = await startWorkflow();
    await append(workflowId);

    expect(await events.since(workflowId, 1)).toEqual([]);
  });

  it('does not mix in another execution’s events', async () => {
    const watched = await startWorkflow();
    const other = await startWorkflow();
    await append(other);
    await append(watched);

    const since = await events.since(watched, 0);
    expect(since).toHaveLength(1);
    expect(since[0].seq).toBe(1);
  });
});

describe('recording what happened to a task', () => {
  let workflows: WorkflowRepository;

  beforeEach(() => {
    workflows = new WorkflowRepository(harness.db);
  });

  const start = () =>
    workflows.start({ namespaceId, defName: 'recorded', defVersion: 1 });

  const scheduleTask = (workflowId: string, refName: string) =>
    workflows.insertTask(
      {
        workflowId,
        namespaceId,
        refName,
        taskDefName: refName,
        taskType: TaskType.SIMPLE,
        status: TaskStatus.SCHEDULED,
        attempt: 0,
        iteration: 0,
        input: {},
      },
      harness.db
    );

  it('writes workflow.started, so a history does not begin mid-story', async () => {
    const workflow = await start();

    const [first] = await events.history(workflow.id);
    expect(first.type).toBe(WorkflowEventType.WORKFLOW_STARTED);
    expect(first.seq).toBe(1);
    expect(first.payload['defName']).toBe('recorded');
  });

  it('records a completion, which nothing did before', async () => {
    const workflow = await start();
    const task = await scheduleTask(workflow.id, 'charge');

    await workflows.completeTask(
      workflow.id,
      task!.id,
      TaskStatus.COMPLETED,
      { txnId: 'abc' },
      undefined,
      undefined
    );

    const history = await events.history(workflow.id);
    const completion = history.find((e) => e.type === WorkflowEventType.TASK_COMPLETED);

    expect(completion).toBeDefined();
    expect(completion!.payload['refName']).toBe('charge');
    expect(completion!.seq).toBe(2);
  });

  it('distinguishes a failure from a timeout from a success', async () => {
    const workflow = await start();

    for (const [refName, status] of [
      ['a', TaskStatus.COMPLETED],
      ['b', TaskStatus.FAILED],
      ['c', TaskStatus.TIMED_OUT],
    ] as const) {
      const task = await scheduleTask(workflow.id, refName);
      await workflows.completeTask(
        workflow.id,
        task!.id,
        status,
        undefined,
        status === TaskStatus.FAILED ? 'upstream 500' : undefined,
        undefined
      );
    }

    const history = await events.history(workflow.id);
    expect(history.slice(1).map((e) => e.type)).toEqual([
      WorkflowEventType.TASK_COMPLETED,
      WorkflowEventType.TASK_FAILED,
      WorkflowEventType.TASK_TIMED_OUT,
    ]);
    expect(history[2].payload['reason']).toBe('upstream 500');
  });

  it('writes nothing when the fencing token does not match', async () => {
    const workflow = await start();
    const task = await scheduleTask(workflow.id, 'charge');

    // A worker whose lease was reclaimed. The update matches no row, so there
    // is no outcome to record — and recording one anyway would put a completion
    // in the history for a task that is still running.
    const recorded = await workflows.completeTask(
      workflow.id,
      task!.id,
      TaskStatus.COMPLETED,
      {},
      undefined,
      randomUUID()
    );

    expect(recorded).toBe(false);
    expect(await events.count(workflow.id)).toBe(1);
  });

  it('gives every concurrent completion its own sequence number', async () => {
    const workflow = await start();

    // Two branches of a fork finishing at the same instant, which is the case
    // the advisory lock exists for: both readers would otherwise see the same
    // `max(seq)` and write the same number, and a stream reading `seq > cursor`
    // would silently drop whichever landed first.
    const tasks = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((refName) => scheduleTask(workflow.id, refName))
    );

    await Promise.all(
      tasks.map((task) =>
        workflows.completeTask(
          workflow.id,
          task!.id,
          TaskStatus.COMPLETED,
          {},
          undefined,
          undefined
        )
      )
    );

    const history = await events.history(workflow.id);
    const seqs = history.map((event) => event.seq);

    expect(seqs).toHaveLength(7);
    expect(new Set(seqs).size).toBe(7);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
