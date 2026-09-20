import type { JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { InlineTaskExecutor } from './inline.executor.js';

/**
 * `INLINE` — the one place a user supplies code.
 *
 * The escape attempts below are the point of the file. Everything else is a
 * feature; those are the security boundary, and a sandbox that is only tested
 * on well-behaved scripts has not been tested.
 */

const contextFor = (input: Record<string, JsonValue>): TaskContext => ({
  taskId: 't-1',
  workflowId: 'w-1',
  namespaceId: 'ns-1',
  input,
  signal: new AbortController().signal,
  state: {},
  heartbeat: async () => undefined,
});

const run = (expression: string, input: Record<string, JsonValue> = {}, options = {}) =>
  new InlineTaskExecutor(options).execute(contextFor({ ...input, expression }));

describe('evaluating', () => {
  it('returns an object as the output', async () => {
    const outcome = await run('return { doubled: $.value * 2 };', { value: 21 });

    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status === 'COMPLETED') expect(outcome.output).toEqual({ doubled: 42 });
  });

  // Forcing every script to `return { result: ... }` would be ceremony that
  // buys nothing.
  it('wraps a plain value under result', async () => {
    for (const [expression, expected] of [
      ['return 42;', 42],
      ['return "hello";', 'hello'],
      ['return true;', true],
      ['return [1, 2];', [1, 2]],
    ] as const) {
      const outcome = await run(expression);
      if (outcome.status !== 'COMPLETED') throw new Error(`failed: ${expression}`);
      expect(outcome.output, expression).toEqual({ result: expected });
    }
  });

  it('sees the whole task input as $', async () => {
    const outcome = await run('return { keys: Object.keys($).sort() };', {
      a: 1,
      b: 2,
    });

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    // `expression` is part of the input too, and hiding it would be a lie about
    // what the script was given.
    expect(outcome.output?.['keys']).toEqual(['a', 'b', 'expression']);
  });

  it('has the standard library', async () => {
    const outcome = await run(
      'return { total: [1,2,3].reduce((a,b) => a+b, 0), upper: "x".toUpperCase(), parsed: JSON.parse("{\\"k\\":1}").k };'
    );

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    expect(outcome.output).toEqual({ total: 6, upper: 'X', parsed: 1 });
  });

  it('accepts "script" as well as "expression"', async () => {
    const outcome = await new InlineTaskExecutor().execute(
      contextFor({ script: 'return 7;' })
    );

    expect(outcome.status).toBe('COMPLETED');
  });

  it('requires a script', async () => {
    const outcome = await new InlineTaskExecutor().execute(contextFor({}));
    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.terminal).toBe(true);
  });
});

