import { ExpressionError, isSealedValue, type JsonValue } from '@node-flow-dev/core';
import { compilePath, evaluatePath } from './jsonpath.js';

/**
 * Conductor-compatible `${...}` expression handling.
 *
 * Two separate jobs live here, and keeping them apart is the point:
 *
 *  1. `extractReferences` — a *static* pass over a definition, run once at
 *     registration. It answers "which task outputs could this input ever read?"
 *  2. `resolveExpression` — the *runtime* pass, run per evaluation against
 *     actual state.
 *
 * Job 1 is what makes the engine scale. Because we know up front that a task
 * only reads `${charge.output.txnId}`, an evaluation fetches exactly the
 * `charge` row instead of loading every task in the workflow. That is the
 * difference between a 30,000-task workflow being cheap and being impossible.
 */

/** `${scope.path.to.value}` — scope is a task ref, `workflow`, or a variable. */
const EXPRESSION_PATTERN = /\$\{([^}]*)\}/g;

/** Scopes that are not task references and so require no row to be fetched. */
const RESERVED_SCOPES = new Set(['workflow', 'env', 'secrets', 'global']);

export interface ParsedExpression {
  /** The full original text, e.g. `${charge.output.id}`. */
  raw: string;
  /** Leading segment: a task reference name, or a reserved scope. */
  scope: string;
  /** Remaining dotted segments after the scope, when the path is plain dots. */
  path: string[];
  /** Everything after the scope, verbatim — `.items[0].id`, `..price` — for JSONPath. */
  rest: string;
  /** True when `rest` is plain dotted names, resolved without the JSONPath evaluator. */
  simple: boolean;
}

/** Parses every `${...}` occurrence in a string. */
export function parseExpressions(input: string): ParsedExpression[] {
  const out: ParsedExpression[] = [];
  for (const match of input.matchAll(EXPRESSION_PATTERN)) {
    const body = match[1].trim();
    if (body.length === 0) continue;
    // The scope is the leading name; the rest may be dotted names or JSONPath.
    const scope = /^[A-Za-z0-9_$-]+/.exec(body)?.[0];
    if (!scope) continue;
    const rest = body.slice(scope.length);
    const simple = /^(\.[A-Za-z0-9_$-]+)*$/.test(rest);
    out.push({
      raw: match[0],
      scope,
      path: simple ? rest.split('.').filter((s) => s.length > 0) : [],
      rest,
      simple,
    });
  }
  return out;
}

/**
 * Task reference names any expression inside `value` could read.
 *
 * Walks arbitrarily nested JSON, since task inputs are free-form objects.
 * Reserved scopes are filtered out — `${workflow.input.x}` needs no task row.
 */
export function extractReferences(value: JsonValue | undefined): Set<string> {
  const refs = new Set<string>();
  collectReferences(value, refs);
  return refs;
}

function collectReferences(value: JsonValue | undefined, into: Set<string>): void {
  if (value === undefined || value === null) return;

  if (typeof value === 'string') {
    for (const expr of parseExpressions(value)) {
      if (!RESERVED_SCOPES.has(expr.scope)) into.add(expr.scope);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, into);
    return;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectReferences(item, into);
  }
}

/**
 * Secret names a value references.
 *
 * Separate from `extractReferences`, which deliberately skips reserved scopes
 * because it answers a different question (which *tasks* an input depends on).
 * This one drives the dispatch-time lookup, so that a task needing one
 * credential does not cause every other one in the namespace to be decrypted.
 */
export function extractSecretNames(value: JsonValue | undefined): Set<string> {
  const names = new Set<string>();
  collectSecretNames(value, names);
  return names;
}

