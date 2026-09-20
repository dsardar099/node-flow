import type { JsonValue, TaskDefinition, TaskType } from '@node-flow-dev/core';
import { simulate, type MockOutcome, type SimulationResult } from './simulate.js';

/**
 * Deterministic replay: run a recorded execution again through the pure engine.
 *
 * Every task's recorded outcome becomes a mock, consumed in the order it
 * happened, so nothing is called for real — no HTTP request, no model, no
 * worker. What the engine re-derives is everything *between* those outcomes:
 * which branch a switch took, whether a loop went round again, what each task's
 * input resolved to, how the run ended.
 *
 * Against the same definition version this should match exactly, and a
 * divergence is an engine determinism bug. Against another version it answers
 * the question every change to a live definition raises: *would the runs we
 * already have have gone the same way?*
 */

export interface RecordedTask {
  refName: string;
  taskType: TaskType | string;
  status: string;
  attempt: number;
  iteration: number;
  input?: Record<string, JsonValue>;
  output?: Record<string, JsonValue>;
  reasonForIncompletion?: string | null;
  scheduledAt?: string | Date | null;
}

export interface RecordedExecution {
  status: string;
  input?: Record<string, JsonValue>;
  output?: Record<string, JsonValue> | null;
  variables?: Record<string, JsonValue>;
  tasks: RecordedTask[];
}

export type DivergenceKind = 'missing' | 'extra' | 'status' | 'input' | 'workflow-status' | 'workflow-output';

export interface Divergence {
  kind: DivergenceKind;
  refName?: string;
  iteration?: number;
  attempt?: number;
  recorded?: JsonValue;
  replayed?: JsonValue;
  message: string;
}

export interface ReplayResult {
  matches: boolean;
  divergences: Divergence[];
  replay: SimulationResult;
}

const OUTCOME_STATUSES = new Set(['COMPLETED', 'FAILED', 'FAILED_WITH_TERMINAL_ERROR', 'TIMED_OUT']);

/** Stable JSON, so key order never reads as a difference. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const key = (t: { refName: string; iteration: number; attempt: number }) => `${t.refName}#${t.iteration}#${t.attempt}`;

export async function replay(
  definition: unknown,
  recorded: RecordedExecution,
  options: { taskDefs?: Record<string, Partial<TaskDefinition>>; env?: Record<string, JsonValue>; maxEvaluations?: number } = {}
): Promise<ReplayResult> {
  // Outcomes per reference, in the order they happened.
  const ordered = [...recorded.tasks].sort((a, b) => {
    const at = (t: RecordedTask) => (t.scheduledAt ? new Date(t.scheduledAt).getTime() : 0);
    return at(a) - at(b) || a.iteration - b.iteration || a.attempt - b.attempt;
  });
  const mocks: Record<string, MockOutcome[]> = {};
  for (const task of ordered) {
    if (!OUTCOME_STATUSES.has(task.status)) continue;
    const outcome: MockOutcome =
      task.status === 'COMPLETED'
        ? { status: 'COMPLETED', output: task.output ?? {} }
        : { status: task.status as 'FAILED', reason: task.reasonForIncompletion ?? undefined, output: task.output ?? {} };
    (mocks[task.refName] ??= []).push(outcome);
  }

  const result = await simulate(definition, {
    input: recorded.input ?? {},
    variables: recorded.variables,
    env: options.env,
    taskDefs: options.taskDefs,
    mocks,
    maxEvaluations: options.maxEvaluations,
  });

  const divergences: Divergence[] = [];
  const replayed = new Map(result.tasks.map((t) => [key(t), t]));
  const original = new Map(recorded.tasks.map((t) => [key(t), t]));

  for (const task of recorded.tasks) {
    const again = replayed.get(key(task));
    const where = { refName: task.refName, iteration: task.iteration, attempt: task.attempt };
    if (!again) {
      divergences.push({ kind: 'missing', ...where, recorded: task.status, message: `${label(task)} ran (${task.status}) but the replay never reached it` });
      continue;
    }
    if (again.status !== task.status) {
      divergences.push({ kind: 'status', ...where, recorded: task.status, replayed: again.status, message: `${label(task)} was ${task.status}, replayed as ${again.status}` });
    }
    if (task.input && canonical(again.input) !== canonical(task.input)) {
      divergences.push({ kind: 'input', ...where, recorded: task.input, replayed: again.input, message: `${label(task)} resolved a different input` });
    }
  }
  for (const task of result.tasks) {
    if (!original.has(key(task))) {
      divergences.push({ kind: 'extra', refName: task.refName, iteration: task.iteration, attempt: task.attempt, replayed: task.status, message: `the replay ran ${label(task)} (${task.status}), which the recorded run never did` });
    }
  }
  if (result.status !== recorded.status) {
    divergences.push({ kind: 'workflow-status', recorded: recorded.status, replayed: result.status, message: `the run ended ${recorded.status}; the replay ended ${result.status}` });
  } else if (recorded.output && canonical(result.output ?? {}) !== canonical(recorded.output)) {
    divergences.push({ kind: 'workflow-output', recorded: recorded.output, replayed: (result.output ?? {}) as JsonValue, message: 'the workflow output differs' });
  }

  return { matches: divergences.length === 0, divergences, replay: result };
}

function label(t: { refName: string; iteration: number; attempt: number }): string {
  return `${t.refName}${t.iteration > 0 ? ` #${t.iteration}` : ''}${t.attempt > 0 ? ` (attempt ${t.attempt + 1})` : ''}`;
}
