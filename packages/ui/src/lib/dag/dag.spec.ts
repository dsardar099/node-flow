import { workflowDefinitionSchema, type TaskType, type WorkflowTask } from '@node-flow-dev/core';
import { compileBlueprint, loopConditionProblem } from '@node-flow-dev/engine';
import { describe, expect, it } from 'vitest';
import { CATALOG, blankTasks, uniqueRef } from './catalog';
import {
  addForkBranch,
  allRefs,
  insertTasks,
  pathOfRef,
  removeTask,
  taskPathOfIssue,
  updateTask,
  walkTasks,
  type Definition,
} from './edit';
import { buildGraph, type GraphNode } from './graph';
import { getIn, pathKey } from './path';
import { latestStatusByRef } from './status';

const t = (ref: string, type: WorkflowTask['type'] = 'SIMPLE', extra: Partial<WorkflowTask> = {}): WorkflowTask => ({
  name: ref,
  taskReferenceName: ref,
  type,
  ...extra,
});

const def = (tasks: WorkflowTask[]): Definition => ({ name: 'wf', tasks });

/**
 * Everything this DSL can nest, nested in itself: a fork inside a switch case,
 * a loop inside a fork branch, an empty default case, a switch at the end of a
 * branch. Invariant tests run against this rather than against tidy fixtures,
 * because the bugs live in the combinations.
 */
const kitchenSink = (): Definition =>
  def([
    t('start'),
    t('route', 'SWITCH', {
      expression: 'kind',
      decisionCases: {
        parallel: [
          t('fan', 'FORK_JOIN', {
            forkTasks: [
              [t('left')],
              [t('loop', 'DO_WHILE', { loopCondition: 'x', loopOver: [t('body_a'), t('body_b')] })],
              [t('inner', 'SWITCH', { expression: 'y', decisionCases: { only: [t('deep')] } })],
            ],
          }),
          t('fan_join', 'JOIN', { joinOn: ['left', 'loop', 'inner'] }),
        ],
        simple: [t('one')],
      },
      defaultCase: [],
    }),
    t('finish'),
  ]);

// ---------------------------------------------------------------- edits

