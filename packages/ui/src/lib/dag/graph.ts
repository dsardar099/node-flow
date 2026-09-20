import type { WorkflowTask } from '@node-flow-dev/core';
import type { Definition, InsertPoint } from './edit';
import { pathKey, type Path } from './path';

/**
 * A workflow definition as a positioned graph.
 *
 * **Why no layout library.** Every graph this DSL can express is
 * series-parallel: a sequence stacks, a switch or fork places branches side by
 * side, a loop wraps a body. For that class of graph a recursive layout is
 * exact — no crossings, no heuristics — and, more importantly for an editor,
 * *stable*: inserting a task moves only what is below it. A general layered
 * layout (dagre, ELK) optimises globally, so one insert can reshuffle the whole
 * canvas and the thing the user was looking at is suddenly somewhere else.
 *
 * **Edges carry insert points.** Each edge knows where a task dropped onto it
 * belongs in the tree. That is what lets the editor offer "+" on edges without
 * ever deriving tree positions from screen geometry — and it is where the one
 * invariant that matters is enforced by construction: the edges between a
 * fork's branches and its join insert at the *end of the branch*, never
 * between the fork and the join, which the compiler would reject.
 */

export type NodeKind = 'start' | 'end' | 'task' | 'switch' | 'fork' | 'loop' | 'merge' | 'loopEnd';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Top-left, as React Flow expects. */
  x: number;
  y: number;
  width: number;
  height: number;
  path?: Path;
  task?: WorkflowTask;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'flow' | 'loopBack';
  label?: string;
  insert?: InsertPoint;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export const NODE = { width: 280, height: 76 };
const TERMINAL = { width: 64, height: 64 };
const JUNCTION = { width: 12, height: 12 };
const GAP = { x: 48, y: 64 };
/** Room on the right of a loop for its back edge to travel up. */
const LOOP_GUTTER = 56;
/** Width given to an empty branch, so its edge has somewhere to be drawn. */
const EMPTY_BRANCH = 96;

interface Exit {
  id: string;
  /** Overrides the insert point of whatever edge leaves through this exit. */
  insert?: InsertPoint;
  label?: string;
}

interface Block {
  width: number;
  height: number;
  entry?: string;
  exits: Exit[];
  edges: GraphEdge[];
  place(centreX: number, top: number): GraphNode[];
}

class EdgeIds {
  private next = 0;
  make(source: string, target: string): string {
    return `${source}->${target}#${this.next++}`;
  }
}

