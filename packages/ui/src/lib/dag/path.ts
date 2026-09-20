/**
 * Addressing a task inside a nested workflow definition.
 *
 * A path is the chain of keys and indices from the definition's root:
 * `['tasks', 2, 'decisionCases', 'approved', 0]`. That is deliberately the
 * exact shape zod reports an issue's location in, so a validation issue from
 * the server locates a node in the editor with no translation at all.
 *
 * Everything here is immutable. The editor keeps its history as a list of
 * definitions, and an edit that mutated shared structure would silently rewrite
 * the past — undo would then restore a state that was never actually saved.
 */

export type Path = readonly (string | number)[];

/** A stable string form, for React keys and node ids. */
export function pathKey(path: Path): string {
  return path.map(String).join('/');
}

export function samePath(a: Path | undefined, b: Path | undefined): boolean {
  return a !== undefined && b !== undefined && pathKey(a) === pathKey(b);
}

export function getIn(root: unknown, path: Path): unknown {
  let cursor: unknown = root;

  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }

  return cursor;
}

/**
 * Replaces the value at `path` with `fn(current)`, copying every container on
 * the way down and sharing everything off it.
 *
 * Throws for a path that does not exist rather than creating it. Every caller
 * addresses something it just read from the same definition, so a missing
 * intermediate is a bug in the caller — and quietly materialising
 * `decisionCases: { undefined: [...] }` would turn that bug into a definition
 * the user then has to debug.
 */
export function updateIn<T>(root: T, path: Path, fn: (current: unknown) => unknown): T {
  if (path.length === 0) return fn(root) as T;

  const [head, ...rest] = path;

  if (Array.isArray(root)) {
    if (typeof head !== 'number' || head < 0 || head >= root.length) {
      throw new Error(`no index ${String(head)} in an array of ${root.length}`);
    }
    const copy = root.slice();
    copy[head] = updateIn(root[head], rest, fn);
    return copy as T;
  }

  if (root !== null && typeof root === 'object') {
    const record = root as Record<string, unknown>;
    if (!(String(head) in record)) throw new Error(`no key "${String(head)}"`);
    return { ...record, [head]: updateIn(record[String(head)], rest, fn) } as T;
  }

  throw new Error(`cannot descend into ${typeof root} at "${String(head)}"`);
}

/** The path of the list containing a task, and the task's index in it. */
export function parentOf(taskPath: Path): { listPath: Path; index: number } {
  const index = taskPath[taskPath.length - 1];
  if (typeof index !== 'number') throw new Error(`${pathKey(taskPath)} is not a task path`);
  return { listPath: taskPath.slice(0, -1), index };
}
