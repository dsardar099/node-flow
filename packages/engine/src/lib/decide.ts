import {
  computeRetryDelaySeconds,
  isTaskSuccessful,
  retryPolicySchema,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  isOperator,
  isTimerBacked,
  isWaitingTask,
  isWorkflowTerminal,
  inlinePayload,
  type EvaluationState,
  type JsonValue,
  TimeoutPolicy,
  type RetryPolicy,
  type TaskDefinition,
  type TaskExecution,
  type WorkflowExecution,
  type WorkflowTask,
  EvaluatorType,
  ExpressionError,
} from '@node-flow-dev/core';
import type { Blueprint, BlueprintNode } from './blueprint.js';
import { requireNode } from './blueprint.js';
import type {
  Command,
  DecisionResult,
  ScheduleTaskCommand,
  SetTimerCommand,
  StartWorkflowCommand,
} from './commands.js';
import { resolveInputParameters, resolveString, type ResolutionScope } from './expression.js';

/**
 * The decider — a pure function from execution state to intended changes.
 *
 * Contract, and every part of it matters:
 *
 *  - **No I/O.** Everything needed arrives in `state`; everything intended
 *    leaves as a command.
 *  - **Deterministic.** Same inputs, same commands. `now` and `random` are
 *    injected rather than read from the ambient environment.
 *  - **Idempotent.** Running twice on the same state produces commands that are
 *    safe to apply twice, because scheduling is guarded by
 *    `UNIQUE (workflowId, refName, iteration)`. This is what lets the engine
 *    always prefer a redundant evaluation over a missed one.
 */

export interface DecideOptions {
  /** Task definitions by name, for retry and timeout policy. */
  taskDefs?: Map<string, TaskDefinition>;
  /**
   * Cap on in-flight tasks within this one execution.
   *
   * Bounds fork-join fan-out blast radius: a dynamic fork over ten thousand
   * items would otherwise schedule all of them at once and bury the queue.
   * 0 disables.
   */
  maxConcurrentTasks?: number;
  /**
   * Task definition names whose retry budget is spent.
   *
   * Computed by the caller — it needs a query over recent attempts — so the
   * decider stays a pure function and simply honours the verdict.
   */
  exhaustedRetryBudgets?: Set<string>;
  /** Injected for deterministic retry jitter in tests. */
  random?: () => number;
}

export function decide(
  blueprint: Blueprint,
  state: EvaluationState,
  options: DecideOptions = {}
): DecisionResult {
  try {
    return decideUnguarded(blueprint, state, options);
  } catch (error) {
    // An expression that cannot resolve is a defect in *this* workflow's
    // definition or data, and it will fail identically on every pass. Thrown
    // out of the decider it became a poison pill: the runner failed, retried the
    // same workflow forever, and the execution sat at RUNNING with no tasks and
    // no reason anywhere but the server log. Failing the workflow — and only
    // it — puts the reason where an operator looks, and lets retry recover it
    // once the definition is fixed.
    if (!(error instanceof ExpressionError)) throw error;
    if (isWorkflowTerminal(state.workflow.status)) return { commands: [], noop: true };
    const commands: Command[] = [{ type: 'FailWorkflow', status: WorkflowStatus.FAILED, reason: error.message }];
    const start = failureWorkflowStart(blueprint, state.workflow, WorkflowStatus.FAILED, error.message);
    if (start) commands.push(start);
    return { commands, noop: false };
  }
}

function decideUnguarded(
  blueprint: Blueprint,
  state: EvaluationState,
  options: DecideOptions
): DecisionResult {
  const commands: Command[] = [];
  const ctx: DecideContext = {
    blueprint,
    state,
    commands,
    taskDefs: options.taskDefs ?? new Map(),
    maxConcurrentTasks: options.maxConcurrentTasks ?? 0,
    dispatchedThisPass: 0,
    exhaustedRetryBudgets: options.exhaustedRetryBudgets ?? new Set(),
    random: options.random ?? Math.random,
    scope: buildResolutionScope(state),
    // Tracks refs scheduled during this pass so a diamond — two branches whose
    // successors converge — cannot emit the same task twice in one decision.
    scheduledThisPass: new Set<string>(),
    resolvedThisPass: new Map(),
    depth: 0,
  };

  const { workflow } = state;

  // A terminal workflow is done; late-arriving task results must not revive it.
  if (isWorkflowTerminal(workflow.status)) {
    return { commands: [], noop: true };
  }

  // A paused workflow keeps its in-flight tasks but schedules nothing new.
  if (workflow.status === WorkflowStatus.PAUSED) {
    return { commands: [], noop: true };
  }

  // The workflow has never scheduled anything: start it.
  //
  // This must key on `hasAnyTask`, not on pending and completed both being
  // empty. A finished workflow whose watermark has moved past its last
  // completion looks identical by that measure, and re-scheduling its entry
  // task is a no-op that leaves it stuck at RUNNING permanently.
  if (!state.hasAnyTask) {
    // The whole-workflow deadline is armed here, on the one pass that is
    // guaranteed to happen exactly once per execution. Arming it anywhere else
    // either misses executions or accumulates a duplicate timer per pass.
    if (blueprint.timeoutSeconds > 0) {
      ctx.commands.push({
        type: 'SetTimer',
        kind: 'workflowTimeout',
        fireAfterSeconds: blueprint.timeoutSeconds,
      });
    }

    scheduleNode(ctx, requireNode(blueprint, blueprint.entryRef), 0, undefined);
    return finish(ctx);
  }

  // Unwinding a failure: only compensations move, and nothing else starts.
  if (compensationOf(state)) {
    continueCompensation(ctx);
    return finish(ctx);
  }

  for (const task of state.completed) {
    handleTerminalTask(ctx, task);
  }

  maybeCompleteWorkflow(ctx);
  return finish(ctx);
}

/**
 * Bounds in-pass operator chaining.
 *
 * A definition can legitimately chain a dozen operators; it can also, through a
 * mistake the compiler does not catch, form a cycle. This turns "the decider
 * spins forever holding a row lock" into "the workflow makes no progress and
 * the stuck-workflow sweeper alerts", which is far easier to diagnose.
 */
const MAX_RESOLUTION_DEPTH = 64;

interface DecideContext {
  blueprint: Blueprint;
  state: EvaluationState;
  commands: Command[];
  taskDefs: Map<string, TaskDefinition>;
  maxConcurrentTasks: number;
  /** Worker tasks scheduled so far in this pass, for the fan-out cap. */
  dispatchedThisPass: number;
  exhaustedRetryBudgets: Set<string>;
  random: () => number;
  scope: ResolutionScope;
  scheduledThisPass: Set<string>;
  /**
   * Tasks resolved earlier in this pass, by ref. They exist nowhere else yet, and
   * a failure later in the same pass must still see them to compensate them.
   */
  resolvedThisPass: Map<string, TaskExecution>;
  /** Current in-pass operator chaining depth. */
  depth: number;
}

function finish(ctx: DecideContext): DecisionResult {
  const failure = ctx.commands.find((c): c is Extract<Command, { type: 'FailWorkflow' }> => c.type === 'FailWorkflow');
  if (failure && beginCompensation(ctx, failure)) {
    return { commands: ctx.commands, noop: false };
  }
  if (failure) {
    const start = failureWorkflowStart(ctx.blueprint, ctx.state.workflow, failure.status, failure.reason);
    if (start) ctx.commands.push(start);
  }
  return { commands: ctx.commands, noop: ctx.commands.length === 0 };
}

/**
 * The start of a definition's failure workflow, or undefined.
 *
 * Exported because a failure the engine does not decide — a whole-workflow
 * timeout, fired by the sweeper — must start the same workflow with the same
 * input. Only FAILED and TIMED_OUT trigger it: a terminated run was stopped on
 * purpose, and treating an operator's decision as a failure to compensate for
 * would undo what they just did.
 *
 * The key is derived from the failed run, so an evaluation replayed after a
 * crash, or a sweeper racing the decider, starts it at most once.
 */
export function failureWorkflowStart(
  blueprint: Blueprint,
  workflow: WorkflowExecution,
  status: WorkflowStatus,
  reason: string
): StartWorkflowCommand | undefined {
  const target = blueprint.failureWorkflow;
  if (!target) return undefined;
  if (status !== WorkflowStatus.FAILED && status !== WorkflowStatus.TIMED_OUT) return undefined;
  // A failure workflow that fails does not start itself again, forever.
  if (target.name === workflow.defName) return undefined;

  const original = workflow.input.kind === 'inline' ? workflow.input.value : {};
  return {
    type: 'StartWorkflow',
    defName: target.name,
    ...(target.version ? { defVersion: target.version } : {}),
    input: {
      ...original,
      workflowId: workflow.id,
      workflowType: workflow.defName,
      workflowVersion: workflow.defVersion,
      reason,
      failureStatus: status,
    },
    ...(workflow.correlationId ? { correlationId: workflow.correlationId } : {}),
    idempotencyKey: `failure-workflow:${workflow.id}`,
  };
}

