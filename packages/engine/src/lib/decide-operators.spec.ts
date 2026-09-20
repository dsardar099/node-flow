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
import type { Command, ScheduleTaskCommand, StartSubWorkflowCommand } from './commands.js';
import { decide, loopConditionProblem } from './decide.js';

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
  id: `t-${refName}-${overrides.iteration ?? 0}`,
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
      correlationId: 'corr-7',
      priority: 0,
      input: inlinePayload({ limit: 3 }),
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

describe('decide — in-pass operator resolution', () => {
  // Control flow that involves no external work should not cost a database
  // round trip per node.
  it('resolves a NOOP and continues to its successor in the same pass', () => {
    const bp = build([
      simple('a'),
      { name: 'gap', taskReferenceName: 'gap', type: TaskType.NOOP },
      simple('b'),
    ]);

    const { commands } = decide(bp, state({ completed: [t('a', TaskStatus.COMPLETED)] }));

    expect(refs(commands)).toEqual(['gap', 'b']);
    const gap = scheduledCmds(commands)[0];
    expect(gap.resolved).toEqual({ status: TaskStatus.COMPLETED, output: {} });
    // 'b' is real work and must not be pre-resolved.
    expect(scheduledCmds(commands)[1].resolved).toBeUndefined();
  });

  it('emits SetVariable and records the values on the task', () => {
    const bp = build([
      simple('a'),
      {
        name: 'setVars',
        taskReferenceName: 'setVars',
        type: TaskType.SET_VARIABLE,
        inputParameters: { stage: 'shipped', order: '${a.output.id}' },
      },
    ]);

    const { commands } = decide(
      bp,
      state({ completed: [t('a', TaskStatus.COMPLETED, { output: inlinePayload({ id: 'o-9' }) })] })
    );

    expect(types(commands)).toContain('SetVariable');
    const setVar = commands.find((c) => c.type === 'SetVariable');
    expect(setVar).toMatchObject({ values: { stage: 'shipped', order: 'o-9' } });
  });

  /**
   * A variable that has been set must be readable, under both spellings.
   *
   * The test above proves only that `SET_VARIABLE` *emits* the command, which
   * is how `${workflow.variables.x}` came to resolve to null while the value
   * sat correctly in the execution row: writing worked, reading did not, and
   * nothing failed — `workflow` is a real scope, so the missing `variables` key
   * just walked off the end of the object and became null. Conductor's own
   * definitions use that spelling, so it is the one most users will write.
   */
  it('reads a variable back through both ${global.x} and ${workflow.variables.x}', () => {
    const bp = build([
      simple('reader', {
        inputParameters: {
          short: '${global.stage}',
          conductor: '${workflow.variables.stage}',
          nested: '${workflow.variables.totals.paid}',
        },
      }),
    ]);

    const base = state();
    const { commands } = decide(bp, {
      ...base,
      workflow: { ...base.workflow, variables: { stage: 'shipped', totals: { paid: 42 } } },
    });

    expect(scheduledCmds(commands)[0].input).toEqual({
      short: 'shipped',
      conductor: 'shipped',
      nested: 42,
    });
  });

  /**
   * A variable is readable by the very next task, not only by the next pass.
   *
   * `SET_VARIABLE` emits a command that updates the stored variables, but an
   * operator does not end the evaluation — the pass continues straight through
   * it and resolves the following task's input against the scope as it stands.
   * With the scope left untouched, `${workflow.variables.x}` read null in the
   * task the SET_VARIABLE existed to feed, while the identical reference in the
   * workflow's `outputParameters`, resolved a pass later, read correctly. Set
   * it then use it is the entire idiom.
   */
  it('makes a variable readable by the task scheduled after it', () => {
    const bp = build([
      {
        name: 'setVars',
        taskReferenceName: 'setVars',
        type: TaskType.SET_VARIABLE,
        inputParameters: { stage: 'shipped' },
      },
      simple('next', { inputParameters: { seen: '${workflow.variables.stage}' } }),
    ]);

    const { commands } = decide(bp, state());

    const next = scheduledCmds(commands).find((c) => c.refName === 'next');
    expect(next?.input).toEqual({ seen: 'shipped' });
  });

  it('exposes workflow metadata through GET_WORKFLOW', () => {
    const bp = build([
      simple('a'),
      { name: 'meta', taskReferenceName: 'meta', type: TaskType.GET_WORKFLOW },
    ]);

    const { commands } = decide(bp, state({ completed: [t('a', TaskStatus.COMPLETED)] }));

    expect(scheduledCmds(commands)[0].resolved?.output).toMatchObject({
      workflowId: 'wf-1',
      defName: 'wf',
      correlationId: 'corr-7',
    });
  });

  it('chains several operators within one evaluation', () => {
    const bp = build([
      simple('a'),
      { name: 'n1', taskReferenceName: 'n1', type: TaskType.NOOP },
      { name: 'n2', taskReferenceName: 'n2', type: TaskType.NOOP },
      { name: 'n3', taskReferenceName: 'n3', type: TaskType.NOOP },
      simple('b'),
    ]);

    const { commands } = decide(bp, state({ completed: [t('a', TaskStatus.COMPLETED)] }));
    expect(refs(commands)).toEqual(['n1', 'n2', 'n3', 'b']);
  });
});

