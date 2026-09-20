import { InvalidDefinitionError, TaskType, workflowDefinitionSchema } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { compileBlueprint, rateLimitFor } from './blueprint.js';

/** Parses through the real schema so defaults are applied exactly as in production. */
function defineWorkflow(tasks: unknown[], overrides: Record<string, unknown> = {}) {
  return workflowDefinitionSchema.parse({ name: 'test_wf', version: 1, tasks, ...overrides });
}

const simple = (ref: string, inputParameters?: Record<string, unknown>) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...(inputParameters ? { inputParameters } : {}),
});

describe('compileBlueprint — sequencing', () => {
  it('links a sequential workflow head to tail', () => {
    const bp = compileBlueprint(defineWorkflow([simple('a'), simple('b'), simple('c')]));

    expect(bp.entryRef).toBe('a');
    expect(bp.nodes.get('a')?.next).toEqual(['b']);
    expect(bp.nodes.get('b')?.next).toEqual(['c']);
    expect(bp.nodes.get('c')?.next).toEqual([]);
    expect(bp.size).toBe(3);
  });

  it('rejects duplicate task reference names', () => {
    expect(() => compileBlueprint(defineWorkflow([simple('a'), simple('a')]))).toThrow(
      InvalidDefinitionError
    );
  });
});

describe('compileBlueprint — static reference extraction', () => {
  // This is the mechanism that keeps evaluation cost proportional to references
  // used rather than to workflow size. If it over-reports, we fetch rows we do
  // not need; if it under-reports, expressions fail at runtime.
  it('records only the task refs an input actually reads', () => {
    const bp = compileBlueprint(
      defineWorkflow([
        simple('charge'),
        simple('ship', {
          txn: '${charge.output.txnId}',
          orderId: '${workflow.input.orderId}',
          literal: 'no expression here',
        }),
      ])
    );

    expect(bp.nodes.get('ship')?.staticRefs).toEqual(['charge']);
  });

  it('finds references nested deep inside objects and arrays', () => {
    const bp = compileBlueprint(
      defineWorkflow([
        simple('a'),
        simple('b'),
        simple('c', {
          payload: { items: [{ id: '${a.output.id}' }, { id: '${b.output.id}' }] },
        }),
      ])
    );

    expect(bp.nodes.get('c')?.staticRefs.sort()).toEqual(['a', 'b']);
  });

  it('does not treat reserved scopes as task references', () => {
    const bp = compileBlueprint(
      defineWorkflow([
        simple('a', {
          fromWorkflow: '${workflow.input.x}',
          fromEnv: '${env.REGION}',
          fromSecret: '${secrets.apiKey}',
          fromGlobal: '${global.counter}',
        }),
      ])
    );

    expect(bp.nodes.get('a')?.staticRefs).toEqual([]);
  });

  it('rejects a reference to a task that does not exist', () => {
    expect(() =>
      compileBlueprint(defineWorkflow([simple('a', { v: '${ghost.output.x}' })]))
    ).toThrow(/references "ghost"/);
  });

  // A task in one fork branch may legitimately reference a task declared later
  // in a sibling branch, so validation has to run after the whole graph exists.
  it('allows forward references resolved after flattening', () => {
    const bp = compileBlueprint(
      defineWorkflow([simple('first', { v: '${later.output.x}' }), simple('later')])
    );
    expect(bp.nodes.get('first')?.staticRefs).toEqual(['later']);
  });
});

