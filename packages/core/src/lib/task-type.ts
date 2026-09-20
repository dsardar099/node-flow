/**
 * Task type identifiers.
 *
 * Three families, and the distinction drives where execution happens:
 *
 *  - SIMPLE            — handed to an external worker over the queue.
 *  - Operators         — resolved by the decider itself, inside the evaluation
 *                        transaction. They never touch the queue and never block.
 *  - System tasks      — executed server-side by the task registry.
 *
 * Only operators are guaranteed to resolve without I/O, which is why they are
 * the only family the pure engine can complete on its own.
 */

export const TaskType = {
  // ---- worker ----
  SIMPLE: 'SIMPLE',

  // ---- operators (decider-resolved, no I/O) ----
  SWITCH: 'SWITCH',
  DO_WHILE: 'DO_WHILE',
  FORK_JOIN: 'FORK_JOIN',
  FORK_JOIN_DYNAMIC: 'FORK_JOIN_DYNAMIC',
  JOIN: 'JOIN',
  EXCLUSIVE_JOIN: 'EXCLUSIVE_JOIN',
  DYNAMIC: 'DYNAMIC',
  SUB_WORKFLOW: 'SUB_WORKFLOW',
  START_WORKFLOW: 'START_WORKFLOW',
  TERMINATE: 'TERMINATE',
  SET_VARIABLE: 'SET_VARIABLE',
  GET_WORKFLOW: 'GET_WORKFLOW',
  YIELD: 'YIELD',
  NOOP: 'NOOP',

  // ---- system tasks (server-executed) ----
  HTTP: 'HTTP',
  HTTP_POLL: 'HTTP_POLL',
  INLINE: 'INLINE',
  JSON_JQ_TRANSFORM: 'JSON_JQ_TRANSFORM',
  EVENT: 'EVENT',
  KAFKA_PUBLISH: 'KAFKA_PUBLISH',
  WAIT: 'WAIT',
  WAIT_FOR_WEBHOOK: 'WAIT_FOR_WEBHOOK',
  PULL_WORKFLOW_MESSAGES: 'PULL_WORKFLOW_MESSAGES',
  WEBHOOK: 'WEBHOOK',
  HUMAN: 'HUMAN',
  BUSINESS_RULE: 'BUSINESS_RULE',
  JDBC: 'JDBC',
  GRPC: 'GRPC',
  UPDATE_TASK: 'UPDATE_TASK',
  UPDATE_SECRET: 'UPDATE_SECRET',
  GET_SIGNED_JWT: 'GET_SIGNED_JWT',
  EMAIL: 'EMAIL',

  // ---- AI (server-executed, through a namespace's integrations) ----
  LLM_TEXT_COMPLETE: 'LLM_TEXT_COMPLETE',
  LLM_CHAT_COMPLETE: 'LLM_CHAT_COMPLETE',
  LLM_GENERATE_EMBEDDINGS: 'LLM_GENERATE_EMBEDDINGS',
  LLM_INDEX_TEXT: 'LLM_INDEX_TEXT',
  LLM_SEARCH_INDEX: 'LLM_SEARCH_INDEX',
  CHUNK_TEXT: 'CHUNK_TEXT',
  LIST_MCP_TOOLS: 'LIST_MCP_TOOLS',
  CALL_MCP_TOOL: 'CALL_MCP_TOOL',
  AGENT: 'AGENT',
  PARSE_DOCUMENT: 'PARSE_DOCUMENT',
  GENERATE_IMAGE: 'GENERATE_IMAGE',
  GENERATE_AUDIO: 'GENERATE_AUDIO',
  GENERATE_VIDEO: 'GENERATE_VIDEO',
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

const OPERATOR_TYPES = new Set<TaskType>([
  TaskType.SWITCH,
  TaskType.DO_WHILE,
  TaskType.FORK_JOIN,
  TaskType.FORK_JOIN_DYNAMIC,
  TaskType.JOIN,
  TaskType.EXCLUSIVE_JOIN,
  TaskType.DYNAMIC,
  TaskType.SUB_WORKFLOW,
  TaskType.START_WORKFLOW,
  TaskType.TERMINATE,
  TaskType.SET_VARIABLE,
  TaskType.GET_WORKFLOW,
  TaskType.YIELD,
  TaskType.NOOP,
  // Resolved by the decider rather than a runner, so that publishing the event
  // and completing the task share one transaction. See `PublishEventCommand`.
  TaskType.EVENT,
  // A specialisation of EVENT with a Kafka-shaped payload, and resolved the
  // same way for the same reason.
  TaskType.KAFKA_PUBLISH,
]);

/**
 * Operators that finish within the same evaluation that scheduled them.
 *
 * Excluded deliberately:
 *  - JOIN / EXCLUSIVE_JOIN wait on sibling branches,
 *  - DO_WHILE spans iterations,
 *  - SUB_WORKFLOW waits on a child execution,
 *  - YIELD waits for an external signal.
 *
 * The decider uses this to know which tasks it may resolve in a single pass
 * without another wakeup, which is what keeps trivial operators from costing a
 * full round-trip through the queue.
 */
const IMMEDIATE_OPERATOR_TYPES = new Set<TaskType>([
  TaskType.SWITCH,
  TaskType.FORK_JOIN,
  TaskType.FORK_JOIN_DYNAMIC,
  TaskType.TERMINATE,
  TaskType.SET_VARIABLE,
  TaskType.GET_WORKFLOW,
  TaskType.NOOP,
  TaskType.START_WORKFLOW,
  TaskType.EVENT,
  TaskType.KAFKA_PUBLISH,
]);

/** True for control-flow tasks the decider resolves itself. */
export function isOperator(type: TaskType): boolean {
  return OPERATOR_TYPES.has(type);
}

/** True for tasks dispatched to external workers via the queue. */
export function isWorkerTask(type: TaskType): boolean {
  return type === TaskType.SIMPLE;
}

/**
 * Task types completed by the clock rather than by anything doing work.
 *
 * `WAIT` must never be queued. A queued task holds a lease, and a lease has to
 * be heartbeated or it expires — so a seven-day wait would either hold an
 * execution slot for a week or be reclaimed as abandoned within the minute.
 * Neither is a wait. It is armed as a timer instead, and the task sits
 * `IN_PROGRESS` costing nothing until the timer fires.
 */
const TIMER_BACKED_TYPES = new Set<TaskType>([TaskType.WAIT]);

export function isTimerBacked(type: TaskType): boolean {
  return TIMER_BACKED_TYPES.has(type);
}

/**
 * Task types completed by something arriving from outside.
 *
 * `WAIT_FOR_WEBHOOK` sits until a third party calls back — which may be
 * seconds or days away, and may never happen. Like a timer-backed task it must
 * never be queued: nothing is going to execute it, and a lease would expire
 * long before the callback arrived.
 *
 * It differs from `WAIT` in what ends it. A wait ends on a schedule the engine
 * set; this ends on an event the engine does not control, which is why it needs
 * a callback slot and a deadline rather than just a timer.
 */
const EXTERNALLY_COMPLETED_TYPES = new Set<TaskType>([
  TaskType.WAIT_FOR_WEBHOOK,
  // Completed by a person through the inbox API. Like a webhook callback it is
  // never queued: nothing in this process will ever execute it, and a lease
  // would expire long before anyone got round to the task.
  TaskType.HUMAN,
  // Completed when messages pushed into the execution arrive, which may be
  // never. Nothing executes it, so like the others it is never queued.
  TaskType.PULL_WORKFLOW_MESSAGES,
]);

export function isExternallyCompleted(type: TaskType): boolean {
  return EXTERNALLY_COMPLETED_TYPES.has(type);
}

/** True for any task nothing dispatches: it waits for a clock or an event. */
export function isWaitingTask(type: TaskType): boolean {
  return TIMER_BACKED_TYPES.has(type) || EXTERNALLY_COMPLETED_TYPES.has(type);
}

/**
 * True for tasks the server executes itself through the system-task registry.
 *
 * Excludes the timer-backed types: they are "system" in the sense that no
 * external worker runs them, but nothing *executes* them at all.
 */
export function isSystemTask(type: TaskType): boolean {
  return (
    !OPERATOR_TYPES.has(type) &&
    type !== TaskType.SIMPLE &&
    !TIMER_BACKED_TYPES.has(type) &&
    !EXTERNALLY_COMPLETED_TYPES.has(type)
  );
}

/** True for operators that complete within the evaluation that scheduled them. */
export function isImmediateOperator(type: TaskType): boolean {
  return IMMEDIATE_OPERATOR_TYPES.has(type);
}

/**
 * The queue a task is dispatched to.
 *
 * `taskDefName[:domain]` — the routing rule, in one function, because it has to
 * agree in three places that never see each other: the decider that schedules,
 * the worker that leases, and the scope that authorises. When it was implicit,
 * the domain was simply dropped and every task went to the shared queue while
 * the API happily accepted the routing request.
 */
export function queueNameFor(taskDefName: string, domain?: string): string {
  return domain ? `${taskDefName}:${domain}` : taskDefName;
}

/** Splits a queue name back into its parts. */
export function parseQueueName(queueName: string): { taskDefName: string; domain?: string } {
  const separator = queueName.indexOf(':');
  if (separator === -1) return { taskDefName: queueName };

  return {
    taskDefName: queueName.slice(0, separator),
    domain: queueName.slice(separator + 1),
  };
}
