import type { Blueprint, BlueprintNode } from './blueprint.js';

/**
 * Everything that depends on a set of tasks, transitively.
 *
 * "Depends on" has two halves, and both matter.
 *
 * **Data.** A node whose inputs read `${charge.output.txnId}` cannot keep its
 * result once `charge` runs again — that result was computed from a value which
 * no longer exists. `staticRefs` records exactly this, per node, because the
 * decider already needs it to know what to prefetch.
 *
 * **Control.** A node reached only because `charge` completed has to go too,
 * even if it never reads `charge`'s output: whether it ran at all was a
 * consequence of a run being discarded. A `SWITCH` is the clearest case — the
 * branch taken depends on the value being switched on, so re-running the task
 * that produced it can change which branch is correct.
 *
 * This is deliberately a *different* rule from the one `rerunFromTask` uses.
 * That one discards every task with `scheduledAt >= target`, which is a proxy
 * for "downstream" that holds only while a workflow is a straight line. Across
 * a fork it is wrong in a way that is easy to miss: an unrelated parallel
 * branch that happened to be scheduled a millisecond later is swept up and
 * re-run for no reason. Walking the blueprint instead costs nothing — it is in
 * memory, and immutable per version — and answers the question actually being
 * asked.
 */
export function dependentsOf(blueprint: Blueprint, refs: readonly string[]): Set<string> {
  // Which nodes read which. Built once; a workflow of 30,000 tasks is still one
  // pass over the node list rather than a scan per lookup.
  const readers = new Map<string, string[]>();
  for (const node of blueprint.nodes.values()) {
    for (const source of dataSourcesOf(node)) {
      const existing = readers.get(source);
      if (existing) existing.push(node.ref);
      else readers.set(source, [node.ref]);
    }
  }

  const found = new Set<string>();

  /**
   * Whether to expand a node's *children*.
   *
   * Reached going forwards — it is downstream, or it reads something that
   * changed — everything it contains is invalidated with it. Reached going
   * *outwards*, because a task inside it is being re-run, only the construct
   * and what follows are: its other branches are independent and re-running
   * them would throw away work for no reason. That distinction is the whole
   * difference between this and a cut on `scheduledAt`.
   */
  const pending: { ref: string; expandChildren: boolean }[] = refs.map((ref) => ({
    ref,
    expandChildren: true,
  }));

  while (pending.length > 0) {
    const { ref, expandChildren } = pending.pop() as { ref: string; expandChildren: boolean };
    const node = blueprint.nodes.get(ref);

    const forwards = [...(readers.get(ref) ?? []), ...successorsOf(node, expandChildren)];
    for (const dependent of forwards) {
      if (found.has(dependent)) continue;
      found.add(dependent);
      pending.push({ ref: dependent, expandChildren: true });
    }

    const parent = node?.location.parentRef;
    if (parent && !found.has(parent)) {
      found.add(parent);
      pending.push({ ref: parent, expandChildren: false });
    }
  }

  // A task cannot be a dependent of itself in any useful sense; the caller is
  // re-running it deliberately and lists it separately.
  for (const ref of refs) found.delete(ref);
  return found;
}

/** Refs this node's inputs read, plus the refs a JOIN waits on. */
function dataSourcesOf(node: BlueprintNode): string[] {
  return [...node.staticRefs, ...(node.joinOn ?? [])];
}

/**
 * Refs scheduled as a consequence of this one.
 *
 * Every branching shape is listed, because missing one silently leaves a task
 * behind holding a result from a run that no longer exists — the failure mode
 * this whole function exists to prevent.
 *
 * `location.parentRef` is the one edge that points *outwards* rather than
 * forwards, and it is required. The last task of a `DO_WHILE` body has an empty
 * `next`: the loop node owns what comes after the loop, so following successors
 * alone walks off the end of the body and never reaches it. Anything enclosing
 * a task — a loop, a fork, a switch — cannot be finished with while that task
 * is being run again, so it is a dependent, and through it so is everything
 * after it.
 */
function successorsOf(node: BlueprintNode | undefined, expandChildren: boolean): string[] {
  if (!node) return [];

  // What comes *after* this node, always.
  const after = [...node.next, ...(node.joinRef ? [node.joinRef] : [])];
  if (!expandChildren) return after;

  // What this node *contains*, only when the node itself is being re-run.
  return [
    ...after,
    ...(node.forkBranchHeads ?? []),
    ...(node.forkBranchTips ?? []),
    ...Object.values(node.caseHeads ?? {}),
    ...(node.defaultHead ? [node.defaultHead] : []),
    ...(node.loopHead ? [node.loopHead] : []),
  ];
}
