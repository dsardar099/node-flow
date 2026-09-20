import {
  type JsonValue,
  CompilationError,
  InvalidDefinitionError,
  TaskType,
  isOperator,
  type WorkflowDefinition,
  type WorkflowTask,
} from '@node-flow-dev/core';
import { extractReferences, resolveString } from './expression.js';

/**
 * The blueprint: a workflow definition compiled once at registration.
 *
 * Compilation does three things the decider would otherwise redo on every
 * evaluation, for every running instance:
 *
 *  1. **Flattens** the nested task tree into a node map with resolved successor
 *     edges, so "what runs after this?" is a lookup rather than a tree walk.
 *  2. **Extracts static references** — the set of task refs each node's inputs
 *     could read. This is what lets an evaluation fetch O(refs used) rows
 *     instead of O(tasks in workflow).
 *  3. **Validates referential integrity** — duplicate refs, joins pointing at
 *     nothing, branches that do not exist. Catching these at registration turns
 *     a class of 3am production failures into a rejected HTTP request.
 *
 * Blueprints are immutable per (name, version), which is why definition versions
 * are immutable: an LRU cache keyed on that pair never needs invalidating.
 */

/** Where a node sits in the nesting structure, so the decider can resolve scope. */
export interface NodeLocation {
  /** Reference name of the enclosing FORK_JOIN, DO_WHILE or SWITCH, if any. */
  parentRef?: string;
  /** Which branch of the parent: a fork index, a switch case key, or 'loop'. */
  branchKey?: string;
}

export interface BlueprintNode {
  ref: string;
  name: string;
  type: TaskType;
  task: WorkflowTask;
  /** Refs to schedule when this node completes. Empty means a branch tip. */
  next: string[];
  /** Task refs this node's inputs may read. Drives the batch fetch. */
  staticRefs: string[];
  location: NodeLocation;
  /** FORK_JOIN: the head ref of each parallel branch — what the fork schedules. */
  forkBranchHeads?: string[];
  /**
   * FORK_JOIN: the *last* ref of each branch — what a JOIN actually waits on.
   *
   * Distinct from the heads, and the distinction is invisible until a branch has
   * more than one task: waiting on heads fires the join when every branch has
   * *started*, not when every branch has *finished*.
   */
  forkBranchTips?: string[];
  /** FORK_JOIN: ref of the JOIN that closes it. */
  joinRef?: string;
  /** SWITCH: case key to branch head ref. */
  caseHeads?: Record<string, string>;
  /** SWITCH: head ref of the default branch. */
  defaultHead?: string;
  /** DO_WHILE: head ref of the loop body. */
  loopHead?: string;
  /** JOIN: refs whose completion it waits on. */
  joinOn?: string[];
}

export interface Blueprint {
  name: string;
  version: number;
  /** Ref of the first task to schedule. */
  entryRef: string;
  nodes: Map<string, BlueprintNode>;
  /** Union of every node's staticRefs, for whole-workflow prefetch decisions. */
  allStaticRefs: string[];
  /**
   * Distinct task definition names this workflow can dispatch.
   *
   * The evaluator needs retry and timeout policy for tasks it is *about to*
   * schedule, not just ones that already exist — on a first evaluation there
   * are none, so deriving the list from existing rows arms no deadlines at all.
   * Usually far smaller than the node count, since nodes share definitions.
   */
  allTaskDefNames: string[];
  /** Total node count, including nested branches and loop bodies. */
  size: number;
  /** Whole-workflow budget in seconds. 0 disables. */
  timeoutSeconds: number;
  /** Cap on live executions of this definition. 0 disables. */
  maxConcurrentExecutions: number;
  /** Cap on in-flight tasks within one execution — bounds fan-out. 0 disables. */
  maxConcurrentTasks: number;
  /** Started when an execution of this definition fails or times out. */
  failureWorkflow?: { name: string; version?: number };
  /** The workflow's declared output, as expressions resolved when it completes. */
  outputParameters?: Record<string, JsonValue>;
  /** Per-key concurrency: `key` is an expression over the workflow input. */
  rateLimit?: { key: string; limit: number };
  /** Key names hidden wherever an execution is read. */
  maskedFields?: string[];
  /**
   * Saga compensation: original task ref to the ref of the task that undoes it.
   * The compensating tasks are nodes too, outside the normal flow.
   */
  compensations: Record<string, string>;
}

