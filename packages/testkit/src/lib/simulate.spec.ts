import { TaskType, WorkflowStatus } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate.js';

/**
 * The simulator is only worth anything if it agrees with the server, so each
 * case here is a behaviour the store and API suites also prove against Postgres.
 */

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({ name: ref, taskReferenceName: ref, type: TaskType.SIMPLE, ...extra });

describe('simulate', () => {
  it('runs a sequence with mocked outputs flowing into later inputs and the workflow output', async () => {
    const result = await simulate(
      {
        name: 'checkout',
        version: 1,
        outputParameters: { receipt: '${charge.output.receiptId}' },
        tasks: [
          simple('reserve', { inputParameters: { sku: '${workflow.input.sku}' } }),
          simple('charge', { inputParameters: { hold: '${reserve.output.holdId}' } }),
        ],
      },
      {
        input: { sku: 'A-1' },
        mocks: { reserve: { output: { holdId: 'h-9' } }, charge: { output: { receiptId: 'r-1' } } },
      }
    );

    expect(result).toMatchObject({ status: WorkflowStatus.COMPLETED, output: { receipt: 'r-1' }, unmocked: [] });
    expect(result.tasks.map((t) => [t.refName, t.input])).toEqual([
      ['reserve', { sku: 'A-1' }],
      ['charge', { hold: 'h-9' }],
    ]);
  });

  it('takes the SWITCH branch the data chooses and skips the other', async () => {
    const definition = {
      name: 'route',
      version: 1,
      tasks: [
        {
          name: 'decide',
          taskReferenceName: 'decide',
          type: TaskType.SWITCH,
          evaluatorType: 'value-param',
          expression: 'tier',
          inputParameters: { tier: '${workflow.input.tier}' },
          decisionCases: { gold: [simple('concierge')] },
          defaultCase: [simple('standard')],
        },
      ],
    };

    const gold = await simulate(definition, { input: { tier: 'gold' } });
    expect(gold.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.refName)).toContain('concierge');
    expect(gold.tasks.find((t) => t.refName === 'standard')?.status).not.toBe('COMPLETED');

    const other = await simulate(definition, { input: { tier: 'silver' } });
    expect(other.tasks.map((t) => t.refName)).toContain('standard');
    expect(other.tasks.find((t) => t.refName === 'concierge')?.status ?? 'SKIPPED').not.toBe('COMPLETED');
  });

  it('retries by the task definition, taking one mock per attempt', async () => {
    const result = await simulate(
      { name: 'flaky', version: 1, tasks: [simple('call')] },
      {
        taskDefs: { call: { retryCount: 2, retryDelaySeconds: 0 } },
        mocks: { call: [{ status: 'FAILED', reason: 'timeout' }, { status: 'FAILED', reason: 'timeout' }, { output: { ok: true } }] },
      }
    );

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.tasks.map((t) => [t.attempt, t.status])).toEqual([
      [0, 'FAILED'],
      [1, 'FAILED'],
      [2, 'COMPLETED'],
    ]);
  });

  it('fails the workflow when retries run out, with the reason', async () => {
    const result = await simulate(
      { name: 'broken', version: 1, tasks: [simple('call')] },
      { mocks: { call: { status: 'FAILED', reason: 'card declined' } } }
    );
    expect(result.status).toBe(WorkflowStatus.FAILED);
    expect(result.reasonForIncompletion).toMatch(/card declined/);
  });

  it('loops, forks and joins as the engine decides', async () => {
    const result = await simulate(
      {
        name: 'batches',
        version: 1,
        tasks: [
          {
            name: 'loop',
            taskReferenceName: 'loop',
            type: TaskType.DO_WHILE,
            loopCondition: '${loop.output.iteration} < 3',
            inputParameters: {},
            loopOver: [
              {
                name: 'fork',
                taskReferenceName: 'fork',
                type: TaskType.FORK_JOIN,
                forkTasks: [[simple('left')], [simple('right')]],
              },
              { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
            ],
          },
        ],
      },
      {}
    );

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.tasks.filter((t) => t.refName === 'left').length).toBeGreaterThanOrEqual(2);
    expect(result.unmocked.sort()).toEqual(['left', 'right']);
  });

  it('runs a sub-workflow for real when given its definition', async () => {
    const child = { name: 'child', version: 1, outputParameters: { doubled: '${inner.output.value}' }, tasks: [simple('inner')] };
    const result = await simulate(
      {
        name: 'parent',
        version: 1,
        outputParameters: { fromChild: '${sub.output.doubled}' },
        tasks: [{ name: 'sub', taskReferenceName: 'sub', type: TaskType.SUB_WORKFLOW, subWorkflowParam: { name: 'child' } }],
      },
      { subWorkflows: { child }, mocks: { inner: { output: { value: 42 } } } }
    );

    expect(result).toMatchObject({ status: WorkflowStatus.COMPLETED, output: { fromChild: 42 } });
  });

  it('runs pure tasks for real through an execute hook', async () => {
    const result = await simulate(
      { name: 'calc', version: 1, outputParameters: { total: '${sum.output.total}' }, tasks: [{ name: 'sum', taskReferenceName: 'sum', type: TaskType.INLINE, inputParameters: { a: 2, b: 3 } }] },
      {
        execute: async (task) =>
          task.taskType === TaskType.INLINE ? { output: { total: Number(task.input['a']) + Number(task.input['b']) } } : undefined,
      }
    );
    expect(result).toMatchObject({ status: WorkflowStatus.COMPLETED, output: { total: 5 }, unmocked: [] });
    expect(result.tasks[0].mocked).toBe(false);
  });

  it('reports a workflow that cannot finish as stuck, naming what it waits on', async () => {
    const result = await simulate(
      { name: 'forever', version: 1, tasks: [{ name: 'spin', taskReferenceName: 'spin', type: TaskType.DO_WHILE, loopCondition: 'true', loopOver: [simple('body')] }] },
      { maxEvaluations: 50 }
    );
    expect(result.status).toBe('STUCK');
    expect(result.reasonForIncompletion).toMatch(/spin/);
  });

  it('resumes a YIELD with its mocked signal', async () => {
    const result = await simulate(
      { name: 'gate', version: 1, outputParameters: { decision: '${hold.output.decision}' }, tasks: [{ name: 'hold', taskReferenceName: 'hold', type: TaskType.YIELD }] },
      { mocks: { hold: { output: { decision: 'go' } } } }
    );
    expect(result).toMatchObject({ status: WorkflowStatus.COMPLETED, output: { decision: 'go' } });
  });
});

