import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { JqTaskExecutor } from './jq.executor.js';
import { JqRunner } from './jq.runner.js';

/**
 * `JSON_JQ_TRANSFORM`.
 *
 * The block that matters is "a program that never returns": jq cannot be
 * interrupted, so if the thread isolation is ever removed these tests stop
 * failing and start hanging the suite — which is exactly what they would do to
 * the server.
 */

const context = (input: Record<string, JsonValue>, signal?: AbortSignal): TaskContext => ({
  taskId: 'task-1',
  workflowId: 'wf-1',
  namespaceId: 'ns-1',
  input,
  signal: signal ?? new AbortController().signal,
  state: {},
  heartbeat: async () => undefined,
});

const run = (input: Record<string, JsonValue>, options = {}) =>
  new JqTaskExecutor(options).execute(context(input));

describe('transforming', () => {
  it('has the declared type', () => {
    expect(new JqTaskExecutor().type).toBe(TaskType.JSON_JQ_TRANSFORM);
  });

  it('reshapes the input document', async () => {
    const outcome = await run({
      queryExpression: '{ total: (.items | map(.price) | add), count: (.items | length) }',
      items: [{ price: 3 }, { price: 4 }],
    });

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['result']).toEqual({ total: 7, count: 2 });
  });

  // The program is not data. Leaving it in the document means `keys` reports a
  // field the author never supplied.
  it('excludes the program from the document it runs against', async () => {
    const outcome = await run({ queryExpression: 'keys', a: 1, b: 2 });
    expect(outcome.output?.['result']).toEqual(['a', 'b']);
  });

  // jq is a stream language; taking only the first value silently discards the
  // rest of a perfectly valid program's output.
  it('reports every value a program yields', async () => {
    const outcome = await run({ queryExpression: '.items[]', items: [1, 2, 3] });

    expect(outcome.output?.['resultList']).toEqual([1, 2, 3]);
    expect(outcome.output?.['result']).toBe(1);
  });

  it('reports an empty stream as null rather than failing', async () => {
    const outcome = await run({ queryExpression: '.items[] | select(. > 99)', items: [1] });

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['result']).toBeNull();
    expect(outcome.output?.['resultList']).toEqual([]);
  });

  it('accepts the "expression" spelling too', async () => {
    const outcome = await run({ expression: '.a', a: 'here' });
    expect(outcome.output?.['result']).toBe('here');
  });

  it('fails terminally with no program', async () => {
    const outcome = await run({ a: 1 });
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });
});

describe('failing', () => {
  // A program that cannot compile will never compile, so burning a retry budget
  // on it only delays the error someone has to read.
  it('treats a program that cannot compile as terminal', async () => {
    const outcome = await run({ queryExpression: '.[' });

    expect(outcome.status).toBe('FAILED');
    expect(outcome).toMatchObject({ terminal: true });
  });

  // A type error is about the data, and the next attempt may carry different
  // data, so it is not permanent in the way a syntax error is.
  it('treats a runtime error as retryable', async () => {
    const outcome = await run({ queryExpression: '.a | keys', a: 1 });

    expect(outcome.status).toBe('FAILED');
    expect(outcome).toMatchObject({ terminal: false });
  });

  it('bounds output that would be stored and passed on', async () => {
    const outcome = await run(
      { queryExpression: '[range(100000)]' },
      { maxOutputBytes: 1000 }
    );

    expect(outcome.status).toBe('FAILED');
    expect(outcome).toMatchObject({ terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('exceeds');
  });
});

describe('a program that never returns', () => {
  /**
   * The reason this task runs in a thread at all.
   *
   * jq-wasm is synchronous and jq has no interrupt hook, so nothing outside can
   * ask this program to stop. Measured before the design was chosen: it ignores
   * every deadline and survives until the thread is killed.
   *
   * If this test ever hangs instead of failing, the isolation is gone — and so
   * is the server's ability to survive a bad jq program.
   */
  it('is killed at its budget instead of running forever', async () => {
    const started = Date.now();
    const outcome = await run({ queryExpression: 'def f: f; f' }, { timeoutMs: 1500 });
    const elapsed = Date.now() - started;

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('budget');
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  // A killed thread must not take the executor with it: the next task has to
  // run normally, the same property the INLINE sandbox needed.
  it('leaves the executor usable afterwards', async () => {
    const executor = new JqTaskExecutor({ timeoutMs: 1500 });

    await executor.execute(context({ queryExpression: 'def f: f; f' }));
    const outcome = await executor.execute(context({ queryExpression: '.a', a: 'fine' }));

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['result']).toBe('fine');
  }, 30_000);

  // Shutdown must not wait for the slowest jq program in flight.
  it('abandons the program when its context is cancelled', async () => {
    const controller = new AbortController();
    const executor = new JqTaskExecutor({ timeoutMs: 60_000 });

    const pending = executor.execute(
      context({ queryExpression: 'def f: f; f' }, controller.signal)
    );
    setTimeout(() => controller.abort(), 250);

    const started = Date.now();
    const outcome = await pending;

    expect(outcome.status).toBe('FAILED');
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);
});

describe('the runner directly', () => {
  it('runs concurrent programs without interference', async () => {
    const runner = new JqRunner();

    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => runner.run({ n }, '.n * 10'))
    );

    expect(results.map((r) => (r.ok ? r.values[0] : r.reason))).toEqual([10, 20, 30, 40]);
  }, 30_000);
});