/**
 * The rate-limit bucket a start with this input falls into, if the definition
 * has one.
 *
 * A key that resolves to nothing — the input lacks the field — shares a bucket
 * named by the expression itself rather than escaping the limit: an unkeyed
 * run is still a run against whatever the limit protects.
 */
export function rateLimitFor(
  blueprint: Pick<Blueprint, 'rateLimit'>,
  input: Record<string, JsonValue> | undefined
): { key: string; limit: number } | undefined {
  if (!blueprint.rateLimit) return undefined;
  const { key, limit } = blueprint.rateLimit;
  let resolved: JsonValue;
  try {
    resolved = resolveString(key, { tasks: new Map(), workflow: { input: input ?? {} }, variables: {} });
  } catch {
    resolved = null;
  }
  const text =
    resolved === null || resolved === ''
      ? key
      : typeof resolved === 'object'
        ? JSON.stringify(resolved)
        : String(resolved);
  return { key: text, limit };
}

/**
 * Compiles a validated definition into a blueprint.
 *
 * Throws InvalidDefinitionError for referential problems (the user's fault, and
 * reportable with a precise message) and CompilationError for structural ones.
 */
export function compileBlueprint(definition: WorkflowDefinition): Blueprint {
  const nodes = new Map<string, BlueprintNode>();

  const entryRef = flattenSequence(definition.tasks, nodes, {}, undefined);
  if (!entryRef) {
    throw new CompilationError(`workflow "${definition.name}" compiled to no executable tasks`);
  }

  validateReferences(definition, nodes);
  const compensations = compileCompensations(nodes);

  // Everything an evaluation may need to fetch. Expression references are the
  // obvious half; join dependencies are the easily-missed half.
  //
  // A JOIN decides whether to fire by inspecting its sibling branches, and those
  // refs appear in `joinOn` or as branch tips — never inside a `${...}`. Omit
  // them here and the prefetch returns nothing for them, every sibling looks
  // unfinished, and the join silently never fires. That failure is invisible to
  // engine unit tests, which supply `resolvedRefs` directly.
  const allStaticRefs = new Set<string>();
  const allTaskDefNames = new Set<string>();
  for (const node of nodes.values()) {
    for (const ref of node.staticRefs) allStaticRefs.add(ref);
    for (const ref of node.joinOn ?? []) allStaticRefs.add(ref);
    for (const ref of node.forkBranchTips ?? []) allStaticRefs.add(ref);
    allTaskDefNames.add(node.name);
  }
  // Output expressions read tasks too, usually ones no node input mentions —
  // `${charge.output.receiptId}` on the last task's completion. Without this
  // the prefetch never loads `charge`, and the output resolves to nothing.
  for (const ref of extractReferences(definition.outputParameters ?? null)) allStaticRefs.add(ref);
  // Compensation decides what to undo from what finished, so both the original
  // tasks and their compensations must be loaded on every evaluation.
  for (const [original, compensation] of Object.entries(compensations)) {
    allStaticRefs.add(original);
    allStaticRefs.add(compensation);
  }

  return {
    name: definition.name,
    version: definition.version,
    entryRef,
    nodes,
    allStaticRefs: [...allStaticRefs],
    allTaskDefNames: [...allTaskDefNames],
    size: nodes.size,
    timeoutSeconds: definition.timeoutSeconds,
    maxConcurrentExecutions: definition.maxConcurrentExecutions,
    maxConcurrentTasks: definition.maxConcurrentTasks,
    compensations,
    ...(definition.failureWorkflow
      ? { failureWorkflow: { name: definition.failureWorkflow, version: definition.failureWorkflowVersion } }
      : {}),
    ...(definition.outputParameters ? { outputParameters: definition.outputParameters } : {}),
    ...(definition.maskedFields?.length ? { maskedFields: definition.maskedFields } : {}),
    ...(definition.rateLimitConfig
      ? {
          rateLimit: {
            key: definition.rateLimitConfig.rateLimitKey,
            limit: definition.rateLimitConfig.concurrentExecLimit,
          },
        }
      : {}),
  };
}

