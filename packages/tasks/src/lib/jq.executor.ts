import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';
import { JqRunner, type JqRunnerOptions } from './jq.runner.js';

/**
 * `JSON_JQ_TRANSFORM` — reshapes JSON with a jq program.
 *
 * The workhorse of any real workflow: an API returns one shape and the next
 * task needs another, and doing that with `${...}` expressions alone means
 * either a `SIMPLE` task whose entire body is a map, or an `INLINE` script
 * where a one-line filter would do.
 *
 * Real jq — jq 1.8.2 compiled to WebAssembly — rather than a subset. A
 * "mostly-jq" implementation is a compatibility claim that breaks on the first
 * program someone pastes from the jq manual, and Conductor users arrive with
 * existing programs.
 *
 * Everything about the execution model is in `JqRunner`: jq cannot be
 * interrupted, so it runs in a thread that can be killed.
 */

export type JqExecutorOptions = JqRunnerOptions;

export class JqTaskExecutor implements TaskExecutor {
  readonly type = TaskType.JSON_JQ_TRANSFORM;
  private readonly runner: JqRunner;

  constructor(options: JqExecutorOptions = {}) {
    this.runner = new JqRunner(options);
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const query = context.input['queryExpression'] ?? context.input['expression'];

    if (typeof query !== 'string' || query.trim() === '') {
      return {
        status: 'FAILED',
        reason: 'JSON_JQ_TRANSFORM requires a "queryExpression"',
        terminal: true,
      };
    }

    // Conductor's convention: the whole input object is the document, with the
    // program addressing `.someKey`. `queryExpression` is excluded because it
    // is the program, not data — leaving it in means `keys` reports a field
    // nobody put there.
    const document = { ...context.input };
    delete document['queryExpression'];
    delete document['expression'];

    const result = await this.runner.run(document, query, context.signal);

    if (!result.ok) {
      return { status: 'FAILED', reason: result.reason, terminal: result.terminal };
    }

    // jq is a stream language: a program yields zero, one or many values. All
    // three are legitimate, so all three are reported rather than the first
    // being silently taken.
    const [first] = result.values;

    return {
      status: 'COMPLETED',
      output: {
        result: (first ?? null) as JsonValue,
        resultList: result.values as JsonValue[],
      },
    };
  }
}
