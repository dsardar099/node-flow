import { Samples, round, type Percentiles } from './stats.js';
import type { BenchmarkProfile } from './profiles.js';

/**
 * The load harness.
 *
 * It drives a **running** node-flow over its public API — no in-process
 * shortcuts, no direct SQL on the hot path — because a number produced by
 * bypassing the API is not a number anyone can reproduce with a worker fleet.
 * Everything here is what a real client can do.
 *
 * Two pacing modes, and the difference matters more than it looks:
 *
 *  - **Closed loop** (`concurrency`): N runs in flight, a new one started as
 *    each finishes. This is what most harnesses do, and it *cannot* show
 *    overload: when the system slows down, the load slows with it, and the
 *    report says latency is fine because the harness stopped asking.
 *  - **Open loop** (`ratePerSecond`): starts arrive on a schedule regardless of
 *    whether the previous ones finished. This is what production looks like,
 *    and it is the only mode where queue depth and admission control mean
 *    anything. Coordinated omission is tracked explicitly: when a start is
 *    issued late, the lateness is reported rather than folded into latency.
 *
 * The metric worth reading is **step turnaround** — the gap between completing
 * one task and leasing the next task of the same run. That interval is
 * entirely node-flow: evaluate, schedule, enqueue, deliver. Workflow latency
 * includes the simulated work and the harness's own scheduling; turnaround
 * does not.
 */

export interface LeasedBenchTask {
  taskId: string;
  workflowId: string;
  leaseToken: string;
  input: Record<string, unknown>;
}

/** The slice of the client the harness uses. `NodeFlowClient` satisfies it. */
export interface BenchClient {
  registerWorkflow(definition: unknown): Promise<{ name: string; version: number }>;
  startWorkflow(options: {
    name: string;
    input?: Record<string, never> | Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<{ workflowId: string; status: string }>;
  lease(options: {
    queue: string;
    workerId: string;
    count?: number;
    waitSeconds?: number;
    leaseSeconds?: number;
    signal?: AbortSignal;
  }): Promise<LeasedBenchTask[]>;
  report(options: {
    taskId: string;
    queueName: string;
    workflowId: string;
    leaseToken: string;
    status: 'COMPLETED' | 'FAILED' | 'FAILED_WITH_TERMINAL_ERROR';
    output?: Record<string, unknown>;
  }): Promise<void>;
}

/** An optional probe for what only the database can answer. */
export interface Probe {
  (): Promise<{ queueDepth?: number; walBytes?: number }>;
}

export interface BenchmarkOptions {
  client: BenchClient;
  profile: BenchmarkProfile;
  /** How many runs to start in total. */
  workflows: number;
  /** Closed loop: runs kept in flight. Mutually exclusive with `ratePerSecond`. */
  concurrency?: number;
  /** Open loop: runs started per second, regardless of completions. */
  ratePerSecond?: number;
  /** Worker loops. Each leases, "works", and reports. */
  workers: number;
  /** Tasks leased per request. Larger batches trade latency for throughput. */
  batchSize?: number;
  leaseSeconds?: number;
  /** Long-poll duration. 0 makes workers spin, which measures the harness. */
  waitSeconds?: number;
  /** Simulated work per task. Zero measures node-flow alone. */
  workDurationMs?: number;
  /** How long a worker pauses after an empty lease. Keeps a `waitSeconds: 0` run from spinning. */
  idleSleepMs?: number;
  /** Gives up rather than hanging when the system cannot finish the load. */
  timeoutMs?: number;
  probe?: Probe;
  probeIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface BenchmarkReport {
  profile: string;
  pacing: { mode: 'closed' | 'open'; concurrency?: number; ratePerSecond?: number };
  workers: number;
  durationSeconds: number;
  workflows: { started: number; completed: number; failed: number; unfinished: number };
  tasks: { leased: number; completed: number };
  throughput: { workflowsPerSecond: number; tasksPerSecond: number };
  latency: {
    /** Start accepted → first task leased. Admission and first schedule. */
    firstLeaseMs: Percentiles;
    /** Task completed → next task of the same run leased. The engine's own loop. */
    stepTurnaroundMs: Percentiles;
    /** Start accepted → last task completed. */
    workflowMs: Percentiles;
    /** How late an open-loop start was issued. Non-zero means the harness fell behind. */
    startLagMs: Percentiles;
  };
  queueDepth?: { max: number; samples: number };
  walBytesPerSecond?: number;
  errors: { starts: number; leases: number; reports: number; examples: string[] };
}

const MAX_ERROR_EXAMPLES = 5;

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const batchSize = options.batchSize ?? 1;
  const waitSeconds = options.waitSeconds ?? 1;
  const queue = options.profile.queues[0];

  const firstLeaseMs = new Samples();
  const stepTurnaroundMs = new Samples();
  const workflowMs = new Samples();
  const startLagMs = new Samples();

  /** Per-run timing, dropped as each run finishes so memory stays flat. */
  const runs = new Map<string, { startedAt: number; lastCompletedAt?: number; tasksDone: number }>();

  const counters = { started: 0, completed: 0, failed: 0, leased: 0, tasksCompleted: 0 };
  const errors = { starts: 0, leases: 0, reports: 0, examples: [] as string[] };
  const noteError = (kind: 'starts' | 'leases' | 'reports', error: unknown) => {
    errors[kind] += 1;
    if (errors.examples.length < MAX_ERROR_EXAMPLES) errors.examples.push(`${kind}: ${(error as Error).message}`);
  };

  await options.client.registerWorkflow(options.profile.definition);

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });

