import { InvalidArgumentError, WorkflowStatus, type JsonValue } from '@node-flow-dev/core';

/**
 * The execution search box: `status:FAILED workflow:checkout_* input.customer.tier:gold card declined`.
 *
 * Parsed here, once, into the same typed filters the structured API takes —
 * so there is still no string DSL reaching SQL, nothing for a client to escape,
 * and a UI search box and an API caller get identical results.
 *
 *   status:FAILED,TIMED_OUT        any of these statuses
 *   workflow:checkout  wf:check*    a workflow name, or a prefix ending in `*`
 *   version:3                       a definition version
 *   id:<uuid>                       one execution
 *   correlation:inv-7               an exact correlation id
 *   key:order-42                    an exact idempotency key
 *   reason:"card declined"          text in the failure reason
 *   input.customer.tier:gold        a value inside the input (JSON containment)
 *   output.approved:true            … or the output; numbers, true/false/null are typed
 *   is:sub   is:top                 only sub-workflows, or only top-level runs
 *   is:running  is:finished         still going, or ended
 *   anything else                   text anywhere: id, workflow, correlation id, reason, input, output
 *
 * Values with spaces go in double quotes. Every term must match.
 */

export interface ParsedExecutionQuery {
  status?: WorkflowStatus[];
  defName?: string;
  defNamePrefix?: string;
  defVersion?: number;
  workflowId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  reason?: string;
  subWorkflows?: 'only' | 'exclude';
  finished?: boolean;
  /** Each entry must match; within an entry, any alternative may. */
  contains?: { field: 'input' | 'output'; alternatives: Record<string, JsonValue>[] }[];
  text?: string[];
}

const STATUSES = new Set<string>(Object.values(WorkflowStatus));
const KEYS = ['status', 'workflow', 'wf', 'version', 'id', 'correlation', 'key', 'reason', 'is', 'input.<path>', 'output.<path>'];
const MAX_TERMS = 20;

export function parseExecutionQuery(source: string): ParsedExecutionQuery {
  const result: ParsedExecutionQuery = {};
  const terms = tokenize(source);
  if (terms.length > MAX_TERMS) throw new InvalidArgumentError(`a search can have at most ${MAX_TERMS} terms`);

  for (const term of terms) {
    if (term.key === undefined) {
      (result.text ??= []).push(term.value);
      continue;
    }
    const key = term.key.toLowerCase();
    const value = term.value;
    if (value === '') throw new InvalidArgumentError(`"${term.key}:" needs a value`);

    if (key === 'status') {
      const statuses = value.split(',').map((s) => s.trim().toUpperCase().replace(/[\s-]/g, '_'));
      const unknown = statuses.find((s) => !STATUSES.has(s));
      if (unknown) throw new InvalidArgumentError(`"${unknown}" is not a status; use ${[...STATUSES].join(', ')}`);
      result.status = [...new Set([...(result.status ?? []), ...(statuses as WorkflowStatus[])])];
    } else if (key === 'workflow' || key === 'wf') {
      if (value.endsWith('*')) result.defNamePrefix = value.slice(0, -1);
      else result.defName = value;
    } else if (key === 'version' || key === 'v') {
      const version = Number(value.replace(/^v/i, ''));
      if (!Number.isInteger(version) || version < 1) throw new InvalidArgumentError(`"${value}" is not a version number`);
      result.defVersion = version;
    } else if (key === 'id') {
      result.workflowId = value;
    } else if (key === 'correlation' || key === 'correlationid') {
      result.correlationId = value;
    } else if (key === 'key' || key === 'idempotencykey') {
      result.idempotencyKey = value;
    } else if (key === 'reason') {
      result.reason = value;
    } else if (key === 'is') {
      const flag = value.toLowerCase();
      if (flag === 'sub' || flag === 'subworkflow') result.subWorkflows = 'only';
      else if (flag === 'top' || flag === 'root') result.subWorkflows = 'exclude';
      else if (flag === 'running' || flag === 'open') result.finished = false;
      else if (flag === 'finished' || flag === 'ended' || flag === 'done') result.finished = true;
      else throw new InvalidArgumentError(`"is:${value}" is not a filter; use is:sub, is:top, is:running or is:finished`);
    } else if (key.startsWith('input.') || key.startsWith('output.')) {
      const field = key.startsWith('input.') ? 'input' : 'output';
      // The path keeps the case it was typed in: JSON keys are case-sensitive.
      const path = term.key.slice(field.length + 1).split('.');
      if (path.some((segment) => segment === '')) throw new InvalidArgumentError(`"${term.key}" is not a valid path`);
      (result.contains ??= []).push({ field, alternatives: typedValues(value, term.quoted).map((v) => nest(path, v)) });
    } else {
      throw new InvalidArgumentError(`"${term.key}:" is not a search key; use ${KEYS.join(', ')}`);
    }
  }
  return result;
}

interface Term {
  key?: string;
  value: string;
  quoted: boolean;
}

/** Splits on spaces, keeping `"quoted values"` and `key:"quoted values"` whole. */
function tokenize(source: string): Term[] {
  const terms: Term[] = [];
  const pattern = /(?:([A-Za-z][\w.-]*):)?(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
  for (const match of source.matchAll(pattern)) {
    const quoted = match[2] !== undefined;
    const value = quoted ? match[2].replace(/\\(.)/g, '$1') : match[3];
    // "https://example.com" is text, not a key "https" — a key is followed by a value, not "//".
    if (match[1] && !quoted && value.startsWith('//')) {
      terms.push({ value: `${match[1]}:${value}`, quoted: false });
      continue;
    }
    if (!match[1] && value === '') continue;
    // `status:` with nothing after it is a key missing its value, not the word "status:".
    const bareKey = !match[1] && !quoted ? /^([A-Za-z][\w.-]*):$/.exec(value) : null;
    if (bareKey) {
      terms.push({ key: bareKey[1], value: '', quoted: false });
      continue;
    }
    terms.push({ key: match[1], value, quoted });
  }
  return terms;
}

/**
 * What a typed value might mean. `42` in a search box is as likely to be the
 * string "42" as the number, so both are tried; quoting forces a string.
 */
function typedValues(value: string, quoted: boolean): JsonValue[] {
  if (quoted) return [value];
  if (value === 'true' || value === 'false') return [value === 'true', value];
  if (value === 'null') return [null];
  if (/^-?\d+(\.\d+)?$/.test(value)) return [Number(value), value];
  return [value];
}

function nest(path: string[], value: JsonValue): Record<string, JsonValue> {
  return path.reduceRight<JsonValue>((inner, key) => ({ [key]: inner }), value) as Record<string, JsonValue>;
}
