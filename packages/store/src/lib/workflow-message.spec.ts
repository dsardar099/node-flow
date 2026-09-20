import { ErrorCode, TaskStatus, TaskType, WorkflowStatus, taskDefinitionSchema, workflowDefinitionSchema } from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowEventsRepository } from './workflow-events.repository.js';
import { WorkflowMessageRepository } from './workflow-message.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let messages: WorkflowMessageRepository;
let evaluator: Evaluator;
let namespaceId: string;
let blueprint: Blueprint;

const policy: TaskDefLoader = {
  load: async (_ns, names) => new Map(names.map((name) => [name, taskDefinitionSchema.parse({ name, retryCount: 0 })])),
};

const define = (tasks: unknown[]) => {
  blueprint = compileBlueprint(workflowDefinitionSchema.parse({ name: 'chat', version: 1, tasks }));
};
const pull = (ref = 'pull', batchSize?: number) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.PULL_WORKFLOW_MESSAGES,
  inputParameters: batchSize ? { batchSize } : {},
});
const noop = (ref: string) => ({ name: ref, taskReferenceName: ref, type: TaskType.NOOP });

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  messages = new WorkflowMessageRepository(harness.db, workflows, decideQueue);
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    new TaskQueueRepository(harness.db),
    new OutboxRepository(harness.db),
    { load: async () => blueprint },
    policy,
    new TimerRepository(harness.db),
    new WorkflowEventsRepository(harness.db),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    messages
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

async function start() {
  const wf = await workflows.start({ namespaceId, defName: 'chat', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await drain(wf.id);
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

const tasks = (workflowId: string) =>
  harness.db
    .selectFrom('TaskExecutions')
    .select(['refName', 'status', 'output', 'iteration'])
    .where('workflowId', '=', workflowId)
    .orderBy('scheduledAt')
    .execute();

describe('workflow messages', () => {
  it('waits for a message, then hands it over and moves on', async () => {
    define([pull(), noop('after')]);
    const wf = await start();
    expect(await tasks(wf.id)).toMatchObject([{ refName: 'pull', status: TaskStatus.IN_PROGRESS }]);

    expect(await messages.push(namespaceId, wf.id, { text: 'hello' })).toMatchObject({ delivered: true });
    await drain(wf.id);

    const [pulled, after] = await tasks(wf.id);
    expect(pulled).toMatchObject({ status: TaskStatus.COMPLETED, output: { count: 1, messages: [{ payload: { text: 'hello' } }] } });
    expect(after?.refName).toBe('after');
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  it('delivers messages that arrived before the pull was scheduled, oldest first, a batch at a time', async () => {
    define([noop('first'), pull('batch', 2), pull('rest', 5)]);
    const wf = await workflows.start({ namespaceId, defName: 'chat', defVersion: 1 });
    await messages.push(namespaceId, wf.id, { n: 1 });
    await messages.push(namespaceId, wf.id, { n: 2 });
    await messages.push(namespaceId, wf.id, { n: 3 });

    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);

    const byRef = Object.fromEntries((await tasks(wf.id)).map((t) => [t.refName, t]));
    const payloads = (ref: string) => ((byRef[ref].output as { messages: { payload: { n: number } }[] }).messages).map((m) => m.payload.n);
    expect(payloads('batch')).toEqual([1, 2]);
    expect(payloads('rest')).toEqual([3]);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
    expect((await messages.list(wf.id)).every((m) => m.consumedAt !== null)).toBe(true);
  });

  it('never hands one message to two pulls, however the pushes race', async () => {
    define([pull('a', 3), pull('b', 3), pull('c', 3), pull('d', 100)]);
    const wf = await start();

    await Promise.all(Array.from({ length: 12 }, (_, n) => messages.push(namespaceId, wf.id, { n }).then(() => drain(wf.id))));
    await drain(wf.id);

    const delivered = (await tasks(wf.id))
      .filter((t) => t.status === TaskStatus.COMPLETED)
      .flatMap((t) => (t.output as { messages: { payload: { n: number } }[] }).messages.map((m) => m.payload.n));
    expect(new Set(delivered).size).toBe(delivered.length);
    const consumed = (await messages.list(wf.id)).filter((m) => m.consumedAt !== null);
    expect(consumed).toHaveLength(delivered.length);
  });

  it('refuses a message for a finished execution, or one in another namespace', async () => {
    define([noop('only')]);
    const wf = await start();
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);

    await expect(messages.push(namespaceId, wf.id, {})).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    const other = await seedNamespace(harness.db, 'other');
    await expect(messages.push(other, wf.id, {})).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});
