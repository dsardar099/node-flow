'use client';

import {
  ArrowsRotateRight,
  BranchesDown,
  CircleCheckFill,
  CircleXmarkFill,
  Clock,
  CodeFork,
  Comments,
  Cpu,
  Database,
  FileCode,
  Gear,
  Globe,
  House,
  Layers,
  Magnifier,
  MagnifierMinus,
  MagnifierPlus,
  Person,
  SquareDashed,
  Stopwatch,
  Stop,
  Tag,
  Thunderbolt,
  Xmark,
} from '@gravity-ui/icons';
import type { WorkflowTask } from '@node-flow-dev/core';
import { Button, ButtonGroup, Chip, ListBox, Popover, SearchField, Tooltip } from '@heroui/react';
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  MarkerType,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useResolvedTheme } from '../shell/theme';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { statusColor } from '../ui/status-chip';
import type { Definition, InsertPoint } from '../../lib/dag/edit';
import { buildGraph, type NodeKind } from '../../lib/dag/graph';
import { pathKey, type Path } from '../../lib/dag/path';

/**
 * A workflow drawn the way Conductor draws one: white task cards with a type
 * badge, the status carried by the card's border and a marker on its corner,
 * Start and End as circles, and the path already taken in green.
 *
 * One component for reading, running and editing. The drawing is the same in
 * all three — editing only adds insert buttons and a delete control — and two
 * components would drift in exactly the place that matters: a graph that looks
 * different while you edit it than after you save it.
 *
 * Nodes are not draggable. Positions are derived from the definition every
 * render, so a dragged node would snap back on the next edit — a control that
 * appears to work and then undoes itself is worse than none.
 */

export interface WorkflowGraphProps {
  definition: Definition;
  /** Task status by reference, for drawing an execution over its definition. */
  statuses?: Record<string, string>;
  selected?: Path;
  /** Paths of tasks with validation issues. */
  flagged?: ReadonlySet<string>;
  onSelect?: (path: Path | undefined) => void;
  /** Present only when editing; its presence is what shows insert buttons. */
  onInsert?: (at: InsertPoint, anchor: { x: number; y: number }) => void;
  /** Present only when editing; shows the delete control on each task. */
  onDelete?: (path: Path) => void;
  height?: number | string;
  className?: string;
}

interface TaskData extends Record<string, unknown> {
  kind: NodeKind;
  task?: WorkflowTask;
  path?: Path;
  status?: string;
  selected: boolean;
  flagged: boolean;
}

interface EdgeData extends Record<string, unknown> {
  insert?: InsertPoint;
  taken: boolean;
}

/** Callbacks for node and edge components, which React Flow renders by type. */
const GraphActions = createContext<{
  onInsert?: WorkflowGraphProps['onInsert'];
  onDelete?: WorkflowGraphProps['onDelete'];
}>({});

export function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

const DONE = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'SKIPPED']);

