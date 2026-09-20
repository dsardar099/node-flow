import { TaskType } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { replay, type RecordedExecution } from './replay.js';
import { simulate } from './simulate.js';

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({ name: ref, taskReferenceName: ref, type: TaskType.SIMPLE, ...extra });

/** A switch on the charge result, retries on charge, and a loop — the paths replay must re-derive. */
const v1 = {
  name: 'order',
  version: 1,
  tasks: [
    simple('charge', { inputParameters: { amount: '${workflow.input.amount}' } }),
    {
      name: 'route',
      taskReferenceName: 'route',
      type: TaskType.SWITCH,
      evaluatorType: 'value-param',
      expression: 'status',
      inputParameters: { status: '${charge.output.status}' },
      decisionCases: { paid: [simple('ship', { inputParameters: { txn: '${charge.output.txn}' } })] },
      defaultCase: [simple('refund')],
    },
  ],
  outputParameters: { txn: '${charge.output.txn}' },
};

/** What a real run recorded: charge failed once, then paid; ship ran. */
async function recordedRun(): Promise<RecordedExecution> {
  const run = await simulate(v1, {
    input: { amount: 42 },
    taskDefs: { charge: { retryCount: 1, retryDelaySeconds: 0 } },
    mocks: { charge: [{ status: 'FAILED', reason: 'card declined' }, { output: { status: 'paid', txn: 'T-9' } }], ship: { output: { tracking: 'Z1' } } },
  });
  expect(run.status).toBe('COMPLETED');
  return {
    status: run.status,
    input: { amount: 42 },
    output: run.output,
    tasks: run.tasks.map((t, i) => ({ ...t, scheduledAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })),
  };
}

describe('replay', () => {
  it('reproduces a recorded run exactly on the same definition', async () => {
    const recorded = await recordedRun();
    const result = await replay(v1, recorded, { taskDefs: { charge: { retryCount: 1, retryDelaySeconds: 0 } } });
    expect(result.divergences).toEqual([]);
    expect(result.matches).toBe(true);
    // Nothing ran for real: every worker task came from what was recorded.
    expect(result.replay.tasks.filter((t) => t.taskType === 'SIMPLE').every((t) => t.mocked)).toBe(true);
  });

  it('shows how a changed definition would have taken the run elsewhere', async () => {
    const recorded = await recordedRun();
    // v2 routes on a field the recorded output does not have, so every run falls to refund.
    const v2 = { ...v1, version: 2, tasks: [v1.tasks[0], { ...v1.tasks[1], inputParameters: { status: '${charge.output.state}' } }] };
    const result = await replay(v2, recorded, { taskDefs: { charge: { retryCount: 1, retryDelaySeconds: 0 } } });
    expect(result.matches).toBe(false);
    // Branches not taken are recorded as SKIPPED, so the other route shows as each branch changing places.
    expect(result.divergences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'status', refName: 'ship', recorded: 'COMPLETED', replayed: 'SKIPPED' }),
        expect.objectContaining({ kind: 'status', refName: 'refund', recorded: 'SKIPPED', replayed: 'COMPLETED' }),
      ])
    );
  });

  it('reports a task input that resolves differently', async () => {
    const recorded = await recordedRun();
    const v3 = { ...v1, tasks: [simple('charge', { inputParameters: { amount: '${workflow.input.amount}', currency: 'EUR' } }), v1.tasks[1]] };
    const result = await replay(v3, recorded, { taskDefs: { charge: { retryCount: 1, retryDelaySeconds: 0 } } });
    expect(result.divergences.filter((d) => d.kind === 'input').map((d) => [d.refName, d.attempt])).toEqual([
      ['charge', 0],
      ['charge', 1],
    ]);
  });

  // With no retries left the recorded failure ends the run.
  it('reports a different ending', async () => {
    const recorded = await recordedRun();
    const result = await replay(v1, recorded, { taskDefs: { charge: { retryCount: 0 } } });
    expect(result.divergences).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'workflow-status', recorded: 'COMPLETED', replayed: 'FAILED' })]));
  });
});

describe('simulate matches the evaluator on in-pass tasks', () => {
  it('publishes each of several sequential events once', async () => {
    const event = (ref: string) => ({ name: ref, taskReferenceName: ref, type: TaskType.EVENT, inputParameters: { sink: ref } });
    const run = await simulate({ name: 'e', version: 1, tasks: [event('a'), event('b'), event('c')] });
    expect(run.published.map((p) => p.sink)).toEqual(['a', 'b', 'c']);
  });
});