describe('structural edits', () => {
  it('never mutates the definition it was given', () => {
    const original = kitchenSink();
    const snapshot = JSON.stringify(original);

    insertTasks(original, { listPath: ['tasks'], index: 1 }, [t('new')]);
    removeTask(original, ['tasks', 0]);
    updateTask(original, ['tasks', 2], { name: 'renamed' });

    // Undo is a list of past definitions. An edit that mutated shared structure
    // would rewrite that list, and undo would restore states never saved.
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('inserts into a default case that does not exist yet', () => {
    const d = def([t('route', 'SWITCH', { expression: 'k', decisionCases: { a: [t('a')] } })]);

    const next = insertTasks(d, { listPath: ['tasks', 0, 'defaultCase'], index: 0 }, [t('fallback')]);

    expect(getIn(next, ['tasks', 0, 'defaultCase', 0, 'taskReferenceName'])).toBe('fallback');
  });

  it('deletes a fork together with its join, since neither is valid alone', () => {
    const d = def([
      t('fan', 'FORK_JOIN', { forkTasks: [[t('a')], [t('b')]] }),
      t('fan_join', 'JOIN', { joinOn: ['a', 'b'] }),
      t('after'),
    ]);

    expect(removeTask(d, ['tasks', 0]).tasks.map((x) => x.taskReferenceName)).toEqual(['after']);
    expect(removeTask(d, ['tasks', 1]).tasks.map((x) => x.taskReferenceName)).toEqual(['after']);
  });

  describe('keeping joins on branch ends', () => {
    const forked = () =>
      def([
        t('fan', 'FORK_JOIN', { forkTasks: [[t('a')], [t('b')]] }),
        t('fan_join', 'JOIN', { joinOn: ['a', 'b'] }),
      ]);

    it('follows a task appended to a branch', () => {
      // Left alone, the join would wait on `a` and let the workflow continue
      // while `a2` is still running.
      const next = insertTasks(forked(), { listPath: ['tasks', 0, 'forkTasks', 0], index: 1 }, [t('a2')]);
      expect(next.tasks[1].joinOn).toEqual(['a2', 'b']);
    });

    it('follows a branch end being removed', () => {
      const d = insertTasks(forked(), { listPath: ['tasks', 0, 'forkTasks', 0], index: 1 }, [t('a2')]);
      const next = removeTask(d, ['tasks', 0, 'forkTasks', 0, 1]);
      expect(next.tasks[1].joinOn).toEqual(['a', 'b']);
    });

    it('includes a newly added branch', () => {
      const next = addForkBranch(forked(), ['tasks', 0], t('c'));
      expect(next.tasks[1].joinOn).toEqual(['a', 'b', 'c']);
    });

    it('follows a renamed branch end', () => {
      const next = updateTask(forked(), ['tasks', 0, 'forkTasks', 1, 0], { taskReferenceName: 'bee' });
      expect(next.tasks[1].joinOn).toEqual(['a', 'bee']);
    });

    it('leaves a join someone deliberately pointed elsewhere', () => {
      const custom = updateTask(forked(), ['tasks', 1], { joinOn: ['a'] });
      const next = insertTasks(custom, { listPath: ['tasks', 0, 'forkTasks', 1], index: 1 }, [t('b2')]);
      expect(next.tasks[1].joinOn).toEqual(['a']);
    });
  });

  it('drops fields a patch sets to undefined instead of saving them', () => {
    const d = def([t('a', 'SIMPLE', { description: 'old' })]);
    const next = updateTask(d, ['tasks', 0], { description: undefined });
    expect('description' in next.tasks[0]).toBe(false);
  });
});

describe('finding things', () => {
  it('walks every task, however deeply nested', () => {
    expect([...allRefs(kitchenSink())].sort()).toEqual(
      ['body_a', 'body_b', 'deep', 'fan', 'fan_join', 'finish', 'inner', 'left', 'loop', 'one', 'route', 'start'].sort()
    );
  });

  it('resolves a reference to the path that reaches it', () => {
    const d = kitchenSink();
    const path = pathOfRef(d, 'body_b')!;
    expect((getIn(d, path) as WorkflowTask).taskReferenceName).toBe('body_b');
  });

  it('locates the task a schema issue is about', () => {
    const d = kitchenSink();
    const issue = ['tasks', 1, 'decisionCases', 'parallel', 0, 'forkTasks', 1, 0, 'loopOver', 1, 'name'];
    expect(taskPathOfIssue(d, issue)).toEqual(issue.slice(0, -1));
  });

  it('does not mistake a branch list for a task', () => {
    const d = kitchenSink();
    // An issue about the list itself, e.g. "must not be empty".
    expect(taskPathOfIssue(d, ['tasks', 1, 'decisionCases', 'parallel'])).toEqual(['tasks', 1]);
  });
});

describe('new tasks', () => {
  it('never reuses a reference', () => {
    expect(uniqueRef('HTTP', new Set(['http', 'http_2']))).toBe('http_3');
  });

  it('inserts a fork with its join, already waiting on both branches', () => {
    const [fork, join] = blankTasks('FORK_JOIN', new Set());
    const lastOf = (branch: WorkflowTask[]) => branch[branch.length - 1].taskReferenceName;
    expect(join.type).toBe('JOIN');
    expect(join.joinOn).toEqual(fork.forkTasks!.map(lastOf));
  });

  it('gives every task of a multi-task template its own reference', () => {
    const tasks = blankTasks('FORK_JOIN', new Set(['fork_join', 'branch_a']));
    const refs = tasks.flatMap((task) => [
      task.taskReferenceName,
      ...(task.forkTasks ?? []).flat().map((x) => x.taskReferenceName),
    ]);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).not.toContain('branch_a');
  });
});

// ---------------------------------------------------------------- graph

describe('the graph', () => {
  it('draws a sequence as a chain, with insert points between each pair', () => {
    const graph = buildGraph(def([t('a'), t('b')]));

    expect(graph.edges.map((e) => [e.source, e.target, e.insert?.index])).toEqual([
      ['tasks/0', 'tasks/1', 1],
      ['#start', 'tasks/0', 0],
      ['tasks/1', '#end', 2],
    ]);
  });

  it('draws every task exactly once, at the path that holds it', () => {
    const d = kitchenSink();
    const graph = buildGraph(d);
    const drawn = graph.nodes.filter((n) => n.task);

    let count = 0;
    walkTasks(d, () => count++);
    expect(drawn).toHaveLength(count);

    for (const node of drawn) {
      expect(getIn(d, node.path!)).toBe(node.task);
    }
  });

  it('labels an empty case, so a branch that does nothing is still visible', () => {
    const graph = buildGraph(kitchenSink());
    // Selected by source as well as label: the nested `inner` switch has an
    // empty default too, and a lookup by label alone finds whichever is first.
    const fallthrough = graph.edges.find((e) => e.label === 'default' && e.source === 'tasks/1');

    expect(fallthrough?.target).toBe('tasks/1#merge');
    expect(fallthrough?.insert).toEqual({ listPath: ['tasks', 1, 'defaultCase'], index: 0 });
  });

  it('draws a loop back to its head, with nowhere to insert on the way back', () => {
    const graph = buildGraph(kitchenSink());
    const back = graph.edges.filter((e) => e.kind === 'loopBack');

    expect(back).toHaveLength(1);
    expect(back[0].insert).toBeUndefined();
  });

  it('gives every edge a unique id, including two empty branches of one fork', () => {
    const d = def([
      t('fan', 'FORK_JOIN', { forkTasks: [[], []] }),
      t('fan_join', 'JOIN', { joinOn: [] }),
    ]);
    const ids = buildGraph(d).edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Layouts to check geometry against.
   *
   * The kitchen sink alone was not enough, and a mutation proved it: squeezing
   * branches 88px closer together passed every test. Its branches all have
   * slack — a loop's gutter, an empty default case with no node in it — so
   * nodes never met. The tight fixtures have nodes filling their branches edge
   * to edge, where any spacing error is an overlap.
   */
  const layouts: [string, Definition][] = [
    ['kitchen sink', kitchenSink()],
    [
      'fork of plain branches',
      def([
        t('fan', 'FORK_JOIN', { forkTasks: [[t('a')], [t('b')], [t('c')]] }),
        t('fan_join', 'JOIN', { joinOn: ['a', 'b', 'c'] }),
      ]),
    ],
    [
      'switch with every case filled',
      def([
        t('route', 'SWITCH', {
          expression: 'k',
          decisionCases: { x: [t('x1')], y: [t('y1')] },
          defaultCase: [t('d1')],
        }),
      ]),
    ],
  ];

  it.each(layouts)('never overlaps two nodes — %s', (_, d) => {
    const overlap = (a: GraphNode, b: GraphNode) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    const { nodes } = buildGraph(d);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlap(nodes[i], nodes[j]), `${nodes[i].id} overlaps ${nodes[j].id}`).toBe(false);
      }
    }
  });

  it.each(layouts)('keeps everything inside the reported bounds — %s', (_, d) => {
    const graph = buildGraph(d);
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(graph.width);
      expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
    }
  });

  it('moves only what is below an insert, so the canvas does not jump', () => {
    const before = buildGraph(kitchenSink());
    const after = buildGraph(
      insertTasks(kitchenSink(), { listPath: ['tasks'], index: 3 }, [t('appended')])
    );

    const position = (graph: typeof before, id: string) => graph.nodes.find((n) => n.id === id)!;
    for (const id of ['tasks/0', 'tasks/1', 'tasks/2']) {
      expect(position(after, id).y).toBe(position(before, id).y);
    }
  });
});