/**
 * Flattens a sequential task list, linking each node to its successor.
 * Returns the head ref, or undefined for an empty list.
 */
function flattenSequence(
  tasks: WorkflowTask[],
  nodes: Map<string, BlueprintNode>,
  location: NodeLocation,
  continuation: string | undefined
): string | undefined {
  if (tasks.length === 0) return continuation;

  // Build back to front so each node knows what follows it.
  let next = continuation;
  for (let i = tasks.length - 1; i >= 0; i--) {
    next = flattenTask(tasks[i], nodes, location, next);
  }
  return next;
}

function flattenTask(
  task: WorkflowTask,
  nodes: Map<string, BlueprintNode>,
  location: NodeLocation,
  continuation: string | undefined
): string {
  const ref = task.taskReferenceName;

  if (nodes.has(ref)) {
    throw new InvalidDefinitionError(
      `duplicate taskReferenceName "${ref}" — reference names must be unique within a workflow`,
      { taskReferenceName: ref }
    );
  }

  const node: BlueprintNode = {
    ref,
    name: task.name,
    type: task.type,
    task,
    next: continuation ? [continuation] : [],
    staticRefs: [...extractReferences(task.inputParameters ?? null)],
    location,
  };

  // Reserve the slot before recursing so nested duplicates are detected.
  nodes.set(ref, node);

  switch (task.type) {
    case TaskType.FORK_JOIN:
      compileFork(task, node, nodes, continuation);
      break;
    case TaskType.SWITCH:
      compileSwitch(task, node, nodes, continuation);
      break;
    case TaskType.EVENT:
      compileEvent(task, node);
      break;
    case TaskType.KAFKA_PUBLISH:
      compileKafkaPublish(task, node);
      break;
    case TaskType.DO_WHILE:
      compileDoWhile(task, node, nodes);
      break;
    case TaskType.SUB_WORKFLOW:
    case TaskType.START_WORKFLOW:
      compileWorkflowLaunch(task, node);
      break;
    case TaskType.JOIN:
    case TaskType.EXCLUSIVE_JOIN:
      node.joinOn = task.joinOn ?? [];
      break;
    default:
      break;
  }

  return ref;
}

function compileFork(
  task: WorkflowTask,
  node: BlueprintNode,
  nodes: Map<string, BlueprintNode>,
  continuation: string | undefined
): void {
  const branches = task.forkTasks ?? [];
  if (branches.length === 0) {
    throw new InvalidDefinitionError(`FORK_JOIN "${node.ref}" declares no branches`, {
      taskReferenceName: node.ref,
    });
  }

  // Branches terminate at their tip; the JOIN is what continues the flow, so
  // branch heads get no continuation of their own.
  const heads: string[] = [];
  const tips: string[] = [];

  branches.forEach((branch, index) => {
    const head = flattenSequence(
      branch,
      nodes,
      { parentRef: node.ref, branchKey: String(index) },
      undefined
    );
    if (!head) {
      throw new InvalidDefinitionError(`FORK_JOIN "${node.ref}" branch ${index} is empty`, {
        taskReferenceName: node.ref,
        branch: index,
      });
    }
    heads.push(head);
    // The tip is the branch's last task — for a nested fork that is its inner
    // JOIN, which is exactly the node whose completion means the branch is done.
    tips.push(branch[branch.length - 1].taskReferenceName);
  });

  node.forkBranchHeads = heads;
  node.forkBranchTips = tips;

  // The successor of a fork is its JOIN, which the definition places next in sequence.
  node.joinRef = continuation;
}

/**
 * Checks an `EVENT` names somewhere to publish to.
 *
 * At registration rather than at run time, because a missing sink is a typo in
 * a definition and the author is right there. The alternative — discovering it
 * when the workflow runs — also has nowhere good to put the error: the decider
 * resolves `EVENT` itself, and a resolved task has no way to fail.
 */
