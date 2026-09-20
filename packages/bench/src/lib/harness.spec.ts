import { describe, expect, it } from 'vitest';
import { runBenchmark, type BenchClient, type LeasedBenchTask } from './harness.js';
import { profileFor } from './profiles.js';
import { formatReport } from './report.js';
import { quantile, Samples } from './stats.js';

/**
 * The harness, measured against an engine whose behaviour is known exactly.
 *
 * A load harness that is wrong reports numbers that look plausible and are
 * not, which is worse than having none — so the thing being measured here is a
 * toy engine with hand-set delays, and the test asserts the report reproduces
 * them. If the harness cannot recover a 30 ms turnaround it was told about, it
 * cannot be trusted to report one it was not.
 */

/** A chain engine in a few lines: start queues step 0, each completion queues the next. */
class FakeEngine implements BenchClient {
  readonly queue: { task: LeasedBenchTask; visibleAt: number }[] = [];
  private nextId = 0;
  private readonly runs = new Map<string, number>();
  started = 0;

  constructor(
    private readonly steps: number,
    private readonly options: { scheduleDelayMs?: number; failEveryNthStart?: number } = {},
    private readonly clock: () => number = () => Date.now()
  ) {}

  async registerWorkflow(): Promise<{ name: string; version: number }> {
    return { name: 'bench', version: 1 };
  }

  async startWorkflow(): Promise<{ workflowId: string; status: string }> {
    this.started += 1;
    if (this.options.failEveryNthStart && this.started % this.options.failEveryNthStart === 0) {
      throw new Error('quota exceeded');
    }
    const workflowId = `wf-${this.nextId++}`;
    this.runs.set(workflowId, 0);
    this.enqueue(workflowId, 0);
    return { workflowId, status: 'RUNNING' };
  }

  async lease(options: { count?: number }): Promise<LeasedBenchTask[]> {
    const now = this.clock();
    const ready: LeasedBenchTask[] = [];
    for (let index = 0; index < this.queue.length && ready.length < (options.count ?? 1); index++) {
      if (this.queue[index].visibleAt > now) continue;
      ready.push(this.queue.splice(index--, 1)[0].task);
    }
    return ready;
  }

  async report(options: { workflowId: string }): Promise<void> {
    const step = (this.runs.get(options.workflowId) ?? 0) + 1;
    this.runs.set(options.workflowId, step);
    if (step < this.steps) this.enqueue(options.workflowId, step);
  }

  private enqueue(workflowId: string, step: number): void {
    this.queue.push({
      task: { taskId: `t-${this.nextId++}`, workflowId, leaseToken: 'lease', input: { step } },
      visibleAt: this.clock() + (this.options.scheduleDelayMs ?? 0),
    });
  }
}

const profile = (steps: number) =>
  profileFor('chain', { steps, workflowName: 'bench', queue: 'bench_task' });

describe('the load harness', () => {
  it('drives every run to completion and reports the delay the engine actually had', async () => {
    const engine = new FakeEngine(3, { scheduleDelayMs: 20 });

    const report = await runBenchmark({
      client: engine,
      profile: profile(3),
      workflows: 12,
      concurrency: 4,
      workers: 4,
      waitSeconds: 0,
      timeoutMs: 20_000,
    });

    expect(report.workflows).toMatchObject({ started: 12, completed: 12, failed: 0, unfinished: 0 });
    expect(report.tasks.completed).toBe(36);

    // The engine delays each schedule by 20 ms, so the interval between
    // completing one task and leasing the next must show it. This is the number
    // the whole harness exists to produce.
    expect(report.latency.stepTurnaroundMs.count).toBe(24);
    expect(report.latency.stepTurnaroundMs.p50).toBeGreaterThanOrEqual(19);
    expect(report.latency.stepTurnaroundMs.p50).toBeLessThan(120);

    // A run of three steps waits three schedules, so it cannot be quicker.
    expect(report.latency.workflowMs.p50).toBeGreaterThanOrEqual(58);
    expect(report.throughput.workflowsPerSecond).toBeGreaterThan(0);
  });

  it('counts refused starts as errors rather than silently shrinking the load', async () => {
    const engine = new FakeEngine(1, { failEveryNthStart: 3 });

    const report = await runBenchmark({
      client: engine,
      profile: profile(1),
      workflows: 9,
      concurrency: 3,
      workers: 2,
      waitSeconds: 0,
      timeoutMs: 20_000,
    });

    // Three of nine were refused: started counts what the server accepted, and
    // the refusals are visible instead of making throughput look better.
    expect(report.workflows.started).toBe(6);
    expect(report.workflows.completed).toBe(6);
    expect(report.errors.starts).toBe(3);
    expect(report.errors.examples[0]).toMatch(/starts: quota exceeded/);
    expect(formatReport(report)).toMatch(/errors {12}3 starts/);
  });

  it('paces an open loop by the clock, and says so when it cannot keep up', async () => {
    const engine = new FakeEngine(1);
    const report = await runBenchmark({
      client: engine,
      profile: profile(1),
      workflows: 10,
      ratePerSecond: 200, // 5 ms apart
      workers: 2,
      waitSeconds: 0,
      timeoutMs: 20_000,
    });

    expect(report.pacing).toEqual({ mode: 'open', ratePerSecond: 200 });
    expect(report.workflows.completed).toBe(10);
    // Ten starts 5 ms apart cannot finish sooner than the schedule allows.
    expect(report.durationSeconds).toBeGreaterThanOrEqual(0.04);
  });

  it('reports an unfinished run rather than a flattering rate', async () => {
    // A worker-less run: nothing can complete, and the harness must say that
    // instead of dividing zero completions by the elapsed time and moving on.
    const engine = new FakeEngine(1);
    const report = await runBenchmark({
      client: engine,
      profile: profile(1),
      workflows: 3,
      concurrency: 3,
      workers: 0,
      waitSeconds: 0,
      timeoutMs: 200,
    });

    expect(report.workflows).toMatchObject({ started: 3, completed: 0, unfinished: 3 });
    expect(formatReport(report)).toMatch(/3 runs never finished/);
  });

  it('samples the probe and folds it into the report', async () => {
    const engine = new FakeEngine(2, { scheduleDelayMs: 5 });
    let walBytes = 1_000_000;

    const report = await runBenchmark({
      client: engine,
      profile: profile(2),
      workflows: 6,
      concurrency: 3,
      workers: 2,
      waitSeconds: 0,
      timeoutMs: 20_000,
      probeIntervalMs: 5,
      probe: async () => {
        walBytes += 10_000;
        return { queueDepth: engine.queue.length, walBytes };
      },
    });

    expect(report.queueDepth?.samples).toBeGreaterThan(0);
    expect(report.walBytesPerSecond).toBeGreaterThan(0);
    expect(formatReport(report)).toMatch(/WAL {15}\d+\.\d+ MB\/s/);
  });
});

describe('percentiles', () => {
  it('reports a value that actually occurred, at the nearest rank', () => {
    const samples = new Samples();
    for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]) samples.record(value);

    const p = samples.percentiles();
    expect(p).toMatchObject({ count: 10, min: 1, p50: 5, p90: 9, p99: 100, max: 100, mean: 14.5 });
    // Not 9.1 or 54.5: an interpolated percentile names a latency no request had.
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3);
    expect(quantile([], 0.5)).toBe(0);
  });
});
