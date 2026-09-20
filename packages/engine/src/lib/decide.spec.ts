import {
  inlinePayload,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  workflowDefinitionSchema,
  type EvaluationState,
  TimeoutPolicy,
  RetryLogic,
  taskDefinitionSchema,
  type JsonValue,
  type TaskExecution,
  type WorkflowExecution,
  type WorkflowTask,
} from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { compileBlueprint, type Blueprint } from './blueprint.js';
import type { Command, ScheduleTaskCommand } from './commands.js';
import { decide, failureWorkflowStart, parseDuration, switchExpressionProblem } from './decide.js';

const NOW = new Date('2026-09-13T00:00:00Z');
/** Midpoint "random" so retry jitter contributes nothing and delays are exact. */
const noJitter = () => 0.5;

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

function build(tasks: unknown[]) {
  return compileBlueprint(
    workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks })
  );
}

function workflow(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return {
    id: 'wf-1',
    namespaceId: 'ns-1',
    defName: 'wf',
    defVersion: 1,
    status: WorkflowStatus.RUNNING,
    priority: 0,
    input: inlinePayload({ orderId: 'o-42' }),
    variables: {},
    startedAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function task(
  refName: string,
  status: TaskStatus,
  overrides: Partial<TaskExecution> = {}
): TaskExecution {
  return {
    id: `t-${refName}-${overrides.attempt ?? 0}`,
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
  };
}

function state(overrides: Partial<EvaluationState> = {}): EvaluationState {
  return {
    workflow: workflow(),
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

const scheduled = (commands: Command[]): ScheduleTaskCommand[] =>
  commands.filter((c): c is ScheduleTaskCommand => c.type === 'ScheduleTask');
const refsScheduled = (commands: Command[]) => scheduled(commands).map((c) => c.refName);
const types = (commands: Command[]) => commands.map((c) => c.type);

const taskDefWith = (name: string, timeoutPolicy: TimeoutPolicy) =>
  new Map([[name, taskDefinitionSchema.parse({ name, timeoutPolicy })]]);

describe('decide — starting a workflow', () => {
  it('schedules the entry task on the first evaluation', () => {
    const { commands } = decide(build([simple('a'), simple('b')]), state());
    expect(refsScheduled(commands)).toEqual(['a']);
    expect(scheduled(commands)[0].attempt).toBe(0);
  });

  it('resolves task inputs against workflow input', () => {
    const bp = build([simple('a', { inputParameters: { id: '${workflow.input.orderId}' } })]);
    const { commands } = decide(bp, state());
    expect(scheduled(commands)[0].input).toEqual({ id: 'o-42' });
  });

  it('does nothing for a terminal workflow, so late results cannot revive it', () => {
    const bp = build([simple('a')]);
    const result = decide(
      bp,
      state({
        workflow: workflow({ status: WorkflowStatus.COMPLETED }),
        completed: [task('a', TaskStatus.COMPLETED)],
      })
    );
    expect(result.commands).toEqual([]);
    expect(result.noop).toBe(true);
  });

  it('schedules nothing while paused', () => {
    const bp = build([simple('a'), simple('b')]);
    const result = decide(
      bp,
      state({
        workflow: workflow({ status: WorkflowStatus.PAUSED }),
        completed: [task('a', TaskStatus.COMPLETED)],
      })
    );
    expect(result.commands).toEqual([]);
  });
});

describe('decide — sequential flow', () => {
  it('schedules the successor when a task completes', () => {
    const bp = build([simple('a'), simple('b'), simple('c')]);
    const { commands } = decide(bp, state({ completed: [task('a', TaskStatus.COMPLETED)] }));
    expect(refsScheduled(commands)).toEqual(['b']);
  });

  it('completes the workflow when the final task finishes', () => {
    const bp = build([simple('a'), simple('b')]);
    const { commands } = decide(
      bp,
      state({
        completed: [task('b', TaskStatus.COMPLETED, { output: inlinePayload({ ok: true }) })],
      })
    );
    expect(types(commands)).toEqual(['CompleteWorkflow']);
  });

  // Checking only `pending` would complete the workflow the instant its last
  // task finished, throwing away the successor scheduled in this same pass.
  it('does not complete the workflow while it is still scheduling work', () => {
    const bp = build([simple('a'), simple('b')]);
    const { commands } = decide(bp, state({ completed: [task('a', TaskStatus.COMPLETED)] }));
    expect(types(commands)).not.toContain('CompleteWorkflow');
  });

  it('does not complete the workflow while another task is still running', () => {
    const bp = build([simple('a'), simple('b')]);
    const { commands } = decide(
      bp,
      state({
        pending: [task('b', TaskStatus.IN_PROGRESS)],
        completed: [task('a', TaskStatus.COMPLETED)],
      })
    );
    expect(types(commands)).not.toContain('CompleteWorkflow');
  });

  it('passes a prior task output into a successor input', () => {
    const bp = build([
      simple('charge'),
      simple('ship', { inputParameters: { txn: '${charge.output.txnId}' } }),
    ]);
    const { commands } = decide(
      bp,
      state({
        completed: [
          task('charge', TaskStatus.COMPLETED, { output: inlinePayload({ txnId: 'tx-9' }) }),
        ],
      })
    );
    expect(scheduled(commands)[0].input).toEqual({ txn: 'tx-9' });
  });
});

describe('decide — idempotency', () => {
  // The engine deliberately prefers a redundant evaluation to a missed one, so
  // re-running a pass must never double-schedule.
  it('produces identical commands when the same state is evaluated twice', () => {
    const bp = build([simple('a'), simple('b')]);
    const s = state({ completed: [task('a', TaskStatus.COMPLETED)] });
    expect(decide(bp, s).commands).toEqual(decide(bp, s).commands);
  });

  it('does not reschedule a task that is already pending', () => {
    const bp = build([simple('a'), simple('b')]);
    const { commands } = decide(
      bp,
      state({
        pending: [task('b', TaskStatus.SCHEDULED)],
        completed: [task('a', TaskStatus.COMPLETED)],
      })
    );
    expect(refsScheduled(commands)).toEqual([]);
  });

  it('does not reschedule a task that already finished', () => {
    const bp = build([simple('a'), simple('b')]);
    const { commands } = decide(
      bp,
      state({
        completed: [task('a', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([['b', task('b', TaskStatus.COMPLETED)]]),
      })
    );
    expect(refsScheduled(commands)).toEqual([]);
  });
});

describe('decide — failure and retry', () => {
  it('retries a failed task with backoff while attempts remain', () => {
    const bp = build([simple('a', { retryCount: 3 })]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.FAILED, { attempt: 0 })] }),
      { random: noJitter }
    );

    expect(types(commands)).toEqual(['RetryTask']);
    const retry = commands[0];
    if (retry.type !== 'RetryTask') throw new Error('expected RetryTask');
    expect(retry.attempt).toBe(1);
    expect(retry.delaySeconds).toBeGreaterThan(0);
    expect(retry.previousTaskId).toBe('t-a-0');
  });

  it('fails the workflow once retries are exhausted', () => {
    const bp = build([simple('a', { retryCount: 1 })]);
    const { commands } = decide(
      bp,
      state({
        completed: [
          task('a', TaskStatus.FAILED, { attempt: 1, reasonForIncompletion: 'upstream 500' }),
        ],
      }),
      { random: noJitter }
    );

    expect(types(commands)).toEqual(['FailWorkflow']);
    expect(commands[0]).toMatchObject({ status: WorkflowStatus.FAILED, reason: 'upstream 500' });
  });

  // A worker returning FAILED_WITH_TERMINAL_ERROR is asserting the input will
  // never succeed; honouring retryCount anyway would burn attempts for nothing.
  it('never retries a terminal error, however many attempts remain', () => {
    const bp = build([simple('a', { retryCount: 10 })]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.FAILED_WITH_TERMINAL_ERROR, { attempt: 0 })] })
    );
    expect(types(commands)).toEqual(['FailWorkflow']);
  });

  it('retries a timeout under the RETRY policy', () => {
    const bp = build([simple('a', { retryCount: 2 })]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.TIMED_OUT, { attempt: 0 })] }),
      { random: noJitter, taskDefs: taskDefWith('a', TimeoutPolicy.RETRY) }
    );
    expect(types(commands)).toEqual(['RetryTask']);
  });

  // TIME_OUT_WF is the default. Retries remaining must not turn a missed
  // deadline into another full timeout per attempt.
  it('fails the workflow on a timeout under TIME_OUT_WF even with retries left', () => {
    const bp = build([simple('a', { retryCount: 2 })]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.TIMED_OUT, { attempt: 0 })] }),
      { random: noJitter, taskDefs: taskDefWith('a', TimeoutPolicy.TIME_OUT_WF) }
    );
    expect(commands[0]).toMatchObject({ type: 'FailWorkflow', status: WorkflowStatus.TIMED_OUT });
  });

  it('retries a timeout and reports TIMED_OUT when attempts run out', () => {
    const bp = build([simple('a', { retryCount: 0 })]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.TIMED_OUT, { attempt: 0 })] }),
      { random: noJitter }
    );
    expect(commands[0]).toMatchObject({ type: 'FailWorkflow', status: WorkflowStatus.TIMED_OUT });
  });

  it('carries on past a failed optional task instead of failing the workflow', () => {
    const bp = build([simple('a', { optional: true, retryCount: 0 }), simple('b')]);
    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.FAILED, { attempt: 0 })] }),
      { random: noJitter }
    );
    expect(types(commands)).not.toContain('FailWorkflow');
    expect(refsScheduled(commands)).toEqual(['b']);
  });

  it('grows the retry delay across attempts', () => {
    const bp = build([simple('a', { retryCount: 5 })]);
    const delayFor = (attempt: number) => {
      const { commands } = decide(
        bp,
        state({ completed: [task('a', TaskStatus.FAILED, { attempt })] }),
        { random: noJitter }
      );
      const c = commands[0];
      if (c.type !== 'RetryTask') throw new Error('expected RetryTask');
      return c.delaySeconds;
    };
    expect(delayFor(1)).toBeGreaterThan(delayFor(0));
    expect(delayFor(2)).toBeGreaterThan(delayFor(1));
  });
});

