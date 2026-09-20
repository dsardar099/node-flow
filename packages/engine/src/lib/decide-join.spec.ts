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
import type { Command, ScheduleTaskCommand } from './commands.js';
import { decide } from './decide.js';

const NOW = new Date('2026-09-13T00:00:00Z');

const simple = (ref: string) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
});

const t = (refName: string, status: TaskStatus): TaskExecution => ({
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
});

function state(overrides: Partial<EvaluationState> = {}): EvaluationState {
  return {
    workflow: {
      id: 'wf-1',
      namespaceId: 'ns-1',
      defName: 'wf',
      defVersion: 1,
      status: WorkflowStatus.RUNNING,
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

const refsScheduled = (commands: Command[]) =>
  commands.filter((c): c is ScheduleTaskCommand => c.type === 'ScheduleTask').map((c) => c.refName);

/**
 * A fork whose branches contain more than one task, and whose JOIN declares no
 * explicit `joinOn`.
 *
 * This is the case that distinguishes "wait for each branch to *start*" from
 * "wait for each branch to *finish*". With single-task branches the two are
 * indistinguishable, which is exactly why the earlier tests missed it.
 */
const multiStepFork = () =>
  compileBlueprint(
    workflowDefinitionSchema.parse({
      name: 'wf',
      version: 1,
      tasks: [
        {
          name: 'fork',
          taskReferenceName: 'fork',
          type: TaskType.FORK_JOIN,
          forkTasks: [
            [simple('left1'), simple('left2')],
            [simple('right1'), simple('right2')],
          ],
        },
        // No joinOn — the join must infer that it waits on the branch *tips*.
        { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN },
        simple('after'),
      ],
    })
  );

describe('decide — JOIN with multi-task branches and no explicit joinOn', () => {
  it('does not fire the join when only the branch heads have completed', () => {
    const { commands } = decide(
      multiStepFork(),
      state({
        completed: [t('left1', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([['right1', t('right1', TaskStatus.COMPLETED)]]),
      })
    );

    // left1 completing should schedule left2, never the join: right2 has not run.
    expect(refsScheduled(commands)).toEqual(['left2']);
    expect(refsScheduled(commands)).not.toContain('join');
  });

  it('fires the join only once every branch tip has completed', () => {
    const { commands } = decide(
      multiStepFork(),
      state({
        completed: [t('left2', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([
          ['left1', t('left1', TaskStatus.COMPLETED)],
          ['right1', t('right1', TaskStatus.COMPLETED)],
          ['right2', t('right2', TaskStatus.COMPLETED)],
        ]),
      })
    );

    // The join resolves in-pass, so 'after' follows in the same evaluation.
    expect(refsScheduled(commands)).toEqual(['join', 'after']);
  });

  it('does not fire the join when the other branch tip is still pending', () => {
    const { commands } = decide(
      multiStepFork(),
      state({
        pending: [t('right2', TaskStatus.IN_PROGRESS)],
        completed: [t('left2', TaskStatus.COMPLETED)],
        resolvedRefs: new Map([
          ['left1', t('left1', TaskStatus.COMPLETED)],
          ['right1', t('right1', TaskStatus.COMPLETED)],
        ]),
      })
    );

    expect(refsScheduled(commands)).not.toContain('join');
  });
});
