import type { WorkflowTask } from '@node-flow-dev/core';
import { getIn, parentOf, updateIn, type Path } from './path';

/**
 * Structural edits to a workflow definition.
 *
 * The editor never lets someone draw an arbitrary edge, and that is the design
 * rather than a missing feature. The DSL is a tree — sequences, switch cases,
 * fork branches, loop bodies — and a graph with a free-form edge from anywhere
 * to anywhere has no representation in it. An editor that allowed one would
 * either refuse to save or silently save something other than what was drawn.
 * So every change is an operation on the tree, and the picture is derived from
 * the tree afterwards; nothing is ever stored about the picture itself.
 *
 * All operations are pure and return a new definition.
 */

export interface Definition {
  name: string;
  tasks: WorkflowTask[];
  [key: string]: unknown;
}

/** A position between tasks: index `index` in the list at `listPath`. */
export interface InsertPoint {
  listPath: Path;
  index: number;
}

const JOIN_TYPES = new Set(['JOIN', 'EXCLUSIVE_JOIN']);

// ---------------------------------------------------------------- traversal

/** Calls `visit` for every task, depth-first in definition order. */
export function walkTasks(
  definition: Definition,
  visit: (task: WorkflowTask, path: Path) => void
): void {
  const walkList = (list: WorkflowTask[] | undefined, listPath: Path) => {
    (list ?? []).forEach((task, index) => {
      const path = [...listPath, index];
      visit(task, path);

      for (const [name, branch] of Object.entries(task.decisionCases ?? {})) {
        walkList(branch, [...path, 'decisionCases', name]);
      }
      walkList(task.defaultCase, [...path, 'defaultCase']);
      (task.forkTasks ?? []).forEach((branch, i) => walkList(branch, [...path, 'forkTasks', i]));
      walkList(task.loopOver, [...path, 'loopOver']);
    });
  };

  walkList(definition.tasks, ['tasks']);
}

export function allRefs(definition: Definition): Set<string> {
  const refs = new Set<string>();
  walkTasks(definition, (task) => refs.add(task.taskReferenceName));
  return refs;
}

/** First task with this reference. The compiler rejects duplicates; mid-edit they can exist. */
export function pathOfRef(definition: Definition, ref: string): Path | undefined {
  let found: Path | undefined;
  walkTasks(definition, (task, path) => {
    if (!found && task.taskReferenceName === ref) found = path;
  });
  return found;
}

/**
 * The task a validation issue is about.
 *
 * A schema issue's path usually ends *inside* a task — `['tasks', 1, 'name']`
 * — so this walks back up to the nearest enclosing task. The result is a node
 * the editor can highlight rather than a field it cannot draw.
 */
