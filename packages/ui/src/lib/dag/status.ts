/** The fields of a task execution that decide which row a graph node shows. */
export interface TaskRun {
  refName: string;
  status: string;
  iteration: number;
  attempt: number;
}

/**
 * One status per task reference.
 *
 * A reference can have many rows — one per retry, one per loop iteration — and
 * the graph has one node for it. The node shows the newest: latest iteration,
 * then latest attempt. Showing the first would draw a retried-and-succeeded
 * task as failed, which is exactly backwards during an incident.
 */
export function latestStatusByRef(tasks: readonly TaskRun[]): Record<string, string> {
  const newest = new Map<string, TaskRun>();
  for (const task of tasks) {
    const current = newest.get(task.refName);
    if (
      !current ||
      task.iteration > current.iteration ||
      (task.iteration === current.iteration && task.attempt > current.attempt)
    ) {
      newest.set(task.refName, task);
    }
  }
  return Object.fromEntries([...newest].map(([ref, task]) => [ref, task.status]));
}

/** A task run with the timestamps time travel reads. */
export interface TimedTaskRun extends TaskRun {
  scheduledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : undefined);

/**
 * Statuses as they stood at one instant.
 *
 * Reconstructed from each run's own timestamps rather than stored snapshots:
 * a run not yet scheduled did not exist, one scheduled but not started was
 * waiting, one started but not ended was running, and one that had ended shows
 * how it ended. A reference with no run yet has no entry, so the graph draws
 * it as not reached — which is what it was.
 */
export function statusesAt(tasks: readonly TimedTaskRun[], at: number): Record<string, string> {
  const visible: TaskRun[] = [];
  for (const task of tasks) {
    const scheduled = time(task.scheduledAt) ?? time(task.startedAt);
    if (scheduled === undefined || scheduled > at) continue;
    const ended = time(task.endedAt);
    const started = time(task.startedAt);
    const status = ended !== undefined && ended <= at ? task.status : started !== undefined && started <= at ? 'IN_PROGRESS' : 'SCHEDULED';
    visible.push({ ...task, status });
  }
  return latestStatusByRef(visible);
}

/** Every instant at which some task changed, in order: the stops a time-travel scrubber steps through. */
export function momentsOf(tasks: readonly TimedTaskRun[], startedAt?: string, endedAt?: string | null): number[] {
  const all = new Set<number>();
  for (const value of [startedAt, endedAt]) {
    const t = time(value);
    if (t !== undefined) all.add(t);
  }
  for (const task of tasks) {
    for (const value of [task.scheduledAt, task.startedAt, task.endedAt]) {
      const t = time(value);
      if (t !== undefined) all.add(t);
    }
  }
  return [...all].sort((a, b) => a - b);
}
