import { randomUUID } from 'node:crypto';
import { TaskStatus, TaskType } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_LOGS_PER_TASK, MAX_LOG_LINE, TaskLogRepository } from './task-log.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

let harness: PostgresHarness;
let logs: TaskLogRepository;
let workflows: WorkflowRepository;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  logs = new TaskLogRepository(harness.db);
  workflows = new WorkflowRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

/** A task leased to a worker, with the token that worker holds. */
async function leasedTask() {
  const workflow = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  const task = await workflows.insertTask(
    {
      workflowId: workflow.id,
      namespaceId,
      refName: 'charge',
      taskDefName: 'charge',
      taskType: TaskType.SIMPLE,
      status: TaskStatus.SCHEDULED,
      attempt: 0,
      iteration: 0,
      input: {},
    },
    harness.db
  );
  const leaseToken = randomUUID();
  await workflows.markTaskStarted(workflow.id, task!.id, 'worker-1', leaseToken);
  return { workflowId: workflow.id, taskId: task!.id, leaseToken };
}

describe('TaskLogRepository', () => {
  it('appends lines and reads them back in the order written', async () => {
    const task = await leasedTask();

    await logs.append({ namespaceId, ...task, entries: [{ message: 'one' }, { message: 'two', level: 'warn' }] });
    await logs.append({ namespaceId, ...task, entries: [{ message: 'three', level: 'error' }] });

    const lines = await logs.list(namespaceId, task.taskId);
    expect(lines.map((l) => [l.message, l.level])).toEqual([
      ['one', 'info'],
      ['two', 'warn'],
      ['three', 'error'],
    ]);
  });

  it('refuses a worker that does not hold the lease', async () => {
    // A log that can be forged is worse than no log during an investigation.
    const task = await leasedTask();

    const outcome = await logs.append({
      namespaceId,
      ...task,
      leaseToken: randomUUID(),
      entries: [{ message: 'forged' }],
    });

    expect(outcome).toBe('not_found');
    expect(await logs.list(namespaceId, task.taskId)).toEqual([]);
  });

  it('does not accept or show lines across namespaces', async () => {
    const task = await leasedTask();
    const other = await seedNamespace(harness.db, 'other');

    expect(await logs.append({ namespaceId: other, ...task, entries: [{ message: 'x' }] })).toBe('not_found');

    await logs.append({ namespaceId, ...task, entries: [{ message: 'mine' }] });
    expect(await logs.list(other, task.taskId)).toEqual([]);
  });

  it('cuts an over-long line and says it did', async () => {
    const task = await leasedTask();
    await logs.append({ namespaceId, ...task, entries: [{ message: 'x'.repeat(MAX_LOG_LINE + 50) }] });

    const [line] = await logs.list(namespaceId, task.taskId);
    expect(line.message).toContain('line truncated');
    expect(line.message.length).toBeLessThan(MAX_LOG_LINE + 100);
  });

  it('stops recording at the per-task cap and leaves a line saying so', async () => {
    const task = await leasedTask();
    const entries = Array.from({ length: MAX_LOGS_PER_TASK + 10 }, (_, i) => ({ message: `line ${i}` }));

    await logs.append({ namespaceId, ...task, entries });
    await logs.append({ namespaceId, ...task, entries: [{ message: 'after the cap' }] });

    const lines = await logs.list(namespaceId, task.taskId, { limit: 2000, after: MAX_LOGS_PER_TASK - 5 });
    expect(lines.at(-1)?.message).toContain('log limit');
    expect(lines.some((l) => l.message === 'after the cap')).toBe(false);
  });

  it('pages with a cursor', async () => {
    const task = await leasedTask();
    await logs.append({ namespaceId, ...task, entries: [1, 2, 3, 4].map((n) => ({ message: String(n) })) });

    const first = await logs.list(namespaceId, task.taskId, { limit: 2 });
    const rest = await logs.list(namespaceId, task.taskId, { after: first.at(-1)?.id });
    expect([...first, ...rest].map((l) => l.message)).toEqual(['1', '2', '3', '4']);
  });
});
