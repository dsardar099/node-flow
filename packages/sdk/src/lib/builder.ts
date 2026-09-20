import {
  workflowDefinitionSchema,
  type JsonValue,
  type WorkflowDefinition,
  type WorkflowTask,
} from '@node-flow-dev/core';

/**
 * A typed workflow builder that compiles to the JSON DSL.
 *
 * The JSON DSL stays the source of truth — this produces it, it does not
 * replace it. What the builder adds is the one thing JSON cannot have: a
 * misspelt `${charge.output.txnid}` is a compile error here, where in JSON it
 * is a task that quietly receives nothing at runtime.
 *
 *   const flow = workflow<{ orderId: string; amount: number }>('checkout');
 *   const charge = flow.simple<{ txnId: string }>('charge', {
 *     input: { amount: flow.input.amount },
 *   });
 *   flow.simple('ship', { input: { txn: charge.output.txnId } });
 *   flow.output({ receipt: charge.output.txnId });
 *   const definition = flow.build();
 *
 * References are typed proxies: reading `charge.output.txnId` yields an
 * `Expr<string>`, which serialises to `"${charge.output.txnId}"`, and reading
 * a field the type does not declare does not compile.
 */

const EXPR = Symbol('node-flow.expr');

/** A reference to a value that exists only at runtime, typed as what it will be. */
export type Expr<T> = { readonly [EXPR]: string; readonly __type?: T } & (T extends readonly (infer E)[]
  ? { readonly [index: number]: Expr<E>; readonly length: Expr<number> }
  : T extends object
    ? { readonly [K in keyof T]-?: Expr<T[K]> }
    : unknown);

/** A value a task input accepts: a literal, a reference of the same type, or an object of either. */
export type Value<T> = T | Expr<T> | (T extends object ? { [K in keyof T]: Value<T[K]> } : never);

export type Inputs = Record<string, unknown>;

/** True for anything the builder produced as a reference. */
export function isExpr(value: unknown): value is Expr<unknown> {
  return typeof value === 'function' && EXPR in (value as object);
}

/** The `${...}` text of a reference. */
export function exprText(value: Expr<unknown>): string {
  return value[EXPR];
}

function reference<T>(path: string): Expr<T> {
  // A function as the target, so the proxy can carry a symbol and still be
  // indexed with any property name without colliding with Object.prototype.
  const target = Object.assign(() => undefined, { [EXPR]: `\${${path}}` });
  return new Proxy(target, {
    get(_t, property) {
      if (property === EXPR) return `\${${path}}`;
      if (property === 'toJSON') return () => `\${${path}}`;
      if (property === Symbol.toPrimitive || property === 'toString') return () => `\${${path}}`;
      if (typeof property === 'symbol') return undefined;
      if (property === 'length') return reference(`${path}.length()`);
      return reference(/^\d+$/.test(property) ? `${path}[${property}]` : `${path}.${property}`);
    },
  }) as unknown as Expr<T>;
}

/**
 * Interpolates references into a string: expr`Order ${flow.input.orderId} shipped`.
 * The result is a plain string with `${...}` expressions in it.
 */
export function expr(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, text, i) => out + text + (i < values.length ? String(values[i]) : ''), '');
}

/** A scheduled task: its reference name, and typed handles on what it will produce. */
export interface TaskHandle<O, I extends object = Inputs> {
  readonly ref: string;
  readonly output: Expr<O>;
  readonly input: Expr<I>;
}

interface Common {
  description?: string;
  optional?: boolean;
  startDelaySeconds?: number;
  retryCount?: number;
  /** A task definition name, or a task built with `compensation(...)`. */
  compensateWith?: string | WorkflowTask;
  cache?: { key: Value<string>; ttlSeconds: number };
}

type Loop = { iteration: number };

/** One sequence of tasks: the workflow itself, a switch case, a fork branch or a loop body. */
export class Sequence {
  /** @internal */
  readonly tasks: WorkflowTask[] = [];

  constructor(/** @internal */ protected readonly refs: Set<string>) {}

  /** A task run by an external worker polling `taskDef` (the reference name by default). */
  simple<O = Record<string, JsonValue>, I extends object = Inputs>(
    ref: string,
    options: Common & { taskDef?: string; input?: { [K in keyof I]: Value<I[K]> }; domain?: string } = {}
  ): TaskHandle<O, I> {
    return this.add<O, I>(ref, 'SIMPLE', options, { name: options.taskDef ?? ref, domain: options.domain });
  }