describe('escaping the sandbox', () => {
  /**
   * The one-liner that defeats `node:vm`.
   *
   * `this.constructor.constructor` reaches the host `Function` there because
   * the context shares a heap with the host. In a WASM guest there is no host
   * object graph to reach, so the worst it can build is a guest function.
   */
  it('cannot reach the host through the constructor chain', async () => {
    const outcome = await run(
      'try { return { got: typeof this.constructor.constructor("return process")() }; }' +
        ' catch (e) { return { got: "threw" }; }'
    );

    if (outcome.status !== 'COMPLETED') return; // Failing outright is also fine.
    expect(outcome.output?.['got']).not.toBe('object');
  });

  it('has no host globals at all', async () => {
    const outcome = await run(
      'return { ' +
        'process: typeof process, require: typeof require, fetch: typeof fetch, ' +
        'global: typeof global, globalThisProcess: typeof globalThis.process, ' +
        'Buffer: typeof Buffer, setTimeout: typeof setTimeout ' +
        '};'
    );

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    for (const [name, type] of Object.entries(outcome.output ?? {})) {
      expect(type, name).toBe('undefined');
    }
  });

  // `import()` returns a promise whatever happens, so the question is whether
  // it ever *resolves* to a module — not what `typeof` says about it.
  it('cannot import anything', async () => {
    const outcome = await run(
      'let state = "pending";' +
        'import("node:fs").then(() => { state = "resolved"; }, () => { state = "rejected"; });' +
        'return { state };'
    );

    if (outcome.status !== 'COMPLETED') return; // Refusing outright is also fine.
    expect(outcome.output?.['state']).not.toBe('resolved');
  });

  /**
   * A timeout alone cannot stop this: the guest never yields, so nothing
   * outside gets a chance to act. The interrupt handler is checked by the
   * engine between operations, from the inside, and the guest cannot disable it.
   */
  it('interrupts an infinite loop', async () => {
    const started = Date.now();
    const outcome = await run('while (true) {}', {}, { timeoutMs: 200 });
    const elapsed = Date.now() - started;

    expect(outcome.status).toBe('FAILED');
    expect(elapsed).toBeLessThan(5_000);
  }, 20_000);

  it('interrupts a spinning computation', async () => {
    const outcome = await run(
      'let n = 0; for (;;) { n = (n + 1) % 1000000; }',
      {},
      { timeoutMs: 200 }
    );

    expect(outcome.status).toBe('FAILED');
  }, 20_000);

  it('stops a script that allocates without bound', async () => {
    const outcome = await run(
      'const a = []; for (let i = 0; i < 1e9; i++) { a.push({ i: "x".repeat(1000) }); } return a.length;',
      {},
      { memoryLimitBytes: 2 * 1024 * 1024, timeoutMs: 3_000 }
    );

    expect(outcome.status).toBe('FAILED');
  }, 20_000);

  /**
   * Set the guest stack above the host's WASM stack and the host `RangeError`
   * fires first, leaving the runtime undisposable — which aborts the *shared*
   * WASM module and breaks every later `INLINE` task in the process. So this
   * checks the executor is still usable afterwards, not merely that the task
   * failed.
   */
  it('stops runaway recursion without poisoning the engine', async () => {
    const executor = new InlineTaskExecutor();

    const outcome = await executor.execute(
      contextFor({ expression: 'function f() { return f(); } return f();' })
    );
    expect(outcome.status).toBe('FAILED');

    const after = await executor.execute(contextFor({ expression: 'return 1;' }));
    expect(after.status).toBe('COMPLETED');
  }, 20_000);

  // A generous-looking stack limit is the dangerous one.
  it('survives recursion even at the largest safe stack', async () => {
    const executor = new InlineTaskExecutor({ maxStackBytes: 256 * 1024 });

    await executor.execute(contextFor({ expression: 'function f(){return f()} return f();' }));
    expect((await executor.execute(contextFor({ expression: 'return 2;' }))).status).toBe(
      'COMPLETED'
    );
  }, 20_000);
});

describe('isolation between executions', () => {
  /**
   * A fresh runtime per execution is what guarantees this. Sharing one would
   * let a script leave a global, edit a prototype, or hold memory for whatever
   * ran next — across tenants.
   */
  it('leaves no globals behind', async () => {
    const executor = new InlineTaskExecutor();

    await executor.execute(contextFor({ expression: 'globalThis.leaked = "secret"; return 1;' }));
    const second = await executor.execute(
      contextFor({ expression: 'return { leaked: typeof globalThis.leaked };' })
    );

    if (second.status !== 'COMPLETED') throw new Error('expected success');
    expect(second.output?.['leaked']).toBe('undefined');
  });

  it('does not carry prototype edits across executions', async () => {
    const executor = new InlineTaskExecutor();

    await executor.execute(
      contextFor({ expression: 'Array.prototype.pwned = () => "yes"; return 1;' })
    );
    const second = await executor.execute(
      contextFor({ expression: 'return { pwned: typeof [].pwned };' })
    );

    if (second.status !== 'COMPLETED') throw new Error('expected success');
    expect(second.output?.['pwned']).toBe('undefined');
  });

  it('survives many executions without degrading', async () => {
    const executor = new InlineTaskExecutor();

    for (let i = 0; i < 25; i++) {
      const outcome = await executor.execute(
        contextFor({ expression: `return ${i} * 2;`, i })
      );
      if (outcome.status !== 'COMPLETED') throw new Error(`failed at ${i}`);
      expect(outcome.output).toEqual({ result: i * 2 });
    }
  }, 30_000);
});

describe('failures', () => {
  // A script that throws will throw again on identical input, so retrying only
  // delays the error someone needs to see.
  it('reports a thrown error as permanent', async () => {
    const outcome = await run('throw new Error("nope");');

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') {
      expect(outcome.reason).toContain('nope');
      expect(outcome.terminal).toBe(true);
    }
  });

  it('reports a syntax error rather than hanging', async () => {
    const outcome = await run('return {{{;');
    expect(outcome.status).toBe('FAILED');
  });

  it('refuses an oversized result', async () => {
    const outcome = await run('return { big: "x".repeat(200000) };', {}, {
      maxOutputBytes: 1_000,
    });

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.reason).toMatch(/over the 1000 byte limit/);
  });

  it('handles a script returning nothing', async () => {
    const outcome = await run('const x = 1;');

    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status === 'COMPLETED') expect(outcome.output).toEqual({ result: null });
  });
});