describe('compileBlueprint — FORK_JOIN', () => {
  const forkWorkflow = () =>
    defineWorkflow([
      {
        name: 'fork',
        taskReferenceName: 'fork',
        type: TaskType.FORK_JOIN,
        forkTasks: [[simple('left1'), simple('left2')], [simple('right1')]],
      },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['left2', 'right1'] },
      simple('after'),
    ]);

  it('flattens every branch and records the branch heads', () => {
    const bp = compileBlueprint(forkWorkflow());

    expect(bp.nodes.get('fork')?.forkBranchHeads).toEqual(['left1', 'right1']);
    expect(bp.nodes.get('left1')?.next).toEqual(['left2']);
    // A branch tip has no successor; the JOIN is what resumes the flow.
    expect(bp.nodes.get('left2')?.next).toEqual([]);
    expect(bp.nodes.get('right1')?.next).toEqual([]);
  });

  it('points the fork at its join and the join at the continuation', () => {
    const bp = compileBlueprint(forkWorkflow());
    expect(bp.nodes.get('fork')?.joinRef).toBe('join');
    expect(bp.nodes.get('join')?.next).toEqual(['after']);
  });

  it('tags nested nodes with their enclosing fork and branch', () => {
    const bp = compileBlueprint(forkWorkflow());
    expect(bp.nodes.get('left1')?.location).toEqual({ parentRef: 'fork', branchKey: '0' });
    expect(bp.nodes.get('right1')?.location).toEqual({ parentRef: 'fork', branchKey: '1' });
  });

  it('rejects a fork that is not followed by a join', () => {
    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'fork',
            taskReferenceName: 'fork',
            type: TaskType.FORK_JOIN,
            forkTasks: [[simple('a')]],
          },
          simple('notAJoin'),
        ])
      )
    ).toThrow(/must be followed immediately by a JOIN/);
  });

  it('rejects a fork with no branches and a fork with an empty branch', () => {
    const withNoBranches = defineWorkflow([
      { name: 'fork', taskReferenceName: 'fork', type: TaskType.FORK_JOIN, forkTasks: [] },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: [] },
    ]);
    expect(() => compileBlueprint(withNoBranches)).toThrow(/declares no branches/);

    const withEmptyBranch = defineWorkflow([
      { name: 'fork', taskReferenceName: 'fork', type: TaskType.FORK_JOIN, forkTasks: [[]] },
      { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: [] },
    ]);
    expect(() => compileBlueprint(withEmptyBranch)).toThrow(/branch 0 is empty/);
  });

  it('rejects a join waiting on a task that does not exist', () => {
    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'fork',
            taskReferenceName: 'fork',
            type: TaskType.FORK_JOIN,
            forkTasks: [[simple('a')]],
          },
          { name: 'join', taskReferenceName: 'join', type: TaskType.JOIN, joinOn: ['nope'] },
        ])
      )
    ).toThrow(/joins on "nope"/);
  });
});

describe('compileBlueprint — SWITCH', () => {
  const switchWorkflow = () =>
    defineWorkflow([
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

  it('compiles each case and the default branch', () => {
    const bp = compileBlueprint(switchWorkflow());
    expect(bp.nodes.get('route')?.caseHeads).toEqual({ ok: 'shipIt', failed: 'refund' });
    expect(bp.nodes.get('route')?.defaultHead).toBe('escalate');
  });

  // Every branch has to rejoin the main flow, or taking a case would silently
  // strand the rest of the workflow.
  it('rejoins every branch to the switch continuation', () => {
    const bp = compileBlueprint(switchWorkflow());
    expect(bp.nodes.get('shipIt')?.next).toEqual(['done']);
    expect(bp.nodes.get('refund')?.next).toEqual(['done']);
    expect(bp.nodes.get('escalate')?.next).toEqual(['done']);
  });

  it('treats refs inside the switch expression as static references', () => {
    const bp = compileBlueprint(
      defineWorkflow([
        simple('check'),
        {
          name: 'route',
          taskReferenceName: 'route',
          type: TaskType.SWITCH,
          expression: '${check.output.status}',
          decisionCases: { ok: [simple('shipIt')] },
        },
      ])
    );
    expect(bp.nodes.get('route')?.staticRefs).toContain('check');
  });
});

describe('compileBlueprint — DO_WHILE', () => {
  it('compiles the loop body without linking it to the loop successor', () => {
    const bp = compileBlueprint(
      defineWorkflow([
        {
          name: 'loop',
          taskReferenceName: 'loop',
          type: TaskType.DO_WHILE,
          loopCondition: '${loop.output.iteration} < 5',
          loopOver: [simple('body1'), simple('body2')],
        },
        simple('after'),
      ])
    );

    expect(bp.nodes.get('loop')?.loopHead).toBe('body1');
    expect(bp.nodes.get('body1')?.next).toEqual(['body2']);
    // The body's tail loops back via the DO_WHILE node re-evaluating, so it must
    // NOT fall through to 'after' — that would exit the loop after one pass.
    expect(bp.nodes.get('body2')?.next).toEqual([]);
    expect(bp.nodes.get('loop')?.next).toEqual(['after']);
  });

  it('rejects a loop with no body or no condition', () => {
    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'loop',
            taskReferenceName: 'loop',
            type: TaskType.DO_WHILE,
            loopCondition: 'true',
            loopOver: [],
          },
        ])
      )
    ).toThrow(/empty loopOver/);

    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'loop',
            taskReferenceName: 'loop',
            type: TaskType.DO_WHILE,
            loopOver: [simple('body')],
          },
        ])
      )
    ).toThrow(/no loopCondition/);
  });
});