describe('decide — TERMINATE', () => {
  it('completes the workflow with the supplied output', () => {
    const bp = build([
      simple('a'),
      {
        name: 'stop',
        taskReferenceName: 'stop',
        type: TaskType.TERMINATE,
        inputParameters: {
          terminationStatus: 'COMPLETED',
          workflowOutput: { reason: 'nothing to do' },
        },
      },
      simple('never'),
    ]);

    const { commands } = decide(bp, state({ completed: [t('a', TaskStatus.COMPLETED)] }));

    expect(types(commands)).toContain('CompleteWorkflow');
    expect(commands.find((c) => c.type === 'CompleteWorkflow')).toMatchObject({
      output: { reason: 'nothing to do' },
    });
    // Everything after a TERMINATE must not run.
    expect(refs(commands)).not.toContain('never');
  });

  it('fails the workflow with a reason when asked to', () => {
    const bp = build([
      simple('a'),
      {
        name: 'stop',
        taskReferenceName: 'stop',
        type: TaskType.TERMINATE,
        inputParameters: { terminationStatus: 'FAILED', terminationReason: 'fraud detected' },
      },
    ]);

    const { commands } = decide(bp, state({ completed: [t('a', TaskStatus.COMPLETED)] }));
    expect(commands.find((c) => c.type === 'FailWorkflow')).toMatchObject({
      status: WorkflowStatus.FAILED,
      reason: 'fraud detected',
    });
  });
});

describe('decide — SUB_WORKFLOW', () => {
  const bp = () =>
    build([
      simple('a'),
      {
        name: 'child',
        taskReferenceName: 'child',
        type: TaskType.SUB_WORKFLOW,
        inputParameters: { orderId: '${a.output.id}' },
        subWorkflowParam: { name: 'fulfilment', version: 2 },
      },
      simple('after'),
    ]);

  it('starts the child workflow with resolved input', () => {
    const { commands } = decide(
      bp(),
      state({ completed: [t('a', TaskStatus.COMPLETED, { output: inlinePayload({ id: 'o-3' }) })] })
    );

    const start = commands.find((c): c is StartSubWorkflowCommand => c.type === 'StartSubWorkflow');
    expect(start).toMatchObject({
      defName: 'fulfilment',
      defVersion: 2,
      parentTaskRefName: 'child',
      input: { orderId: 'o-3' },
    });
  });

  // The parent task must stay open until the child finishes, or the parent
  // would race ahead of work that has not happened.
  it('leaves the parent task unresolved while the child runs', () => {
    const { commands } = decide(bp(), state({ completed: [t('a', TaskStatus.COMPLETED)] }));
    const childTask = scheduledCmds(commands).find((c) => c.refName === 'child');
    expect(childTask?.resolved).toBeUndefined();
    expect(refs(commands)).not.toContain('after');
  });

  it('continues past the sub-workflow once its task completes', () => {
    const { commands } = decide(
      bp(),
      state({
        completed: [t('child', TaskStatus.COMPLETED, { taskType: TaskType.SUB_WORKFLOW })],
      })
    );
    expect(refs(commands)).toEqual(['after']);
  });

  /**
   * A retry has to start a new child, not just a new task.
   *
   * `RetryTask` re-creates the task; the child is started by a *separate*
   * command that only `scheduleNode` emitted, and a retry does not go through
   * it. So the retried task was inserted `SCHEDULED` with nothing running
   * underneath it and nothing that could ever complete it, and the parent hung
   * in `RUNNING` permanently.
   *
   * `retryCount` defaults to 3, which made this the default path: any
   * sub-workflow whose child failed stranded its parent unless the author had
   * explicitly written `retryCount: 0`. The tests above only ever drove the
   * child to *success*.
   */
  it('starts a fresh child when the failed attempt is retried', () => {
    const { commands } = decide(
      bp(),
      state({
        completed: [
          t('child', TaskStatus.FAILED, {
            taskType: TaskType.SUB_WORKFLOW,
            input: inlinePayload({ orderId: 'o-3' }),
          }),
        ],
      })
    );

    expect(types(commands)).toContain('RetryTask');
    expect(commands.find((c) => c.type === 'StartSubWorkflow')).toMatchObject({
      defName: 'fulfilment',
      parentTaskRefName: 'child',
      input: { orderId: 'o-3' },
      // The attempt travels with it: the start is deduplicated on a key built
      // from these fields, so without it the retry is absorbed as a duplicate
      // of the previous attempt's child and nothing completes the new task.
      parentTaskAttempt: 1,
    });
  });
});