  const startedAt = now();
  const deadline = options.timeoutMs === undefined ? Number.POSITIVE_INFINITY : startedAt + options.timeoutMs;

  // ---------------------------------------------------------------- workers

  const workerLoop = async (workerId: string): Promise<void> => {
    while (!controller.signal.aborted) {
      let leased: LeasedBenchTask[];
      try {
        leased = await options.client.lease({
          queue,
          workerId,
          count: batchSize,
          waitSeconds,
          ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        noteError('leases', error);
        await sleep(50);
        continue;
      }

      if (leased.length === 0) {
        // A courtesy yield, and not only politeness: with `waitSeconds: 0` a
        // worker that loops on an immediately-resolved lease never returns to
        // the event loop, so timers — including this harness's own pacing —
        // never fire. Against a real server it would also be a hot spin that
        // measures the client rather than the engine.
        await sleep(options.idleSleepMs ?? 1);
        continue;
      }

      const at = now();
      counters.leased += leased.length;

      for (const task of leased) {
        const run = runs.get(task.workflowId);
        if (run) {
          // Two different intervals, and conflating them is the usual mistake:
          // the first lease includes starting the run, every later one is pure
          // engine turnaround.
          if (run.lastCompletedAt === undefined) firstLeaseMs.record(at - run.startedAt);
          else stepTurnaroundMs.record(at - run.lastCompletedAt);
        }
      }

      if (options.workDurationMs) await sleep(options.workDurationMs);

      for (const task of leased) {
        try {
          await options.client.report({
            taskId: task.taskId,
            queueName: queue,
            workflowId: task.workflowId,
            leaseToken: task.leaseToken,
            status: 'COMPLETED',
            output: { ok: true },
          });
        } catch (error) {
          noteError('reports', error);
          continue;
        }

        const completedAt = now();
        counters.tasksCompleted += 1;

        const run = runs.get(task.workflowId);
        if (!run) continue;
        run.lastCompletedAt = completedAt;
        run.tasksDone += 1;

        if (task.input['step'] === options.profile.lastStep) {
          workflowMs.record(completedAt - run.startedAt);
          counters.completed += 1;
          // Dropped here rather than kept for a final tally: a million-run
          // benchmark must not hold a million entries to report an average.
          runs.delete(task.workflowId);
        }
      }
    }
  };

  // ----------------------------------------------------------------- starts

  const startOne = async (index: number): Promise<void> => {
    try {
      const at = now();
      const started = await options.client.startWorkflow({
        name: options.profile.definition['name'] as string,
        input: { run: index },
      });
      counters.started += 1;
      runs.set(started.workflowId, { startedAt: at, tasksDone: 0 });
    } catch (error) {
      noteError('starts', error);
    }
  };

  const openLoop = async (): Promise<void> => {
    const interval = 1000 / (options.ratePerSecond as number);
    const inFlight: Promise<void>[] = [];

    for (let index = 0; index < options.workflows && !controller.signal.aborted; index++) {
      const due = startedAt + index * interval;
      const wait = due - now();
      if (wait > 0) await sleep(wait);
      // Recorded rather than smoothed away: a harness that cannot keep up is
      // measuring itself, and the report has to say so.
      else startLagMs.record(-wait);

      inFlight.push(startOne(index));
      // Bounded so a stalled server cannot make the harness accumulate
      // unbounded promises and fall over before the system under test does.
      if (inFlight.length >= 1000) {
        await Promise.all(inFlight.splice(0, inFlight.length));
      }
    }

    await Promise.all(inFlight);
  };

  const closedLoop = async (): Promise<void> => {
    const concurrency = Math.max(options.concurrency ?? 1, 1);
    let next = 0;

    const runner = async (): Promise<void> => {
      while (next < options.workflows && !controller.signal.aborted) {
        const index = next++;
        await startOne(index);
        // Waits for the run to finish before starting another, which is what
        // "closed loop" means: the load follows the system's own pace.
        //
        // The deadline is part of the condition, not a separate watchdog: a
        // system that has stopped completing anything would otherwise hold this
        // loop forever, and a benchmark that hangs reports nothing at all —
        // strictly worse than one that reports a run it could not finish.
        while (
          !controller.signal.aborted &&
          now() < deadline &&
          counters.completed + counters.failed <= index - concurrency
        ) {
          await sleep(1);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runner()));
  };

  // ------------------------------------------------------------------ probe

  let queueDepthMax = 0;
  let queueDepthSamples = 0;
  let walFirst: number | undefined;
  let walLast: number | undefined;

  const probeLoop = async (): Promise<void> => {
    const interval = options.probeIntervalMs ?? 1000;
    while (!controller.signal.aborted) {
      try {
        const sample = await (options.probe as Probe)();
        if (sample.queueDepth !== undefined) {
          queueDepthMax = Math.max(queueDepthMax, sample.queueDepth);
          queueDepthSamples += 1;
        }
        if (sample.walBytes !== undefined) {
          walFirst ??= sample.walBytes;
          walLast = sample.walBytes;
        }
      } catch {
        // A probe is instrumentation. Losing it must not fail a benchmark that
        // is otherwise producing good numbers.
      }
      await sleep(interval);
    }
  };

  const workers = Array.from({ length: options.workers }, (_, index) => workerLoop(`bench-${index}`));
  const probing = options.probe ? probeLoop() : undefined;

  await (options.ratePerSecond ? openLoop() : closedLoop());

  // Starting is done; wait for the work to drain.
  while (
    counters.completed + counters.failed < counters.started &&
    now() < deadline &&
    !controller.signal.aborted
  ) {
    await sleep(5);
  }

  controller.abort();
  options.signal?.removeEventListener('abort', abort);
  await Promise.all(workers);
  await probing;

  const durationSeconds = Math.max((now() - startedAt) / 1000, 0.001);

  return {
    profile: options.profile.name,
    pacing: options.ratePerSecond
      ? { mode: 'open', ratePerSecond: options.ratePerSecond }
      : { mode: 'closed', concurrency: options.concurrency ?? 1 },
    workers: options.workers,
    durationSeconds: round(durationSeconds),
    workflows: {
      started: counters.started,
      completed: counters.completed,
      failed: counters.failed,
      unfinished: counters.started - counters.completed - counters.failed,
    },
    tasks: { leased: counters.leased, completed: counters.tasksCompleted },
    throughput: {
      workflowsPerSecond: round(counters.completed / durationSeconds),
      tasksPerSecond: round(counters.tasksCompleted / durationSeconds),
    },
    latency: {
      firstLeaseMs: firstLeaseMs.percentiles(),
      stepTurnaroundMs: stepTurnaroundMs.percentiles(),
      workflowMs: workflowMs.percentiles(),
      startLagMs: startLagMs.percentiles(),
    },
    ...(queueDepthSamples > 0 ? { queueDepth: { max: queueDepthMax, samples: queueDepthSamples } } : {}),
    ...(walFirst !== undefined && walLast !== undefined
      ? { walBytesPerSecond: round((walLast - walFirst) / durationSeconds) }
      : {}),
    errors,
  };
}
