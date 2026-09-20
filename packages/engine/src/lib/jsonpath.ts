import { ExpressionError, type JsonValue } from '@node-flow-dev/core';

/**
 * The JSONPath that `${...}` expressions accept after their scope.
 *
 * Written here rather than taken from a library because the engine is pure and
 * runs on every evaluation: filter expressions in the common libraries are
 * evaluated as script, which is both a dependency on a sandbox and a way for a
 * definition to run code in the decider. This evaluates a fixed grammar and
 * nothing else.
 *
 * Supported, covering what workflow authors write:
 *
 *   .name  ['name']  ["name"]     child
 *   [2]  [-1]                     index, negative from the end
 *   [*]  .*                       every child
 *   ..name  ..[*]                 descendants
 *   [0,2]  ['a','b']              union
 *   [1:3]  [:2]  [-2:]            slice
 *   [?(@.price > 10)]             filter: @.path, or @, compared with ==, !=, <, <=, >, >= to a number,
 *                                 string, true, false or null; or just @.path to test that it exists
 *   .length()                     length of an array, string or object
 *
 * A *definite* path — children and indexes only — yields a value. Anything that
 * can select more than one node yields an array of every match, even one.
 */

type Selector =
  | { kind: 'child'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'union'; keys: (string | number)[] }
  | { kind: 'slice'; start?: number; end?: number }
  | { kind: 'filter'; path: (string | number)[]; op?: '==' | '!=' | '<' | '<=' | '>' | '>='; value?: JsonValue }
  | { kind: 'length' };

interface Step {
  selector: Selector;
  descendant: boolean;
}

export interface CompiledPath {
  steps: Step[];
  definite: boolean;
}

const cache = new Map<string, CompiledPath>();

/** Compiles the part of an expression after its scope, e.g. `.items[0].id`. */
export function compilePath(source: string): CompiledPath {
  const hit = cache.get(source);
  if (hit) return hit;

  const steps: Step[] = [];
  let i = 0;
  const fail = (why: string): never => {
    throw new ExpressionError(`invalid path "${source}": ${why}`, { path: source });
  };

  while (i < source.length) {
    let descendant = false;
    if (source.startsWith('..', i)) {
      descendant = true;
      i += 2;
      if (source[i] !== '[') {
        const name = readName(source, i);
        if (!name) fail('expected a name after ".."');
        i += name.length;
        steps.push({ selector: name === '*' ? { kind: 'wildcard' } : { kind: 'child', name }, descendant });
        continue;
      }
    } else if (source[i] === '.') {
      i += 1;
      if (source.startsWith('length()', i) && i + 'length()'.length === source.length) {
        steps.push({ selector: { kind: 'length' }, descendant: false });
        break;
      }
      const name = readName(source, i);
      if (!name) fail(`expected a name at position ${i}`);
      i += name.length;
      steps.push({ selector: name === '*' ? { kind: 'wildcard' } : { kind: 'child', name }, descendant: false });
      continue;
    }

    if (source[i] !== '[') fail(`unexpected "${source[i]}" at position ${i}`);
    const close = findClose(source, i);
    if (close < 0) fail('unclosed "["');
    const inner = source.slice(i + 1, close).trim();
    steps.push({ selector: parseBracket(inner, fail), descendant });
    i = close + 1;
  }

  const compiled = {
    steps,
    definite: steps.every((s) => !s.descendant && (s.selector.kind === 'child' || s.selector.kind === 'index' || s.selector.kind === 'length')),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(source, compiled);
  return compiled;
}

/** Evaluates a compiled path. Definite paths return the value or undefined; others an array of matches. */
export function evaluatePath(root: JsonValue | undefined, path: CompiledPath): JsonValue | undefined {
  let nodes: JsonValue[] = root === undefined ? [] : [root];
  for (const step of path.steps) {
    const next: JsonValue[] = [];
    for (const node of nodes) {
      const candidates = step.descendant ? [node, ...descendants(node)] : [node];
      for (const candidate of candidates) apply(candidate, step.selector, next);
    }
    nodes = next;
  }
  if (path.definite) return nodes[0];
  return nodes;
}

function apply(node: JsonValue, selector: Selector, out: JsonValue[]): void {
  switch (selector.kind) {
    case 'child':
      if (node !== null && typeof node === 'object' && !Array.isArray(node) && selector.name in node) {
        out.push((node as Record<string, JsonValue>)[selector.name]);
      } else if (Array.isArray(node) && /^-?\d+$/.test(selector.name)) {
        // `items.0` has always worked, and keeps working.
        pushIndex(node, Number(selector.name), out);
      }
      return;
    case 'index':
      if (Array.isArray(node)) pushIndex(node, selector.index, out);
      return;
    case 'wildcard':
      if (Array.isArray(node)) out.push(...node);
      else if (node !== null && typeof node === 'object') out.push(...Object.values(node));
      return;
    case 'union':
      for (const key of selector.keys) {
        if (typeof key === 'number') {
          if (Array.isArray(node)) pushIndex(node, key, out);
        } else if (node !== null && typeof node === 'object' && !Array.isArray(node) && key in node) {
          out.push((node as Record<string, JsonValue>)[key]);
        }
      }
      return;
    case 'slice': {
      if (!Array.isArray(node)) return;
      const length = node.length;
      const clamp = (n: number) => (n < 0 ? Math.max(0, length + n) : Math.min(n, length));
      const start = selector.start === undefined ? 0 : clamp(selector.start);
      const end = selector.end === undefined ? length : clamp(selector.end);
      out.push(...node.slice(start, end));
      return;
    }
    case 'filter': {
      const items = Array.isArray(node) ? node : node !== null && typeof node === 'object' ? Object.values(node) : [];
      for (const item of items) if (matches(item, selector)) out.push(item);
      return;
    }
    case 'length':
      if (Array.isArray(node) || typeof node === 'string') out.push(node.length);
      else if (node !== null && typeof node === 'object') out.push(Object.keys(node).length);
      return;
  }
}

function pushIndex(array: JsonValue[], index: number, out: JsonValue[]): void {
  const at = index < 0 ? array.length + index : index;
  if (at >= 0 && at < array.length) out.push(array[at]);
}

function descendants(node: JsonValue): JsonValue[] {
  const all: JsonValue[] = [];
  const walk = (value: JsonValue) => {
    const children = Array.isArray(value) ? value : value !== null && typeof value === 'object' ? Object.values(value) : [];
    for (const child of children) {
      all.push(child);
      walk(child);
    }
  };
  walk(node);
  return all;
}

function matches(item: JsonValue, filter: Extract<Selector, { kind: 'filter' }>): boolean {
  let value: JsonValue | undefined = item;
  for (const key of filter.path) {
    if (value === null || typeof value !== 'object') return false;
    value = Array.isArray(value) ? (typeof key === 'number' ? value[key] : undefined) : (value as Record<string, JsonValue>)[String(key)];
    if (value === undefined) return false;
  }
  if (!filter.op) return value !== undefined && value !== null && value !== false;
  const expected = filter.value;
  switch (filter.op) {
    case '==':
      return value === expected;
    case '!=':
      return value !== expected;
    default: {
      const comparable =
        (typeof value === 'number' && typeof expected === 'number') || (typeof value === 'string' && typeof expected === 'string');
      if (!comparable) return false;
      const [a, b] = [value as number | string, expected as number | string];
      return filter.op === '<' ? a < b : filter.op === '<=' ? a <= b : filter.op === '>' ? a > b : a >= b;
    }
  }
}

function readName(source: string, from: number): string {
  const match = /^(\*|[A-Za-z0-9_$-]+)/.exec(source.slice(from));
  return match ? match[1] : '';
}

/** The `]` closing the bracket at `open`, skipping over quoted strings. */
function findClose(source: string, open: number): number {
  let quote: string | undefined;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') {
      depth--;
      if (depth === 0 && c === ']') return i;
    }
  }
  return -1;
}

