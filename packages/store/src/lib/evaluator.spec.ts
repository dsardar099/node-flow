import { TaskStatus, TaskType, WorkflowStatus, workflowDefinitionSchema } from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import type { DbTransaction } from './database.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The full loop: decider, repositories and Postgres together.
 *
 * The engine tests prove the decider computes the right commands; the queue
 * tests prove the database primitives behave under contention. These prove the
 * two compose — that a workflow actually runs to completion, and that the
 * transaction boundary holds when things go wrong mid-flight.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let evaluator: Evaluator;
let namespaceId: string;

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

/** Serves blueprints from memory; registration lands with the metadata module. */
class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();

  register(tasks: unknown[], name = 'wf', version = 1): Blueprint {
    const bp = compileBlueprint(workflowDefinitionSchema.parse({ name, version, tasks }));
    this.map.set(`${name}:${version}`, bp);
    return bp;
  }

  async load(_ns: string, defName: string, defVersion: number): Promise<Blueprint> {
    const bp = this.map.get(`${defName}:${defVersion}`);
    if (!bp) throw new Error(`no blueprint for ${defName} v${defVersion}`);
    return bp;
  }
}

let blueprints: StubBlueprints;

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

async function startWorkflow(input: Record<string, unknown> = {}) {
  const wf = await workflows.start({
    namespaceId,
    defName: 'wf',
    defVersion: 1,
    input: input as never,
  });
  await decideQueue.enqueue(namespaceId, wf.id, 'started');
  return wf;
}

/** Leases a task, reports success, and requests the follow-up evaluation. */
async function completeNextTask(queueName: string, output: Record<string, unknown> = {}) {
  const [leased] = await taskQueue.lease(queueName, 'test-worker', 60, 1, namespaceId);
  expect(leased, `expected a task on queue "${queueName}"`).toBeDefined();

  await workflows.completeTask(
    leased.workflowId,
    leased.taskId,
    TaskStatus.COMPLETED,
    output as never,
    undefined,
    undefined
  );
  await taskQueue.acknowledge(queueName, leased.taskId, leased.leaseToken);
  await decideQueue.enqueue(namespaceId, leased.workflowId, 'task completed');
  return leased;
}

describe('Evaluator — running a workflow end to end', () => {
  it('drives a three-step workflow to completion', async () => {
    blueprints.register([simple('a'), simple('b'), simple('c')]);
    const wf = await startWorkflow();

    await evaluator.evaluate(wf.id);
    await completeNextTask('a');
    await evaluator.evaluate(wf.id);
    await completeNextTask('b');
    await evaluator.evaluate(wf.id);
    await completeNextTask('c');
    await evaluator.evaluate(wf.id);

    const finished = await workflows.findById(wf.id);
    expect(finished?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('queues the first task on the first evaluation', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await startWorkflow();

    const outcome = await evaluator.evaluate(wf.id);

    expect(outcome.evaluated).toBe(true);
    expect(await taskQueue.depth('a', namespaceId)).toMatchObject({ available: 1, leased: 0 });
    // 'b' must not be queued before 'a' finishes.
    expect(await taskQueue.depth('b', namespaceId)).toMatchObject({ available: 0, leased: 0 });
  });

  it('threads a task output into the next task input', async () => {
    blueprints.register([
      simple('charge'),
      simple('ship', { inputParameters: { txn: '${charge.output.txnId}' } }),
    ]);
    const wf = await startWorkflow();

    await evaluator.evaluate(wf.id);
    await completeNextTask('charge', { txnId: 'tx-77' });
    await evaluator.evaluate(wf.id);

    const [shipTask] = await taskQueue.lease('ship', 'w', 60, 1, namespaceId);
    const tasks = await workflows.loadPendingTasks(wf.id);
    const ship = tasks.find((t) => t.refName === 'ship');

    expect(shipTask).toBeDefined();
    expect(ship?.input).toMatchObject({ kind: 'inline', value: { txn: 'tx-77' } });
  });

  it('fails the workflow when a task exhausts its retries', async () => {
    blueprints.register([simple('a', { retryCount: 0 })]);
    const wf = await startWorkflow();

    await evaluator.evaluate(wf.id);
    const [leased] = await taskQueue.lease('a', 'w', 60, 1, namespaceId);
    await workflows.completeTask(
      wf.id,
      leased.taskId,
      TaskStatus.FAILED,
      undefined,
      'payment declined',
      undefined
    );
    await decideQueue.enqueue(namespaceId, wf.id, 'task failed');
    await evaluator.evaluate(wf.id);

    const finished = await workflows.findById(wf.id);
    expect(finished?.status).toBe(WorkflowStatus.FAILED);
    expect(finished?.reasonForIncompletion).toBe('payment declined');
  });

  it('runs parallel branches and joins them', async () => {
    blueprints.register([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('left')], [simple('right')]],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
      simple('after'),
    ]);
    const wf = await startWorkflow();

    // Fork resolves in-pass and schedules both branches.
    await evaluator.evaluate(wf.id);
    await evaluator.evaluate(wf.id);

    expect((await taskQueue.depth('left', namespaceId)).available).toBe(1);
    expect((await taskQueue.depth('right', namespaceId)).available).toBe(1);

    await completeNextTask('left');
    await evaluator.evaluate(wf.id);
    await completeNextTask('right');
    await evaluator.evaluate(wf.id);
    await evaluator.evaluate(wf.id);

    expect((await taskQueue.depth('after', namespaceId)).available).toBe(1);
  });
});

