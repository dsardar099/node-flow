import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

/**
 * Runs jq programs in a worker thread that can be killed.
 *
 * This is not a performance optimisation, and that distinction matters for
 * anyone tempted to simplify it away. `jq-wasm` exposes a **synchronous** API
 * and jq has no interrupt hook, so a runaway program cannot be stopped from the
 * outside — measured directly: `def f: f; f` never returns, ignores every
 * deadline, and had to be SIGKILLed.
 *
 * On the main thread that is not a failed task, it is a **dead process**: the
 * event loop stops, so the decider stops, the pollers stop, in-flight HTTP
 * requests hang and every lease in the process expires. One malformed jq
 * program in one workflow would take down everything sharing that process.
 *
 * `worker.terminate()` is the only mechanism that stops it, and it only exists
 * for threads. Hence a thread per execution, and hence the CPU budget is a hard
 * kill rather than a polite cancellation.
 *
 * `INLINE` does not need this: QuickJS has an interrupt handler the guest
 * cannot disable, so it bounds itself from the inside. jq gives us nothing
 * equivalent.
 */

export interface JqRunnerOptions {
  /** Hard CPU budget. Enforced by killing the thread. */
  timeoutMs?: number;
  /** Bounds the result, which is stored and handed to the next task. */
  maxOutputBytes?: number;
  /**
   * Absolute path to `jq-wasm`, for a layout the default search cannot reach.
   * Normally unset.
   */
  jqModulePath?: string;
}

const DEFAULTS = {
  timeoutMs: 5_000,
  maxOutputBytes: 1024 * 1024,
};

export type JqResult =
  | { ok: true; values: unknown[] }
  | { ok: false; reason: string; terminal: boolean };

/**
 * The worker body, inline as source rather than a sibling file.
 *
 * The server is bundled by webpack, which rewrites
 * `new URL('./jq.worker.js', import.meta.url)` into `[object Object]` — a
 * separate worker file simply cannot be addressed from inside the bundle.
 * Source text passed to `eval: true` is immune to that, because there is
 * nothing for a bundler to resolve.
 *
 * It reaches `jq-wasm` through an absolute path supplied by the parent: an
 * eval'd worker resolves bare specifiers against the process's working
 * directory, which under pnpm's strict layout is wrong almost everywhere.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  let jq;
  try {
    const module = await import(workerData.jqModule);
    jq = await module.loadJq();
  } catch (error) {
    parentPort.postMessage({ ok: false, reason: 'jq failed to load: ' + error.message, terminal: false });
    return;
  }

  try {
    // Synchronous, and deliberately the last thing this thread does. If it
    // never returns, the parent kills the thread.
    parentPort.postMessage({ ok: true, values: jq.json(workerData.input, workerData.query) });
  } catch (error) {
    // jq distinguishes a program that cannot compile from one that compiled and
    // then hit bad data. The first can never succeed, so retrying it only
    // delays the error someone has to read.
    const message = String(error && error.message ? error.message : error);
    parentPort.postMessage({
      ok: false,
      reason: message,
      terminal: /compile error|syntax error/i.test(message),
    });
  }
})();
`;

/**
 * Where to import `jq-wasm` from.
 *
 * Neither `__dirname` nor `import.meta.url` can be used here. The first is a
 * webpack shim that breaks module concatenation when a bundled module also
 * declares it; the second cannot be expressed once the module is emitted as
 * CommonJS, and webpack fails the build outright with "Cannot get final name
 * for export". A module that has to work both bundled and unbundled therefore
 * cannot ask where its own source lives.
 *
 * So it asks where the *process* lives instead, which is knowable either way:
 * the entry script under a deployed server, the working directory under a test
 * runner. `createRequire` then applies normal Node resolution from there, which
 * is what makes this work under pnpm's strict layout where a bare specifier
 * resolved from the wrong directory finds nothing.
 */
function resolveJqModule(explicit?: string): string {
  if (explicit) return pathToFileURL(explicit).href;

  const candidates = [
    // The running entry point — `packages/server/dist/main.js` for the bundled
    // server, which is why `jq-wasm` is a dependency of `server` even though no
    // file there imports it.
    process.argv[1],
    join(process.cwd(), 'noop.js'),
  ].filter((path): path is string => typeof path === 'string' && path !== '');

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return pathToFileURL(createRequire(candidate).resolve('jq-wasm')).href;
    } catch (error) {
      failures.push(`${candidate}: ${(error as Error).message}`);
    }
  }

  throw new Error(`jq-wasm could not be resolved from ${failures.join('; ')}`);
}

export class JqRunner {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  /** Resolved once and cached: the failure is a deployment fault, not a task's. */
  private jqModule?: string;

  private readonly jqModulePath?: string;

  constructor(options: JqRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULTS.maxOutputBytes;
    this.jqModulePath = options.jqModulePath;
  }

  async run(input: unknown, query: string, signal?: AbortSignal): Promise<JqResult> {
    try {
      this.jqModule ??= resolveJqModule(this.jqModulePath);
    } catch (error) {
      return {
        ok: false,
        reason: `jq is not available in this install: ${(error as Error).message}`,
        terminal: false,
      };
    }

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { jqModule: this.jqModule, input, query },
      // Nothing in the worker reads or writes either, and leaving them attached
      // means a jq program's stray output lands in the server's logs.
      stdout: true,
      stderr: true,
      resourceLimits: {
        // A program that allocates rather than spins hits this and the thread
        // dies with ERR_WORKER_OUT_OF_MEMORY, which is a failed task rather
        // than a failed process.
        maxOldGenerationSizeMb: 256,
      },
    });

    try {
      return await this.settle(worker, signal);
    } finally {
      // Unconditional: a thread that completed normally still has to be reaped,
      // and one that timed out is precisely what must not be left running.
      await worker.terminate();
    }
  }

  private settle(worker: Worker, signal?: AbortSignal): Promise<JqResult> {
    return new Promise<JqResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          ok: false,
          reason: `jq program exceeded its ${this.timeoutMs}ms budget`,
          // Not terminal. A program slow enough to trip the budget on a large
          // payload may well pass on a retry with a smaller one, and calling it
          // permanent would strand a workflow that could recover.
          terminal: false,
        });
      }, this.timeoutMs);

      const done = (result: JqResult) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      // Shutdown and the task's own deadline. Without this a drain waits for
      // the slowest jq program in flight.
      const onAbort = () =>
        done({ ok: false, reason: 'cancelled', terminal: false });
      signal?.addEventListener('abort', onAbort, { once: true });

      worker.on('message', (message: JqResult) => {
        if (!message.ok) return done(message);

        // Checked here rather than in the worker: the cost is in moving the
        // value across the thread boundary, which has already happened, and the
        // parent is what knows the limit.
        const encoded = JSON.stringify(message.values) ?? '';
        if (encoded.length > this.maxOutputBytes) {
          return done({
            ok: false,
            reason: `jq output of ${encoded.length} bytes exceeds the ${this.maxOutputBytes}-byte limit`,
            terminal: true,
          });
        }

        done(message);
      });

      worker.on('error', (error) =>
        done({ ok: false, reason: `jq worker failed: ${error.message}`, terminal: false })
      );

      // Reached when the thread dies without reporting — the out-of-memory
      // kill, most often. Harmless after a result, because `done` has already
      // resolved and a promise settles once.
      worker.on('exit', (code) =>
        done({
          ok: false,
          reason: `jq worker exited unexpectedly with code ${code}`,
          terminal: false,
        })
      );
    });
  }
}
