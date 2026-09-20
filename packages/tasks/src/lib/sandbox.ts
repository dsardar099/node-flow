import type { JsonValue } from '@node-flow-dev/core';
import { getQuickJS, type QuickJSWASMModule } from 'quickjs-emscripten';

/**
 * The QuickJS sandbox, shared by every task type that evaluates user code.
 *
 * Extracted because there is now more than one: `INLINE` runs a script, and
 * `HTTP_POLL` evaluates a termination condition. Both are user-supplied code
 * arriving in a workflow definition, so both need identical isolation — and a
 * second evaluation path would be a second chance to get the limits wrong.
 *
 * Why QuickJS-on-WASM rather than `node:vm` or `isolated-vm` is argued at
 * length in `InlineTaskExecutor`; the short version is that the guest cannot
 * address host memory at all, so there is no host object graph to escape into.
 */

export interface SandboxOptions {
  /**
   * CPU budget, enforced by an interrupt handler the guest cannot disable.
   *
   * A timeout alone would not help: `while (true) {}` never yields, so nothing
   * on the outside gets a chance to act on a deadline.
   */
  timeoutMs?: number;
  /** Heap ceiling. Bounds a script that allocates rather than spins. */
  memoryLimitBytes?: number;
  /**
   * Guest stack ceiling, and **bigger is emphatically not safer**.
   *
   * QuickJS enforces this itself and raises a catchable JS error. The host WASM
   * stack has its own, lower ceiling. Set the guest limit above the host's and
   * the host `RangeError` fires first — leaving the runtime holding live
   * objects, so `dispose()` trips an assertion and *aborts the shared WASM
   * module*, breaking every later evaluation in the process.
   *
   * Measured: 256 KB traps cleanly, 512 KB aborts. 128 KB keeps real margin.
   */
  maxStackBytes?: number;
}

export const SANDBOX_DEFAULTS = {
  timeoutMs: 5_000,
  memoryLimitBytes: 32 * 1024 * 1024,
  maxStackBytes: 128 * 1024,
};

export type SandboxResult =
  | { ok: true; value: JsonValue }
  | { ok: false; reason: string };

export class JsSandbox {
  private module?: Promise<QuickJSWASMModule>;

  constructor(private readonly options: SandboxOptions = {}) {}

  /**
   * Evaluates `expression` with `bindings` in scope as `$`.
   *
   * The body is wrapped in a function, so both `return x` and a bare expression
   * work — authors write both and rejecting either would be a papercut with no
   * safety benefit.
   */
  async evaluate(
    expression: string,
    bindings: Record<string, JsonValue>
  ): Promise<SandboxResult> {
    const timeoutMs = this.options.timeoutMs ?? SANDBOX_DEFAULTS.timeoutMs;

    this.module ??= getQuickJS();
    const runtime = (await this.module).newRuntime();

    try {
      runtime.setMemoryLimit(this.options.memoryLimitBytes ?? SANDBOX_DEFAULTS.memoryLimitBytes);
      runtime.setMaxStackSize(this.options.maxStackBytes ?? SANDBOX_DEFAULTS.maxStackBytes);

      const deadline = Date.now() + timeoutMs;
      runtime.setInterruptHandler(() => Date.now() > deadline);

      const context = runtime.newContext();

      try {
        // Injected as a JSON string and parsed *inside* the guest. Building the
        // object across the boundary handle-by-handle is slower, easy to leak,
        // and buys nothing — the guest can only ever see a plain value anyway.
        const source = `
          (function () {
            "use strict";
            const $ = ${JSON.stringify(bindings)};
            return (function () { ${expression} })();
          })()
        `;

        const result = context.evalCode(source);

        if (result.error) {
          const message = context.dump(result.error) as unknown;
          result.error.dispose();
          return { ok: false, reason: describe(message) };
        }

        const value = context.dump(result.value) as JsonValue;
        result.value.dispose();
        return { ok: true, value };
      } finally {
        context.dispose();
      }
    } catch (error) {
      // An interrupt surfaces as a thrown error from `evalCode`, and so does
      // exhausting the memory limit. Both are the sandbox doing its job.
      return { ok: false, reason: `exceeded its limits: ${describe(error)}` };
    } finally {
      // Disposing the runtime frees the guest heap outright. Without it every
      // evaluation leaks a WASM arena and the process grows until it is killed.
      try {
        runtime.dispose();
      } catch {
        // A failed dispose means the shared WASM module may be aborted, and it
        // is shared by every future evaluation. Dropping it makes the next call
        // rebuild — tens of milliseconds once, against every later evaluation
        // failing forever.
        this.module = undefined;
      }
    }
  }
}

/** A thrown value is not necessarily an Error, and often is not. */
export function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record['message'] === 'string') {
      return record['name'] ? `${String(record['name'])}: ${record['message']}` : record['message'];
    }
  }

  return String(value);
}