// ---------------------------------------------------------------- invariants

describe('every insert point the graph offers', () => {
  /** A fork must be followed immediately by a join — the compiler's rule. */
  function forksAreJoined(d: Definition): boolean {
    let ok = true;
    walkTasks(d, (task, path) => {
      if (task.type !== 'FORK_JOIN') return;
      const list = getIn(d, path.slice(0, -1)) as WorkflowTask[];
      const next = list[path[path.length - 1] as number + 1];
      if (!next || (next.type !== 'JOIN' && next.type !== 'EXCLUSIVE_JOIN')) ok = false;
    });
    return ok;
  }

  const offered = () => buildGraph(kitchenSink()).edges.filter((e) => e.insert);

  it('is a real position in the tree', () => {
    for (const { insert, id } of offered()) {
      expect(() => insertTasks(kitchenSink(), insert!, [t('probe')]), id).not.toThrow();
    }
  });

  it('never separates a fork from its join', () => {
    // The property the edge insert points exist to guarantee. Built from the
    // kitchen sink, where a fork sits inside a switch case and its branches
    // end in a loop and a nested switch — every shape of exit a fork can have.
    for (const { insert, id } of offered()) {
      const next = insertTasks(kitchenSink(), insert!, [t('probe')]);
      expect(forksAreJoined(next), `inserting via ${id} broke a fork`).toBe(true);
    }
  });

  it('puts the task where the edge is drawn', () => {
    // Inserting on an edge must place the new task between that edge's
    // endpoints: in the rebuilt graph, the probe is reachable from the source
    // and reaches the target (junctions aside, which are rebuilt too).
    for (const { insert, source, target, id } of offered()) {
      const next = insertTasks(kitchenSink(), insert!, [t('probe')]);
      const graph = buildGraph(next);
      const probe = graph.nodes.find((n) => n.task?.taskReferenceName === 'probe')!;

      const refOf = (nodeId: string) =>
        buildGraph(kitchenSink()).nodes.find((n) => n.id === nodeId)?.task?.taskReferenceName;
      const idOfRef = (ref: string | undefined) =>
        ref === undefined ? undefined : graph.nodes.find((n) => n.task?.taskReferenceName === ref)?.id;

      const sourceRef = refOf(source);
      const targetRef = refOf(target);
      const incoming = graph.edges.filter((e) => e.target === probe.id).map((e) => e.source);
      const outgoing = graph.edges.filter((e) => e.source === probe.id).map((e) => e.target);

      if (sourceRef) expect(incoming, `${id}: probe should follow ${sourceRef}`).toContain(idOfRef(sourceRef));
      if (targetRef) expect(outgoing, `${id}: probe should precede ${targetRef}`).toContain(idOfRef(targetRef));
    }
  });
});