describe('decide — DO_WHILE', () => {
  const loopWorkflow = (condition: string) =>
    build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: condition,
        loopOver: [simple('body')],
      },
      simple('after'),
    ]);

  // "Page N", "attempt N": the body reads the loop's progress while the
  // DO_WHILE is still open. It failed to resolve and, before failures were
  // contained, took the decider down with it.
  it('lets the body read the iteration it is running in', () => {
    const bp = build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: '${loop.output.iteration} < 3',
        loopOver: [simple('page', { inputParameters: { page: '${loop.output.iteration}' } })],
      },
    ]);

    const first = scheduledCmds(decide(bp, state()).commands).find((c) => c.refName === 'page');
    expect(first?.input).toEqual({ page: 1 });

    const second = scheduledCmds(
      decide(bp, state({ completed: [t('page', TaskStatus.COMPLETED, { iteration: 1 })] })).commands
    ).find((c) => c.refName === 'page');
    expect(second?.input).toEqual({ page: 2 });
  });

  it('starts the first iteration when the loop begins', () => {
    const { commands } = decide(loopWorkflow('${loop.output.iteration} < 3'), state());

    // Entry schedules the DO_WHILE, which immediately starts iteration 1.
    const body = scheduledCmds(commands).find((c) => c.refName === 'body');
    expect(body?.iteration).toBe(1);
  });

  it('runs another iteration while the condition holds', () => {
    const { commands } = decide(
      loopWorkflow('${loop.output.iteration} < 3'),
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] })
    );

    const next = scheduledCmds(commands).find((c) => c.refName === 'body');
    expect(next?.iteration).toBe(2);
    expect(refs(commands)).not.toContain('after');
  });

  // Exiting must *complete* the open DO_WHILE row, not schedule a new one:
  // the task has existed since the loop began, so re-scheduling it collides
  // with its own identity, is absorbed, and leaves it non-terminal forever.
  it('completes the open DO_WHILE task and continues once the condition fails', () => {
    const { commands } = decide(
      loopWorkflow('${loop.output.iteration} < 3'),
      state({
        pending: [t('loop', TaskStatus.SCHEDULED, { taskType: TaskType.DO_WHILE })],
        completed: [t('body', TaskStatus.COMPLETED, { iteration: 3 })],
      })
    );

    const completeLoop = commands.find((c) => c.type === 'CompleteTask' && c.refName === 'loop');
    expect(completeLoop).toMatchObject({ output: { iteration: 3 } });

    expect(refs(commands)).toContain('after');
    expect(scheduledCmds(commands).find((c) => c.refName === 'body')).toBeUndefined();
  });

  /**
   * A loop with nothing after it has to finish the workflow.
   *
   * Every other test in this block puts a task after the loop, and that is
   * precisely why this survived: with a successor, the pass schedules something
   * and the workflow completes on the *next* evaluation. With none, the pass
   * completes the open DO_WHILE row and schedules nothing — and the workflow
   * was then read as still running, because "already finished" was taken from
   * the frontier as it was when the pass began, which cannot include a task
   * this pass just closed.
   *
   * Nothing was left to trigger another evaluation either, so the run sat in
   * RUNNING forever with every one of its tasks terminal — the stuck-workflow
   * signature the sweeper exists to shout about.
   */
  it('completes the workflow when the loop is the last task', () => {
    const bp = build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: '${loop.output.iteration} < 3',
        loopOver: [simple('body')],
      },
    ]);

    const { commands } = decide(
      bp,
      state({
        pending: [t('loop', TaskStatus.SCHEDULED, { taskType: TaskType.DO_WHILE })],
        completed: [t('body', TaskStatus.COMPLETED, { iteration: 3 })],
      })
    );

    expect(commands.find((c) => c.type === 'CompleteTask' && c.refName === 'loop')).toBeDefined();
    expect(types(commands)).toContain('CompleteWorkflow');
  });

  // The condition reads the number of iterations *completed*, so `< 3` runs the
  // body three times. Reading it as the iteration about to start silently runs
  // one fewer than asked for.
  it('keeps looping while the completed count is below the bound', () => {
    for (const completedIterations of [1, 2]) {
      const { commands } = decide(
        loopWorkflow('${loop.output.iteration} < 3'),
        state({
          pending: [t('loop', TaskStatus.SCHEDULED, { taskType: TaskType.DO_WHILE })],
          completed: [t('body', TaskStatus.COMPLETED, { iteration: completedIterations })],
        })
      );

      const next = scheduledCmds(commands).find((c) => c.refName === 'body');
      expect(next?.iteration, `after ${completedIterations} iterations`).toBe(
        completedIterations + 1
      );
    }
  });

  it('treats a literal false condition as a single pass', () => {
    const { commands } = decide(
      loopWorkflow('false'),
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] })
    );
    expect(refs(commands)).toContain('after');
  });

  // Two layers guard bad conditions, and they catch different things.
  // A reference to a task that does not exist is rejected at *compile* time:
  it('rejects a condition referencing an unknown task when compiling', () => {
    expect(() => loopWorkflow('${nonsense.output.x} < 5')).toThrow(/references "nonsense"/);
  });

  // …while a condition that is syntactically broken but references real tasks
  // survives compilation and must be handled at runtime. Exiting is the safe
  // direction: a loop that cannot decide should stop, not spin forever holding
  // a row lock.
  it('exits rather than looping forever on an unparseable condition', () => {
    const { commands } = decide(
      loopWorkflow('${body.output.count} ~~~ nonsense'),
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] })
    );
    expect(refs(commands)).toContain('after');
  });

  // The scaling property that matters: iteration 10,000 must cost the same as
  // iteration 1, because only the current iteration is ever loaded.
  it('evaluates a late iteration with the same state as an early one', () => {
    const bp = loopWorkflow('${loop.output.iteration} < 100000');

    const early = decide(bp, state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] }));
    const late = decide(
      bp,
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 10_000 })] })
    );

    expect(scheduledCmds(early.commands)[0].iteration).toBe(2);
    expect(scheduledCmds(late.commands)[0].iteration).toBe(10_001);
    expect(early.commands.length).toBe(late.commands.length);
  });
});