export function buildGraph(definition: Definition): Graph {
  const ids = new EdgeIds();
  const edge = (
    source: string,
    target: string,
    options: Omit<GraphEdge, 'id' | 'source' | 'target' | 'kind'> & { kind?: GraphEdge['kind'] } = {}
  ): GraphEdge => ({ id: ids.make(source, target), source, target, kind: 'flow', ...options });

  const connect = (exits: Exit[], target: string, fallback: InsertPoint): GraphEdge[] =>
    exits.map((exit) =>
      edge(exit.id, target, { insert: exit.insert ?? fallback, label: exit.label })
    );

  const single = (id: string, kind: NodeKind, size: { width: number; height: number }, extra: Partial<GraphNode> = {}): Block => ({
    width: size.width,
    height: size.height,
    entry: id,
    exits: [{ id }],
    edges: [],
    place: (cx, top) => [{ id, kind, x: cx - size.width / 2, y: top, ...size, ...extra }],
  });

  function sequence(tasks: WorkflowTask[] | undefined, listPath: Path): Block & {
    leading: InsertPoint;
    trailing: InsertPoint;
  } {
    const list = tasks ?? [];
    const blocks = list.map((task, index) => taskBlock(task, [...listPath, index]));
    const edges = blocks.flatMap((block) => block.edges);

    for (let i = 1; i < blocks.length; i++) {
      // Every task block has an entry; only an empty *sequence* lacks one, and
      // these are task blocks.
      const entry = blocks[i].entry;
      if (entry) edges.push(...connect(blocks[i - 1].exits, entry, { listPath, index: i }));
    }

    return {
      width: Math.max(0, ...blocks.map((block) => block.width)),
      height:
        blocks.reduce((sum, block) => sum + block.height, 0) + GAP.y * Math.max(0, blocks.length - 1),
      entry: blocks[0]?.entry,
      exits: blocks[blocks.length - 1]?.exits ?? [],
      edges,
      leading: { listPath, index: 0 },
      trailing: { listPath, index: list.length },
      place(cx, top) {
        let y = top;
        return blocks.flatMap((block) => {
          const placed = block.place(cx, y);
          y += block.height + GAP.y;
          return placed;
        });
      },
    };
  }

  /** Branches side by side: switch cases, or fork branches. */
  function branches(list: { seq: ReturnType<typeof sequence>; label?: string }[]) {
    const widths = list.map(({ seq }) => Math.max(seq.width, EMPTY_BRANCH));
    return {
      width: widths.reduce((a, b) => a + b, 0) + GAP.x * Math.max(0, list.length - 1),
      height: Math.max(0, ...list.map(({ seq }) => seq.height)),
      place(cx: number, top: number) {
        let left = cx - (widths.reduce((a, b) => a + b, 0) + GAP.x * Math.max(0, list.length - 1)) / 2;
        return list.flatMap(({ seq }, i) => {
          const placed = seq.place(left + widths[i] / 2, top);
          left += widths[i] + GAP.x;
          return placed;
        });
      },
    };
  }

  function taskBlock(task: WorkflowTask, path: Path): Block {
    const id = pathKey(path);

    if (task.type === 'SWITCH') {
      const cases = [
        ...Object.entries(task.decisionCases ?? {}).map(([name, list]) => ({
          label: name,
          seq: sequence(list, [...path, 'decisionCases', name]),
        })),
        { label: 'default', seq: sequence(task.defaultCase, [...path, 'defaultCase']) },
      ];
      const merge = `${id}#merge`;
      const row = branches(cases);

      const edges = cases.flatMap(({ seq, label }) => [
        ...seq.edges,
        ...(seq.entry
          ? [
              edge(id, seq.entry, { label, insert: seq.leading }),
              ...connect(seq.exits, merge, seq.trailing),
            ]
          : [edge(id, merge, { label, insert: seq.leading })]),
      ]);

      const width = Math.max(NODE.width, row.width);
      return {
        width,
        height: NODE.height + GAP.y + row.height + GAP.y + JUNCTION.height,
        entry: id,
        exits: [{ id: merge }],
        edges,
        place(cx, top) {
          const branchTop = top + NODE.height + GAP.y;
          return [
            { id, kind: 'switch', x: cx - NODE.width / 2, y: top, ...NODE, path, task },
            ...row.place(cx, branchTop),
            {
              id: merge,
              kind: 'merge',
              x: cx - JUNCTION.width / 2,
              y: branchTop + row.height + GAP.y,
              ...JUNCTION,
            },
          ];
        },
      };
    }

    if (task.type === 'FORK_JOIN') {
      const forks = (task.forkTasks ?? []).map((list, i) => ({
        seq: sequence(list, [...path, 'forkTasks', i]),
        label: `branch ${i + 1}`,
      }));
      const row = branches(forks);

      const edges: GraphEdge[] = [];
      const exits: Exit[] = [];
      for (const { seq, label } of forks) {
        edges.push(...seq.edges);
        if (seq.entry) {
          edges.push(edge(id, seq.entry, { insert: seq.leading }));
          // The join is drawn by the enclosing sequence, but where a task
          // dropped on that edge goes is decided here: the end of this branch.
          exits.push(...seq.exits.map((exit) => ({ ...exit, insert: exit.insert ?? seq.trailing })));
        } else {
          exits.push({ id, insert: seq.leading, label });
        }
      }
      if (forks.length === 0) exits.push({ id });

      return {
        width: Math.max(NODE.width, row.width),
        height: NODE.height + (forks.length ? GAP.y + row.height : 0),
        entry: id,
        exits,
        edges,
        place: (cx, top) => [
          { id, kind: 'fork', x: cx - NODE.width / 2, y: top, ...NODE, path, task },
          ...row.place(cx, top + NODE.height + GAP.y),
        ],
      };
    }

    if (task.type === 'DO_WHILE') {
      const body = sequence(task.loopOver, [...path, 'loopOver']);
      const end = `${id}#loopEnd`;

      const edges = [
        ...body.edges,
        ...(body.entry
          ? [edge(id, body.entry, { insert: body.leading }), ...connect(body.exits, end, body.trailing)]
          : [edge(id, end, { insert: body.leading })]),
        edge(end, id, { kind: 'loopBack', label: task.loopCondition ? 'repeat' : undefined }),
      ];

      const inner = Math.max(NODE.width, body.width || EMPTY_BRANCH);
      const bodyHeight = body.height || 0;
      return {
        width: inner + LOOP_GUTTER * 2,
        height: NODE.height + GAP.y + (bodyHeight ? bodyHeight + GAP.y : 0) + JUNCTION.height,
        entry: id,
        exits: [{ id: end }],
        edges,
        place(cx, top) {
          const bodyTop = top + NODE.height + GAP.y;
          return [
            { id, kind: 'loop', x: cx - NODE.width / 2, y: top, ...NODE, path, task },
            ...body.place(cx, bodyTop),
            {
              id: end,
              kind: 'loopEnd',
              x: cx - JUNCTION.width / 2,
              y: bodyTop + (bodyHeight ? bodyHeight + GAP.y : 0),
              ...JUNCTION,
            },
          ];
        },
      };
    }

    return single(id, 'task', NODE, { path, task });
  }

  const root = sequence(definition.tasks, ['tasks']);
  const start = single('#start', 'start', TERMINAL);
  const end = single('#end', 'end', TERMINAL);

  const edges = [
    ...root.edges,
    ...(root.entry
      ? [
          edge('#start', root.entry, { insert: root.leading }),
          ...connect(root.exits, '#end', root.trailing),
        ]
      : [edge('#start', '#end', { insert: root.leading })]),
  ];

  const width = Math.max(TERMINAL.width, root.width);
  const cx = width / 2;
  const rootTop = TERMINAL.height + GAP.y;
  const endTop = rootTop + (root.height ? root.height + GAP.y : 0);

  return {
    nodes: [...start.place(cx, 0), ...root.place(cx, rootTop), ...end.place(cx, endTop)],
    edges,
    width,
    height: endTop + TERMINAL.height,
  };
}