/** Assembles what expressions may read: prior task results, workflow I/O, variables. */
function buildResolutionScope(state: EvaluationState): ResolutionScope {
  const tasks = new Map<string, { input?: Record<string, JsonValue>; output?: Record<string, JsonValue> }>();

  const add = (task: TaskExecution) => {
    tasks.set(task.refName, {
      input: task.input.kind === 'inline' ? task.input.value : undefined,
      output: task.output?.kind === 'inline' ? task.output.value : undefined,
    });
  };

  for (const task of state.resolvedRefs.values()) add(task);
  // Tasks completing in this pass take precedence over anything prefetched.
  for (const task of state.completed) add(task);

  return {
    tasks,
    workflow: {
      input: state.workflow.input.kind === 'inline' ? state.workflow.input.value : undefined,
      output: state.workflow.output?.kind === 'inline' ? state.workflow.output.value : undefined,
    },
    variables: state.workflow.variables,
    env: state.env,
  };
}

/**
 * Reacts to one task reaching a terminal state.
 *
 * Successful tasks advance the graph. Failures either retry, are absorbed
 * because the task is optional, or fail the workflow.
 */
function handleTerminalTask(ctx: DecideContext, task: TaskExecution): void {
  const node = ctx.blueprint.nodes.get(task.refName);

  if (!node) {
    // Tasks created by FORK_JOIN_DYNAMIC exist only at runtime and are absent
    // from the blueprint. Without this they would be silently dropped here and
    // their JOIN would wait forever.
    handleDynamicChild(ctx, task);
    return;
  }

  if (isTaskSuccessful(task.status)) {
    advance(ctx, node, task);
    return;
  }

  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.TIMED_OUT) {
    const policy = retryPolicyFor(ctx, node);
    const nextAttempt = task.attempt + 1;

    // A timeout under ALERT_ONLY is a warning, not a failure: the task keeps
    // its result and the workflow proceeds. Treating it as fatal — which is
    // what happened while the policy was ignored — turns a monitoring signal
    // into an outage.
    const timeoutPolicy = task.status === TaskStatus.TIMED_OUT ? timeoutPolicyFor(ctx, node) : undefined;
    if (timeoutPolicy === TimeoutPolicy.ALERT_ONLY) {
      advance(ctx, node, task);
      return;
    }

    // TIME_OUT_WF means the deadline is the workflow's deadline: a missed one
    // ends the workflow, it does not buy the task another full timeout. Only
    // RETRY spends retries on a timeout. Retrying under TIME_OUT_WF let a task
    // with a 5-minute budget and three retries hold its workflow for twenty
    // minutes while every attempt reported the same timeout — and matches
    // neither the documented policy nor Conductor's.
    const retriesTimeouts = timeoutPolicy === undefined || timeoutPolicy === TimeoutPolicy.RETRY;

    if (retriesTimeouts && nextAttempt <= policy.retryCount && isRetryable(ctx, node, task, policy)) {
      ctx.commands.push({
        type: 'RetryTask',
        refName: node.ref,
        taskDefName: node.name,
        domain: node.task.domain,
        taskType: node.type,
        input: task.input.kind === 'inline' ? task.input.value : {},
        iteration: task.iteration,
        parentRefName: node.location.parentRef,
        attempt: nextAttempt,
        delaySeconds: computeRetryDelaySeconds(policy, nextAttempt, ctx.random),
        previousTaskId: task.id,
      });

      /**
       * A retried sub-workflow needs a new child, exactly as a first attempt
       * does.
       *
       * `RetryTask` only re-creates the *task*. The child is started by a
       * separate command that `scheduleNode` emits, and a retry does not go
       * through `scheduleNode` — so the retried task sat `SCHEDULED` with
       * nothing running underneath it and nothing that could ever complete it.
       * The parent then hung in `RUNNING` for good.
       *
       * `retryCount` defaults to 3, so this was the default path: any
       * sub-workflow whose child failed stranded its parent unless the author
       * had explicitly set `retryCount: 0`.
       */
      if (node.type === TaskType.SUB_WORKFLOW) {
        startSubWorkflow(
          ctx,
          node,
          task.input.kind === 'inline' ? task.input.value : {},
          task.iteration,
          nextAttempt
        );
      }

      return;
    }
  }

  // Retries exhausted, or a terminal error that was never retryable.
  // An optional task lets the workflow carry on regardless — that is its purpose.
  if (node.task.optional) {
    advance(ctx, node, task);
    return;
  }

  ctx.commands.push({
    type: 'FailWorkflow',
    status: task.status === TaskStatus.TIMED_OUT ? WorkflowStatus.TIMED_OUT : WorkflowStatus.FAILED,
    reason:
      task.reasonForIncompletion ??
      `task "${task.refName}" ended as ${task.status} after ${task.attempt + 1} attempt(s)`,
  });
}

/**
 * Handles a terminal task with no blueprint node.
 *
 * Two ways this happens: a branch materialised by FORK_JOIN_DYNAMIC, or a
 * definition edited under a running instance. The first must still satisfy its
 * JOIN; the second has nowhere to go and is left alone for the stuck-workflow
 * sweeper to surface.
 */
function handleDynamicChild(ctx: DecideContext, task: TaskExecution): void {
  const parentRef = task.parentRefName;
  if (!parentRef) return;

  const fork = ctx.blueprint.nodes.get(parentRef);
  if (!fork || fork.type !== TaskType.FORK_JOIN_DYNAMIC) return;

  if (!isTaskSuccessful(task.status)) {
    // A failed dynamic branch fails the workflow; there is no node carrying an
    // `optional` flag to consult, because the branch was never declared.
    ctx.commands.push({
      type: 'FailWorkflow',
      status: task.status === TaskStatus.TIMED_OUT ? WorkflowStatus.TIMED_OUT : WorkflowStatus.FAILED,
      reason:
        task.reasonForIncompletion ??
        `dynamically forked task "${task.refName}" ended as ${task.status}`,
    });
    return;
  }

  const join = joinFor(ctx, fork);
  if (!join) return;

  const waitingOn = joinDependencies(ctx, fork, join);
  const allSettled = waitingOn.every((ref) => {
    if (ref === task.refName) return true;
    const other = lookupTaskAt(ctx, ref, task.iteration);
    return other !== undefined && isTaskSuccessful(other.status);
  });

  if (allSettled) scheduleNode(ctx, join, task.iteration, fork.location.parentRef);
}

/** Moves the graph forward from a finished node. */
function advance(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  switch (node.type) {
    case TaskType.SWITCH:
      resolveSwitch(ctx, node, task);
      return;
    case TaskType.FORK_JOIN:
      resolveFork(ctx, node, task);
      return;
    case TaskType.FORK_JOIN_DYNAMIC:
      resolveDynamicFork(ctx, node, task);
      return;
    case TaskType.DO_WHILE:
      // A finished DO_WHILE means the loop exited; fall through to its successor.
      break;
    case TaskType.TERMINATE:
      resolveTerminate(ctx, node, task);
      return;
    case TaskType.JOIN:
    case TaskType.EXCLUSIVE_JOIN:
      // A join completes only once its dependencies are satisfied; by the time
      // it appears here as successful, it already has. Fall through.
      break;
    default:
      break;
  }

  // A task inside a loop body that has finished: either start the next
  // iteration or let the loop exit.
  const enclosingLoop = enclosingLoopOf(ctx, node);
  if (enclosingLoop && node.next.length === 0) {
    advanceLoop(ctx, enclosingLoop, task);
    return;
  }

  for (const successorRef of node.next) {
    scheduleNode(ctx, requireNode(ctx.blueprint, successorRef), task.iteration, node.location.parentRef);
  }

  // A branch tip inside a fork has no successor of its own; completing it may
  // be what finally satisfies the enclosing JOIN.
  if (node.next.length === 0 && node.location.parentRef) {
    maybeSatisfyJoin(ctx, node, task);
  }
}

/**
 * The resolution scope for a node, with its enclosing loop's progress visible.
 *
 * A loop body reading `${loop.output.iteration}` is ordinary Conductor usage —
 * "page N", "attempt N" — but the DO_WHILE task stays open until the loop
 * exits, so it has no output yet and the reference failed to resolve. Inside
 * the body it now reads as the iteration running, which is also what the loop
 * condition sees once that iteration completes.
 */