describe('loopConditionProblem — refusing conditions that would silently run once', () => {
  const loopWorkflow = (condition: string) =>
    build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: condition,
        loopOver: [simple('body')],
      },
      simple('after'),
    ]);

  it.each([
    ['true'],
    ['false'],
    ['${loop.output.iteration} < 3'],
    ['${charge.output.status} == PAID'],
    ["${charge.output.status} == 'PAID'"],
    ['${a.output.count} >= ${b.output.limit}'],
  ])('accepts %s', (condition) => {
    expect(loopConditionProblem(condition)).toBeUndefined();
  });

  it.each([
    // Conductor's JavaScript style: compared as literal text, never < 3.
    ["$.loop['iteration'] < 3", /looks like an expression/],
    ['$.loop.iteration < 3', /looks like an expression/],
    // No comparison: the evaluator only understands `left <op> right`.
    ['${check.output.done}', /not a comparison/],
    ['${body.output.count} ~~~ nonsense', /not a comparison/],
  ])('refuses %s', (condition, message) => {
    expect(loopConditionProblem(condition)).toMatch(message);
  });

  // The claim the rule rests on, observed rather than asserted: the evaluator
  // really does exit after one pass on Conductor-style syntax. If this ever
  // started looping correctly, the rule would be refusing a working condition.
  it('refuses a condition that the evaluator really does exit on after one pass', () => {
    const { commands } = decide(
      loopWorkflow("$.loop['iteration'] < 3"),
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] })
    );
    expect(refs(commands)).toContain('after');
    expect(refs(commands)).not.toContain('body');
  });

  // The rule and the evaluator must agree on what "understood" means, or the
  // check is guessing. Every accepted condition that compares numbers must
  // actually be evaluated by the engine, not fall through to the exit path.
  it('accepts only conditions the evaluator really does evaluate', () => {
    const { commands } = decide(
      loopWorkflow('${loop.output.iteration} < 3'),
      state({ completed: [t('body', TaskStatus.COMPLETED, { iteration: 1 })] })
    );
    expect(refs(commands)).toContain('body');
    expect(refs(commands)).not.toContain('after');
  });
});