function collectSecretNames(value: JsonValue | undefined, into: Set<string>): void {
  if (value === undefined || value === null) return;

  if (typeof value === 'string') {
    for (const expr of parseExpressions(value)) {
      // The first path segment is the name; anything deeper indexes into a
      // structured value, which a secret may legitimately be.
      if (expr.scope === 'secrets' && expr.path.length > 0) into.add(expr.path[0]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSecretNames(item, into);
    return;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectSecretNames(item, into);
  }
}

/** Values an expression can be resolved against. */
export interface ResolutionScope {
  /** Task outputs and inputs, keyed by reference name. */
  tasks: Map<string, { input?: Record<string, JsonValue>; output?: Record<string, JsonValue> }>;
  workflow: { input?: Record<string, JsonValue>; output?: Record<string, JsonValue> };
  variables: Record<string, JsonValue>;
  env?: Record<string, JsonValue>;
  /**
   * Secret values, **only** where the resolved result will not be persisted.
   *
   * Left undefined by the decider on purpose. The decider resolves a task's
   * input and the applier writes it to `TaskExecutions`, so a secret resolved
   * there would be stored in the database in clear, returned by the execution
   * API and rendered in the UI — a credential leak with a long half-life and no
   * audit trail.
   *
   * So `${secrets.x}` survives evaluation untouched and is resolved once, at
   * dispatch, into the copy handed to the executor or worker and nowhere else.
   */
  secrets?: Record<string, JsonValue>;
}

/** Walks a dotted path, supporting numeric array indices. Returns undefined if absent. */
function walkPath(root: JsonValue | undefined, path: string[]): JsonValue | undefined {
  let cursor: JsonValue | undefined = root;
  for (const segment of path) {
    if (cursor === undefined || cursor === null) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, JsonValue>)[segment];
  }
  return cursor;
}

function resolveOne(expr: ParsedExpression, scope: ResolutionScope): JsonValue | undefined {
  if (!expr.simple) return resolveWithPath(expr, scope);
  switch (expr.scope) {
    case 'workflow':
      // `${workflow.env.name}` is Orkes' spelling for an environment variable;
      // `${env.name}` below is the short one. Both read the same values.
      if (expr.path[0] === 'env') return walkPath(scope.env ?? {}, expr.path.slice(1));
      // Likewise `${workflow.variables.name}` for `${global.name}`. This is the
      // spelling Conductor users and their existing definitions already have,
      // and without it `SET_VARIABLE` is write-only: the value is stored, every
      // read of it resolves to null, and nothing reports a problem because
      // `workflow` is a real scope and `variables` is simply a key it lacks.
      if (expr.path[0] === 'variables') return walkPath(scope.variables, expr.path.slice(1));
      return walkPath(scope.workflow as unknown as JsonValue, expr.path);
    case 'global':
      return walkPath(scope.variables, expr.path);
    case 'env':
      return walkPath(scope.env ?? {}, expr.path);
    case 'secrets':
      // Deferred, not missing. When no secrets are supplied the reference is
      // returned **verbatim** so a later stage can resolve it — see the note on
      // `ResolutionScope.secrets`. Resolving it to `undefined` here is what the
      // first version did, and it turned every secret reference into a silent
      // null.
      return scope.secrets === undefined ? expr.raw : walkPath(scope.secrets, expr.path);
    default: {
      const task = scope.tasks.get(expr.scope);
      if (!task) {
        throw new ExpressionError(
          `expression ${expr.raw} refers to task "${expr.scope}", which has not produced a result`,
          { reference: expr.scope }
        );
      }

      const value = walkPath(task as unknown as JsonValue, expr.path);

      // A sealed output field is deferred, not resolved. The engine has no key
      // — it is pure — so resolving here would write the *envelope* into the
      // next task's input where a plaintext value belongs, and persist it
      // there. Returning the reference lets the dispatch path open it into the
      // copy an executor receives, and nowhere else.
      return isSealedValue(value) ? expr.raw : value;
    }
  }
}

/**
 * Resolves a string containing `${...}` expressions.
 *
 * A string that is *exactly* one expression yields the referenced value with its
 * type intact, so `${count.output.total}` stays a number. Anything else is
 * interpolated into a string. This mirrors Conductor and matters: losing the
 * type would break every downstream numeric comparison.
 */
export function resolveString(input: string, scope: ResolutionScope): JsonValue {
  const expressions = parseExpressions(input);
  if (expressions.length === 0) return input;

  if (expressions.length === 1 && expressions[0].raw === input.trim()) {
    const resolved = resolveOne(expressions[0], scope);
    return resolved === undefined ? null : resolved;
  }

  let out = input;
  for (const expr of expressions) {
    const resolved = resolveOne(expr, scope);
    out = out.replaceAll(
      expr.raw,
      resolved === undefined || resolved === null
        ? ''
        : typeof resolved === 'object'
          ? JSON.stringify(resolved)
          : String(resolved)
    );
  }
  return out;
}

/** Recursively resolves every expression inside a JSON structure. */
export function resolveValue(value: JsonValue, scope: ResolutionScope): JsonValue {
  if (typeof value === 'string') return resolveString(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, scope);
    return out;
  }
  return value;
}

/** Resolves a task's `inputParameters` against the current state. */
export function resolveInputParameters(
  params: Record<string, JsonValue> | undefined,
  scope: ResolutionScope
): Record<string, JsonValue> {
  if (!params) return {};
  return resolveValue(params, scope) as Record<string, JsonValue>;
}

/**
 * Resolves an expression whose path is JSONPath rather than plain dots —
 * `${charge.output.items[0].id}`, `${workflow.input.orders[?(@.total > 100)]}`.
 * Same scopes, same rules for a missing task and for sealed values.
 */
function resolveWithPath(expr: ParsedExpression, scope: ResolutionScope): JsonValue | undefined {
  let root: JsonValue | undefined;
  let rest = expr.rest;
  switch (expr.scope) {
    case 'workflow':
      if (rest.startsWith('.env') && /^\.env(\.|\[|$)/.test(rest)) {
        root = scope.env ?? {};
        rest = rest.slice('.env'.length);
      } else if (rest.startsWith('.variables') && /^\.variables(\.|\[|$)/.test(rest)) {
        // The same alias as in `resolveOne`, for the path form.
        root = scope.variables;
        rest = rest.slice('.variables'.length);
      } else {
        root = scope.workflow as unknown as JsonValue;
      }
      break;
    case 'global':
      root = scope.variables;
      break;
    case 'env':
      root = scope.env ?? {};
      break;
    case 'secrets':
      if (scope.secrets === undefined) return expr.raw;
      root = scope.secrets;
      break;
    default: {
      const task = scope.tasks.get(expr.scope);
      if (!task) {
        throw new ExpressionError(`expression ${expr.raw} refers to task "${expr.scope}", which has not produced a result`, {
          reference: expr.scope,
        });
      }
      root = task as unknown as JsonValue;
    }
  }
  const value = evaluatePath(root, compilePath(rest));
  return isSealedValue(value) ? expr.raw : value;
}