function scopeInsideLoop(ctx: DecideContext, node: BlueprintNode, iteration: number): ResolutionScope {
  let cursor: BlueprintNode | undefined = node;
  while (cursor?.location.parentRef) {
    const parent = ctx.blueprint.nodes.get(cursor.location.parentRef);
    if (parent?.type === TaskType.DO_WHILE && cursor.location.branchKey === 'loop') {
      if (ctx.scope.tasks.has(parent.ref) || iteration < 1) return ctx.scope;
      const tasks = new Map(ctx.scope.tasks);
      tasks.set(parent.ref, { input: {}, output: { iteration } });
      return { ...ctx.scope, tasks };
    }
    cursor = parent;
  }
  return ctx.scope;
}

/** The DO_WHILE this node's body belongs to, if any. */
function enclosingLoopOf(ctx: DecideContext, node: BlueprintNode): BlueprintNode | undefined {
  const parentRef = node.location.parentRef;
  if (!parentRef || node.location.branchKey !== 'loop') return undefined;
  const parent = ctx.blueprint.nodes.get(parentRef);
  return parent?.type === TaskType.DO_WHILE ? parent : undefined;
}

/**
 * Decides whether a DO_WHILE runs another iteration.
 *
 * Evaluated when the loop body's last task finishes. The condition sees
 * `${loopRef.output.iteration}`, so a body can terminate on its own count as
 * well as on data.
 *
 * Only the current iteration's tasks are ever loaded — a loop that has run
 * 10,000 times costs exactly as much to evaluate as one that has run once.
 */
function advanceLoop(ctx: DecideContext, loop: BlueprintNode, bodyTask: TaskExecution): void {
  const nextIteration = bodyTask.iteration + 1;

  if (loopShouldContinue(ctx, loop, bodyTask)) {
    if (loop.loopHead) {
      scheduleNode(ctx, requireNode(ctx.blueprint, loop.loopHead), nextIteration, loop.ref);
    }
    return;
  }

  // Loop finished: complete the DO_WHILE task that has been open since the loop
  // began, then carry on past it.
  //
  // This must *complete* the existing row, not schedule a new one. The
  // DO_WHILE was inserted when the loop started, so re-scheduling it collides
  // with its own identity, is absorbed by ON CONFLICT DO NOTHING, and leaves
  // the task non-terminal forever — the frontier never empties and the
  // workflow never completes.
  const loopTask = ctx.state.pending.find((t) => t.refName === loop.ref);
  if (loopTask) {
    ctx.commands.push({
      type: 'CompleteTask',
      taskId: loopTask.id,
      refName: loop.ref,
      output: { iteration: bodyTask.iteration },
    });
  } else {
    // Started in this very pass — a body of operators can run every iteration
    // before the DO_WHILE row exists. Its schedule becomes the completion, or
    // the loop would stay open with nothing left to close it.
    const started = ctx.commands.find(
      (c): c is ScheduleTaskCommand => c.type === 'ScheduleTask' && c.refName === loop.ref && !c.resolved
    );
    if (started) {
      started.resolved = { status: TaskStatus.COMPLETED, output: { iteration: bodyTask.iteration } };
      started.continuedInPass = true;
    }
  }

  for (const successorRef of loop.next) {
    scheduleNode(ctx, requireNode(ctx.blueprint, successorRef), 0, loop.location.parentRef);
  }
}

/**
 * Evaluates a loop condition.
 *
 * Conductor's conditions are JavaScript, which we do not execute in the pure
 * engine — that belongs in the sandboxed INLINE runner. What is supported here
 * is the common numeric-bound form (`${ref.output.iteration} < 5`) plus plain
 * booleans; anything else stops the loop rather than spinning forever, which is
 * the safe direction to fail.
 */
/** `left <op> right` — the one shape of loop condition the evaluator understands. */
const LOOP_COMPARISON = /^(.+?)\s*(<=|>=|<|>|===|==|!==|!=)\s*(.+)$/;

/**
 * Why a loop condition cannot mean what its author intended, or undefined.
 *
 * For **registration**, deliberately not for compilation. Stored definitions
 * are recompiled whenever a process loads them, so a rule added to the
 * compiler would make workflows registered before it fail to load — and take
 * their running executions down with them. At runtime an unevaluable condition
 * still exits the loop, which stays the safety net; this stops new ones being
 * saved.
 *
 * It rejects only what is certainly wrong, and both cases share a symptom: the
 * loop silently runs exactly once.
 *
 *  - **No comparison at all** — `${check.output.done}`. The evaluator only
 *    understands `left <op> right`, `true` and `false`.
 *  - **An operand written as an expression in another syntax** —
 *    `$.loop['iteration']`, which is how Conductor's JavaScript conditions
 *    look and therefore what people migrating will paste. It is compared as
 *    the literal string, which is never less than 3.
 *
 * A bare word like `PAID` is *not* rejected: the evaluator treats it as a string
 * literal, so `${charge.output.status} == PAID` works as written.
 */