/**
 * A fork inside a loop. It hung on the live server: every iteration after the
 * first found its branch refs "already resolved" from the iteration before and
 * scheduled nothing, so the loop sat RUNNING forever. Found by the testkit
 * simulator, then confirmed against Postgres.
 */
describe('decide — FORK_JOIN inside DO_WHILE', () => {
  const bp = () =>
    build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: '${loop.output.iteration} < 3',
        loopOver: [
          { name: 'fork', taskReferenceName: 'fork', type: TaskType.FORK_JOIN, forkTasks: [[simple('left')], [simple('right')]] },
          { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
        ],
      },
    ]);
  const loopTask = t('loop', TaskStatus.IN_PROGRESS, { taskType: TaskType.DO_WHILE });

  it('starts the next iteration even though the branches ran in the last one', () => {
    const { commands } = decide(
      bp(),
      state({
        pending: [loopTask],
        completed: [t('join', TaskStatus.COMPLETED, { iteration: 1, taskType: TaskType.JOIN })],
        // What the store loads: the latest finished row per static ref.
        resolvedRefs: new Map([
          ['left', t('left', TaskStatus.COMPLETED, { iteration: 1 })],
          ['right', t('right', TaskStatus.COMPLETED, { iteration: 1 })],
        ]),
      })
    );

    const scheduled = scheduledCmds(commands).map((c) => `${c.refName}#${c.iteration}`);
    expect(scheduled).toEqual(expect.arrayContaining(['fork#2', 'left#2', 'right#2']));
  });

  it('does not satisfy this iteration’s join with the last iteration’s branch', () => {
    const { commands } = decide(
      bp(),
      state({
        pending: [loopTask, t('right', TaskStatus.IN_PROGRESS, { iteration: 2 })],
        completed: [t('left', TaskStatus.COMPLETED, { iteration: 2 })],
        resolvedRefs: new Map([
          ['left', t('left', TaskStatus.COMPLETED, { iteration: 2 })],
          // Finished rows sort first, so iteration 1's `right` is what the store hands over.
          ['right', t('right', TaskStatus.COMPLETED, { iteration: 1 })],
        ]),
      })
    );

    expect(refs(commands)).not.toContain('join');
  });

  it('still refuses to schedule a copy of a task that finished in the same iteration', () => {
    const { commands } = decide(
      bp(),
      state({
        pending: [loopTask],
        completed: [t('left', TaskStatus.COMPLETED, { iteration: 1 })],
        resolvedRefs: new Map([
          ['left', t('left', TaskStatus.COMPLETED, { iteration: 1 })],
          ['right', t('right', TaskStatus.COMPLETED, { iteration: 1 })],
          ['join', t('join', TaskStatus.COMPLETED, { iteration: 1, taskType: TaskType.JOIN })],
        ]),
      })
    );

    expect(refs(commands)).not.toContain('join');
  });
});