describe('simulate refuses what registration refuses', () => {
  it('rejects a loop condition that would silently run once', async () => {
    await expect(
      simulate({
        name: 'bad',
        version: 1,
        tasks: [{ name: 'l', taskReferenceName: 'l', type: 'DO_WHILE', loopCondition: '$.l.iteration < 3', loopOver: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] }],
      })
    ).rejects.toThrow(/looks like an expression but is not one/);
  });
});

describe('saga compensation', () => {
  const order = (shipMock: unknown) => ({
    name: 'order',
    version: 1,
    tasks: [
      simple('reserve', { compensateWith: 'release_stock' }),
      simple('charge', {
        compensateWith: { name: 'refund', taskReferenceName: 'refund', type: TaskType.SIMPLE, inputParameters: { txn: '${charge.output.txnId}' } },
      }),
      simple('ship'),
      simple('notify', { compensateWith: 'unsend' }),
    ],
    shipMock,
  });

  it('undoes completed tasks most recent first, then fails with the original reason', async () => {
    const { shipMock: _, ...definition } = order(undefined);
    const result = await simulate(definition, {
      taskDefs: { ship: { retryCount: 0 } },
      mocks: { charge: { output: { txnId: 'tx-9' } }, ship: { status: 'FAILED', reason: 'carrier down' } },
    });

    expect(result.status).toBe(WorkflowStatus.FAILED);
    expect(result.reasonForIncompletion).toBe('task "ship" ended as FAILED after 1 attempt(s): carrier down (compensated: charge, reserve)'.replace('task "ship" ended as FAILED after 1 attempt(s): ', ''));
    const compensations = result.tasks.filter((t) => ['refund', 'reserve__compensate'].includes(t.refName));
    expect(compensations.map((t) => t.refName)).toEqual(['refund', 'reserve__compensate']);
    expect(compensations[0].input).toEqual({ txn: 'tx-9' });
    expect(compensations[1].input).toMatchObject({ output: {} });
    // `notify` never ran, so there is nothing of it to undo.
    expect(result.tasks.map((t) => t.refName)).not.toContain('notify__compensate');
  });

  it('compensates nothing when the workflow succeeds', async () => {
    const { shipMock: _, ...definition } = order(undefined);
    const result = await simulate(definition, {});
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.tasks.some((t) => t.refName.endsWith('compensate') || t.refName === 'refund')).toBe(false);
  });

  it('fails with both reasons when a compensation itself fails', async () => {
    const { shipMock: _, ...definition } = order(undefined);
    const result = await simulate(definition, {
      taskDefs: { ship: { retryCount: 0 }, refund: { retryCount: 0 } },
      mocks: { ship: { status: 'FAILED', reason: 'carrier down' }, refund: { status: 'FAILED', reason: 'refund api 500' } },
    });
    expect(result.status).toBe(WorkflowStatus.FAILED);
    expect(result.reasonForIncompletion).toMatch(/carrier down; compensation "refund" for "charge" failed: refund api 500/);
    // The unwind stops at the failure rather than carrying on regardless.
    expect(result.tasks.map((t) => t.refName)).not.toContain('reserve__compensate');
  });

  it('unwinds a business failure raised by TERMINATE, but not an intentional TERMINATED', async () => {
    const withTerminate = (status: string) => ({
      name: 't',
      version: 1,
      tasks: [
        simple('reserve', { compensateWith: 'release_stock' }),
        { name: 'stop', taskReferenceName: 'stop', type: TaskType.TERMINATE, inputParameters: { terminationStatus: status, terminationReason: 'out of stock' } },
      ],
    });
    const failed = await simulate(withTerminate('FAILED'), {});
    expect(failed.tasks.map((t) => t.refName)).toContain('reserve__compensate');
    expect(failed.reasonForIncompletion).toMatch(/out of stock \(compensated: reserve\)/);

    const terminated = await simulate(withTerminate('TERMINATED'), {});
    expect(terminated.tasks.map((t) => t.refName)).not.toContain('reserve__compensate');
  });

  it('refuses a compensation that reuses a reference or is control flow', async () => {
    await expect(simulate({ name: 'x', version: 1, tasks: [simple('a', { compensateWith: simple('b') }), simple('b')] })).rejects.toThrow(/duplicate taskReferenceName "b"/);
    await expect(
      simulate({ name: 'y', version: 1, tasks: [simple('a', { compensateWith: { name: 'n', taskReferenceName: 'n', type: TaskType.NOOP } })] })
    ).rejects.toThrow(/must be a task that does work/);
  });
});
