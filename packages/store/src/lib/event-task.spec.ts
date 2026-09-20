import {
  InvalidDefinitionError,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowEventsRepository } from './workflow-events.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * `EVENT` — the workflow emitting something.
 *
 * Resolved by the decider rather than run by a task runner, which is the whole
 * design: the publish and the task's completion share one transaction, so they
 * commit together or not at all. A runner would put the publish outside that
 * transaction, and a lease expiring in between would retry the task and publish
 * twice with nothing recording the first.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let events: WorkflowEventsRepository;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[]): void {
    this.map.set(
      'wf:1',
      compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }))
    );
  }
  async load(): Promise<Blueprint> {
    const bp = this.map.get('wf:1');
    if (!bp) throw new Error('no blueprint');
    return bp;
  }
}

const defLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [
        name,
        taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0 }),
      ])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  events = new WorkflowEventsRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    defLoader,
    timers,
    events
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

const eventTask = (ref: string, input: Record<string, unknown>) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.EVENT,
  inputParameters: input,
});

async function start(tasks: unknown[]) {
  blueprints.register(tasks);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await drain(wf.id);
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 15; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

/**
 * Only what the `EVENT` task published.
 *
 * The engine publishes its own lifecycle events — `workflow.completed` and
 * friends — through the same outbox, so an unfiltered count is measuring two
 * different things at once.
 */
const published = (sink = 'orders') =>
  harness.db
    .selectFrom('OutboxEvents')
    .select(['topic', 'payload'])
    .where('topic', '=', sink)
    .execute();

describe('publishing', () => {
  it('writes the event to the outbox and completes the task', async () => {
    const wf = await start([
      eventTask('notify', { sink: 'orders', payload: { id: 'A-1', total: 42 } }),
    ]);

    const rows = await published();
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe('orders');
    expect(rows[0].payload as Record<string, JsonValue>).toMatchObject({ id: 'A-1', total: 42 });

    const task = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  // Nothing executes it, so a queue entry would sit there until it was
  // reclaimed as abandoned.
  it('never reaches a queue', async () => {
    const wf = await start([eventTask('notify', { sink: 'orders' })]);

    expect(
      await harness.db
        .selectFrom('TaskQueues')
        .select('taskId')
        .where('workflowId', '=', wf.id)
        .execute()
    ).toEqual([]);
  });

  // The sink names the destination; it is not part of the message.
  it('excludes the sink from the payload', async () => {
    await start([eventTask('notify', { sink: 'orders', id: 'A-1' })]);

    const payload = (await published())[0].payload as Record<string, JsonValue>;
    expect(payload['id']).toBe('A-1');
    expect(payload['sink']).toBeUndefined();
  });

  // Delivery is at-least-once, so a consumer needs something stable to
  // deduplicate on.
  it('carries an identity a subscriber can deduplicate on', async () => {
    const wf = await start([eventTask('notify', { sink: 'orders' })]);

    const payload = (await published())[0].payload as Record<string, JsonValue>;
    const meta = payload['_event'] as Record<string, JsonValue>;

    expect(meta['workflowId']).toBe(wf.id);
    expect(String(meta['id'])).toContain(wf.id);
  });

  /**
   * The property the whole design exists for.
   *
   * Evaluation is idempotent and a redundant pass is normal — the lost-wakeup
   * rule deliberately errs toward scheduling another. Re-running one must not
   * publish the event a second time.
   */
  it('publishes once however many times the workflow is evaluated', async () => {
    const wf = await start([eventTask('notify', { sink: 'orders' })]);

    for (let i = 0; i < 5; i++) {
      await decideQueue.enqueue(namespaceId, wf.id, 'redundant pass');
      await drain(wf.id);
    }

    expect(await published()).toHaveLength(1);
  });

  /**
   * The transactional coupling, tested by breaking the transaction.
   *
   * The claim is that the event and the task commit together or not at all.
   * Nothing else in this file actually proves that — every other test observes
   * the happy path, where a publish outside the transaction would look
   * identical. So this one makes the evaluation fail *after* the event has been
   * written, and asserts that nothing reached the outbox.
   */
  it('publishes nothing if the evaluation does not commit', async () => {
    const exploding = new WorkflowEventsRepository(harness.db);
    exploding.append = async () => {
      throw new Error('history write failed');
    };

    const failing = new Evaluator(
      harness.db,
      workflows,
      decideQueue,
      taskQueue,
      outbox,
      blueprints,
      defLoader,
      timers,
      exploding
    );

    blueprints.register([eventTask('notify', { sink: 'orders' })]);
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');

    await expect(failing.evaluate(wf.id)).rejects.toThrow('history write failed');

    // Neither the event nor the task survived.
    expect(await published()).toEqual([]);
    expect(
      await harness.db
        .selectFrom('TaskExecutions')
        .select('id')
        .where('workflowId', '=', wf.id)
        .execute()
    ).toEqual([]);
  });

  // Found live: three EVENTs in a row published the second and third twice.
  it('publishes each of several sequential events exactly once', async () => {
    const wf = await start([
      eventTask('first', { sink: 'a', n: 1 }),
      eventTask('second', { sink: 'b', n: 2 }),
      eventTask('third', { sink: 'c', n: 3 }),
    ]);
    for (let i = 0; i < 3; i++) {
      await decideQueue.enqueue(namespaceId, wf.id, 'redundant pass');
      await drain(wf.id);
    }

    const rows = await harness.db.selectFrom('OutboxEvents').select('topic').where('topic', 'in', ['a', 'b', 'c']).execute();
    expect(rows.map((r) => r.topic).sort()).toEqual(['a', 'b', 'c']);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  // Steps resolved in-pass are marked seen; the unwind must still find them.
  it('compensates steps that resolved in-pass, publishing each once', async () => {
    const wf = await start([
      { ...eventTask('charge', { sink: 'charges' }), compensateWith: { name: 'refund', taskReferenceName: 'refund', type: TaskType.SIMPLE } },
      { ...eventTask('reserve', { sink: 'reservations' }), compensateWith: { name: 'release', taskReferenceName: 'release', type: TaskType.SIMPLE } },
      { name: 'stop', taskReferenceName: 'stop', type: TaskType.TERMINATE, inputParameters: { terminationStatus: 'FAILED', terminationReason: 'out of stock' } },
    ]);
    for (let i = 0; i < 3; i++) {
      await decideQueue.enqueue(namespaceId, wf.id, 'redundant pass');
      await drain(wf.id);
    }

    const topics = (await harness.db.selectFrom('OutboxEvents').select('topic').orderBy('id').execute()).map((r) => r.topic);
    expect(topics).toEqual(['charges', 'reservations']);
    // Most recent first: the unwind has started with the last step's compensation.
    const queued = await harness.db.selectFrom('TaskQueues').select('queueName').execute();
    expect(queued.map((q) => q.queueName)).toEqual(['release']);
  });

  it('records the publish in the workflow history', async () => {
    const wf = await start([eventTask('notify', { sink: 'orders' })]);

    const history = await events.history(wf.id);
    expect(history.some((e) => e.type === 'event.published')).toBe(true);
  });

  it('passes its output to the next task', async () => {
    const wf = await start([
      eventTask('notify', { sink: 'orders' }),
      {
        name: 'after',
        taskReferenceName: 'after',
        type: TaskType.NOOP,
        inputParameters: { where: '${notify.output.sink}' },
      },
    ]);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('input')
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'after')
      .executeTakeFirstOrThrow();

    expect((row.input as Record<string, JsonValue>)['where']).toBe('orders');
  });
});

describe('refusing', () => {
  /**
   * Caught at registration, not at run time.
   *
   * A missing sink is a typo in a definition and the author is right there;
   * discovering it when the workflow runs also has nowhere good to put the
   * error, because the decider resolves `EVENT` itself and a resolved task has
   * no way to fail.
   */
  it('rejects a definition whose EVENT has no sink', () => {
    expect(() =>
      compileBlueprint(
        workflowDefinitionSchema.parse({
          name: 'wf',
          version: 1,
          tasks: [eventTask('notify', { id: 'A-1' })],
        })
      )
    ).toThrow(InvalidDefinitionError);
  });

  it('rejects an empty sink too', () => {
    expect(() =>
      compileBlueprint(
        workflowDefinitionSchema.parse({
          name: 'wf',
          version: 1,
          tasks: [eventTask('notify', { sink: '   ' })],
        })
      )
    ).toThrow(InvalidDefinitionError);
  });
});