function Graph({
  definition,
  statuses,
  selected,
  flagged,
  onSelect,
  onInsert,
  onDelete,
  height = 560,
  className = '',
}: WorkflowGraphProps) {
  const graph = useMemo(() => buildGraph(definition), [definition]);
  const selectedKey = selected ? pathKey(selected) : undefined;

  const statusOf = useMemo(() => {
    const byId = new Map<string, string | undefined>();
    for (const node of graph.nodes) {
      byId.set(node.id, node.task ? statuses?.[node.task.taskReferenceName] : undefined);
    }
    return byId;
  }, [graph, statuses]);

  const nodes: Node<TaskData>[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type:
          node.kind === 'merge' || node.kind === 'loopEnd'
            ? 'junction'
            : node.kind === 'start' || node.kind === 'end'
              ? 'terminal'
              : 'task',
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        draggable: false,
        selectable: Boolean(node.task),
        data: {
          kind: node.kind,
          task: node.task,
          path: node.path,
          status: statusOf.get(node.id),
          selected: node.path !== undefined && pathKey(node.path) === selectedKey,
          flagged: node.path !== undefined && Boolean(flagged?.has(pathKey(node.path))),
        },
      })),
    [graph, statusOf, selectedKey, flagged]
  );

  // An edge is "taken" when the task it leaves has finished — Conductor's green
  // path, which answers "how far did this get?" at a glance.
  const edges: Edge<EdgeData>[] = useMemo(
    () =>
      graph.edges.map((edge) => {
        const from = statusOf.get(edge.source);
        const to = statusOf.get(edge.target);
        // Neither into nor out of a skipped task: the branch a SWITCH did not take
        // must not light up as part of the path the run followed.
        const taken =
          statuses !== undefined &&
          from !== 'SKIPPED' &&
          to !== 'SKIPPED' &&
          (edge.source === '#start' ? Object.keys(statuses).length > 0 : from !== undefined && DONE.has(from));
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: edge.kind === 'loopBack' ? 'loopBack' : 'insertable',
          ...(edge.kind === 'loopBack'
            ? { sourceHandle: 'loop-out', targetHandle: 'loop-in' }
            : {
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 16,
                  height: 16,
                  color: taken ? 'var(--success)' : 'var(--muted)',
                },
              }),
          data: { insert: edge.insert, taken },
        };
      }),
    [graph, statusOf, statuses]
  );

  const pathById = useMemo(
    () => new Map(graph.nodes.flatMap((n) => (n.path ? [[n.id, n.path] as const] : []))),
    [graph]
  );

  const actions = useMemo(() => ({ onInsert, onDelete }), [onInsert, onDelete]);
  const colorMode = useResolvedTheme();

  return (
    <GraphActions.Provider value={actions}>
      <div style={{ height }} className={`relative bg-background ${className}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          colorMode={colorMode}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={Boolean(onSelect)}
          onNodeClick={(_, node) => onSelect?.(pathById.get(node.id))}
          onPaneClick={() => onSelect?.(undefined)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1.2} color="var(--border)" />
          <ZoomToolbar
            size={{ width: graph.width, height: graph.height }}
            tasks={graph.nodes.flatMap((n) =>
              n.task && n.path
                ? [{ id: n.id, path: n.path, task: n.task, status: statusOf.get(n.id), x: n.x + n.width / 2, y: n.y + n.height / 2 }]
                : []
            )}
            onSelect={onSelect}
          />
          <KeepInView width={graph.width} height={graph.height} />
        </ReactFlow>
      </div>
    </GraphActions.Provider>
  );
}

interface FindableTask {
  id: string;
  path: Path;
  task: WorkflowTask;
  status?: string;
  /** Centre of the node, in graph coordinates. */
  x: number;
  y: number;
}

/** The canvas toolbar: reset, zoom level, out, in, fit — and find a task. */
function ZoomToolbar({
  size,
  tasks,
  onSelect,
}: {
  size: GraphSize;
  tasks: FindableTask[];
  onSelect?: (path: Path | undefined) => void;
}) {
  const { zoomIn, zoomOut, fitView, setViewport, setCenter } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const canvasW = useStore((state) => state.width);
  const canvasH = useStore((state) => state.height);

  return (
    <div className="absolute left-3 top-3 z-10">
      <ButtonGroup size="sm" variant="tertiary" className="bg-surface shadow-sm">
        {/* "Reset" means the view this canvas opens with — centred, at a
            readable zoom. It used to jump to a fixed corner offset, which put
            the graph back in the top-left the moment anyone pressed it. */}
        <Button
          isIconOnly
          aria-label="Reset position"
          onPress={() => void setViewport(openingView(size, canvasW, canvasH), { duration: 200 })}
        >
          <House />
        </Button>
        <Button isDisabled className="tabular min-w-14">
          <ButtonGroup.Separator />
          {Math.round(zoom * 100)}%
        </Button>
        <Button isIconOnly aria-label="Zoom out" onPress={() => zoomOut({ duration: 150 })}>
          <ButtonGroup.Separator />
          <MagnifierMinus />
        </Button>
        <Button isIconOnly aria-label="Zoom in" onPress={() => zoomIn({ duration: 150 })}>
          <ButtonGroup.Separator />
          <MagnifierPlus />
        </Button>
        <Button isIconOnly aria-label="Fit to screen" onPress={() => void fitView({ padding: 0.15, maxZoom: 1, duration: 200 })}>
          <ButtonGroup.Separator />
          <SquareDashed />
        </Button>
        {tasks.length > 1 && (
          <TaskFinder
            tasks={tasks}
            onFind={(found) => {
              void setCenter(found.x, found.y, { zoom: Math.max(zoom, 1), duration: 300 });
              onSelect?.(found.path);
            }}
          />
        )}
      </ButtonGroup>
    </div>
  );
}

/**
 * Keeps the graph centred in the canvas.
 *
 * The viewport is computed from the **graph's own** size rather than from
 * React Flow's measurements, and that is the fix rather than an optimisation.
 * The previous version waited on `useNodesInitialized()` before its first fit
 * and scheduled that fit in an animation frame it cancelled on every effect
 * re-run — while having already recorded that it *had* fitted. Lose that race
 * once and the flag says the work is done, the follow-up run takes the
 * "everything still fits" early return, and the graph sits at React Flow's
 * default `translate(0, 0)` for the life of the page. Which is exactly what it
 * did: every workflow opened hard against the left edge with its Start circle
 * under the toolbar.
 *
 * `buildGraph` already knows the answer. It places every node inside
 * `[0, width] × [0, height]` — `dag.spec.ts` asserts that of every node it
 * builds — so the drawing's bounds are known before a single node has been
 * laid out, and the viewport can be set on the first pass with no waiting, no
 * frame scheduling, and no flag to get out of step with reality.
 */
function KeepInView({ width, height }: { width: number; height: number }) {
  const flow = useReactFlow();
  // Two primitive selectors, not one object: a selector returning a fresh
  // object re-renders on every store change, pan and zoom included.
  const canvasW = useStore((state) => state.width);
  const canvasH = useStore((state) => state.height);
  const lastCanvas = useRef({ w: 0, h: 0 });

  useEffect(() => {
    if (!canvasW || !canvasH || !width || !height) return;

    const canvasChanged = lastCanvas.current.w !== canvasW || lastCanvas.current.h !== canvasH;
    lastCanvas.current = { w: canvasW, h: canvasH };

    // No animation while the canvas itself is moving — first paint, a window
    // resize, a side panel opening. Animate only when the graph changed under a
    // canvas that stood still, where the movement is what tells the editor
    // something was added.
    void flow.setViewport(openingView({ width, height }, canvasW, canvasH), {
      duration: canvasChanged ? 0 : 200,
    });
    // Keyed on the graph's size and the canvas's size, never the viewport:
    // re-running on pan would refit every time the user moved. `width` and
    // `height` change only when the *shape* changes, so renaming a task — the
    // common edit — does not move the canvas at all.
  }, [flow, width, height, canvasW, canvasH]);

  return null;
}

/** Below this, node labels stop being legible. */
const READABLE_ZOOM = 0.65;
/** Breathing room between the drawing and the edges of the canvas. */
const PAD = 32;
/** Clear of the zoom toolbar, which floats over the canvas's top-left corner. */
const TOP = PAD + 24;

interface GraphSize {
  width: number;
  height: number;
}

/**
 * The view a canvas opens with: the whole graph when that leaves it readable,
 * otherwise a legible zoom with the graph centred horizontally and pinned to
 * the top, so the reader starts where the workflow starts and scrolls down
 * through it.
 *
 * Plain fit-to-screen shrank a ten-task workflow to a third of its size —
 * technically all visible, practically unreadable.
 */
function openingView(graph: GraphSize, canvasW: number, canvasH: number) {
  const fitAll = Math.min(1, (canvasW - PAD * 2) / graph.width, (canvasH - PAD * 2) / graph.height);
  const zoom =
    fitAll >= READABLE_ZOOM ? fitAll : Math.max(Math.min(1, (canvasW - PAD * 2) / graph.width), 0.2);

  return {
    zoom,
    x: centreX(graph.width, canvasW, zoom),
    y: topY(graph.height * zoom, canvasH),
  };
}

/** The pan that puts a graph this wide in the middle of a canvas that wide. */
function centreX(graphW: number, canvasW: number, zoom: number): number {
  return (canvasW - graphW * zoom) / 2;
}

/**
 * The vertical pan: centred when the drawing fits, otherwise against the top.
 *
 * A workflow that is taller than the canvas is read downwards from Start, so
 * starting it half-scrolled would only make the reader pan back up.
 */
function topY(drawnH: number, canvasH: number): number {
  return drawnH <= canvasH - PAD * 2 ? (canvasH - drawnH) / 2 : TOP;
}

// ---------------------------------------------------------------- nodes

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const TYPE_ICON: Partial<Record<string, Icon>> = {
  SIMPLE: Cpu,
  SWITCH: BranchesDown,
  FORK_JOIN: CodeFork,
  FORK_JOIN_DYNAMIC: CodeFork,
  JOIN: CodeFork,
  EXCLUSIVE_JOIN: CodeFork,
  DO_WHILE: ArrowsRotateRight,
  SUB_WORKFLOW: Layers,
  START_WORKFLOW: Layers,
  HTTP: Globe,
  HTTP_POLL: Globe,
  WEBHOOK: Globe,
  WAIT_FOR_WEBHOOK: Clock,
  PULL_WORKFLOW_MESSAGES: Comments,
  INLINE: FileCode,
  JSON_JQ_TRANSFORM: FileCode,
  BUSINESS_RULE: FileCode,
  EVENT: Thunderbolt,
  KAFKA_PUBLISH: Thunderbolt,
  WAIT: Stopwatch,
  HUMAN: Person,
  JDBC: Database,
  TERMINATE: Stop,
  SET_VARIABLE: Tag,
};

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'var(--success)',
  COMPLETED_WITH_ERRORS: 'var(--warning)',
  SKIPPED: 'var(--muted)',
  IN_PROGRESS: 'var(--accent)',
  SCHEDULED: 'var(--accent)',
  FAILED: 'var(--danger)',
  FAILED_WITH_TERMINAL_ERROR: 'var(--danger)',
  TIMED_OUT: 'var(--danger)',
  CANCELED: 'var(--muted)',
};

const FAILED = new Set(['FAILED', 'FAILED_WITH_TERMINAL_ERROR', 'TIMED_OUT']);

function TaskNode({ data }: NodeProps<Node<TaskData>>) {
  const { onDelete } = useContext(GraphActions);
  const task = data.task;
  if (!task) return null;

  const Icon = TYPE_ICON[task.type] ?? Gear;
  const color = data.flagged
    ? 'var(--danger)'
    : data.status
      ? (STATUS_COLOR[data.status] ?? 'var(--border)')
      : undefined;
  const failed = data.status !== undefined && FAILED.has(data.status);

  return (
    <div
      className="group relative flex h-full w-full cursor-pointer items-start gap-3 rounded-xl border-2 bg-surface px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md"
      style={{
        borderColor: data.selected ? 'var(--accent)' : (color ?? 'var(--border)'),
        // Conductor's hatching on a failed task: visible without reading, and
        // not dependent on colour alone.
        backgroundImage: failed
          ? 'repeating-linear-gradient(-45deg, transparent 0 12px, color-mix(in oklab, var(--danger) 10%, transparent) 12px 24px)'
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {data.kind === 'loop' && <Handle id="loop-in" type="target" position={Position.Right} className="!opacity-0" />}

      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          task.type === 'SIMPLE' ? 'bg-default text-foreground' : 'bg-accent-soft text-accent'
        }`}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={task.name}>
          {task.name}
        </p>
        <p className="truncate text-xs text-muted">{task.taskReferenceName}</p>
      </div>
      <Chip size="sm" variant="soft" className="shrink-0 text-[10px] uppercase">
        {task.type}
      </Chip>

      {data.status && (
        <span
          className="absolute -right-2.5 -top-2.5 rounded-full bg-surface"
          title={data.status}
          style={{ color: STATUS_COLOR[data.status] }}
        >
          {failed ? <CircleXmarkFill className="size-5" /> : DONE.has(data.status) ? <CircleCheckFill className="size-5" /> : (
            <span className="block size-5 animate-pulse rounded-full" style={{ background: STATUS_COLOR[data.status] }} />
          )}
        </span>
      )}

      {onDelete && data.path && (
        <Tooltip delay={400}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="danger"
              aria-label={`Delete ${task.taskReferenceName}`}
              // Revealed on hover, focus or selection: a delete control on
              // every node at once made the whole canvas look like an error.
              className={`nodrag absolute -right-3 -top-3 size-6 min-w-6 rounded-full transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                data.selected ? 'opacity-100' : 'opacity-0'
              }`}
              onPress={() => onDelete(data.path as Path)}
            >
              <Xmark className="size-3" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{task.type === 'FORK_JOIN' ? 'Delete parallel block' : 'Delete task'}</Tooltip.Content>
        </Tooltip>
      )}

      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

function TerminalNode({ data }: NodeProps<Node<TaskData>>) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-full border-4 border-muted/40 bg-surface text-xs">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {data.kind === 'start' ? 'Start' : 'End'}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

function JunctionNode({ data }: NodeProps<Node<TaskData>>) {
  return (
    <div className="h-full w-full rounded-full border border-border bg-surface">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      {data.kind === 'loopEnd' && <Handle id="loop-out" type="source" position={Position.Right} className="!opacity-0" />}
    </div>
  );
}

const NODE_TYPES = { task: TaskNode, terminal: TerminalNode, junction: JunctionNode };

// ---------------------------------------------------------------- edges

function InsertableEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { onInsert } = useContext(GraphActions);
  const [path, labelX, labelY] = getBezierPath(props);
  const insert = props.data?.insert;
  const stroke = props.data?.taken ? 'var(--success)' : 'var(--muted)';

  const open = (element: HTMLElement) => {
    if (!onInsert || !insert) return;
    const rect = element.getBoundingClientRect();
    onInsert(insert, { x: rect.left + rect.width / 2, y: rect.bottom });
  };

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={{ stroke, strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
          style={{ left: labelX, top: labelY }}
        >
          {props.label && (
            <Chip size="sm" variant="secondary">
              {props.label}
            </Chip>
          )}
          {onInsert && insert && (
            <button
              type="button"
              aria-label="Insert a task here"
              // Opened on mousedown, not click: typing in a field and then
              // clicking "+" blurs the field, the commit re-renders the graph and
              // replaces this button before mouseup, so a click lands on nothing.
              onMouseDown={(event) => event.button === 0 && open(event.currentTarget)}
              // Keyboard activation arrives as a click with no mousedown.
              onClick={(event) => event.detail === 0 && open(event.currentTarget)}
              className="flex size-5 items-center justify-center rounded-full border border-border bg-surface text-xs leading-none text-muted shadow-sm hover:border-accent hover:text-accent"
            >
              +
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * The edge from a loop's end back to its head, drawn out to the right through
 * the gutter the layout reserves, dashed so it cannot be mistaken for flow.
 */
function LoopBackEdge(props: EdgeProps<Edge<EdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({ ...props, offset: 32, borderRadius: 12 });

  return (
    <>
      <BaseEdge id={props.id} path={path} style={{ stroke: 'var(--muted)', strokeDasharray: '5 5' }} />
      {props.label && (
        <EdgeLabelRenderer>
          <div className="absolute -translate-y-1/2" style={{ left: labelX + 6, top: labelY }}>
            <Chip size="sm" variant="secondary">
              {props.label}
            </Chip>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES = { insertable: InsertableEdge, loopBack: LoopBackEdge };

/**
 * Finds a task on a large canvas by reference, name or type.
 *
 * On a workflow of forty tasks the one you want is usually off-screen, and
 * panning to hunt for it is the slow part of reading an execution. Choosing a
 * result centres the canvas on it and selects it, which opens its details.
 * Enter takes the first match, so "/"-style quick jumps need no mouse.
 */
function TaskFinder({ tasks, onFind }: { tasks: FindableTask[]; onFind: (task: FindableTask) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = tasks
    .filter((t) => !needle || [t.task.taskReferenceName, t.task.name, t.task.type].some((f) => f.toLowerCase().includes(needle)))
    .slice(0, 50);

  const pick = (task: FindableTask | undefined) => {
    if (!task) return;
    onFind(task);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly variant="tertiary" aria-label="Find a task">
        <ButtonGroup.Separator />
        <Magnifier />
      </Button>
      <Popover.Content placement="bottom start" className="w-80">
        <Popover.Dialog className="space-y-2 p-2">
          <SearchField aria-label="Find a task" value={query} onChange={setQuery} onSubmit={() => pick(matches[0])} autoFocus>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Find a task" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          {matches.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No task matches “{query}”.</p>
          ) : (
            <ListBox
              aria-label="Tasks"
              className="max-h-72 overflow-y-auto"
              onAction={(key) => pick(tasks.find((t) => t.id === key))}
            >
              {matches.map((t) => (
                <ListBox.Item key={t.id} id={t.id} textValue={t.task.taskReferenceName}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{t.task.taskReferenceName}</span>
                      <span className="block truncate text-xs text-muted">{t.task.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">{t.task.type}</span>
                    {t.status && (
                      <span className="size-2 shrink-0 rounded-full" style={{ background: statusColor(t.status) }} aria-label={t.status} />
                    )}
                  </span>
                </ListBox.Item>
              ))}
            </ListBox>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