function parseBracket(inner: string, fail: (why: string) => never): Selector {
  if (inner === '*') return { kind: 'wildcard' };

  if (inner.startsWith('?')) {
    const body = /^\?\s*\((.*)\)$/s.exec(inner)?.[1]?.trim();
    if (!body) fail(`filters are written [?(@.field op value)]`);
    const comparison = /^@((?:\.[A-Za-z0-9_$-]+|\[\d+\])*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(body as string);
    const existence = /^@((?:\.[A-Za-z0-9_$-]+|\[\d+\])+)$/.exec(body as string);
    if (comparison) {
      return { kind: 'filter', path: filterPath(comparison[1]), op: comparison[2] as '==', value: literal(comparison[3].trim(), fail) };
    }
    if (existence) return { kind: 'filter', path: filterPath(existence[1]) };
    return fail(`unsupported filter "${body}" — only @.field compared to a literal, or @.field on its own`);
  }

  const slice = /^(-?\d+)?\s*:\s*(-?\d+)?$/.exec(inner);
  if (slice) {
    return { kind: 'slice', start: slice[1] === undefined ? undefined : Number(slice[1]), end: slice[2] === undefined ? undefined : Number(slice[2]) };
  }

  const parts = splitUnion(inner);
  const keys = parts.map((part) => {
    if (/^-?\d+$/.test(part)) return Number(part);
    const quoted = /^(['"])(.*)\1$/s.exec(part);
    if (quoted) return quoted[2].replace(/\\(.)/g, '$1');
    return fail(`"${part}" is neither an index nor a quoted name`);
  });
  if (keys.length === 1) return typeof keys[0] === 'number' ? { kind: 'index', index: keys[0] } : { kind: 'child', name: keys[0] };
  return { kind: 'union', keys };
}

function splitUnion(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      current += c;
      if (c === '\\') current += inner[++i] ?? '';
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ',') {
      parts.push(current.trim());
      current = '';
    } else current += c;
  }
  parts.push(current.trim());
  return parts;
}

function filterPath(text: string): (string | number)[] {
  return [...text.matchAll(/\.([A-Za-z0-9_$-]+)|\[(\d+)\]/g)].map((m) => (m[1] !== undefined ? m[1] : Number(m[2])));
}

function literal(text: string, fail: (why: string) => never): JsonValue {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const quoted = /^(['"])(.*)\1$/s.exec(text);
  if (quoted) return quoted[2];
  return fail(`"${text}" is not a number, quoted string, true, false or null`);
}
