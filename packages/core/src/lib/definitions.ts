import { z } from 'zod';
import { TaskType } from './task-type.js';
import {
  concurrencyPolicySchema,
  retryPolicySchema,
  RetryLogic,
  timeoutPolicySchema,
  TimeoutPolicy,
} from './policies.js';

/**
 * The workflow DSL.
 *
 * JSON is the storage and wire format so definitions stay portable, editable in
 * the visual editor, and diffable. The typed TypeScript builder in `@node-flow-dev/sdk`
 * compiles down to exactly these shapes.
 *
 * Task inputs hold arbitrary JSON with `${...}` expression strings embedded. The
 * expressions are not parsed here — that happens in the blueprint compiler,
 * which extracts the static reference set each task depends on. Keeping parsing
 * out of validation means a definition with a typo'd reference still loads, and
 * fails with a precise error at compile time instead of a schema rejection.
 */

/** Arbitrary JSON. Recursive, so task inputs can nest freely. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/** Reference names identify a task within a workflow and appear in expressions. */
export const taskReferenceNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
    'must start with a letter or underscore and contain only letters, digits, underscore or hyphen'
  );

export const workflowNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/, 'invalid workflow name');

/**
 * Which engine evaluates `${...}` expressions.
 *
 * `value-param` and `javascript` mirror Conductor's SWITCH evaluators; `jsonpath`
 * is ours, for cases where a path is clearer than a script.
 */
export const EvaluatorType = {
  VALUE_PARAM: 'value-param',
  JAVASCRIPT: 'javascript',
  JSONPATH: 'jsonpath',
} as const;
export type EvaluatorType = (typeof EvaluatorType)[keyof typeof EvaluatorType];

export const subWorkflowParamSchema = z.object({
  name: workflowNameSchema,
  version: z.int().min(1).optional(),
  /** Inherit the parent's task-to-domain routing so children land on the same workers. */
  taskToDomain: z.record(z.string(), z.string()).optional(),
});

/**
 * A task inside a workflow definition.
 *
 * Operator-specific fields are optional here and validated per type by the
 * blueprint compiler in `engine` (`compileBlueprint` and its per-type
 * `compile*` functions), rather than via a discriminated union. A union would
 * reject an entire definition on one malformed task and report the error
 * against the union rather than the task — far worse diagnostics for something
 * users hand-edit as JSON.
 */
export interface WorkflowTask {
  name: string;
  taskReferenceName: string;
  type: TaskType;
  description?: string;
  inputParameters?: Record<string, JsonValue>;
  optional?: boolean;
  asyncComplete?: boolean;
  startDelaySeconds?: number;
  /**
   * Reuse a previous successful output for the same key instead of running the
   * task again. `key` is an expression, e.g. `${workflow.input.customerId}`.
   */
  cacheConfig?: { key: string; ttlInSecond: number };
  /**
   * Retry overrides for this task, layered over its task definition. Any field
   * left out defers to the definition.
   */
  retryCount?: number;
  retryLogic?: RetryLogic;
  retryDelaySeconds?: number;
  backoffScaleFactor?: number;
  maxRetryDelaySeconds?: number;
  jitter?: number;
  /** Routes this task to a named worker pool. */
  domain?: string;
  // SWITCH
  evaluatorType?: EvaluatorType;
  expression?: string;
  decisionCases?: Record<string, WorkflowTask[]>;
  defaultCase?: WorkflowTask[];
  // FORK_JOIN
  forkTasks?: WorkflowTask[][];
  // FORK_JOIN_DYNAMIC
  dynamicForkTasksParam?: string;
  dynamicForkTasksInputParamName?: string;
  // JOIN / EXCLUSIVE_JOIN
  joinOn?: string[];
  // DO_WHILE
  loopCondition?: string;
  loopOver?: WorkflowTask[];
  // DYNAMIC
  dynamicTaskNameParam?: string;
  // SUB_WORKFLOW
  subWorkflowParam?: z.infer<typeof subWorkflowParamSchema>;
  /**
   * Undoes this task if the workflow later fails — saga-style compensation.
   *
   * A task, or the name of a task definition as shorthand (run as a SIMPLE task
   * that receives this task's `input` and `output`). When a workflow fails,
   * every completed task that declares one is compensated, most recent first,
   * before the workflow ends as failed.
   */
  compensateWith?: string | WorkflowTask;
}