describe('Evaluator — transaction boundary', () => {
  // The claim is taken first and inside the transaction, so a redundant
  // evaluation finds nothing to claim and does no work.
  it('does not evaluate a workflow with no pending request', async () => {
    blueprints.register([simple('a')]);
    const wf = await startWorkflow();

    const first = await evaluator.evaluate(wf.id);
    const second = await evaluator.evaluate(wf.id);

    expect(first.evaluated).toBe(true);
    expect(second.evaluated).toBe(false);
  });

  it('ignores a terminal workflow', async () => {
    blueprints.register([simple('a')]);
    const wf = await startWorkflow();
    await harness.db.transaction().execute((tx: DbTransaction) =>
      workflows.setStatus(wf.id, WorkflowStatus.TERMINATED, undefined, 'operator', tx)
    );
    await decideQueue.enqueue(namespaceId, wf.id, 'late arrival');

    expect((await evaluator.evaluate(wf.id)).evaluated).toBe(false);
  });

  // Idempotency in practice: replaying an evaluation must not double-schedule,
  // which is what lets the engine always prefer an extra pass to a missed one.
  it('does not double-schedule when the same evaluation runs twice', async () => {
    blueprints.register([simple('a'), simple('b')]);
    const wf = await startWorkflow();

    await evaluator.evaluate(wf.id);
    await completeNextTask('a');

    await evaluator.evaluate(wf.id);
    await decideQueue.enqueue(namespaceId, wf.id, 'redundant');
    await evaluator.evaluate(wf.id);

    expect((await taskQueue.depth('b', namespaceId)).available).toBe(1);
  });

  // Nothing observable may escape a transaction that rolls back.
  it('leaves no trace when the evaluation transaction fails', async () => {
    blueprints.register([simple('a')]);
    const wf = await startWorkflow();

    const broken = new Evaluator(harness.db,
      workflows,
      decideQueue,
      taskQueue,
      outbox,
      {
        load: async () => {
          throw new Error('blueprint store unavailable');
        },
      }
    );

    await expect(broken.evaluate(wf.id)).rejects.toThrow('blueprint store unavailable');

    // The claim survived the rollback, so the wakeup is not lost.
    expect(await decideQueue.depth()).toBe(1);
    expect(await taskQueue.depth('a', namespaceId)).toMatchObject({ available: 0, leased: 0 });

    // A healthy evaluator picks up exactly where the failed one left off.
    expect((await evaluator.evaluate(wf.id)).evaluated).toBe(true);
    expect((await taskQueue.depth('a', namespaceId)).available).toBe(1);
  });
});

describe('Evaluator — outbox', () => {
  // Completion used to publish `workflow.completed` and failure `workflow.failed`,
  // which nothing consumed: every finished run retried ten times and then sat
  // in the dead letter. Lifecycle events now go only to status listeners that
  // asked for them (status-listener.spec).
  it('writes nothing to the outbox for a completion nobody listens to', async () => {
    blueprints.register([simple('a')]);
    const wf = await startWorkflow();

    await evaluator.evaluate(wf.id);
    await completeNextTask('a', { done: true });
    await evaluator.evaluate(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe('COMPLETED');
    expect(await outbox.pendingCount()).toBe(0);
  });
});

describe('Evaluator — idempotent starts', () => {
  it('returns the same execution for a repeated idempotency key', async () => {
    blueprints.register([simple('a')]);

    const first = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      idempotencyKey: 'order-42',
    });
    const second = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      idempotencyKey: 'order-42',
    });

    expect(second.id).toBe(first.id);
  });
});