  /** An HTTP call made by the server. Its output carries `response.body`, `response.statusCode` and headers. */
  http<Body = JsonValue>(
    ref: string,
    options: Common & {
      uri: Value<string>;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, Value<string>>;
    }
  ): TaskHandle<{ response: { body: Body; statusCode: number; headers: Record<string, string> } }> {
    const { uri, method, body, headers, ...rest } = options;
    return this.add(ref, 'HTTP', { ...rest, input: { uri, method: method ?? 'GET', ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) } });
  }

  /** Sandboxed JavaScript over `$` (the input). Whatever it returns is the output. */
  inline<O = Record<string, JsonValue>, I extends object = Inputs>(
    ref: string,
    options: Common & { script: string; input?: { [K in keyof I]: Value<I[K]> } }
  ): TaskHandle<O, I> {
    return this.add<O, I>(ref, 'INLINE', { ...options, input: { evaluatorType: 'javascript', expression: options.script, ...(options.input ?? {}) } as never });
  }

  /** Pauses for a duration such as `"10m"` or `"1 day"`, or until a signal when none is given. */
  wait(ref: string, options: { duration?: string; until?: string } = {}): TaskHandle<Record<string, JsonValue>> {
    return this.add(ref, 'WAIT', { input: { ...(options.duration ? { duration: options.duration } : {}), ...(options.until ? { until: options.until } : {}) } });
  }

  /** Pauses until a signal resumes it; the signal's output is this task's output. */
  yield<O = Record<string, JsonValue>>(ref: string, options: { description?: string } = {}): TaskHandle<O> {
    return this.add<O, Inputs>(ref, 'YIELD', options);
  }

  /** Waits for a person to respond through the inbox; their response is the output. */
  human<O = Record<string, JsonValue>>(
    ref: string,
    options: { title: Value<string>; description?: Value<string>; assignee?: string; form?: Record<string, unknown> }
  ): TaskHandle<O> {
    return this.add<O, Inputs>(ref, 'HUMAN', { input: options as Inputs });
  }

  /** Runs another workflow and waits for it; the child's output is this task's output. */
  subWorkflow<O = Record<string, JsonValue>>(
    ref: string,
    options: Common & { workflow: string; version?: number; input?: Inputs }
  ): TaskHandle<O> {
    const { workflow: name, version, ...rest } = options;
    return this.add<O, Inputs>(ref, 'SUB_WORKFLOW', rest, { subWorkflowParam: { name, ...(version ? { version } : {}) } });
  }

  /** Writes workflow variables, read later as `flow.variables.name`. */
  setVariable(ref: string, values: Inputs): TaskHandle<Record<string, never>> {
    return this.add(ref, 'SET_VARIABLE', { input: values });
  }

  /** Ends the workflow here. */
  terminate(ref: string, options: { status: 'COMPLETED' | 'FAILED' | 'TERMINATED'; reason?: Value<string>; output?: Inputs }): TaskHandle<Record<string, never>> {
    return this.add(ref, 'TERMINATE', {
      input: { terminationStatus: options.status, ...(options.reason ? { terminationReason: options.reason } : {}), ...(options.output ? { workflowOutput: options.output } : {}) },
    });
  }

  /** Branches on a value: the matching case runs, or `otherwise`. */
  switch<C extends string>(
    ref: string,
    options: { on: Value<string | number | boolean>; cases: Record<C, (branch: Sequence) => void>; otherwise?: (branch: Sequence) => void }
  ): TaskHandle<{ evaluationResult: string[] }> {
    const decisionCases: Record<string, WorkflowTask[]> = {};
    for (const [value, build] of Object.entries(options.cases) as [string, (branch: Sequence) => void][]) {
      decisionCases[value] = this.branch(build);
    }
    // The value is passed as an input parameter and named by the expression —
    // the value-param form, which is how a switch reads data without a script.
    return this.add(ref, 'SWITCH', { input: { switchCaseValue: options.on } }, {
      evaluatorType: 'value-param',
      expression: 'switchCaseValue',
      decisionCases,
      defaultCase: options.otherwise ? this.branch(options.otherwise) : [],
    });
  }

  /**
   * Runs branches in parallel and waits for all of them. The join is added
   * after the fork as `${ref}_join`; its output maps each branch's last task to
   * that task's output.
   */
  fork(ref: string, branches: ((branch: Sequence) => void)[]): TaskHandle<Record<string, Record<string, JsonValue>>> {
    const forkTasks = branches.map((build) => this.branch(build));
    const joinOn = forkTasks.map((tasks) => tasks[tasks.length - 1]?.taskReferenceName).filter((r): r is string => Boolean(r));
    this.add(ref, 'FORK_JOIN', {}, { forkTasks });
    return this.add(`${ref}_join`, 'JOIN', {}, { joinOn });
  }

  /**
   * Repeats the body. `times` runs it that many times; `condition` is a raw
   * loop condition such as `${ref.output.hasMore} == true`.
   */
  loop(ref: string, options: { times: number; body: (body: Sequence, loop: TaskHandle<Loop>) => void } | { condition: string; body: (body: Sequence, loop: TaskHandle<Loop>) => void }): TaskHandle<Loop> {
    const handle: TaskHandle<Loop> = { ref, output: reference(`${ref}.output`), input: reference(`${ref}.input`) };
    this.claim(ref);
    const body = new Sequence(this.refs);
    options.body(body, handle);
    const loopCondition = 'times' in options ? `\${${ref}.output.iteration} < ${options.times}` : options.condition;
    this.tasks.push({ name: ref, taskReferenceName: ref, type: 'DO_WHILE', loopCondition, loopOver: body.tasks } as WorkflowTask);
    return handle;
  }

  private branch(build: (branch: Sequence) => void): WorkflowTask[] {
    const branch = new Sequence(this.refs);
    build(branch);
    return branch.tasks;
  }

  private claim(ref: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new Error(`"${ref}" is not a usable reference name — letters, digits, "_" and "-"`);
    if (this.refs.has(ref)) throw new Error(`reference name "${ref}" is already used in this workflow`);
    this.refs.add(ref);
  }

  private add<O, I extends object>(
    ref: string,
    type: WorkflowTask['type'],
    options: Common & { input?: unknown },
    extra: Partial<WorkflowTask> = {}
  ): TaskHandle<O, I> {
    this.claim(ref);
    const task: WorkflowTask = {
      name: (extra.name as string | undefined) ?? ref,
      taskReferenceName: ref,
      type,
      ...(options.input !== undefined ? { inputParameters: plain(options.input) as Record<string, JsonValue> } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.optional ? { optional: true } : {}),
      ...(options.startDelaySeconds ? { startDelaySeconds: options.startDelaySeconds } : {}),
      ...(options.retryCount !== undefined ? { retryCount: options.retryCount } : {}),
      ...(options.compensateWith ? { compensateWith: options.compensateWith } : {}),
      ...(options.cache ? { cacheConfig: { key: plain(options.cache.key) as string, ttlInSecond: options.cache.ttlSeconds } } : {}),
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && key !== 'name') (task as unknown as Record<string, unknown>)[key] = value;
    }
    this.tasks.push(task);
    return { ref, output: reference<O>(`${ref}.output`), input: reference<I>(`${ref}.input`) };
  }
}