describe('path keys', () => {
  it('are unique per task', () => {
    const keys: string[] = [];
    walkTasks(kitchenSink(), (_, path) => keys.push(pathKey(path)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('drawing an execution', () => {
  const run = (refName: string, status: string, iteration: number, attempt: number) => ({
    refName,
    status,
    iteration,
    attempt,
  });

  it('shows a retried task by its last attempt, not its first', () => {
    // Listed newest-first on purpose, so "take the last row" would also be wrong.
    const statuses = latestStatusByRef([
      run('charge', 'COMPLETED', 0, 2),
      run('charge', 'FAILED', 0, 0),
      run('charge', 'FAILED', 0, 1),
    ]);
    expect(statuses['charge']).toBe('COMPLETED');
  });

  it('prefers a later loop iteration over a later attempt of an earlier one', () => {
    const statuses = latestStatusByRef([
      run('body', 'COMPLETED', 1, 3),
      run('body', 'IN_PROGRESS', 2, 0),
    ]);
    expect(statuses['body']).toBe('IN_PROGRESS');
  });
});

describe('what the palette inserts', () => {
  /**
   * Every template, compiled by the real engine and checked against the real
   * registration rule.
   *
   * Written after the loop template was found to use Conductor's condition
   * syntax, which passes validation and makes the loop run exactly once. The
   * engine is imported here and only here — a test dependency, never shipped
   * to the browser.
   */
  /**
   * Templates that cannot be valid until someone fills something in, and the
   * refusal each must produce. A placeholder that made them compile would be a
   * guess that passes validation and fails at runtime.
   */
  const needsInput: Partial<Record<TaskType, RegExp>> = {
    SUB_WORKFLOW: /does not name a workflow/,
    START_WORKFLOW: /does not name a workflow/,
    EVENT: /no sink/,
    KAFKA_PUBLISH: /no topic/,
  };

  const types = (Object.keys(CATALOG) as TaskType[]).filter((type) => !CATALOG[type].companion);

  it.each(types)('%s compiles as inserted', (type) => {
    const definition = workflowDefinitionSchema.parse({
      name: 'template_check',
      tasks: blankTasks(type, new Set()),
    });

    const refusal = needsInput[type];
    if (refusal) {
      // These must *fail*, naming what is missing, rather than carry a guess.
      expect(() => compileBlueprint(definition)).toThrow(refusal);
      return;
    }

    const blueprint = compileBlueprint(definition);
    for (const node of blueprint.nodes.values()) {
      expect(loopConditionProblem(node.task.loopCondition), node.ref).toBeUndefined();
    }
  });
});