describe('decide — SWITCH', () => {
  const switchWorkflow = () =>
    build([
      simple('check'),
      {
        name: 'route',
        taskReferenceName: 'route',
        type: TaskType.SWITCH,
        expression: '${check.output.status}',
        decisionCases: { ok: [simple('shipIt')], failed: [simple('refund')] },
        defaultCase: [simple('escalate')],
      },
      simple('done'),
    ]);

  it('schedules only the matching case and skips the rest', () => {
    const { commands } = decide(
      switchWorkflow(),
      state({
        completed: [task('route', TaskStatus.COMPLETED, { output: inlinePayload({ caseValue: 'ok' }) })],
      })
    );

    expect(refsScheduled(commands)).toEqual(['shipIt']);
    const skipped = commands.filter((c) => c.type === 'SkipTask').map((c) => (c as { refName: string }).refName);
    expect(skipped.sort()).toEqual(['escalate', 'refund']);
  });

  it('falls back to the default branch when no case matches', () => {
    const { commands } = decide(
      switchWorkflow(),
      state({
        completed: [
          task('route', TaskStatus.COMPLETED, { output: inlinePayload({ caseValue: 'weird' }) }),
        ],
      })
    );
    expect(refsScheduled(commands)).toEqual(['escalate']);
  });

  // Untaken branches must be marked SKIPPED rather than simply left absent, or a
  // JOIN downstream of the switch waits forever on a task that will never exist.
  it('marks untaken branches SKIPPED so downstream joins are not deadlocked', () => {
    const { commands } = decide(
      switchWorkflow(),
      state({
        completed: [task('route', TaskStatus.COMPLETED, { output: inlinePayload({ caseValue: 'ok' }) })],
      })
    );
    expect(commands.some((c) => c.type === 'SkipTask')).toBe(true);
  });

  it('evaluates the expression when the task output carries no decision', () => {
    const { commands } = decide(
      switchWorkflow(),
      state({
        completed: [task('route', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([
          ['check', task('check', TaskStatus.COMPLETED, { output: inlinePayload({ status: 'failed' }) })],
        ]),
      })
    );
    expect(refsScheduled(commands)).toEqual(['refund']);
  });
});

describe('decide — SWITCH expression forms', () => {
  const withSwitch = (route: Partial<WorkflowTask>) =>
    build([
      {
        name: 'route',
        taskReferenceName: 'route',
        type: TaskType.SWITCH,
        decisionCases: { true: [simple('express')], gold: [simple('priority')] },
        defaultCase: [simple('standard')],
        ...route,
      },
    ]);

  const routed = (bp: Blueprint, input: Record<string, JsonValue>) =>
    refsScheduled(
      decide(bp, state({ completed: [task('route', TaskStatus.COMPLETED, { input: inlinePayload(input) })] })).commands
    );

  // Conductor's own form, and what nearly every migrated definition uses: the
  // expression names an input parameter. Read as literal text, it matched no
  // case and every run silently took the default branch.
  it('reads a value-param expression as the name of an input parameter', () => {
    const bp = withSwitch({ evaluatorType: 'value-param', expression: 'tier', inputParameters: { tier: '${workflow.input.tier}' } });
    expect(routed(bp, { tier: 'gold' })).toEqual(['priority']);
  });

  it('stringifies non-string case values so boolean inputs match their case', () => {
    const bp = withSwitch({ evaluatorType: 'value-param', expression: 'fast', inputParameters: { fast: '${workflow.input.fast}' } });
    expect(routed(bp, { fast: true })).toEqual(['express']);
  });

  it('decides the same way when the SWITCH is resolved as a system task', () => {
    const bp = withSwitch({ evaluatorType: 'value-param', expression: 'tier', inputParameters: { tier: 'gold' } });
    const scheduled = decide(bp, state({})).commands.find((c) => c.type === 'ScheduleTask') as ScheduleTaskCommand;
    expect(scheduled.resolved?.output).toEqual({ caseValue: 'gold' });
  });
});

describe('decide — an expression that cannot resolve', () => {
  // A poison pill before: thrown out of decide, the runner failed and retried
  // the same workflow forever while it sat at RUNNING with no reason recorded.
  it('fails that workflow with the reason instead of throwing', () => {
    // `a` reads a task that exists in the definition but has not run yet.
    const bp = build([simple('a', { inputParameters: { x: '${later.output.value}' } }), simple('later')]);
    const result = decide(bp, state({ hasAnyTask: false }));
    expect(result.commands).toEqual([
      expect.objectContaining({ type: 'FailWorkflow', status: WorkflowStatus.FAILED, reason: expect.stringMatching(/later/) }),
    ]);
  });
});

describe('decide — environment variables', () => {
  it('resolves both spellings into task input', () => {
    const bp = build([
      simple('call', { inputParameters: { url: '${workflow.env.API_BASE}/orders', region: '${env.limits.regions.0}' } }),
    ]);
    const { commands } = decide(
      bp,
      state({ hasAnyTask: false, env: { API_BASE: 'https://api.example.com', limits: { regions: ['eu'] } } })
    );
    const scheduled = commands.find((c) => c.type === 'ScheduleTask') as ScheduleTaskCommand;
    expect(scheduled.input).toEqual({ url: 'https://api.example.com/orders', region: 'eu' });
  });

  // Resolved at decision time, unlike a secret — so control flow can use it.
  it('lets a SWITCH branch on one', () => {
    const bp = build([
      {
        name: 'route',
        taskReferenceName: 'route',
        type: TaskType.SWITCH,
        expression: '${workflow.env.MODE}',
        decisionCases: { dry_run: [simple('log')] },
        defaultCase: [simple('send')],
      },
    ]);
    const { commands } = decide(bp, state({ hasAnyTask: false, env: { MODE: 'dry_run' } }));
    expect(refsScheduled(commands)).toContain('log');
    expect(refsScheduled(commands)).not.toContain('send');
  });
});

describe('decide — workflow output and signal-only WAIT', () => {
  // Declared outputs were ignored: the workflow finished with the last task's output.
  it('resolves the declared outputParameters when the workflow completes', () => {
    const bp = compileBlueprint(
      workflowDefinitionSchema.parse({
        name: 'wf',
        version: 1,
        outputParameters: { receipt: '${charge.output.id}', order: '${workflow.input.orderId}', skipped: '${never.output.x}' },
        tasks: [
          simple('charge'),
          {
            name: 'route',
            taskReferenceName: 'route',
            type: TaskType.SWITCH,
            expression: 'no',
            decisionCases: { yes: [simple('never')] },
            defaultCase: [],
          },
        ],
      })
    );
    expect(bp.allStaticRefs).toContain('charge');

    const { commands } = decide(
      bp,
      state({
        completed: [task('route', TaskStatus.COMPLETED, { output: inlinePayload({ caseValue: 'no' }) })],
        resolvedRefs: new Map([['charge', task('charge', TaskStatus.COMPLETED, { output: inlinePayload({ id: 'r-9' }) })]]),
      })
    );
    const complete = commands.find((c) => c.type === 'CompleteWorkflow');
    expect(complete).toMatchObject({ output: { receipt: 'r-9', order: 'o-42', skipped: null } });
  });

  it('arms no timer for a WAIT that is completed from outside', () => {
    const bp = build([{ name: 'gate', taskReferenceName: 'gate', type: TaskType.WAIT }]);
    const { commands } = decide(bp, state({ hasAnyTask: false }));
    expect(commands.some((c) => c.type === 'SetTimer' && (c as { kind: string }).kind === 'wait')).toBe(false);
  });

  it.each([
    ['30s', 30],
    ['10m 30s', 630],
    ['2 hours', 7200],
    ['1 day 4 hours', 100800],
    ['45', 45],
  ])('reads the duration "%s"', (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it('refuses a duration that is not one', () => {
    expect(parseDuration('10 fortnights')).toBeUndefined();
    expect(parseDuration('soon')).toBeUndefined();
  });
});

describe('decide — failure workflow', () => {
  const withFailureWorkflow = (extra: Record<string, unknown> = {}) =>
    compileBlueprint(
      workflowDefinitionSchema.parse({
        name: 'wf',
        version: 1,
        failureWorkflow: 'compensate',
        tasks: [simple('a', { retryCount: 0 })],
        ...extra,
      })
    );

  it('starts it with the failed run’s input and why it failed', () => {
    const { commands } = decide(
      withFailureWorkflow(),
      state({
        workflow: workflow({ input: inlinePayload({ orderId: 'A-1' }), correlationId: 'order-A-1' }),
        completed: [task('a', TaskStatus.FAILED, { reasonForIncompletion: 'card declined' })],
      })
    );

    const start = commands.find((c) => c.type === 'StartWorkflow');
    expect(start).toMatchObject({
      defName: 'compensate',
      correlationId: 'order-A-1',
      input: { orderId: 'A-1', failureStatus: WorkflowStatus.FAILED, reason: 'card declined', workflowType: 'wf' },
    });
    // Derived from the failed run, so a replayed evaluation starts it once.
    expect((start as { idempotencyKey?: string }).idempotencyKey).toMatch(/^failure-workflow:/);
  });

  it('pins the version when the definition names one', () => {
    const { commands } = decide(
      withFailureWorkflow({ failureWorkflowVersion: 3 }),
      state({ completed: [task('a', TaskStatus.FAILED)] })
    );
    expect(commands.find((c) => c.type === 'StartWorkflow')).toMatchObject({ defName: 'compensate', defVersion: 3 });
  });

  // A terminated run was stopped on purpose; compensating for it would undo
  // the operator's decision.
  it('is not started for a terminated run', () => {
    expect(
      failureWorkflowStart(withFailureWorkflow(), workflow(), WorkflowStatus.TERMINATED, 'operator')
    ).toBeUndefined();
    expect(failureWorkflowStart(withFailureWorkflow(), workflow(), WorkflowStatus.TIMED_OUT, 'late')).toMatchObject({
      defName: 'compensate',
    });
  });

  it('starts nothing when the workflow did not fail', () => {
    const { commands } = decide(withFailureWorkflow(), state({ completed: [task('a', TaskStatus.COMPLETED)] }));
    expect(commands.some((c) => c.type === 'StartWorkflow')).toBe(false);
  });

  it('does not start itself when the failure workflow is the one failing', () => {
    const { commands } = decide(
      withFailureWorkflow({ name: 'compensate' }),
      state({ workflow: workflow({ defName: 'compensate' }), completed: [task('a', TaskStatus.FAILED)] })
    );
    expect(commands.some((c) => c.type === 'StartWorkflow')).toBe(false);
  });
});

describe('switchExpressionProblem', () => {
  const route = (extra: Partial<WorkflowTask>): WorkflowTask => ({
    name: 'route',
    taskReferenceName: 'route',
    type: TaskType.SWITCH,
    decisionCases: {},
    ...extra,
  });

  it('accepts an input parameter name, a ${} expression, and the legacy switchCaseValue form', () => {
    expect(switchExpressionProblem(route({ expression: 'tier', inputParameters: { tier: 'x' } }))).toBeUndefined();
    expect(switchExpressionProblem(route({ expression: '${check.output.status}' }))).toBeUndefined();
    expect(switchExpressionProblem(route({ inputParameters: { switchCaseValue: 'x' } }))).toBeUndefined();
  });

  it('rejects a bare word that names no input parameter', () => {
    expect(switchExpressionProblem(route({ expression: 'tier' }))).toMatch(/not one of this task's input parameters/);
  });

  it('rejects a javascript evaluator, which the engine never runs', () => {
    expect(
      switchExpressionProblem(route({ evaluatorType: 'javascript', expression: "$.tier == 'gold' ? 'gold' : 'other'" }))
    ).toMatch(/not evaluated/);
  });
});

describe('decide — FORK_JOIN', () => {
  const forkWorkflow = () =>
    build([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('left')], [simple('right')]],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
      simple('after'),
    ]);

  it('schedules every branch in parallel', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({ completed: [task('fork', TaskStatus.COMPLETED)] })
    );
    expect(refsScheduled(commands).sort()).toEqual(['left', 'right']);
  });

  it('does not schedule the join while a branch is still running', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({
        pending: [task('right', TaskStatus.IN_PROGRESS)],
        completed: [task('left', TaskStatus.COMPLETED)],
      })
    );
    expect(refsScheduled(commands)).toEqual([]);
  });

  // The join resolves in-pass rather than being handed to a worker, so the
  // same evaluation continues straight through to the task after it.
  it('schedules the join once the last branch finishes and continues past it', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({
        completed: [task('right', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([['left', task('left', TaskStatus.COMPLETED)]]),
      })
    );
    expect(refsScheduled(commands)).toEqual(['join', 'after']);
    const join = scheduled(commands).find((c) => c.refName === 'join');
    expect(join?.resolved?.status).toBe(TaskStatus.COMPLETED);
  });

  // The deadlock this prevents: a SWITCH inside a fork skips a branch, and the
  // join waits forever for a task that was never going to run.
  it('treats a SKIPPED branch as satisfied so the join is not deadlocked', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({
        completed: [task('right', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([['left', task('left', TaskStatus.SKIPPED)]]),
      })
    );
    expect(refsScheduled(commands)).toContain('join');
  });

  it('continues past the join to the next task', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({ completed: [task('join', TaskStatus.COMPLETED, { taskType: TaskType.JOIN })] })
    );
    expect(refsScheduled(commands)).toEqual(['after']);
  });

  // Two branches completing in the same evaluation must not each schedule the
  // join — the unique constraint would reject it, but the decider should not
  // emit a contradiction in the first place.
  it('schedules the join only once when both branches finish together', () => {
    const { commands } = decide(
      forkWorkflow(),
      state({
        completed: [task('left', TaskStatus.COMPLETED), task('right', TaskStatus.COMPLETED)],
      })
    );
    expect(refsScheduled(commands).filter((r) => r === 'join')).toEqual(['join']);
  });
});

