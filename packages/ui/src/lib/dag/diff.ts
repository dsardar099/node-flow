import type { WorkflowTask } from '@node-flow-dev/core';
import { walkTasks, type Definition } from './edit';

/**
 * Comparing two versions of a workflow.
 *
 * Two views of the same change, because each answers a different question.
 * The task summary says *what* changed in the terms people think in — "added
 * `notify`, changed `charge`" — and the line diff says exactly *how*, down to
 * the retry count. Versions and timestamps are left out of both: every version
 * differs there, and showing it would bury the changes that matter.
 */

export type LineKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** Line numbers in the old and new text; absent on the side the line is not in. */
  oldLine?: number;
  newLine?: number;
}

/** Past this many lines on either side, fall back to a cheaper, coarser diff. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * A line diff by longest common subsequence.
 *
 * Quadratic, which is fine for definitions — thousands of lines at most — and
 * gives the minimal, readable diff a heuristic would not. Guarded anyway, so a
 * pathological definition degrades to "everything changed" rather than
 * freezing the tab.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map((text, i) => ({ kind: 'removed' as const, text, oldLine: i + 1 })),
      ...b.map((text, i) => ({ kind: 'added' as const, text, newLine: i + 1 })),
    ];
  }

  // lengths[i][j] = LCS length of a[i..] and b[j..], filled from the end.
  const lengths: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ kind: 'added', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i], oldLine: ++i });
  while (j < b.length) out.push({ kind: 'added', text: b[j], newLine: ++j });
  return out;
}

export interface Hunk {
  lines: DiffLine[];
}

/** Groups a diff into changed regions with `context` unchanged lines around each, as a code review shows it. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const changed = lines.map((line, index) => (line.kind === 'same' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const result: Hunk[] = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(lines.length - 1, changed[0] + context);
  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(lines.length - 1, index + context);
    } else {
      result.push({ lines: lines.slice(start, end + 1) });
      start = Math.max(0, index - context);
      end = Math.min(lines.length - 1, index + context);
    }
  }
  result.push({ lines: lines.slice(start, end + 1) });
  return result;
}

export interface TaskChange {
  ref: string;
  kind: 'added' | 'removed' | 'changed';
  type: string;
  /** For a changed task: which of its fields differ. */
  fields?: string[];
}

export interface DefinitionChanges {
  tasks: TaskChange[];
  /** Workflow-level settings that differ, such as `timeoutSeconds` or `failureWorkflow`. */
  settings: string[];
}

/** Fields that differ by definition between versions and say nothing about behaviour. */
const IGNORED = new Set(['version', 'createTime', 'updateTime', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

/** What changed between two versions, by task reference and by setting. */
export function describeChanges(before: Definition, after: Definition): DefinitionChanges {
  const tasksOf = (definition: Definition) => {
    const map = new Map<string, WorkflowTask>();
    walkTasks(definition, (task) => map.set(task.taskReferenceName, task));
    return map;
  };
  const oldTasks = tasksOf(before);
  const newTasks = tasksOf(after);

  const tasks: TaskChange[] = [];
  for (const [ref, task] of newTasks) {
    const previous = oldTasks.get(ref);
    if (!previous) {
      tasks.push({ ref, kind: 'added', type: task.type });
      continue;
    }
    const fields = changedKeys(ownFields(previous), ownFields(task));
    if (fields.length) tasks.push({ ref, kind: 'changed', type: task.type, fields });
  }
  for (const [ref, task] of oldTasks) {
    if (!newTasks.has(ref)) tasks.push({ ref, kind: 'removed', type: task.type });
  }

  const { tasks: _a, ...beforeSettings } = before as Record<string, unknown>;
  const { tasks: _b, ...afterSettings } = after as Record<string, unknown>;
  const settings = changedKeys(beforeSettings, afterSettings).filter((key) => !IGNORED.has(key));

  return { tasks, settings };
}

/** A task's own fields: nested branches are separate tasks, compared on their own. */
function ownFields(task: WorkflowTask): Record<string, unknown> {
  const { decisionCases, defaultCase, forkTasks, loopOver, ...rest } = task as WorkflowTask & Record<string, unknown>;
  return {
    ...rest,
    // Structure still counts — which refs a branch holds — just not their contents.
    ...(decisionCases ? { decisionCases: Object.fromEntries(Object.entries(decisionCases).map(([k, v]) => [k, v.map((t) => t.taskReferenceName)])) } : {}),
    ...(defaultCase ? { defaultCase: defaultCase.map((t) => t.taskReferenceName) } : {}),
    ...(forkTasks ? { forkTasks: forkTasks.map((branch) => branch.map((t) => t.taskReferenceName)) } : {}),
    ...(loopOver ? { loopOver: loopOver.map((t) => t.taskReferenceName) } : {}),
  };
}

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => stable(a[key]) !== stable(b[key])).sort();
}

/** JSON with sorted keys, so key order alone never reads as a change. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
      : v
  ) ?? 'undefined';
}

/** Pretty JSON with sorted keys and the ignored fields dropped: the text both sides of the line diff use. */
export function comparable(definition: Definition): string {
  const { version: _v, ...rest } = definition as Record<string, unknown>;
  for (const key of IGNORED) delete (rest as Record<string, unknown>)[key];
  return JSON.stringify(JSON.parse(stable(rest)), null, 2);
}
