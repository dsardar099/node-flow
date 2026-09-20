import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';
import { JsSandbox, type SandboxOptions } from './sandbox.js';

/**
 * `INLINE` — runs a snippet of JavaScript against the task's input.
 *
 * The escape hatch every orchestration system needs: reshaping a payload,
 * computing a branch condition, deriving a value that no expression language
 * covers. It is also the one place a user supplies **code**, which makes the
 * sandbox the entire design.
 *
 * ## Why QuickJS-on-WASM and not `isolated-vm` or `node:vm`
 *
 * `node:vm` is not a sandbox and never has been: the context shares a heap with
 * the host, and `this.constructor.constructor('return process')()` walks out of
 * it in one line.
 *
 * `isolated-vm` is a genuine isolate and is faster, but it is a native addon
 * sharing an address space with the host, and it had a type-confusion
 * sandbox-escape CVE in August 2026. Running untrusted user JavaScript inside a
 * multi-tenant control plane is exactly the situation where "fast, with a
 * history of escapes" is the wrong trade.
 *
 * QuickJS compiled to WebAssembly has a different property: the guest cannot
 * address host memory *at all*, because WASM's memory model does not provide a
 * way to. There is no host object graph to reach. An escape would need a bug in
 * the WASM engine itself rather than in the binding layer, which is a
 * categorically smaller surface.
 *
 * ## What the guest gets
 *
 * Nothing but the input. No `require`, no `fetch`, no timers, no `process`.
 * That is not a restriction to relax later — a task that needs the network has
 * `HTTP`, and one that needs to do real work has a worker. `INLINE` exists to
 * transform data it was handed.
 */

/** Bounds the result, which is stored, indexed and passed to the next task. */
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export type InlineExecutorOptions = SandboxOptions & {
  /** Bounds the result, which is stored and passed to the next task. */
  maxOutputBytes?: number;
};

export class InlineTaskExecutor implements TaskExecutor {
  readonly type = TaskType.INLINE;
  private readonly sandbox: JsSandbox;
  private readonly maxOutputBytes: number;

  constructor(options: InlineExecutorOptions = {}) {
    this.sandbox = new JsSandbox(options);
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const expression = context.input['expression'] ?? context.input['script'];
    if (typeof expression !== 'string' || expression.trim() === '') {
      return {
        status: 'FAILED',
        reason: 'inline task requires an "expression"',
        terminal: true,
      };
    }

    const result = await this.sandbox.evaluate(expression, context.input);

    if (!result.ok) {
      return {
        status: 'FAILED',
        reason: `inline script failed: ${result.reason}`,
        // A script that throws will throw again on identical input, so retrying
        // only delays the error someone needs to see.
        terminal: true,
      };
    }

    return this.wrap(result.value);
  }

  /**
   * Shapes the returned value into task output.
   *
   * A script returning a plain value — a number, a string — is normal and
   * useful, so it is wrapped under `result` rather than rejected. Forcing every
   * script to `return { result: ... }` would be ceremony that buys nothing.
   */
  private wrap(value: JsonValue): TaskOutcome {
    // `undefined` is not JSON. Stored as-is it serialises away entirely, so a
    // script that returned nothing would produce `{}` and the next task would
    // see a missing key rather than an explicit null.
    const normalised = value === undefined ? null : value;

    const output =
      normalised !== null && typeof normalised === 'object' && !Array.isArray(normalised)
        ? (normalised as Record<string, JsonValue>)
        : { result: normalised };

    const size = JSON.stringify(output).length;
    const limit = this.maxOutputBytes;

    if (size > limit) {
      return {
        status: 'FAILED',
        reason: `inline script returned ${size} bytes, over the ${limit} byte limit`,
        terminal: true,
      };
    }

    return { status: 'COMPLETED', output };
  }
}