describe('Evaluator — taskToDomain at start', () => {
  const queues = async (workflowId: string) =>
    (
      await harness.db
        .selectFrom('TaskQueues')
        .innerJoin('TaskExecutions', 'TaskExecutions.id', 'TaskQueues.taskId')
        .select(['TaskExecutions.refName', 'TaskExecutions.domain', 'TaskQueues.queueName'])
        .where('TaskQueues.workflowId', '=', workflowId)
        .orderBy('TaskExecutions.refName')
        .execute()
    ).map((row) => [row.refName, row.domain, row.queueName]);

  const start = async (taskToDomain: Record<string, string>) => {
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1, taskToDomain });
    await decideQueue.enqueue(namespaceId, wf.id, 'started');
    return wf;
  };

  it('routes worker tasks by name, then *, over the domain in the definition', async () => {
    blueprints.register([
      {
        type: TaskType.FORK_JOIN,
        name: 'fan',
        taskReferenceName: 'fan',
        forkTasks: [[simple('charge', { domain: 'defined' })], [simple('ship', { domain: 'defined' })], [simple('notify')]],
      },
      { type: TaskType.JOIN, name: 'join', taskReferenceName: 'join', joinOn: ['charge', 'ship', 'notify'] },
    ]);
    const wf = await start({ charge: 'eu-west', '*': 'canary' });
    await evaluator.evaluate(wf.id);

    expect(await queues(wf.id)).toEqual([
      ['charge', 'eu-west', 'charge:eu-west'],
      ['notify', 'canary', 'notify:canary'],
      ['ship', 'canary', 'ship:canary'],
    ]);
    expect((await workflows.findById(wf.id))?.taskToDomain).toEqual({ charge: 'eu-west', '*': 'canary' });
  });

  it('keeps the definition’s domain when the run does not route that task', async () => {
    blueprints.register([simple('charge', { domain: 'defined' }), simple('ship')]);
    const wf = await start({ refund: 'eu-west' });
    await evaluator.evaluate(wf.id);
    expect(await queues(wf.id)).toEqual([['charge', 'defined', 'charge:defined']]);
  });

  it('sends a retry to the same domain', async () => {
    blueprints.register([simple('charge', { retryCount: 1, retryDelaySeconds: 0 })]);
    const wf = await start({ charge: 'eu-west' });
    await evaluator.evaluate(wf.id);
    const [leased] = await taskQueue.lease('charge:eu-west', 'w', 60, 1, namespaceId);
    await workflows.completeTask(wf.id, leased.taskId, TaskStatus.FAILED, undefined, 'declined', undefined);
    await taskQueue.acknowledge('charge:eu-west', leased.taskId, leased.leaseToken);
    await decideQueue.enqueue(namespaceId, wf.id, 'failed');
    await evaluator.evaluate(wf.id);

    expect(await queues(wf.id)).toEqual([['charge', 'eu-west', 'charge:eu-west']]);
  });

  it('never routes a system task, which only this server’s runner leases', async () => {
    blueprints.register([{ name: 'call', taskReferenceName: 'call', type: TaskType.HTTP, inputParameters: { uri: 'https://example.com' } }]);
    const wf = await start({ '*': 'canary', call: 'canary' });
    await evaluator.evaluate(wf.id);
    expect(await queues(wf.id)).toEqual([['call', null, 'call']]);
  });

  it('hands a sub-workflow the parent’s routing with its own entries on top', async () => {
    blueprints.register([
      {
        name: 'child',
        taskReferenceName: 'child',
        type: TaskType.SUB_WORKFLOW,
        subWorkflowParam: { name: 'child_wf', version: 1, taskToDomain: { ship: 'us-east' } },
      },
    ]);
    const wf = await start({ charge: 'eu-west', ship: 'eu-west' });
    await evaluator.evaluate(wf.id);

    const event = await harness.db
      .selectFrom('OutboxEvents')
      .select('payload')
      .where('topic', '=', 'subworkflow.start')
      .executeTakeFirstOrThrow();
    expect((event.payload as { taskToDomain: unknown }).taskToDomain).toEqual({ charge: 'eu-west', ship: 'us-east' });
  });
});

/**
 * Postgres `jsonb` cannot hold a NUL inside a string, and JSON can.
 *
 * A task calling an external API is the usual way one arrives. Before this was
 * handled the insert threw "unsupported Unicode escape sequence", the task
 * never reached a terminal state, and the run hung with nothing in the UI to
 * say why — found exactly that way, against a public API whose test data
 * contained one.
 */
describe('output that Postgres cannot store verbatim', () => {
  const NUL = String.fromCharCode(0);

  it('records a task output containing a NUL rather than failing the write', async () => {
    blueprints.register([simple('a')]);
    const wf = await startWorkflow();
    await evaluator.evaluate(wf.id);

    await completeNextTask('a', {
      body: { note: `ends here${NUL}and continues`, nested: [`x${NUL}y`] },
      clean: 'untouched',
    });
    await evaluator.evaluate(wf.id);

    const finished = await workflows.findById(wf.id);
    expect(finished?.status).toBe(WorkflowStatus.COMPLETED);

    const task = await workflows.findTaskByRef(wf.id, 'a');
    // Stored as a payload envelope, inline until it is large enough to offload.
    const output = (task?.output as unknown as { value: { body: { note: string; nested: string[] }; clean: string } }).value;
    // The NUL is gone and everything around it survives: the task did its work,
    // and refusing to record the result over one unprintable byte is the worse
    // bug.
    expect(output.body.note).toBe('ends hereand continues');
    expect(output.body.nested).toEqual(['xy']);
    expect(output.clean).toBe('untouched');
  });
});