describe('decide — determinism', () => {
  it('is a pure function of its inputs', () => {
    const bp = build([
      simple('a'),
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('x')], [simple('y')]],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['x', 'y'] },
    ]);
    const s = state({ completed: [task('fork', TaskStatus.COMPLETED)] });

    const runs = Array.from({ length: 5 }, () => decide(bp, s, { random: noJitter }).commands);
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});

describe('decide — operators resolved in-pass', () => {
  const noop = (ref: string) => ({ name: ref, taskReferenceName: ref, type: TaskType.NOOP });

  // The evaluator records these as already seen. A task marked seen that the
  // pass did not actually walk past would strand the workflow; one left unseen
  // that it did walk past has its successors — and their side effects — run twice.
  it('says which resolved tasks the pass continued through', () => {
    const bp = build([noop('a'), noop('b'), simple('work')]);
    const scheduled = decide(bp, state({ hasAnyTask: false }), { random: noJitter }).commands.filter(
      (c): c is ScheduleTaskCommand => c.type === 'ScheduleTask'
    );

    expect(scheduled.map((c) => [c.refName, c.continuedInPass])).toEqual([
      ['a', true],
      ['b', true],
      ['work', undefined],
    ]);
  });

  it('leaves the task at the depth limit for the next pass', () => {
    const bp = build(Array.from({ length: 70 }, (_, i) => noop(`n${i}`)));
    const scheduled = decide(bp, state({ hasAnyTask: false }), { random: noJitter }).commands.filter(
      (c): c is ScheduleTaskCommand => c.type === 'ScheduleTask'
    );

    expect(scheduled.length).toBeLessThan(70);
    expect(scheduled.slice(0, -1).every((c) => c.continuedInPass)).toBe(true);
    expect(scheduled.at(-1)?.continuedInPass).toBe(false);
  });
});

