import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * The system tasks that need no I/O.
 *
 * Small enough to share a file, and worth having as real executors rather than
 * special cases in the runner — the moment one becomes a special case, the next
 * one does too, and the registry stops being the answer to "what can this
 * install run?".
 */

/**
 * `NOOP` — completes immediately.
 *
 * Useful as a join point, a placeholder while a workflow is being built, and a
 * deliberate marker in a diagram. It passes its input through as output, which
 * makes it a cheap way to reshape data for the next task.
 */
export class NoopTaskExecutor implements TaskExecutor {
  readonly type = TaskType.NOOP;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    return { status: 'COMPLETED', output: context.input };
  }
}

/**
 * `UPDATE_TASK` — records a value against the workflow without doing anything.
 *
 * The escape hatch for "mark this step done because something outside the
 * system says so". It completes with whatever it was given.
 */
export class UpdateTaskExecutor implements TaskExecutor {
  readonly type = TaskType.UPDATE_TASK;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    return { status: 'COMPLETED', output: context.input };
  }
}

/**
 * `BUSINESS_RULE` — evaluates simple declarative conditions.
 *
 * A deliberately small evaluator: a list of `when` conditions against the
 * input, returning the first match's `then`. Anything more expressive belongs
 * in `INLINE`, where it is sandboxed — growing a bespoke rule language here
 * would mean reinventing a scripting engine without the sandbox.
 */
export class BusinessRuleTaskExecutor implements TaskExecutor {
  readonly type = TaskType.BUSINESS_RULE;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const rules = context.input['rules'];
    if (!Array.isArray(rules)) {
      return { status: 'FAILED', reason: 'business rule task requires "rules"', terminal: true };
    }

    for (const rule of rules) {
      if (!isRecord(rule)) continue;

      const when = rule['when'];
      if (when === undefined || matches(when, context.input)) {
        return { status: 'COMPLETED', output: { matched: true, result: rule['then'] ?? null } };
      }
    }

    // No match is a *result*, not a failure. Failing would force every caller
    // to model "nothing applied" as an error path.
    return { status: 'COMPLETED', output: { matched: false, result: null } };
  }
}

/** Every declared key must equal the corresponding input value. */
function matches(when: JsonValue, input: Record<string, JsonValue>): boolean {
  if (!isRecord(when)) return false;

  return Object.entries(when).every(
    ([key, expected]) => JSON.stringify(input[key]) === JSON.stringify(expected)
  );
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