describe('compileBlueprint — scale', () => {
  // PLAN.md targets 30,000-task workflows. Compilation happens once per version,
  // but it must not be accidentally quadratic or registration would time out.
  it('compiles a 30,000-task workflow', () => {
    const tasks = Array.from({ length: 30_000 }, (_, i) => simple(`t${i}`));
    const started = performance.now();
    const bp = compileBlueprint(defineWorkflow(tasks));
    const elapsedMs = performance.now() - started;

    expect(bp.size).toBe(30_000);
    expect(bp.entryRef).toBe('t0');
    expect(bp.nodes.get('t29999')?.next).toEqual([]);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});

describe('compileBlueprint — launching another workflow', () => {
  // A SUB_WORKFLOW with no target starts no child, so nothing ever completes
  // it: the parent hangs forever with no error anywhere. Caught at
  // registration, where it is one line to fix.
  it.each([TaskType.SUB_WORKFLOW, TaskType.START_WORKFLOW])(
    'refuses a %s that names no workflow',
    (type) => {
      expect(() =>
        compileBlueprint(defineWorkflow([{ name: 'child', taskReferenceName: 'child', type }]))
      ).toThrow(/does not name a workflow/);
    }
  );

  it('locates the refusal by task reference, so an editor can point at it', () => {
    try {
      compileBlueprint(
        defineWorkflow([
          simple('before'),
          { name: 'child', taskReferenceName: 'child', type: TaskType.SUB_WORKFLOW },
        ])
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDefinitionError);
      expect((error as InvalidDefinitionError).details).toMatchObject({
        taskReferenceName: 'child',
      });
    }
  });

  it('accepts one that does', () => {
    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'child',
            taskReferenceName: 'child',
            type: TaskType.SUB_WORKFLOW,
            subWorkflowParam: { name: 'billing' },
          },
        ])
      )
    ).not.toThrow();
  });

  it('checks a launch nested inside a branch, not just at the top level', () => {
    expect(() =>
      compileBlueprint(
        defineWorkflow([
          {
            name: 'route',
            taskReferenceName: 'route',
            type: TaskType.SWITCH,
            expression: 'kind',
            decisionCases: {
              refund: [{ name: 'child', taskReferenceName: 'child', type: TaskType.SUB_WORKFLOW }],
            },
          },
        ])
      )
    ).toThrow(/does not name a workflow/);
  });
});

describe('rateLimitFor', () => {
  const compile = (rateLimitKey: string) =>
    compileBlueprint(
      workflowDefinitionSchema.parse({
        name: 'limited',
        version: 1,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }],
        rateLimitConfig: { rateLimitKey, concurrentExecLimit: 3 },
      })
    );

  it('is absent for a definition with no rateLimitConfig', () => {
    const plain = compileBlueprint(
      workflowDefinitionSchema.parse({
        name: 'plain',
        version: 1,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: TaskType.SIMPLE }],
      })
    );
    expect(rateLimitFor(plain, { customer: 'acme' })).toBeUndefined();
  });

  it('resolves the key against the workflow input, keeping interpolation and non-strings', () => {
    expect(rateLimitFor(compile('${workflow.input.customer}'), { customer: 'acme' })).toEqual({ key: 'acme', limit: 3 });
    expect(rateLimitFor(compile('${workflow.input.id}'), { id: 42 })).toEqual({ key: '42', limit: 3 });
    expect(rateLimitFor(compile('tenant-${workflow.input.t}'), { t: 'x' })?.key).toBe('tenant-x');
    expect(rateLimitFor(compile('global'), {})?.key).toBe('global');
  });

  it('puts a start whose key is missing in a shared bucket rather than no bucket', () => {
    expect(rateLimitFor(compile('${workflow.input.customer}'), {})?.key).toBe('${workflow.input.customer}');
    expect(rateLimitFor(compile('${workflow.input.customer}'), undefined)?.key).toBe('${workflow.input.customer}');
  });
});
