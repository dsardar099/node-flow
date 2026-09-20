import { describe, expect, it } from 'vitest';
import { BackgroundRunner, RunnerHost } from './background-runner.js';
import {
  ALL_ROLES,
  mapWithConcurrency,
  parseRoles,
  runnersForRoles,
  type EngineRunnerComponents,
} from './engine-runners.js';

/**
 * The loops that drive every sweeper.
 *
 * These are the failures worth testing, all of them silent: a loop that stops
 * after one exception, two passes of the same job running at once, a shutdown
 * that returns while work is still in flight, and a backlog that drains one
 * batch per interval instead of continuously.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a condition rather than for a fixed duration. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await sleep(5);
  }
}

describe('BackgroundRunner', () => {
  it('runs repeatedly until stopped', async () => {
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'tick',
      intervalMs: 5,
      jitter: 0,
      run: async () => {
        passes++;
        return 0;
      },
    });

    runner.start();
    await until(() => passes >= 3);
    await runner.stop();

    const settled = passes;
    await sleep(40);
    expect(passes).toBe(settled);
  });

  // A loop that dies on its first exception takes the job out of service for
  // the lifetime of the process, and nothing reports it.
  it('keeps running after a pass throws', async () => {
    let passes = 0;
    const errors: unknown[] = [];
    const runner = new BackgroundRunner({
      name: 'flaky',
      intervalMs: 5,
      jitter: 0,
      onError: (error) => errors.push(error),
      run: async () => {
        passes++;
        if (passes <= 2) throw new Error('boom');
        return 0;
      },
    });

    runner.start();
    await until(() => passes >= 4);
    await runner.stop();

    expect(errors).toHaveLength(2);
    expect(runner.stats().errors).toBe(2);
  });

  // Two relays publishing the same batch, or two sweepers reclaiming the same
  // lease, turns a slow database into a correctness problem.
  it('never overlaps passes of the same job', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const runner = new BackgroundRunner({
      name: 'slow',
      intervalMs: 1,
      jitter: 0,
      run: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent--;
        return 0;
      },
    });

    runner.start();
    await sleep(120);
    await runner.stop();

    expect(maxConcurrent).toBe(1);
  });

  it('waits for the in-flight pass before stop resolves', async () => {
    let finished = false;
    const runner = new BackgroundRunner({
      name: 'graceful',
      intervalMs: 5,
      jitter: 0,
      run: async () => {
        await sleep(50);
        finished = true;
        return 0;
      },
    });

    runner.start();
    await until(() => runner.stats().passes === 0 && !finished);
    await sleep(10); // Let the pass actually begin.
    await runner.stop();

    expect(finished).toBe(true);
  });

  // After an outage there may be thousands of due timers. Sleeping a full
  // interval between fixed-size batches would take hours to drain seconds
  // of work.
  it('runs again immediately after a full batch', async () => {
    // 22 items in batches of 5: four full passes that drain eagerly, then a
    // partial fifth that goes back to waiting. Exactly five, no trailing pass.
    let remaining = 22;
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'backlog',
      intervalMs: 10_000, // Long enough that a second pass proves eager draining.
      jitter: 0,
      drainThreshold: 5,
      run: async () => {
        passes++;
        const handled = Math.min(5, remaining);
        remaining -= handled;
        return handled;
      },
    });

    runner.start();
    await until(() => remaining === 0);
    await runner.stop();

    expect(passes).toBe(5);
  });

  it('waits the interval when the batch was not full', async () => {
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'quiet',
      intervalMs: 10_000,
      jitter: 0,
      drainThreshold: 5,
      run: async () => {
        passes++;
        return 1;
      },
    });

    runner.start();
    await until(() => passes === 1);
    await sleep(60);
    await runner.stop();

    expect(passes).toBe(1);
  });

  // Replicas started by one rollout otherwise sweep in lockstep forever,
  // turning steady load into a periodic spike on already-contended rows.
  it('spreads intervals with jitter', async () => {
    const delays = new Set<number>();

    for (let i = 0; i < 20; i++) {
      const runner = new BackgroundRunner({
        name: 'jittered',
        intervalMs: 1000,
        jitter: 0.5,
        run: async () => 0,
      });

      runner.start();
      await until(() => (runner.stats().nextDelayMs ?? 0) > 0);
      delays.add(runner.stats().nextDelayMs as number);
      await runner.stop();
    }

    expect(delays.size).toBeGreaterThan(1);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(1500);
    }
  });

  it('uses the exact interval when jitter is disabled', async () => {
    const runner = new BackgroundRunner({
      name: 'exact',
      intervalMs: 1000,
      jitter: 0,
      run: async () => 0,
    });

    runner.start();
    await until(() => (runner.stats().nextDelayMs ?? 0) > 0);
    await runner.stop();

    expect(runner.stats().nextDelayMs).toBe(1000);
  });

  it('reports what it has done', async () => {
    const runner = new BackgroundRunner({
      name: 'counted',
      intervalMs: 5,
      jitter: 0,
      run: async () => 3,
    });

    runner.start();
    await until(() => runner.stats().passes >= 2);
    await runner.stop();

    const stats = runner.stats();
    expect(stats.name).toBe('counted');
    expect(stats.items).toBe(stats.passes * 3);
    expect(stats.running).toBe(false);
  });

  it('ignores a second start', async () => {
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'idempotent',
      intervalMs: 10_000,
      jitter: 0,
      run: async () => {
        passes++;
        return 0;
      },
    });

    runner.start();
    runner.start();
    await until(() => passes >= 1);
    await sleep(30);
    await runner.stop();

    expect(passes).toBe(1);
  });
});

describe('waking a runner', () => {
  /**
   * The interval is there so nothing is missed; it should not also decide how
   * quickly work is noticed. Without this, every step of every workflow waits
   * half an interval before a decider looks at it.
   */
  it('brings the next pass forward instead of waiting out the interval', async () => {
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'decider',
      intervalMs: 10_000,
      jitter: 0,
      run: async () => {
        passes++;
        return 0;
      },
    });

    runner.start();
    await until(() => passes === 1);

    runner.wake();
    // Ten seconds away on the schedule; a few milliseconds away with a wake.
    await until(() => passes === 2, 500);
  });

  /**
   * The lost-wakeup shape, one level down. A notification arriving while a pass
   * is running describes work that pass may already have read past, so dropping
   * it strands that work until the next tick.
   */
  it('honours a wake that arrived while a pass was running', async () => {
    let passes = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));

    const runner = new BackgroundRunner({
      name: 'decider',
      intervalMs: 10_000,
      jitter: 0,
      run: async () => {
        passes++;
        if (passes === 1) await blocked;
        return 0;
      },
    });

    runner.start();
    await until(() => passes === 1);

    runner.wake();
    release();

    await until(() => passes === 2, 500);
    await runner.stop();
  });

  it('ignores a wake for a runner this process does not hold', async () => {
    const host = new RunnerHost([]);
    expect(() => host.wake('decider')).not.toThrow();

    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'decider',
      intervalMs: 10_000,
      jitter: 0,
      run: async () => {
        passes++;
        return 0;
      },
    });
    const withRunner = new RunnerHost([runner]);
    withRunner.start();
    await until(() => passes === 1);

    withRunner.wake('poller');
    await sleep(50);
    expect(passes).toBe(1);

    withRunner.wake('decider');
    await until(() => passes === 2, 500);
    await withRunner.stop();
  });

  it('does nothing once stopped', async () => {
    let passes = 0;
    const runner = new BackgroundRunner({
      name: 'decider',
      intervalMs: 10_000,
      jitter: 0,
      run: async () => {
        passes++;
        return 0;
      },
    });

    runner.start();
    await until(() => passes === 1);
    await runner.stop();

    runner.wake();
    await sleep(50);
    expect(passes).toBe(1);
  });
});

