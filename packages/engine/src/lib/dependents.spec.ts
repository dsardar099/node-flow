import { TaskType, workflowDefinitionSchema } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { compileBlueprint } from './blueprint.js';
import { dependentsOf } from './dependents.js';

/**
 * Which tasks a re-run invalidates.
 *
 * This decides what an operator loses when they re-run one task, so the cases
 * that matter are the ones where the obvious answer is wrong: a parallel branch
 * that must *not* be swept up, and a task that reads an output without
 * following it in control flow.
 */

const build = (tasks: unknown[]) =>
  compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }));

const simple = (ref: string, inputParameters: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  inputParameters,
});

describe('dependentsOf', () => {
  it('follows a straight line forwards and not backwards', () => {
    const blueprint = build([simple('a'), simple('b'), simple('c')]);

    expect([...dependentsOf(blueprint, ['b'])].sort()).toEqual(['c']);
    expect([...dependentsOf(blueprint, ['a'])].sort()).toEqual(['b', 'c']);
    // Nothing follows the last task, so re-running it costs nothing else.
    expect([...dependentsOf(blueprint, ['c'])]).toEqual([]);
  });

  /**
   * The case `rerunFromTask`'s `scheduledAt >=` rule gets wrong.
   *
   * Two branches of a fork are independent. Re-running one must not discard the
   * other merely because it happened to be scheduled a moment later — that is
   * work thrown away for no reason, and on a branch that may have cost minutes.
   */
  it('does not sweep up an independent parallel branch', () => {
    const blueprint = build([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('left')], [simple('right')]],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
      simple('after'),
    ]);

    const dependents = dependentsOf(blueprint, ['left']);

    // The JOIN waits on `left`, so it and everything after it must go.
    expect(dependents.has('join')).toBe(true);
    expect(dependents.has('after')).toBe(true);
    // `right` is untouched — it neither reads `left` nor follows it.
    expect(dependents.has('right')).toBe(false);
  });

  /**
   * A data dependency with no control-flow edge between the two.
   *
   * `right` reads `left`'s output across the fork. Nothing in the control graph
   * connects them, so a rule based on successors alone would leave `right`
   * holding a value computed from a run that no longer exists.
   */
  it('follows an output read across branches', () => {
    const blueprint = build([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [
          [simple('left')],
          [simple('right', { borrowed: '${left.output.value}' })],
        ],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left', 'right'] },
    ]);

    expect(dependentsOf(blueprint, ['left']).has('right')).toBe(true);
  });

  it('follows every branch of a switch', () => {
    const blueprint = build([
      simple('decide'),
      {
        name: 'route',
        taskReferenceName: 'route',
        type: TaskType.SWITCH,
        evaluatorType: 'value-param',
        expression: 'value',
        inputParameters: { value: '${decide.output.choice}' },
        decisionCases: { yes: [simple('approved')] },
        defaultCase: [simple('rejected')],
      },
    ]);

    // Re-running `decide` can change which branch is correct, so both go.
    const dependents = dependentsOf(blueprint, ['decide']);
    expect(dependents.has('route')).toBe(true);
    expect(dependents.has('approved')).toBe(true);
    expect(dependents.has('rejected')).toBe(true);
  });

  it('takes the union for several seeds, and never the seeds themselves', () => {
    const blueprint = build([simple('a'), simple('b'), simple('c'), simple('d')]);

    const dependents = dependentsOf(blueprint, ['a', 'c']);

    expect([...dependents].sort()).toEqual(['b', 'd']);
    expect(dependents.has('a')).toBe(false);
    expect(dependents.has('c')).toBe(false);
  });

  /** A loop body points back at itself; the walk must still terminate. */
  it('terminates on a cycle', () => {
    const blueprint = build([
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition: '$.loop.iteration < 3',
        loopOver: [simple('body')],
      },
      simple('after'),
    ]);

    const dependents = dependentsOf(blueprint, ['body']);
    expect(dependents.has('after')).toBe(true);
  });

  it('ignores a ref the blueprint does not contain', () => {
    const blueprint = build([simple('a'), simple('b')]);
    expect([...dependentsOf(blueprint, ['nonexistent'])]).toEqual([]);
  });
});