/**
 * A task that launches another workflow must say which one.
 *
 * Without this the failure is silent in two different ways. A `SUB_WORKFLOW`
 * with no `subWorkflowParam` starts no child and so is never completed by one:
 * it stays in progress forever and the workflow hangs with no error anywhere.
 * A `START_WORKFLOW` without it reports success having started nothing. Both
 * are obvious at registration and invisible at runtime, which is exactly the
 * kind of mistake a compiler exists to catch.
 *
 * Whether the named workflow *exists* is not checked here: that needs a
 * namespace lookup, and this compiler is pure by design.
 */
function compileWorkflowLaunch(task: WorkflowTask, node: BlueprintNode): void {
  if (!task.subWorkflowParam?.name) {
    throw new InvalidDefinitionError(
      `${task.type} "${node.ref}" does not name a workflow to run — set subWorkflowParam.name`,
      { taskReferenceName: node.ref }
    );
  }
}

function compileEvent(task: WorkflowTask, node: BlueprintNode): void {
  const sink = task.inputParameters?.['sink'];

  if (typeof sink !== 'string' || sink.trim() === '') {
    throw new InvalidDefinitionError(`EVENT "${node.ref}" has no sink to publish to`, {
      taskReferenceName: node.ref,
    });
  }
}

/**
 * Checks a `KAFKA_PUBLISH` names a topic.
 *
 * Same reasoning as `EVENT`, which this is a specialisation of: caught at
 * registration because a resolved task has no way to fail at run time, and
 * because the author is right there when the definition is written.
 */
function compileKafkaPublish(task: WorkflowTask, node: BlueprintNode): void {
  const topic = task.inputParameters?.['topic'];

  if (typeof topic !== 'string' || topic.trim() === '') {
    throw new InvalidDefinitionError(`KAFKA_PUBLISH "${node.ref}" has no topic`, {
      taskReferenceName: node.ref,
    });
  }
}

function compileSwitch(
  task: WorkflowTask,
  node: BlueprintNode,
  nodes: Map<string, BlueprintNode>,
  continuation: string | undefined
): void {
  if (!task.expression && !task.inputParameters) {
    throw new InvalidDefinitionError(`SWITCH "${node.ref}" has no expression to evaluate`, {
      taskReferenceName: node.ref,
    });
  }

  // Every case rejoins the main flow at the switch's continuation.
  const caseHeads: Record<string, string> = {};
  for (const [caseKey, branch] of Object.entries(task.decisionCases ?? {})) {
    const head = flattenSequence(
      branch,
      nodes,
      { parentRef: node.ref, branchKey: caseKey },
      continuation
    );
    if (head) caseHeads[caseKey] = head;
  }
  node.caseHeads = caseHeads;

  if (task.defaultCase?.length) {
    node.defaultHead = flattenSequence(
      task.defaultCase,
      nodes,
      { parentRef: node.ref, branchKey: 'default' },
      continuation
    );
  }

  // A SWITCH expression itself may reference task outputs.
  if (task.expression) {
    for (const ref of extractReferences(task.expression)) {
      if (!node.staticRefs.includes(ref)) node.staticRefs.push(ref);
    }
  }
}

function compileDoWhile(
  task: WorkflowTask,
  node: BlueprintNode,
  nodes: Map<string, BlueprintNode>
): void {
  const body = task.loopOver ?? [];
  if (body.length === 0) {
    throw new InvalidDefinitionError(`DO_WHILE "${node.ref}" has an empty loopOver body`, {
      taskReferenceName: node.ref,
    });
  }
  if (!task.loopCondition) {
    throw new InvalidDefinitionError(`DO_WHILE "${node.ref}" has no loopCondition`, {
      taskReferenceName: node.ref,
    });
  }

  // The body loops back to the DO_WHILE node, which re-evaluates the condition;
  // it never continues directly to the loop's successor.
  node.loopHead = flattenSequence(
    body,
    nodes,
    { parentRef: node.ref, branchKey: 'loop' },
    undefined
  );

  for (const ref of extractReferences(task.loopCondition)) {
    if (!node.staticRefs.includes(ref)) node.staticRefs.push(ref);
  }
}