export const workflowTaskSchema: z.ZodType<WorkflowTask> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(255),
    taskReferenceName: taskReferenceNameSchema,
    type: z.enum(TaskType),
    description: z.string().max(2000).optional(),
    inputParameters: z.record(z.string(), jsonValueSchema).optional(),
    optional: z.boolean().optional(),
    asyncComplete: z.boolean().optional(),
    startDelaySeconds: z.number().min(0).optional(),
    cacheConfig: z.object({ key: z.string().min(1), ttlInSecond: z.int().min(1).max(31_536_000) }).optional(),
    /**
     * Retry overrides for this one task, on top of its task definition.
     *
     * `retryCount` was the only one of these accepted for a long time, and zod
     * strips unknown keys — so an author who wrote `retryLogic` or
     * `retryDelaySeconds` here got no error and no effect. This project's own
     * end-to-end suite did exactly that in two places, and those tests passed
     * while asserting nothing about the behaviour they had asked for.
     *
     * Accepting the whole policy is the smaller change of the two available:
     * the alternative is to reject the fields at registration, which turns
     * silence into an error but still leaves the obvious spelling unusable.
     */
    retryCount: z.int().min(0).optional(),
    retryLogic: z.enum(RetryLogic).optional(),
    retryDelaySeconds: z.number().min(0).optional(),
    backoffScaleFactor: z.number().min(1).optional(),
    maxRetryDelaySeconds: z.number().min(0).optional(),
    jitter: z.number().min(0).max(1).optional(),
    domain: z.string().max(255).optional(),
    evaluatorType: z.enum(EvaluatorType).optional(),
    expression: z.string().optional(),
    decisionCases: z.record(z.string(), z.array(workflowTaskSchema)).optional(),
    defaultCase: z.array(workflowTaskSchema).optional(),
    forkTasks: z.array(z.array(workflowTaskSchema)).optional(),
    dynamicForkTasksParam: z.string().optional(),
    dynamicForkTasksInputParamName: z.string().optional(),
    joinOn: z.array(z.string()).optional(),
    loopCondition: z.string().optional(),
    loopOver: z.array(workflowTaskSchema).optional(),
    dynamicTaskNameParam: z.string().optional(),
    subWorkflowParam: subWorkflowParamSchema.optional(),
    compensateWith: z.union([z.string().min(1), workflowTaskSchema]).optional(),
  })
) as z.ZodType<WorkflowTask>;

export const workflowDefinitionSchema = z.object({
  name: workflowNameSchema,
  version: z.int().min(1).default(1),
  description: z.string().max(4000).optional(),
  tasks: z.array(workflowTaskSchema).min(1),
  inputParameters: z.array(z.string()).optional(),
  outputParameters: z.record(z.string(), jsonValueSchema).optional(),
  /** Initial workflow-scoped variables, mutable at runtime by SET_VARIABLE. */
  variables: z.record(z.string(), jsonValueSchema).optional(),
  inputSchema: jsonValueSchema.optional(),
  outputSchema: jsonValueSchema.optional(),
  /**
   * Started when an execution ends FAILED or TIMED_OUT — compensation, alerting,
   * cleanup. Receives the failed run's input plus `workflowId`, `reason` and
   * `failureStatus`.
   */
  /**
   * An empty string means "none", and has to.
   *
   * Conductor's own SDK initialises `failureWorkflow` to `""` and emits it
   * unconditionally from `toWorkflowDef()`, so **every** workflow built with
   * the builder and not given a failure workflow arrives carrying one. Rejecting
   * it as too short refused a large fraction of real Conductor definitions at
   * registration — found against a sixty-workflow project, not by the
   * compatibility suite, whose definitions are hand-written and therefore never
   * carried the field the builder always sets.
   */
  failureWorkflow: z.preprocess(
    (value) => (value === '' ? undefined : value),
    workflowNameSchema.optional()
  ),
  /** Pins the failure workflow's version. Omitted means the latest when it starts. */
  failureWorkflowVersion: z.int().min(1).optional(),
  restartable: z.boolean().default(true),
  timeoutSeconds: z.number().min(0).default(0),
  timeoutPolicy: z.enum(TimeoutPolicy).default(TimeoutPolicy.TIME_OUT_WF),
  /** Cap on concurrent live executions of this definition. 0 disables. */
  maxConcurrentExecutions: z.int().min(0).default(0),
  /**
   * Per-key concurrency, queued rather than refused: at most
   * `concurrentExecLimit` executions sharing the resolved `rateLimitKey` (say
   * `${workflow.input.customerId}`) run at once; later starts wait their turn.
   */
  rateLimitConfig: z
    .object({ rateLimitKey: z.string().min(1), concurrentExecLimit: z.int().min(1) })
    .optional(),
  /**
   * Key names whose values are shown as `***` wherever an execution is read —
   * workflow and task input and output, variables and history — at any depth.
   * Stored values are unchanged; workers still receive them.
   */
  maskedFields: z.array(z.string().min(1).max(200)).max(100).optional(),
  /** Cap on concurrent in-flight tasks within a single execution. 0 disables. */
  maxConcurrentTasks: z.int().min(0).default(0),
  ownerEmail: z.email().optional(),
  tags: z.array(z.string()).default([]),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const taskDefinitionSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    inputKeys: z.array(z.string()).default([]),
    outputKeys: z.array(z.string()).default([]),
    inputSchema: jsonValueSchema.optional(),
    outputSchema: jsonValueSchema.optional(),
    /**
     * Output fields that are credentials, as dotted paths.
     *
     * A task that fetches a token writes that token to its output, and
     * completing a task persists its output — so by default the credential
     * lives in the execution history, in clear, for the retention period.
     *
     * Naming a field here **seals** it instead: the stored value is an
     * encrypted envelope, and a downstream `${task.output.field}` reference
     * stays unresolved until dispatch, exactly as `${secrets.x}` does. The
     * value still flows to the task that needs it and is never written down.
     */
    secretOutputFields: z.array(z.string()).default([]),
    ownerEmail: z.email().optional(),
  })
  .extend(retryPolicySchema.shape)
  .extend(timeoutPolicySchema.shape)
  .extend(concurrencyPolicySchema.shape);

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