describe('RunnerHost', () => {
  it('stops every runner', async () => {
    const counts = [0, 0, 0];
    const host = new RunnerHost(
      counts.map(
        (_, index) =>
          new BackgroundRunner({
            name: `job-${index}`,
            intervalMs: 5,
            jitter: 0,
            run: async () => {
              counts[index]++;
              return 0;
            },
          })
      )
    );

    host.start();
    await until(() => counts.every((count) => count > 0));
    await host.stop();

    const settled = [...counts];
    await sleep(40);
    expect(counts).toEqual(settled);
    expect(host.stats().every((s) => !s.running)).toBe(true);
  });
});

describe('role selection', () => {
  it('defaults to every role', () => {
    expect(parseRoles(undefined)).toEqual(ALL_ROLES);
    expect(parseRoles('')).toEqual(ALL_ROLES);
  });

  it('parses a list, tolerating spacing and case', () => {
    expect(parseRoles(' Decider , poller ')).toEqual(['decider', 'poller']);
  });

  it('deduplicates', () => {
    expect(parseRoles('poller,poller')).toEqual(['poller']);
  });

  // Falling back to a default would produce a cluster where every workflow
  // starts and none progresses, traced to a typo nobody would look for.
  it('rejects an unknown role rather than ignoring it', () => {
    expect(() => parseRoles('decider,polller')).toThrow(/polller/);
  });

  it('gives the api role no background work', () => {
    const host = runnersForRoles(['api'], components());
    expect(host.stats()).toHaveLength(0);
  });

  it('gives the decider role only the evaluation loop', () => {
    const host = runnersForRoles(['decider'], components());
    expect(host.stats().map((s) => s.name)).toEqual(['decider']);
  });

  it('gives the poller role the time-driven jobs', () => {
    const names = runnersForRoles(['poller'], components())
      .stats()
      .map((s) => s.name);

    expect(names).toContain('timeouts');
    expect(names).toContain('outbox');
    expect(names).toContain('abandoned-leases');
    expect(names).not.toContain('decider');
  });

  it('omits runners whose component was not supplied', () => {
    const names = runnersForRoles(['poller'], components())
      .stats()
      .map((s) => s.name);

    expect(names).not.toContain('payload-gc');
    expect(names).not.toContain('partitions');
  });

  it('includes the optional runners when their components exist', () => {
    const names = runnersForRoles(['poller'], {
      ...components(),
      partitions: { maintain: async () => ({ created: [], dropped: [] }) } as never,
      stuckWorkflows: { sweep: async () => 0 } as never,
      payloadGc: { collect: async () => 0 } as never,
    })
      .stats()
      .map((s) => s.name);

    expect(names).toContain('partitions');
    expect(names).toContain('stuck-workflows');
    expect(names).toContain('payload-gc');
  });

  it('drives the evaluator over the decide queue', async () => {
    const evaluated: string[] = [];
    const host = runnersForRoles(
      ['decider'],
      {
        ...components(),
        decideQueue: {
          peekBatch: async () =>
            evaluated.length === 0
              ? [
                  { workflowId: 'a', namespaceId: 'ns' },
                  { workflowId: 'b', namespaceId: 'ns' },
                ]
              : [],
        } as never,
        evaluator: {
          evaluate: async (id: string) => {
            evaluated.push(id);
            return { evaluated: true, commandCount: 0, noop: false };
          },
        } as never,
      },
      { decide: 5 }
    );

    host.start();
    await until(() => evaluated.length >= 2);
    await host.stop();

    expect(evaluated).toEqual(['a', 'b']);
  });
});

/** Stubs that do nothing; the tests here are about wiring, not behaviour. */
function components(): EngineRunnerComponents {
  return {
    evaluator: { evaluate: async () => ({ evaluated: false, commandCount: 0, noop: true }) },
    decideQueue: { peekBatch: async () => [] },
    timeoutSweeper: { sweep: async () => 0 },
    outboxRelay: { relay: async () => ({ delivered: 0, failed: 0, deadLettered: 0 }) },
    dispatch: { reclaimAbandoned: async () => 0 },
    concurrency: { expireStaleHolders: async () => 0, pruneRateLimitWindows: async () => 0 },
  } as never;
}

describe('bounded concurrency', () => {
  it('runs several at once without exceeding the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(10);
      done.push(item);
      inFlight--;
    });

    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // A swallowed failure here would be a decider that evaluates nothing while
  // reporting healthy passes.
  it('propagates a failure instead of hiding it', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('evaluation failed');
      })
    ).rejects.toThrow('evaluation failed');
  });

  it('falls back to running in order for one item or a limit of one', async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (item) => {
      await sleep(5);
      order.push(item);
    });
    expect(order).toEqual([1, 2, 3]);
  });
});