/**
 * Referential integrity across the flattened graph.
 *
 * Run after flattening so forward references resolve — a task may legitimately
 * reference one declared later in a parallel branch.
 */
function validateReferences(definition: WorkflowDefinition, nodes: Map<string, BlueprintNode>) {
  for (const node of nodes.values()) {
    for (const ref of node.staticRefs) {
      if (!nodes.has(ref)) {
        throw new InvalidDefinitionError(
          `task "${node.ref}" references "${ref}", which is not a task in workflow "${definition.name}"`,
          { taskReferenceName: node.ref, missingReference: ref }
        );
      }
    }

    if (node.joinOn) {
      for (const ref of node.joinOn) {
        if (!nodes.has(ref)) {
          throw new InvalidDefinitionError(
            `${node.type} "${node.ref}" joins on "${ref}", which is not a task in workflow "${definition.name}"`,
            { taskReferenceName: node.ref, missingReference: ref }
          );
        }
      }
    }

    if (node.type === TaskType.FORK_JOIN) {
      const join = node.joinRef ? nodes.get(node.joinRef) : undefined;
      if (!join || (join.type !== TaskType.JOIN && join.type !== TaskType.EXCLUSIVE_JOIN)) {
        throw new InvalidDefinitionError(
          `FORK_JOIN "${node.ref}" must be followed immediately by a JOIN or EXCLUSIVE_JOIN task`,
          { taskReferenceName: node.ref }
        );
      }
    }
  }
}

/** Looks up a node, throwing a precise error rather than returning undefined. */
export function requireNode(blueprint: Blueprint, ref: string): BlueprintNode {
  const node = blueprint.nodes.get(ref);
  if (!node) {
    throw new CompilationError(
      `blueprint for "${blueprint.name}" v${blueprint.version} has no node "${ref}"`,
      { reference: ref }
    );
  }
  return node;
}

/** Whether a node is resolved by the decider rather than dispatched. */
export function isOperatorNode(node: BlueprintNode): boolean {
  return isOperator(node.type);
}

/**
 * Turns each `compensateWith` into a node of its own.
 *
 * Outside the flow — no predecessor schedules it, it schedules nothing after
 * it — and located under the task it undoes, so the decider can tell a
 * compensation from ordinary work. The string shorthand names a task
 * definition and becomes a SIMPLE task handed the original's input and output,
 * which is what an "undo" worker almost always needs.
 */
function compileCompensations(nodes: Map<string, BlueprintNode>): Record<string, string> {
  const compensations: Record<string, string> = {};
  for (const node of [...nodes.values()]) {
    const declared = node.task.compensateWith;
    if (!declared) continue;
    if (node.location.branchKey === 'compensation') {
      throw new InvalidDefinitionError(`compensation "${node.ref}" cannot itself declare compensateWith`, { taskReferenceName: node.ref });
    }

    const task: WorkflowTask =
      typeof declared === 'string'
        ? {
            name: declared,
            taskReferenceName: `${node.ref}__compensate`,
            type: TaskType.SIMPLE,
            inputParameters: { input: `\${${node.ref}.input}`, output: `\${${node.ref}.output}` },
          }
        : declared;

    if (nodes.has(task.taskReferenceName)) {
      throw new InvalidDefinitionError(
        `duplicate taskReferenceName "${task.taskReferenceName}" — the compensation of "${node.ref}" must have a reference name of its own`,
        { taskReferenceName: task.taskReferenceName }
      );
    }
    if (isOperator(task.type)) {
      throw new InvalidDefinitionError(`the compensation of "${node.ref}" must be a task that does work, not ${task.type}`, {
        taskReferenceName: task.taskReferenceName,
      });
    }

    nodes.set(task.taskReferenceName, {
      ref: task.taskReferenceName,
      name: task.name,
      type: task.type,
      task,
      next: [],
      staticRefs: [...extractReferences(task.inputParameters ?? null)],
      location: { parentRef: node.ref, branchKey: 'compensation' },
    });
    compensations[node.ref] = task.taskReferenceName;
  }
  return compensations;
}