/**
 * Retry settings written on the task itself, not only on its task definition.
 *
 * `retryCount` was the only one honoured. The others were stripped by zod
 * before the engine ever saw them, so a definition asking for `FIXED` delays
 * ran on exponential backoff and reported nothing — no error at registration,
 * no trace at runtime. This project's own end-to-end suite wrote
 * `retryLogic: 'FIXED', retryDelaySeconds: 1` in two places and passed while
 * asserting nothing about the behaviour it had asked for.
 */
describe('decide — task-level retry overrides', () => {
  it('honours retryLogic and retryDelaySeconds from the task', () => {
    const bp = build([
      simple('a', { retryCount: 3, retryLogic: RetryLogic.FIXED, retryDelaySeconds: 7 }),
    ]);

    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.FAILED, { attempt: 0 })] }),
      { random: noJitter }
    );

    const retry = commands[0];
    if (retry.type !== 'RetryTask') throw new Error('expected RetryTask');
    // FIXED means the delay is the base delay, every attempt. Exponential — the
    // default this used to silently fall back to — would give 1 * 2^0 = 1.
    expect(retry.delaySeconds).toBe(7);
  });

  it('leaves unset fields to the task definition', () => {
    const bp = build([simple('a', { retryCount: 3 })]);

    const { commands } = decide(
      bp,
      state({ completed: [task('a', TaskStatus.FAILED, { attempt: 0 })] }),
      { random: noJitter }
    );

    const retry = commands[0];
    if (retry.type !== 'RetryTask') throw new Error('expected RetryTask');
    // The default policy: exponential from a 1s base, so the first retry is 1s.
    expect(retry.delaySeconds).toBe(1);
  });
});
