import {
  inlinePayload,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  workflowDefinitionSchema,
  type EvaluationState,
  type TaskExecution,
} from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { compileBlueprint } from './blueprint.js';
import type { Command, ScheduleTaskCommand, StartWorkflowCommand } from './commands.js';
import { decide } from './decide.js';

const NOW = new Date('2026-09-13T00:00:00Z');

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

const build = (tasks: unknown[]) =>
  compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }));

const t = (
  refName: string,
  status: TaskStatus,
  overrides: Partial<TaskExecution> = {}
): TaskExecution => ({
  id: `t-${refName}`,
  workflowId: 'wf-1',
  refName,
  taskDefName: refName,
  taskType: TaskType.SIMPLE,
  status,
  attempt: 0,
  iteration: 0,
  input: inlinePayload({}),
  scheduledAt: NOW,
  ...overrides,
});

function state(overrides: Partial<EvaluationState> = {}): EvaluationState {
  return {
    workflow: {
      id: 'wf-1',
      namespaceId: 'ns-1',
      defName: 'wf',
      defVersion: 1,
      status: WorkflowStatus.RUNNING,
      correlationId: 'corr-1',
      priority: 0,
      input: inlinePayload({}),
      variables: {},
      startedAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
    pending: [],
    completed: [],
    resolvedRefs: new Map(),
    // Default to "has run" unless a test is explicitly exercising a fresh start,
    // which is what an empty override of both lists means.
    hasAnyTask: (overrides.pending?.length ?? 0) + (overrides.completed?.length ?? 0) > 0,
    now: NOW,
    ...overrides,
  };
}

const scheduledCmds = (c: Command[]) =>
  c.filter((x): x is ScheduleTaskCommand => x.type === 'ScheduleTask');
const refs = (c: Command[]) => scheduledCmds(c).map((x) => x.refName);
const types = (c: Command[]) => c.map((x) => x.type);

describe('decide — FORK_JOIN_DYNAMIC', () => {
  const dynamicFork = () =>
    build([
      simple('prepare'),
      {
        name: 'fanOut',
        taskReferenceName: 'fanOut',
        type: TaskType.FORK_JOIN_DYNAMIC,
        dynamicForkTasksParam: 'dynamicTasks',
        dynamicForkTasksInputParamName: 'dynamicTasksInput',
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN },
      simple('after'),
    ]);

  const forkTask = (refNames: string[]) =>
    t('fanOut', TaskStatus.COMPLETED, {
      taskType: TaskType.FORK_JOIN_DYNAMIC,
      input: inlinePayload({
        dynamicTasks: refNames.map((r) => ({ name: 'process', taskReferenceName: r })),
        dynamicTasksInput: Object.fromEntries(refNames.map((r) => [r, { item: r }])),
      }),
    });

  /**
   * The fork has to *become* complete, which every other test here assumes.
   *
   * They all start from a `forkTask(...)` that is already `COMPLETED`, so they
   * prove what happens next and nothing about how it got there. It never got
   * there: operators are never queued to a worker, and `decide` only advances
   * tasks that are already terminal, so a fork that does not settle during the
   * pass that schedules it is inserted `SCHEDULED` and stays that way. Every
   * workflow using a dynamic fork hung with zero branches materialised.
   */
  it('settles in the pass that schedules it, with its branches', () => {
    const { commands } = decide(
      dynamicFork(),
      state({
        completed: [
          t('prepare', TaskStatus.COMPLETED, {
            output: inlinePayload({
              tasks: [{ name: 'process', taskReferenceName: 'only' }],
              inputs: { only: { item: 'x' } },
            }),
          }),
        ],
      })
    );

    const fork = scheduledCmds(commands).find((c) => c.refName === 'fanOut');
    expect(fork, 'the fork must be scheduled').toBeDefined();
    // Unresolved means it would sit in the frontier with nothing to finish it.
    expect(fork?.resolved?.status).toBe(TaskStatus.COMPLETED);
  });

  it('materialises one task per runtime entry with its own input', () => {
    const { commands } = decide(
      dynamicFork(),
      state({ completed: [forkTask(['item1', 'item2', 'item3'])] })
    );

    expect(refs(commands).sort()).toEqual(['item1', 'item2', 'item3']);
    const first = scheduledCmds(commands).find((c) => c.refName === 'item1');
    expect(first?.input).toEqual({ item: 'item1' });
    expect(first?.taskDefName).toBe('process');
  });

  // The forked refs exist nowhere in the blueprint, so the fork's own output is
  // the only place the JOIN can learn what it must wait for.
  it('records the forked refs in the fork output for the join to read', () => {
    const { commands } = decide(dynamicFork(), state({ completed: [forkTask(['a', 'b'])] }));

    const complete = commands.find((c) => c.type === 'CompleteTask');
    expect(complete).toMatchObject({ refName: 'fanOut', output: { forkedTaskRefs: ['a', 'b'] } });
  });

  // Fanning out over an empty collection is normal, not an error — it must skip
  // to the join rather than stall the workflow forever.
  it('goes straight to the join when the task list is empty', () => {
    const { commands } = decide(dynamicFork(), state({ completed: [forkTask([])] }));
    expect(refs(commands)).toEqual(['join', 'after']);
  });

  it('does not fire the join while a dynamic branch is still running', () => {
    const { commands } = decide(
      dynamicFork(),
      state({
        pending: [t('item2', TaskStatus.IN_PROGRESS, { parentRefName: 'fanOut' })],
        completed: [t('item1', TaskStatus.COMPLETED, { parentRefName: 'fanOut' })],
        resolvedRefs: new Map([['fanOut', forkTaskWithOutput(['item1', 'item2'])]]),
      })
    );
    expect(refs(commands)).not.toContain('join');
  });

  it('fires the join once every dynamic branch has completed', () => {
    const { commands } = decide(
      dynamicFork(),
      state({
        completed: [t('item2', TaskStatus.COMPLETED, { parentRefName: 'fanOut' })],
        resolvedRefs: new Map([
          ['fanOut', forkTaskWithOutput(['item1', 'item2'])],
          ['item1', t('item1', TaskStatus.COMPLETED, { parentRefName: 'fanOut' })],
        ]),
      })
    );
    expect(refs(commands)).toEqual(['join', 'after']);
  });

  // A dynamic branch has no blueprint node, so there is no `optional` flag to
  // consult — it must still fail the workflow rather than vanish silently.
  it('fails the workflow when a dynamic branch fails', () => {
    const { commands } = decide(
      dynamicFork(),
      state({
        completed: [
          t('item1', TaskStatus.FAILED, {
            parentRefName: 'fanOut',
            reasonForIncompletion: 'item processing failed',
          }),
        ],
        resolvedRefs: new Map([['fanOut', forkTaskWithOutput(['item1'])]]),
      })
    );
    expect(commands.find((c) => c.type === 'FailWorkflow')).toMatchObject({
      reason: 'item processing failed',
    });
  });

  function forkTaskWithOutput(refNames: string[]): TaskExecution {
    return t('fanOut', TaskStatus.COMPLETED, {
      taskType: TaskType.FORK_JOIN_DYNAMIC,
      output: inlinePayload({ forkedTaskRefs: refNames }),
    });
  }
});

describe('decide — DYNAMIC', () => {
  const dynamicTask = () =>
    build([
      simple('pick'),
      {
        name: 'runIt',
        taskReferenceName: 'runIt',
        type: TaskType.DYNAMIC,
        dynamicTaskNameParam: 'taskToExecute',
        inputParameters: { taskToExecute: '${pick.output.handler}', payload: 'x' },
      },
    ]);

  it('dispatches the task named by the runtime parameter', () => {
    const { commands } = decide(
      dynamicTask(),
      state({
        completed: [
          t('pick', TaskStatus.COMPLETED, { output: inlinePayload({ handler: 'sendEmail' }) }),
        ],
      })
    );

    const cmd = scheduledCmds(commands)[0];
    expect(cmd.taskDefName).toBe('sendEmail');
    // It becomes an ordinary worker task once resolved.
    expect(cmd.taskType).toBe(TaskType.SIMPLE);
  });

  it('falls back to the node name when the parameter is missing', () => {
    const { commands } = decide(
      dynamicTask(),
      state({ completed: [t('pick', TaskStatus.COMPLETED, { output: inlinePayload({}) })] })
    );
    expect(scheduledCmds(commands)[0].taskDefName).toBe('runIt');
  });
});

describe('decide — EXCLUSIVE_JOIN', () => {
  // An exclusive join follows a SWITCH: one branch runs, the rest are SKIPPED.
  // Waiting for all of them would mean waiting for tasks that will never exist.
  const exclusiveWorkflow = () =>
    build([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('pathA')], [simple('pathB')]],
      },
      {
        name: 'merge',
        taskReferenceName: 'merge',
        type: TaskType.EXCLUSIVE_JOIN,
        joinOn: ['pathA', 'pathB'],
      },
      simple('after'),
    ]);

  it('fires as soon as one branch completes, even with another skipped', () => {
    const { commands } = decide(
      exclusiveWorkflow(),
      state({
        completed: [t('pathA', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([['pathB', t('pathB', TaskStatus.SKIPPED)]]),
      })
    );
    expect(refs(commands)).toEqual(['merge', 'after']);
  });

  /**
   * The join carries the result of the branch that ran.
   *
   * The tests around it only ever asserted *when* it fires, so it went out
   * behaving like a plain JOIN: a map keyed by branch, with the skipped branch
   * in it. That makes `${merge.output.field}` — the whole reason to put a join
   * after a SWITCH — unreadable unless the caller already knows which branch
   * won, which is what the operator exists to hide.
   */
  it('outputs the taken branch’s result, not a map of branches', () => {
    const { commands } = decide(
      exclusiveWorkflow(),
      state({
        completed: [t('pathA', TaskStatus.COMPLETED, { output: inlinePayload({ side: 'A' }) })],
        resolvedRefs: new Map([['pathB', t('pathB', TaskStatus.SKIPPED)]]),
      })
    );

    const merge = scheduledCmds(commands).find((c) => c.refName === 'merge');
    expect(merge?.resolved?.output).toEqual({ side: 'A' });
  });

  /**
   * And it must read that branch from this pass, not from the prefetch.
   *
   * `resolvedRefs` is a snapshot taken before the evaluation, so the branch
   * that completed *in* this pass appears there as it was — non-terminal, with
   * no output. Consulting it first handed back `{}` for the one branch whose
   * result the join exists to carry.
   */
  it('prefers the branch as it finished in this pass over the prefetch', () => {
    const stale = t('pathA', TaskStatus.SCHEDULED, { output: undefined });

    const { commands } = decide(
      exclusiveWorkflow(),
      state({
        completed: [t('pathA', TaskStatus.COMPLETED, { output: inlinePayload({ side: 'fresh' }) })],
        resolvedRefs: new Map([
          ['pathA', stale],
          ['pathB', t('pathB', TaskStatus.SKIPPED)],
        ]),
      })
    );

    const merge = scheduledCmds(commands).find((c) => c.refName === 'merge');
    expect(merge?.resolved?.output).toEqual({ side: 'fresh' });
  });

  /**
   * A skipped branch must not fire the join on its own.
   *
   * The branches of a SWITCH settle at different times: the untaken ones are
   * written `SKIPPED` straight away while the taken one is still being
   * dispatched. A skip is a terminal task, so the next evaluation advances it
   * into the join — which resolves as it is scheduled, and so settled with
   * nothing but skips to read. The taken branch schedules it later.
   */
  it('does not fire off a skipped branch while the taken one is still running', () => {
    const { commands } = decide(
      exclusiveWorkflow(),
      state({
        completed: [t('pathB', TaskStatus.SKIPPED)],
        // pathA is dispatched but has produced nothing yet.
        pending: [t('pathA', TaskStatus.IN_PROGRESS)],
      })
    );

    expect(refs(commands)).not.toContain('merge');
  });

  it('does not fire when every branch was skipped', () => {
    const { commands } = decide(
      exclusiveWorkflow(),
      state({
        completed: [t('pathA', TaskStatus.SKIPPED)],
        resolvedRefs: new Map([['pathB', t('pathB', TaskStatus.SKIPPED)]]),
      })
    );
    expect(refs(commands)).not.toContain('merge');
  });
});