export function taskPathOfIssue(definition: Definition, issuePath: Path): Path | undefined {
  for (let length = issuePath.length; length > 0; length--) {
    const candidate = issuePath.slice(0, length);
    const value = getIn(definition, candidate);
    const isTask =
      typeof candidate[candidate.length - 1] === 'number' &&
      value !== null &&
      typeof value === 'object' &&
      'type' in (value as object) &&
      'taskReferenceName' in (value as object);
    if (isTask) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------- lists

/**
 * Updates the task list at `listPath`, treating a missing list as empty.
 *
 * Lists that may legitimately be absent — `defaultCase`, `loopOver` — would
 * make `updateIn` throw, and a first insert into an empty default case is the
 * most ordinary edit there is. Only the *final* key may be missing; anything
 * above it must exist, because it was read from this definition.
 */
function updateList(
  definition: Definition,
  listPath: Path,
  fn: (list: WorkflowTask[]) => WorkflowTask[]
): Definition {
  const owner = listPath.slice(0, -1);
  const key = listPath[listPath.length - 1];

  return updateIn(definition, owner, (container) => {
    if (Array.isArray(container)) {
      // A fork branch: the list lives at an index of `forkTasks`.
      const copy = container.slice();
      copy[key as number] = fn((container[key as number] as WorkflowTask[]) ?? []);
      return copy;
    }
    const record = container as Record<string, unknown>;
    return { ...record, [key]: fn((record[String(key)] as WorkflowTask[] | undefined) ?? []) };
  });
}

// ---------------------------------------------------------------- joins

/** The last task reference of each branch of every fork, keyed by the fork's ref. */
function forkTails(definition: Definition): Map<string, string[]> {
  const tails = new Map<string, string[]>();
  walkTasks(definition, (task) => {
    if (task.type !== 'FORK_JOIN') return;
    tails.set(
      task.taskReferenceName,
      (task.forkTasks ?? [])
        .map((branch) => branch[branch.length - 1]?.taskReferenceName)
        .filter((ref): ref is string => ref !== undefined)
    );
  });
  return tails;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * Keeps each join waiting on the ends of its branches, when that is what it
 * was doing.
 *
 * A join lists the references it waits for, and those are almost always the
 * last task of each branch. So appending a task to a branch silently leaves the
 * join waiting on the task *before* it — a workflow that compiles, runs, and
 * continues past the join before the branch has finished. That is the single
 * most common way hand-edited fork definitions go wrong.
 *
 * The rule is narrow on purpose: a join is updated only if, before the edit, it
 * waited on exactly the branch ends. A join someone deliberately pointed
 * elsewhere is left alone — rewriting a choice the user made is worse than
 * failing to make one for them.
 */
function syncJoins(after: Definition, tailsBefore: Map<string, string[]>): Definition {
  const tailsAfter = forkTails(after);
  let result = after;

  walkTasks(after, (task, path) => {
    if (task.type !== 'FORK_JOIN') return;

    const { listPath, index } = parentOf(path);
    const join = (getIn(result, listPath) as WorkflowTask[])[index + 1];
    if (!join || !JOIN_TYPES.has(join.type)) return;

    const before = tailsBefore.get(task.taskReferenceName);
    const now = tailsAfter.get(task.taskReferenceName) ?? [];
    if (!before || !sameSet(join.joinOn ?? [], before) || sameSet(before, now)) return;

    result = updateIn(result, [...listPath, index + 1], (current) => ({
      ...(current as WorkflowTask),
      joinOn: now,
    }));
  });

  return result;
}

/** Runs an edit and then repairs join targets that tracked branch ends. */
function withJoinSync(definition: Definition, edit: (d: Definition) => Definition): Definition {
  return syncJoins(edit(definition), forkTails(definition));
}

// ---------------------------------------------------------------- operations

export function insertTasks(
  definition: Definition,
  at: InsertPoint,
  tasks: WorkflowTask[]
): Definition {
  return withJoinSync(definition, (d) =>
    updateList(d, at.listPath, (list) => {
      if (at.index < 0 || at.index > list.length) {
        throw new Error(`cannot insert at ${at.index} in a list of ${list.length}`);
      }
      return [...list.slice(0, at.index), ...tasks, ...list.slice(at.index)];
    })
  );
}

/**
 * Removes a task — and its partner, if it has one.
 *
 * A fork and the join after it are one unit to the compiler, which requires
 * the join immediately after the fork. Deleting either alone produces a
 * definition invalid by construction, so deleting either deletes both.
 */
export function removeTask(definition: Definition, taskPath: Path): Definition {
  const { listPath, index } = parentOf(taskPath);
  const list = getIn(definition, listPath) as WorkflowTask[];
  const task = list[index];

  let start = index;
  let count = 1;
  if (task.type === 'FORK_JOIN' && JOIN_TYPES.has(list[index + 1]?.type)) count = 2;
  if (JOIN_TYPES.has(task.type) && list[index - 1]?.type === 'FORK_JOIN') {
    start = index - 1;
    count = 2;
  }

  return withJoinSync(definition, (d) =>
    updateList(d, listPath, (items) => [...items.slice(0, start), ...items.slice(start + count)])
  );
}

/**
 * Changes a task's own fields.
 *
 * Renaming a reference does **not** rewrite the `${ref.output…}` expressions
 * that point at it. Doing that correctly means parsing every expression in the
 * definition, and doing it approximately — a text replace — corrupts any
 * expression that happens to contain the old name as a substring. Validation
 * reports the now-dangling references by task, which is honest and fixable.
 */
export function updateTask(
  definition: Definition,
  taskPath: Path,
  patch: Partial<WorkflowTask>
): Definition {
  const ref = (getIn(definition, taskPath) as WorkflowTask).taskReferenceName;

  const updated = updateIn(definition, taskPath, (current) => {
    const next = { ...(current as WorkflowTask), ...patch };
    // `undefined` in a patch means "remove the field", so the saved JSON does
    // not carry `"expression": undefined`-shaped noise that round-trips as null.
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    return next;
  });

  // A renamed branch tail is a join target that has moved.
  if (patch.taskReferenceName && patch.taskReferenceName !== ref) {
    return syncRenamedJoinTarget(updated, ref, patch.taskReferenceName);
  }
  return updated;
}

/** Joins are the one place a reference is structural rather than an expression. */
function syncRenamedJoinTarget(definition: Definition, from: string, to: string): Definition {
  let result = definition;
  walkTasks(definition, (task, path) => {
    if (JOIN_TYPES.has(task.type) && task.joinOn?.includes(from)) {
      result = updateIn(result, path, (current) => ({
        ...(current as WorkflowTask),
        joinOn: ((current as WorkflowTask).joinOn ?? []).map((ref) => (ref === from ? to : ref)),
      }));
    }
  });
  return result;
}

export function addSwitchCase(definition: Definition, taskPath: Path, name: string): Definition {
  const task = getIn(definition, taskPath) as WorkflowTask;
  if (name === '' || name in (task.decisionCases ?? {})) {
    throw new Error(`case "${name}" already exists or is empty`);
  }
  return updateTask(definition, taskPath, {
    decisionCases: { ...(task.decisionCases ?? {}), [name]: [] },
  });
}

export function removeSwitchCase(definition: Definition, taskPath: Path, name: string): Definition {
  const task = getIn(definition, taskPath) as WorkflowTask;
  const { [name]: _removed, ...rest } = task.decisionCases ?? {};
  return updateTask(definition, taskPath, { decisionCases: rest });
}

export function addForkBranch(
  definition: Definition,
  taskPath: Path,
  placeholder: WorkflowTask
): Definition {
  return withJoinSync(definition, (d) =>
    updateIn(d, taskPath, (current) => {
      const task = current as WorkflowTask;
      return { ...task, forkTasks: [...(task.forkTasks ?? []), [placeholder]] };
    })
  );
}

export function removeForkBranch(
  definition: Definition,
  taskPath: Path,
  branch: number
): Definition {
  return withJoinSync(definition, (d) =>
    updateIn(d, taskPath, (current) => {
      const task = current as WorkflowTask;
      return { ...task, forkTasks: (task.forkTasks ?? []).filter((_, i) => i !== branch) };
    })
  );
}