export interface WorkflowOptions {
  version?: number;
  description?: string;
  ownerEmail?: string;
  timeoutSeconds?: number;
  failureWorkflow?: string;
  maskedFields?: string[];
  inputParameters?: string[];
  variables?: Record<string, JsonValue>;
}

/** The workflow: a sequence with typed `input` and `variables`, and the definition it compiles to. */
export class WorkflowBuilder<I extends object = Inputs, V extends object = Inputs> extends Sequence {
  readonly input: Expr<I> = reference<I>('workflow.input');
  readonly variables: Expr<V> = reference<V>('global');
  private declaredOutput?: Inputs;

  constructor(
    readonly name: string,
    private readonly options: WorkflowOptions = {}
  ) {
    super(new Set());
  }

  /** The workflow's output, from literals and references. */
  output(values: Inputs): this {
    this.declaredOutput = values;
    return this;
  }

  /** The JSON definition, checked against the DSL schema — what `POST /metadata/workflows` takes. */
  build(): WorkflowDefinition {
    const { version, ...rest } = this.options;
    return workflowDefinitionSchema.parse({
      name: this.name,
      version: version ?? 1,
      ...rest,
      ...(this.declaredOutput ? { outputParameters: plain(this.declaredOutput) } : {}),
      tasks: this.tasks,
    });
  }
}

/** Starts a workflow definition. Type parameters are the input and variables it works with. */
export function workflow<I extends object = Inputs, V extends object = Inputs>(name: string, options: WorkflowOptions = {}): WorkflowBuilder<I, V> {
  return new WorkflowBuilder<I, V>(name, options);
}

/** A task to use as `compensateWith`, built outside the flow so it does not join a sequence. */
export function compensation(build: (sequence: Sequence) => void): WorkflowTask {
  const sequence = new Sequence(new Set());
  build(sequence);
  if (sequence.tasks.length !== 1) throw new Error('a compensation is exactly one task');
  return sequence.tasks[0];
}

/** Replaces references with their `${...}` text, recursively. */
function plain(value: unknown): unknown {
  if (isExpr(value)) return exprText(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}