describe('decide — START_WORKFLOW', () => {
  const fireAndForget = () =>
    build([
      simple('a'),
      {
        name: 'kickoff',
        taskReferenceName: 'kickoff',
        type: TaskType.START_WORKFLOW,
        inputParameters: { reportDate: '2026-09-13' },
        subWorkflowParam: { name: 'nightlyReport' },
      },
      simple('after'),
    ]);

  it('starts the workflow and continues without waiting', () => {
    const { commands } = decide(fireAndForget(), state({ completed: [t('a', TaskStatus.COMPLETED)] }));

    const start = commands.find((c): c is StartWorkflowCommand => c.type === 'StartWorkflow');
    expect(start).toMatchObject({ defName: 'nightlyReport', input: { reportDate: '2026-09-13' } });

    // Unlike SUB_WORKFLOW, the parent does not block on the child.
    expect(refs(commands)).toContain('after');
    expect(types(commands)).not.toContain('StartSubWorkflow');
  });

  // A replayed evaluation must not launch the child a second time.
  it('carries an idempotency key derived from the task identity', () => {
    const s = state({ completed: [t('a', TaskStatus.COMPLETED)] });
    const first = decide(fireAndForget(), s);
    const second = decide(fireAndForget(), s);

    const keyOf = (c: Command[]) =>
      (c.find((x) => x.type === 'StartWorkflow') as StartWorkflowCommand).idempotencyKey;

    expect(keyOf(first.commands)).toBe('wf-1:kickoff:0');
    expect(keyOf(second.commands)).toBe(keyOf(first.commands));
  });
});