export function loopConditionProblem(condition: string | undefined): string | undefined {
  const text = condition?.trim() ?? '';
  if (text === '' || text === 'true' || text === 'false') return undefined;

  const comparison = text.match(LOOP_COMPARISON);
  if (!comparison) {
    return `"${text}" is not a comparison — write it as left <op> right, for example \${ref.output.done} == true`;
  }

  for (const operand of [comparison[1], comparison[3]]) {
    const value = operand.trim();
    const isExpression = value.includes('${');
    const isQuoted = /^(["']).*\1$/.test(value);
    if (!isExpression && !isQuoted && value.includes('$')) {
      return `"${value}" looks like an expression but is not one — write it as \${ref.output.field}; as written it is compared as literal text`;
    }
  }

  return undefined;
}

function loopShouldContinue(
  ctx: DecideContext,
  loop: BlueprintNode,
  bodyTask: TaskExecution
): boolean {
  const condition = loop.task.loopCondition?.trim();
  if (!condition) return false;
  if (condition === 'true') return true;
  if (condition === 'false') return false;

  const comparison = condition.match(LOOP_COMPARISON);
  if (!comparison) return false;

  const [, rawLeft, operator, rawRight] = comparison;
  const left = evaluateOperand(ctx, rawLeft, bodyTask);
  const right = evaluateOperand(ctx, rawRight, bodyTask);
  if (left === undefined || right === undefined) return false;

  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '==':
    case '===':
      return left === right;
    case '!=':
    case '!==':
      return left !== right;
    default:
      return false;
  }
}

function evaluateOperand(
  ctx: DecideContext,
  raw: string,
  bodyTask: TaskExecution
): number | string | undefined {
  const text = raw.trim();

  const numeric = Number(text);
  if (text.length > 0 && !Number.isNaN(numeric)) return numeric;

  // `${loop.output.iteration}` is the number of iterations *completed*, not the
  // one about to start. `iteration < 3` therefore runs the body three times:
  // after passes 1 and 2 the condition holds, after pass 3 it does not.
  // Using the next iteration here silently runs one fewer than asked for.
  if (/\.output\.iteration\s*\}$/.test(text)) return bodyTask.iteration;

  const scopeWithBody: ResolutionScope = {
    ...ctx.scope,
    tasks: new Map(ctx.scope.tasks).set(bodyTask.refName, {
      input: bodyTask.input.kind === 'inline' ? bodyTask.input.value : undefined,
      output: bodyTask.output?.kind === 'inline' ? bodyTask.output.value : undefined,
    }),
  };

  try {
    const resolved = resolveString(text, scopeWithBody);
    if (typeof resolved === 'number') return resolved;
    if (typeof resolved === 'string') {
      const asNumber = Number(resolved);
      return Number.isNaN(asNumber) ? resolved.replace(/^["']|["']$/g, '') : asNumber;
    }
    return undefined;
  } catch {
    // An unresolvable operand exits the loop rather than looping forever.
    return undefined;
  }
}

/** TERMINATE ends the workflow immediately with a chosen status. */
function resolveTerminate(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  const input = task.input.kind === 'inline' ? task.input.value : {};
  const requested = String(input['terminationStatus'] ?? WorkflowStatus.COMPLETED);

  if (requested === WorkflowStatus.COMPLETED) {
    const output = input['workflowOutput'];
    ctx.commands.push({
      type: 'CompleteWorkflow',
      output: output && typeof output === 'object' && !Array.isArray(output) ? output : {},
    });
    return;
  }

  ctx.commands.push({
    type: 'FailWorkflow',
    status: requested === WorkflowStatus.TERMINATED ? WorkflowStatus.TERMINATED : WorkflowStatus.FAILED,
    reason: String(input['terminationReason'] ?? `terminated by task "${node.ref}"`),
  });
}

/**
 * Takes the matching SWITCH branch and marks the rest SKIPPED.
 *
 * Skipping explicitly rather than leaving branches absent is what stops a
 * downstream JOIN waiting forever on a branch that was never going to run.
 */
function resolveSwitch(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  const caseHeads = node.caseHeads ?? {};
  const evaluated = evaluateSwitchExpression(ctx, node, task);

  const takenHead = evaluated !== undefined ? caseHeads[evaluated] : undefined;
  const target = takenHead ?? node.defaultHead;

  for (const [caseKey, head] of Object.entries(caseHeads)) {
    if (head !== target) {
      ctx.commands.push({
        type: 'SkipTask',
        refName: head,
        iteration: task.iteration,
        reason: `SWITCH "${node.ref}" selected "${evaluated ?? 'default'}", not "${caseKey}"`,
      });
    }
  }
  if (node.defaultHead && node.defaultHead !== target) {
    ctx.commands.push({
      type: 'SkipTask',
      refName: node.defaultHead,
      iteration: task.iteration,
      reason: `SWITCH "${node.ref}" selected case "${evaluated}"`,
    });
  }

  if (target) {
    scheduleNode(ctx, requireNode(ctx.blueprint, target), task.iteration, node.ref);
    return;
  }

  // No case matched and no default: continue past the switch rather than stall.
  for (const successorRef of node.next) {
    scheduleNode(ctx, requireNode(ctx.blueprint, successorRef), task.iteration, node.location.parentRef);
  }
}

function evaluateSwitchExpression(
  ctx: DecideContext,
  node: BlueprintNode,
  task: TaskExecution
): string | undefined {
  const output = task.output?.kind === 'inline' ? task.output.value : undefined;

  // A SWITCH resolved server-side puts its decision in the task output, which
  // takes precedence over re-evaluating the expression.
  if (output && typeof output['caseValue'] === 'string') return output['caseValue'];

  if (!node.task.expression) return undefined;
  const input = task.input.kind === 'inline' ? task.input.value : {};
  const resolved = switchCaseValue(ctx, node.task, input);
  return resolved === null || resolved === undefined ? undefined : String(resolved);
}

/**
 * The value a SWITCH branches on.
 *
 * Two spellings are accepted, because both are in circulation:
 *
 *  - a `${...}` expression — `${check.output.status}` — resolved directly;
 *  - Conductor's `value-param` form, where the expression is the **name of an
 *    input parameter** — `expression: "switchCaseValue"` beside
 *    `inputParameters: { switchCaseValue: "${check.output.status}" }`. This is
 *    what almost every Conductor definition uses. Treating the name as literal
 *    text sent every run down the default case without an error anywhere.
 */
function switchCaseValue(
  ctx: DecideContext,
  task: WorkflowTask,
  input: Record<string, JsonValue>
): JsonValue | undefined {
  const expression = task.expression?.trim();
  if (!expression) return input['switchCaseValue'] ?? undefined;
  if (!expression.includes('${') && Object.hasOwn(input, expression)) return input[expression];
  return safeResolve(ctx, expression);
}

/**
 * Why a SWITCH can never pick the case its author meant, or undefined.
 *
 * For registration only, like `loopConditionProblem` and for the same reason:
 * stored definitions are recompiled on load, so a compiler rule would take
 * already-running executions down with them.
 *
 *  - **`javascript` evaluator** — the pure engine does not run scripts, so the
 *    script would be compared as literal text and match nothing.
 *  - **`value-param` naming no input parameter** — a bare word that is not a
 *    key of `inputParameters` is compared as literal text; every run takes the
 *    default case.
 */
export function switchExpressionProblem(task: WorkflowTask): string | undefined {
  const expression = task.expression?.trim();
  if (task.evaluatorType === EvaluatorType.JAVASCRIPT) {
    return 'JavaScript SWITCH expressions are not evaluated — use value-param with an input parameter name, or a ${ref.output.field} expression';
  }
  if (!expression || expression.includes('${')) return undefined;
  if ((task.evaluatorType ?? EvaluatorType.VALUE_PARAM) === EvaluatorType.VALUE_PARAM) {
    if (!Object.hasOwn(task.inputParameters ?? {}, expression)) {
      return `expression "${expression}" is not one of this task's input parameters, so every run would take the default case — add an input parameter named "${expression}" or write a \${...} expression`;
    }
  }
  return undefined;
}

/** Schedules every branch of a fork in parallel. */
function resolveFork(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  for (const head of node.forkBranchHeads ?? []) {
    scheduleNode(ctx, requireNode(ctx.blueprint, head), task.iteration, node.ref);
  }
}

/**
 * Fans out over a task list computed at runtime.
 *
 * The branches do not exist in the blueprint — their count and names come from
 * a previous task's output, so they are materialised here. Two consequences:
 *
 *  - The refs are recorded in the fork's own output as `forkedTaskRefs`, since
 *    that is the only place the downstream JOIN can learn what to wait for.
 *  - Nothing static-analysed these tasks, so a malformed entry is a runtime
 *    error. An empty list is legitimate — fanning out over zero items should
 *    skip straight to the join, not stall.
 */
function resolveDynamicFork(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  const input = task.input.kind === 'inline' ? task.input.value : {};
  const listParam = node.task.dynamicForkTasksParam ?? 'dynamicTasks';
  const inputsParam = node.task.dynamicForkTasksInputParamName ?? 'dynamicTasksInput';

  const rawList = input[listParam];
  const perTaskInputs = asRecord(input[inputsParam]);

  if (!Array.isArray(rawList) || rawList.length === 0) {
    // Zero branches: satisfy the join immediately rather than wait for nothing.
    const join = joinFor(ctx, node);
    if (join) scheduleNode(ctx, join, task.iteration, node.location.parentRef);
    return;
  }

  const forkedRefs: string[] = [];

  for (const entry of rawList) {
    const spec = asRecord(entry);
    if (!spec) continue;

    const refName = typeof spec['taskReferenceName'] === 'string' ? spec['taskReferenceName'] : undefined;
    const name = typeof spec['name'] === 'string' ? spec['name'] : refName;
    if (!refName || !name) continue;

    forkedRefs.push(refName);

    ctx.commands.push({
      type: 'ScheduleTask',
      refName,
      taskDefName: name,
      // A dynamically forked task may name its own domain; otherwise it
      // inherits the fork's, so a fork routed to a fleet does not scatter its
      // branches across the shared pool.
      domain: (spec['domain'] as string | undefined) ?? node.task.domain,
      taskType: (spec['type'] as TaskType) ?? TaskType.SIMPLE,
      input: asRecord(perTaskInputs?.[refName]) ?? {},
      iteration: task.iteration,
      parentRefName: node.ref,
      attempt: 0,
    });
  }

  // Publish what was forked so the JOIN knows its dependencies.
  //
  // When the fork settled in this same pass its row does not exist yet, so
  // `task.id` is the synthetic in-pass id and completing it would address
  // nothing. Write the refs onto the schedule command instead — the same shape
  // `DO_WHILE` uses when its loop opens and closes within one evaluation.
  const scheduledHere = ctx.commands.find(
    (c): c is ScheduleTaskCommand =>
      c.type === 'ScheduleTask' && c.refName === node.ref && c.iteration === task.iteration
  );

  if (scheduledHere?.resolved) {
    scheduledHere.resolved = {
      ...scheduledHere.resolved,
      output: { forkedTaskRefs: forkedRefs },
    };
    return;
  }

  ctx.commands.push({
    type: 'CompleteTask',
    taskId: task.id,
    refName: node.ref,
    output: { forkedTaskRefs: forkedRefs },
  });
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

/** The JOIN that closes a fork, static or dynamic. */
function joinFor(ctx: DecideContext, fork: BlueprintNode): BlueprintNode | undefined {
  const ref = fork.joinRef ?? fork.next[0];
  if (!ref) return undefined;
  const candidate = ctx.blueprint.nodes.get(ref);
  return candidate && (candidate.type === TaskType.JOIN || candidate.type === TaskType.EXCLUSIVE_JOIN)
    ? candidate
    : undefined;
}

/**
 * Completes a JOIN once every branch it waits on has finished.
 *
 * SKIPPED counts as finished — otherwise a SWITCH inside a fork would deadlock
 * the join forever on a branch that was deliberately not taken.
 */
function maybeSatisfyJoin(ctx: DecideContext, node: BlueprintNode, task: TaskExecution): void {
  const forkRef = node.location.parentRef;
  if (!forkRef) return;

  const fork = ctx.blueprint.nodes.get(forkRef);
  if (!fork) return;

  const isFork = fork.type === TaskType.FORK_JOIN || fork.type === TaskType.FORK_JOIN_DYNAMIC;
  if (!isFork) return;

  const join = joinFor(ctx, fork);
  if (!join) return;

  const waitingOn = joinDependencies(ctx, fork, join);
  if (waitingOn.length === 0) return;

  if (join.type === TaskType.EXCLUSIVE_JOIN) {
    // An exclusive join follows a SWITCH: exactly one branch runs and the rest
    // are SKIPPED, so waiting for *all* of them would be waiting for tasks that
    // will never exist. One genuinely-completed branch is the whole condition.
    const anyCompleted = waitingOn.some((ref) => {
      const other = ref === task.refName ? task : lookupTaskAt(ctx, ref, task.iteration);
      return other?.status === TaskStatus.COMPLETED;
    });
    if (!anyCompleted) return;
  } else {
    // Fall back to branch *tips*, never heads. Heads would satisfy the join as
    // soon as every branch had started rather than finished — a difference that
    // only shows up once a branch has more than one task.
    const allSettled = waitingOn.every((ref) => {
      if (ref === task.refName) return true;
      const other = lookupTaskAt(ctx, ref, task.iteration);
      return other !== undefined && isTaskSuccessful(other.status);
    });
    if (!allSettled) return;
  }

  scheduleNode(ctx, join, task.iteration, fork.location.parentRef);
}

/**
 * What a JOIN waits on.
 *
 * An explicit `joinOn` wins. Otherwise a static fork uses its branch tips, and
 * a dynamic fork reads the refs it recorded in its own output — the only place
 * that information exists, since those tasks were never in the blueprint.
 */
function joinDependencies(
  ctx: DecideContext,
  fork: BlueprintNode,
  join: BlueprintNode
): string[] {
  if (join.joinOn?.length) return join.joinOn;

  if (fork.type === TaskType.FORK_JOIN_DYNAMIC) {
    const forkTask = lookupTask(ctx, fork.ref);
    const output = forkTask?.output?.kind === 'inline' ? forkTask.output.value : undefined;
    const refs = output?.['forkedTaskRefs'];
    return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [];
  }

  return fork.forkBranchTips ?? [];
}

function lookupTask(ctx: DecideContext, refName: string): TaskExecution | undefined {
  return ctx.resolvedThisPass.get(refName) ?? ctx.state.resolvedRefs.get(refName) ?? findCompleted(ctx.state, refName);
}

/**
 * A task as of one loop iteration.
 *
 * For joins, which must only count their own iteration's branches. The latest
 * finished row for a ref can belong to the previous pass while this pass's
 * copy is still running, and accepting it fired the join a pass early.
 */
function lookupTaskAt(ctx: DecideContext, refName: string, iteration: number): TaskExecution | undefined {
  // Resolved earlier in this pass: a branch of NOOPs finishes before its join is
  // reached, and nothing loaded from the database knows that yet.
  const inPass = ctx.resolvedThisPass.get(`${refName}#${iteration}`);
  if (inPass) return inPass;
  const exact = ctx.state.resolvedRefs.get(`${refName}#${iteration}`);
  if (exact) return exact;
  const latest = ctx.state.resolvedRefs.get(refName);
  if (latest?.iteration === iteration) return latest;
  return ctx.state.completed.find((t) => t.refName === refName && t.iteration === iteration);
}

function findCompleted(state: EvaluationState, refName: string): TaskExecution | undefined {
  return state.completed.find((t) => t.refName === refName);
}

/**
 * Emits a ScheduleTask, resolving the node's inputs against current state.
 *
 * Operators that resolve immediately are still scheduled as tasks rather than
 * being collapsed away: their execution is what makes control flow visible in
 * the execution view, which matters enormously when debugging why a workflow
 * took the branch it did.
 */
function scheduleNode(
  ctx: DecideContext,
  node: BlueprintNode,
  iteration: number,
  parentRefName: string | undefined
): void {
  const key = `${node.ref}#${iteration}`;
  if (ctx.scheduledThisPass.has(key)) return;

  /**
   * An exclusive join waits for the branch that actually runs.
   *
   * Its branches settle at different times: a SWITCH writes the untaken ones as
   * `SKIPPED` immediately, while the taken one is still being dispatched. Those
   * skips are terminal tasks, so the next evaluation advances *them* and
   * arrives here — and the join, which resolves the moment it is scheduled,
   * would settle on a set of branches where the only finished ones are skips.
   * The result was an empty output and a workflow that read nothing from the
   * branch it took.
   *
   * There is an equivalent guard for a join under a FORK_JOIN; this is the
   * SWITCH path, which reaches the join as an ordinary successor instead.
   */
  if (node.type === TaskType.EXCLUSIVE_JOIN) {
    const anyCompleted = (node.joinOn ?? []).some((ref) => {
      const task = ctx.state.completed.find((t) => t.refName === ref) ?? ctx.state.resolvedRefs.get(ref);
      return task?.status === TaskStatus.COMPLETED;
    });
    // Not "never": the branch that runs schedules the join when it finishes.
    if (!anyCompleted) return;
  }

  // Per-execution fan-out cap. Operators are exempt: they perform no external
  // work, and blocking them would stall the control flow that decides what runs
  // next — the cap would prevent the workflow from making progress at all.
  if (ctx.maxConcurrentTasks > 0 && !isOperator(node.type) && !isWaitingTask(node.type)) {
    const inFlight = ctx.state.pending.length + ctx.dispatchedThisPass;
    if (inFlight >= ctx.maxConcurrentTasks) return;
  }

  // Already live or already finished — never schedule a second copy.
  if (ctx.state.pending.some((t) => t.refName === node.ref && t.iteration === iteration)) return;
  if (ctx.state.resolvedRefs.has(key)) return;
  // A finished row under the bare ref is only "this task" if it is from this
  // iteration or a later one. Treating any earlier iteration as a duplicate
  // stopped every loop whose body reads its own tasks — a FORK_JOIN's branches,
  // joined by name — from ever starting its second pass.
  const earlier = ctx.state.resolvedRefs.get(node.ref);
  if (earlier && earlier.iteration >= iteration) return;

  ctx.scheduledThisPass.add(key);

  const input = resolveInputParameters(node.task.inputParameters, scopeInsideLoop(ctx, node, iteration));

  const command: ScheduleTaskCommand = {
    type: 'ScheduleTask',
    refName: node.ref,
    // DYNAMIC picks its implementation at runtime: the node names an input
    // parameter, and that parameter's value is the task actually run.
    taskDefName: resolveTaskDefName(node, input),
    domain: node.task.domain,
    taskType: node.type === TaskType.DYNAMIC ? TaskType.SIMPLE : node.type,
    input,
    iteration,
    parentRefName: parentRefName ?? node.location.parentRef,
    delaySeconds: node.task.startDelaySeconds,
    attempt: 0,
  };

  // A key that resolves to nothing caches nothing: two unrelated runs sharing
  // the empty key would hand each other their results.
  if (node.task.cacheConfig && !isOperator(node.type)) {
    const key = resolveString(node.task.cacheConfig.key, scopeInsideLoop(ctx, node, iteration));
    if (key !== null && key !== undefined && key !== '') {
      command.cache = { key: typeof key === 'string' ? key : JSON.stringify(key), ttlSeconds: node.task.cacheConfig.ttlInSecond };
    }
  }

  // Operators that need no external work resolve here and now, then the pass
  // continues straight through them. Otherwise a SWITCH inside a FORK inside a
  // DO_WHILE would cost three evaluations to traverse control flow that does
  // nothing.
  const resolved = resolveImmediateOperator(ctx, node, input, iteration);
  if (resolved) {
    command.resolved = resolved;
    command.continuedInPass = ctx.depth < MAX_RESOLUTION_DEPTH;
    ctx.commands.push(command);
    const inPass: TaskExecution = {
      id: `inpass-${node.ref}-${iteration}`,
      workflowId: ctx.state.workflow.id,
      refName: node.ref,
      taskDefName: command.taskDefName,
      taskType: node.type,
      status: resolved.status,
      attempt: 0,
      iteration,
      input: inlinePayload(input),
      output: inlinePayload(resolved.output),
      scheduledAt: ctx.state.now,
      // Later in the pass is later in time, so an unwind orders these most recent first.
      endedAt: new Date(ctx.state.now.getTime() + ctx.resolvedThisPass.size + 1),
    };
    ctx.resolvedThisPass.set(node.ref, inPass);
    ctx.resolvedThisPass.set(key, inPass);
    continueThrough(ctx, node, input, resolved.output, iteration);
    return;
  }

  ctx.commands.push(command);
  if (!isOperator(node.type) && !isWaitingTask(node.type)) ctx.dispatchedThisPass += 1;
  scheduleTimeouts(ctx, node);

  // A WAIT is completed by the clock, so arm the clock. It is not dispatched
  // anywhere and holds no lease — see `isTimerBacked`.
  if (isTimerBacked(node.type)) scheduleWait(ctx, node, input);

  if (node.type === TaskType.SUB_WORKFLOW) startSubWorkflow(ctx, node, input, iteration, command.attempt);
  if (node.type === TaskType.DO_WHILE) startLoop(ctx, node);
}

/**
 * Arms the timer that completes a `WAIT`.
 *
 * Accepts either a duration (`seconds`/`duration`) or an absolute instant
 * (`until`). A duration of zero, or an instant already past, still goes through
 * the timer rather than completing in-pass: the sweeper runs every second, so
 * the cost is negligible, and having exactly one path that completes a WAIT is
 * worth more than saving a second on a degenerate case.
 */
function scheduleWait(
  ctx: DecideContext,
  node: BlueprintNode,
  input: Record<string, JsonValue>
): void {
  // No duration and no instant: the WAIT is completed from outside — a signal,
  // an event handler, the task API. Arming a zero-second timer completed it at
  // once, so a workflow meant to pause until told to sailed straight through.
  if (!hasWaitTiming(input)) return;
  ctx.commands.push({
    type: 'SetTimer',
    kind: 'wait',
    refName: node.ref,
    fireAfterSeconds: waitSeconds(input, ctx.state.now),
  });
}

/** Seconds until a WAIT should complete. Never negative. */
export function waitSeconds(input: Record<string, JsonValue>, now: Date): number {
  const until = input['until'];
  if (typeof until === 'string') {
    const at = Date.parse(until);
    // An unparseable instant becomes "no wait" rather than an error. The
    // alternative — failing the task — turns a typo in a date into a dead
    // workflow, and the value is visible in the task input either way.
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
  }

  const seconds = input['seconds'] ?? input['duration'];
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return Math.max(0, seconds);
  if (typeof seconds === 'string') {
    const parsed = parseDuration(seconds);
    if (parsed !== undefined) return parsed;
  }

  return 0;
}

/**
 * Whether a WAIT says when it ends, as opposed to waiting to be told.
 *
 * Presence, not validity: a timing that is present but unparseable still ends
 * the wait at once, deliberately — a typo in a date must not become a workflow
 * that waits forever for a signal nobody knows to send.
 */
export function hasWaitTiming(input: Record<string, JsonValue>): boolean {
  return ['until', 'seconds', 'duration'].some((key) => input[key] !== undefined && input[key] !== null && input[key] !== '');
}

/**
 * Conductor's duration strings: "30s", "10m 30s", "2h", "1 day 4 hours".
 * Undefined for anything else, so a typo is visibly not a duration.
 */
export function parseDuration(text: string): number | undefined {
  const units: Record<string, number> = {
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
    m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
  };
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  let total = 0;
  let matched = '';
  for (const part of trimmed.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
    const factor = units[part[2]];
    if (factor === undefined) return undefined;
    total += Number(part[1]) * factor;
    matched += part[0];
  }
  return matched.replace(/\s+/g, '') === trimmed.replace(/\s+/g, '') ? total : undefined;
}

/**
 * Arms the deadlines for a task the moment it is scheduled.
 *
 * Each timeout class answers a different question, which is why they are
 * separate rather than one number:
 *
 *  - `scheduleToStart` — nobody picked it up. Distinguishes "no workers on this
 *    queue" from "the worker is slow", which is the difference between paging
 *    the platform team and paging the service owner.
 *  - `startToClose` — a worker took it and never finished.
 *  - `timeoutSeconds` — the total budget, end to end.
 *
 * A policy of 0 means unbounded, so no timer is armed. The timers are cancelled
 * when the task reaches a terminal state; without that they would fire against
 * work that already succeeded.
 */
function scheduleTimeouts(ctx: DecideContext, node: BlueprintNode): void {
  const def = ctx.taskDefs.get(node.name);
  if (!def) return;

  // A timer-backed task is never dispatched and nothing executes it, so the
  // two deadlines that measure dispatch and execution do not apply. Arming
  // `scheduleToStart` on a WAIT would fire while it is legitimately waiting and
  // mark it TIMED_OUT — turning the feature into a bug that looks like one of
  // the engine's own guarantees.
  //
  // `taskTimeout` is kept: a total budget on a WAIT is meaningful, and a
  // declared "wait at most this long" should win over the wait itself.
  // A task nothing dispatches has no dispatch deadlines. `scheduleToStart`
  // measures "nobody picked it up", which is permanently true of a WAIT and of
  // a task waiting on a third party — it would fire while each was doing
  // exactly what it was asked to.
  //
  // `taskTimeout` is kept, and for `WAIT_FOR_WEBHOOK` it is the *only* thing
  // that ends a callback which never arrives.
  const deadlines: [SetTimerCommand['kind'], number][] = isWaitingTask(node.type)
    ? [['taskTimeout', def.timeoutSeconds]]
    : [
        ['scheduleToStart', def.scheduleToStartTimeout],
        ['startToClose', def.startToCloseTimeout],
        ['taskTimeout', def.timeoutSeconds],
      ];

  for (const [kind, seconds] of deadlines) {
    if (seconds > 0) {
      ctx.commands.push({ type: 'SetTimer', kind, fireAfterSeconds: seconds, refName: node.ref });
    }
  }
}

/**
 * The task definition a node actually runs.
 *
 * Normally the node's own name. A DYNAMIC node instead names an input parameter
 * whose *value* is the task to run, chosen at runtime — Conductor's function
 * pointer. If the parameter is missing or is not a string there is nothing
 * sensible to dispatch, so the node name stands and the failure surfaces as an
 * unknown task rather than as a silent no-op.
 */
function resolveTaskDefName(node: BlueprintNode, input: Record<string, JsonValue>): string {
  if (node.type !== TaskType.DYNAMIC) return node.name;
  const param = node.task.dynamicTaskNameParam ?? 'taskToExecute';
  const value = input[param];
  return typeof value === 'string' && value.length > 0 ? value : node.name;
}

/** Output for an operator the decider can settle without leaving the process. */
function resolveImmediateOperator(
  ctx: DecideContext,
  node: BlueprintNode,
  input: Record<string, JsonValue>,
  iteration: number
): ScheduleTaskCommand['resolved'] | undefined {
  switch (node.type) {
    case TaskType.NOOP:
      return { status: TaskStatus.COMPLETED, output: {} };

    case TaskType.SET_VARIABLE:
      ctx.commands.push({ type: 'SetVariable', values: input });
      // Visible immediately, not only to the next evaluation.
      //
      // The command updates the stored variables, but a pass continues straight
      // through an operator: the task after this one has its input resolved
      // *here*, against this scope. Leaving the scope alone meant
      // `${workflow.variables.x}` read null in the very task the SET_VARIABLE
      // was written to feed, while the same reference in the workflow's output
      // — resolved a pass later — read correctly. Setting a variable and using
      // it in the next step is the whole idiom.
      ctx.scope.variables = { ...ctx.scope.variables, ...input };
      return { status: TaskStatus.COMPLETED, output: input };

    // Resolved here rather than by a task runner, so the publish lands in the
    // same transaction as the completion. See `PublishEventCommand`.
    case TaskType.EVENT: {
      // Guaranteed present: the compiler refuses to register an EVENT without
      // one, which is the only reason this can assume it rather than fail.
      const sink = String(input['sink']);
      const { sink: _sink, payload, ...rest } = input;
      // `payload` if given, otherwise every other input key — the same
      // convention the JQ task uses for "the program is not part of the data".
      const body =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, JsonValue>)
          : rest;

      ctx.commands.push({
        type: 'PublishEvent',
        sink,
        payload: body,
        // The task identity. Carried to the subscriber so it can deduplicate
        // across at-least-once redeliveries from the relay.
        idempotencyKey: `${ctx.state.workflow.id}:${node.ref}:${iteration}`,
      });

      return { status: TaskStatus.COMPLETED, output: { sink, published: true } };
    }

    /**
     * `KAFKA_PUBLISH` — an `EVENT` with a Kafka-shaped payload.
     *
     * It does **not** talk to a broker here, and deliberately not from a task
     * runner either. The message goes to the transactional outbox with the task
     * completion, and the relay delivers it to the broker after commit.
     *
     * The trade this makes, stated plainly: the task completes when the message
     * is durably *queued*, not when Kafka acknowledges it, so there is no
     * partition or offset in the output. In exchange a broker outage does not
     * fail the workflow — the relay retries with backoff and dead-letters after
     * a limit, which is a far better answer than burning a task's retry budget
     * on an outage nobody in the workflow can do anything about.
     */
    case TaskType.KAFKA_PUBLISH: {
      // Guaranteed by the compiler, which refuses to register one without.
      const topic = String(input['topic']);
      const cluster = typeof input['cluster'] === 'string' ? input['cluster'] : 'default';

      const { topic: _t, cluster: _c, key, value, headers, ...rest } = input;

      ctx.commands.push({
        type: 'PublishEvent',
        // Namespaced so a Kafka sink handler claims only Kafka messages, and an
        // install with no Kafka configured dead-letters them visibly rather
        // than appearing to succeed.
        sink: `kafka:${cluster}`,
        payload: {
          topic,
          // Kafka's partitioning key: same key, same partition, so per-entity
          // ordering survives. Absent means round-robin, which is right for
          // messages with no ordering requirement.
          key: typeof key === 'string' ? key : null,
          value: (value ?? rest) as JsonValue,
          headers: (headers ?? {}) as JsonValue,
        },
        idempotencyKey: `${ctx.state.workflow.id}:${node.ref}:${iteration}`,
      });

      return { status: TaskStatus.COMPLETED, output: { topic, cluster, queued: true } };
    }

    case TaskType.GET_WORKFLOW:
      return {
        status: TaskStatus.COMPLETED,
        output: {
          workflowId: ctx.state.workflow.id,
          defName: ctx.state.workflow.defName,
          defVersion: ctx.state.workflow.defVersion,
          status: ctx.state.workflow.status,
          correlationId: ctx.state.workflow.correlationId ?? null,
        },
      };

    case TaskType.FORK_JOIN:
      return { status: TaskStatus.COMPLETED, output: { forkedBranches: node.forkBranchHeads ?? [] } };

    /**
     * The dynamic fork settles here too, for the same reason its static
     * sibling does — and it *must*, or it never settles at all.
     *
     * Operators are never queued to a worker, and `decide` only advances tasks
     * that are already terminal. An operator that resolves neither in-pass nor
     * by some other machinery is therefore inserted `SCHEDULED` and left there
     * forever: this one stranded every workflow that used it, with the fork
     * sitting in the frontier and not one branch materialised.
     *
     * Its branches come from runtime input, so they are read in
     * `resolveDynamicFork` on the way through; the real output is written back
     * onto this command there.
     */
    case TaskType.FORK_JOIN_DYNAMIC:
      return { status: TaskStatus.COMPLETED, output: { forkedTaskRefs: [] } };

    case TaskType.JOIN:
    case TaskType.EXCLUSIVE_JOIN: {
      // A join is only ever scheduled once the decider has confirmed its
      // dependencies are satisfied, so by definition it is already complete.
      // Leaving it unresolved would put it on a worker queue and wait forever
      // for a worker that has no idea what a JOIN is.
      //
      // `completed` before `resolvedRefs`: the prefetch is a snapshot taken
      // before the pass, so for a branch that finished *in* this pass it holds
      // the older, non-terminal row with no output. Reading it first returns an
      // empty object for the one branch whose result the join exists to carry.
      const outputOf = (ref: string): JsonValue => {
        const task =
          ctx.state.completed.find((t) => t.refName === ref) ?? ctx.state.resolvedRefs.get(ref);
        return (task?.output?.kind === 'inline' ? task.output.value : {}) as JsonValue;
      };

      if (node.type === TaskType.EXCLUSIVE_JOIN) {
        // Exactly one branch of a SWITCH runs, so the join *is* that branch's
        // result — `${merge.output.field}` reads the field the branch produced.
        // Keyed by branch like a JOIN, the caller would have to know which
        // branch ran to read anything, which defeats the operator.
        const taken = (node.joinOn ?? []).find((ref) => {
          const task = ctx.state.completed.find((t) => t.refName === ref) ?? ctx.state.resolvedRefs.get(ref);
          return task !== undefined && task.status !== TaskStatus.SKIPPED;
        });
        return {
          status: TaskStatus.COMPLETED,
          output: (taken ? asRecord(outputOf(taken)) : undefined) ?? {},
        };
      }

      const joined: Record<string, JsonValue> = {};
      for (const ref of node.joinOn ?? []) joined[ref] = outputOf(ref);
      return { status: TaskStatus.COMPLETED, output: joined };
    }

    case TaskType.SWITCH: {
      const caseValue = switchCaseValue(ctx, node.task, input);
      return {
        status: TaskStatus.COMPLETED,
        output: { caseValue: caseValue === undefined || caseValue === null ? null : String(caseValue) },
      };
    }

    case TaskType.TERMINATE:
      return { status: TaskStatus.COMPLETED, output: input };

    case TaskType.START_WORKFLOW: {
      // Fire and forget: nothing links the child back, so this task is done the
      // moment the start is issued. The child's fate cannot affect this workflow.
      const param = node.task.subWorkflowParam;
      if (param) {
        ctx.commands.push({
          type: 'StartWorkflow',
          defName: param.name,
          defVersion: param.version,
          input,
          correlationId: ctx.state.workflow.correlationId,
          // Derived from the parent task identity so replaying an evaluation
          // cannot start the same child twice.
          idempotencyKey: `${ctx.state.workflow.id}:${node.ref}:${iteration}`,
        });
      }
      return { status: TaskStatus.COMPLETED, output: { started: param?.name ?? null } };
    }

    default:
      return undefined;
  }
}

/** Advances past an operator resolved within this pass. */
function continueThrough(
  ctx: DecideContext,
  node: BlueprintNode,
  input: Record<string, JsonValue>,
  output: Record<string, JsonValue>,
  iteration: number
): void {
  if (ctx.depth >= MAX_RESOLUTION_DEPTH) return;
  ctx.depth += 1;

  const synthetic: TaskExecution = {
    id: `inpass-${node.ref}-${iteration}`,
    workflowId: ctx.state.workflow.id,
    refName: node.ref,
    taskDefName: node.name,
    taskType: node.type,
    status: TaskStatus.COMPLETED,
    attempt: 0,
    iteration,
    input: inlinePayload(input),
    output: inlinePayload(output),
    scheduledAt: ctx.state.now,
  };

  // Make this result visible to expressions in whatever runs next.
  ctx.scope.tasks.set(node.ref, { input, output });

  advance(ctx, node, synthetic);
  ctx.depth -= 1;
}

function safeResolve(ctx: DecideContext, expression: string): JsonValue | undefined {
  try {
    return resolveString(expression, ctx.scope);
  } catch {
    return undefined;
  }
}

/** A SUB_WORKFLOW task stays IN_PROGRESS until its child reaches a terminal state. */
function startSubWorkflow(
  ctx: DecideContext,
  node: BlueprintNode,
  input: Record<string, JsonValue>,
  iteration: number,
  attempt: number
): void {
  const param = node.task.subWorkflowParam;
  if (!param) return;

  ctx.commands.push({
    type: 'StartSubWorkflow',
    parentTaskRefName: node.ref,
    parentTaskIteration: iteration,
    parentTaskAttempt: attempt,
    defName: param.name,
    defVersion: param.version,
    input,
    taskToDomain: param.taskToDomain,
  });
}

/** Kicks off a loop's first iteration. The DO_WHILE stays open until it exits. */
function startLoop(ctx: DecideContext, node: BlueprintNode): void {
  if (!node.loopHead) return;
  scheduleNode(ctx, requireNode(ctx.blueprint, node.loopHead), 1, node.ref);
}

/**
 * Completes the workflow when nothing is left to do.
 *
 * "Nothing left" means no task still running and nothing scheduled in this
 * pass. Checking both is essential: looking only at `pending` would complete a
 * workflow the instant its last task finished, discarding the successors this
 * very evaluation just scheduled.
 */
function maybeCompleteWorkflow(ctx: DecideContext): void {
  if (ctx.commands.some((c) => c.type === 'FailWorkflow')) return;

  const stillScheduling = ctx.commands.some(
    (c) => c.type === 'ScheduleTask' || c.type === 'RetryTask'
  );
  if (stillScheduling) return;

  const completedIds = new Set(ctx.state.completed.map((t) => t.id));

  // Tasks this pass just finished count as finished.
  //
  // `state.completed` is the frontier as it was when the pass began, so a task
  // the decider resolves *here* — the DO_WHILE closed when its loop exits, a
  // FORK_JOIN closed once its branches are published — is still sitting in
  // `pending` and would be read as running. The workflow then does not
  // complete, and because nothing was scheduled either, nothing ever enqueues
  // another evaluation: a `DO_WHILE` with no successor hung in RUNNING forever
  // with every one of its tasks terminal.
  for (const command of ctx.commands) {
    if (command.type === 'CompleteTask' || command.type === 'FailTask') {
      completedIds.add(command.taskId);
    }
  }

  const stillRunning = ctx.state.pending.filter((t) => !completedIds.has(t.id));
  if (stillRunning.length > 0) return;

  ctx.commands.push({ type: 'CompleteWorkflow', output: buildWorkflowOutput(ctx) });
}

function buildWorkflowOutput(ctx: DecideContext): Record<string, JsonValue> {
  // The definition's declared output. It was never read: every workflow that
  // declared `outputParameters` finished with the last task's output instead,
  // which looks plausible and is wrong — found by a synchronous execute call
  // asserting on the result.
  //
  // Resolved key by key: a key whose expression names a task that never ran —
  // a branch not taken — resolves to null rather than failing a workflow that
  // has otherwise finished.
  const declared = ctx.blueprint.outputParameters;
  if (declared) {
    const output: Record<string, JsonValue> = {};
    for (const [key, expression] of Object.entries(declared)) {
      try {
        output[key] = resolveInputParameters({ value: expression }, ctx.scope)['value'] ?? null;
      } catch (error) {
        if (!(error instanceof ExpressionError)) throw error;
        output[key] = null;
      }
    }
    return output;
  }

  const template = ctx.state.workflow.output;
  if (template?.kind === 'inline') return template.value;

  // No explicit outputParameters: surface the last completed task's output,
  // which is the common case and saves boilerplate in simple workflows.
  const last = ctx.state.completed[ctx.state.completed.length - 1];
  return last?.output?.kind === 'inline' ? last.output.value : {};
}

/**
 * Whether a failure may be retried at all.
 *
 * Two gates beyond the attempt count, both of which were previously stored and
 * silently ignored:
 *
 *  - **`nonRetryableErrors`** — the caller has declared this error permanent.
 *    Retrying a permanent failure burns attempts and delays the real outcome.
 *  - **`retryBudget`** — the share of executions that may be retries. Once
 *    exceeded, retries fail fast. This is the control that stops a degraded
 *    dependency being held down by the retry traffic its own degradation
 *    caused, which is the classic way a partial outage becomes a total one.
 */
function isRetryable(
  ctx: DecideContext,
  node: BlueprintNode,
  task: TaskExecution,
  policy: RetryPolicy
): boolean {
  const reason = task.reasonForIncompletion ?? '';
  if (policy.nonRetryableErrors.some((code) => reason.includes(code))) return false;

  // Supplied by the caller, which counts recent attempts per task definition;
  // the decider stays pure and simply honours the verdict.
  if (ctx.exhaustedRetryBudgets.has(node.name)) return false;

  return true;
}

/** Timeout policy for a node, defaulting to failing the workflow. */
function timeoutPolicyFor(ctx: DecideContext, node: BlueprintNode): TimeoutPolicy {
  return ctx.taskDefs.get(node.name)?.timeoutPolicy ?? TimeoutPolicy.TIME_OUT_WF;
}

/**
 * Retry policy for a node: task definition first, then the task's own override.
 *
 * Every field the task sets wins, not just `retryCount`. It used to be only
 * `retryCount`, which meant a definition carrying `retryLogic: 'FIXED'` ran on
 * exponential backoff and said nothing — the field was dropped at parse, so
 * there was no error and no trace of it downstream.
 *
 * `undefined` is the only value that defers to the definition, which is why
 * this filters rather than spreading `node.task` wholesale: spreading would let
 * an absent key overwrite a set one with `undefined`.
 */
function retryPolicyFor(ctx: DecideContext, node: BlueprintNode): RetryPolicy {
  const def = ctx.taskDefs.get(node.name);
  const base = def ? (def as unknown as RetryPolicy) : retryPolicySchema.parse({});

  const overrides = {
    retryCount: node.task.retryCount,
    retryLogic: node.task.retryLogic,
    retryDelaySeconds: node.task.retryDelaySeconds,
    backoffScaleFactor: node.task.backoffScaleFactor,
    maxRetryDelaySeconds: node.task.maxRetryDelaySeconds,
    jitter: node.task.jitter,
  };

  const set = Object.entries(overrides).filter(([, value]) => value !== undefined);
  if (set.length === 0) return base;

  return { ...base, ...Object.fromEntries(set) };
}

// ---------------------------------------------------------------- compensation

/** What a workflow was failing with when it started unwinding. */
interface CompensationState {
  status: 'FAILED' | 'TIMED_OUT';
  reason: string;
}

/** The variable compensation keeps its state in — visible, so an operator can see a run is unwinding and why. */
export const COMPENSATION_VARIABLE = '__compensation';

function compensationOf(state: EvaluationState): CompensationState | undefined {
  const value = state.workflow.variables?.[COMPENSATION_VARIABLE] as unknown as CompensationState | undefined;
  return value && typeof value === 'object' && typeof value.reason === 'string' ? value : undefined;
}

/** The latest row for a ref this pass can see: just finished, still running, or loaded as a static ref. */
function latestTask(ctx: DecideContext, ref: string): TaskExecution | undefined {
  return (
    ctx.resolvedThisPass.get(ref) ??
    ctx.state.completed.filter((t) => t.refName === ref).sort((a, b) => b.attempt - a.attempt)[0] ??
    ctx.state.pending.find((t) => t.refName === ref) ??
    ctx.state.resolvedRefs.get(ref)
  );
}

/**
 * Completed tasks still to be undone, most recently finished first.
 *
 * Reverse order is the point of a saga: a later step may depend on an earlier
 * one — the shipment on the charge — so it is undone before what it built on.
 */
function pendingCompensations(ctx: DecideContext): { original: TaskExecution; node: BlueprintNode }[] {
  const due: { original: TaskExecution; node: BlueprintNode }[] = [];
  for (const [originalRef, compensationRef] of Object.entries(ctx.blueprint.compensations)) {
    const original = latestTask(ctx, originalRef);
    if (!original || original.status !== TaskStatus.COMPLETED) continue;
    const compensation = latestTask(ctx, compensationRef);
    if (compensation && isTaskSuccessful(compensation.status)) continue;
    due.push({ original, node: requireNode(ctx.blueprint, compensationRef) });
  }
  const finishedAt = (task: TaskExecution) => (task.endedAt ?? task.scheduledAt).getTime();
  return due.sort((a, b) => finishedAt(b.original) - finishedAt(a.original));
}

/**
 * Turns a failure into the start of an unwind, when there is anything to undo.
 *
 * Only for FAILED and TIMED_OUT. A TERMINATED run was stopped on purpose, and
 * undoing its work is a decision for whoever stopped it — the same line the
 * failure workflow draws.
 */
function beginCompensation(ctx: DecideContext, failure: Extract<Command, { type: 'FailWorkflow' }>): boolean {
  if (compensationOf(ctx.state)) return false;
  if (failure.status !== WorkflowStatus.FAILED && failure.status !== WorkflowStatus.TIMED_OUT) return false;

  const due = pendingCompensations(ctx);
  if (due.length === 0) return false;

  // Whatever else this pass meant to start belongs to a run that is no longer
  // going forward. Tasks it resolved in-pass stay: they are the record of what
  // happened, the failing TERMINATE among them.
  ctx.commands = ctx.commands.filter(
    (c) =>
      c.type !== 'FailWorkflow' &&
      c.type !== 'RetryTask' &&
      c.type !== 'StartSubWorkflow' &&
      c.type !== 'StartWorkflow' &&
      c.type !== 'SetTimer' &&
      !(c.type === 'ScheduleTask' && !c.resolved)
  );
  ctx.commands.push({
    type: 'SetVariable',
    values: { [COMPENSATION_VARIABLE]: { status: failure.status, reason: failure.reason } as unknown as JsonValue },
  });
  scheduleCompensation(ctx, due[0]);
  return true;
}

/** One step of an unwind: react to the compensation that just finished, then start the next or end the run. */
function continueCompensation(ctx: DecideContext): void {
  const state = compensationOf(ctx.state) as CompensationState;

  for (const task of ctx.state.completed) {
    const node = ctx.blueprint.nodes.get(task.refName);
    if (!node || node.location.branchKey !== 'compensation' || isTaskSuccessful(task.status)) continue;

    // A failed compensation gets its own retries, like any task; once they are
    // spent the run fails with both reasons, because an unwind that stopped
    // halfway is exactly what someone has to go and finish by hand.
    handleTerminalTask(ctx, task);
    const failed = ctx.commands.find((c): c is Extract<Command, { type: 'FailWorkflow' }> => c.type === 'FailWorkflow');
    if (failed) {
      failed.status = WorkflowStatus.FAILED;
      failed.reason = `${state.reason}; compensation "${task.refName}" for "${node.location.parentRef}" failed: ${task.reasonForIncompletion ?? task.status}`;
      return;
    }
  }
  if (ctx.commands.some((c) => c.type === 'RetryTask')) return;

  // One at a time: a compensation still running holds the rest.
  const running = Object.values(ctx.blueprint.compensations).some((ref) => {
    const task = latestTask(ctx, ref);
    return task !== undefined && (task.status === TaskStatus.SCHEDULED || task.status === TaskStatus.IN_PROGRESS);
  });
  if (running) return;

  const due = pendingCompensations(ctx);
  if (due.length > 0) {
    scheduleCompensation(ctx, due[0]);
    return;
  }

  const undone = Object.entries(ctx.blueprint.compensations)
    .filter(([, ref]) => {
      const task = latestTask(ctx, ref);
      return task !== undefined && isTaskSuccessful(task.status);
    })
    .map(([original]) => original);
  ctx.commands.push({
    type: 'FailWorkflow',
    status: state.status as Extract<Command, { type: 'FailWorkflow' }>['status'],
    reason: undone.length ? `${state.reason} (compensated: ${undone.join(', ')})` : state.reason,
  });
}

function scheduleCompensation(ctx: DecideContext, due: { original: TaskExecution; node: BlueprintNode }): void {
  scheduleNode(ctx, due.node, 0, due.original.refName);
}
