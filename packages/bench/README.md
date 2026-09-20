# @node-flow-dev/bench

The load harness. It drives a **running** node-flow over the ordinary `/v1` API — no in-process shortcuts and no privileged SQL on the hot path — so every number it prints is one a user with an API key can reproduce.

```bash
nf-bench --url http://localhost:3000 --namespace default --api-key nf_… \
  --profile chain --steps 5 --workflows 500 --concurrency 20 --workers 8
```

## What it measures

```
latency (ms)      p50      p90      p95      p99      max
first lease          95.0    121.0    138.0    143.0    143.0
step turnaround      67.0     80.0     82.0     92.0     95.0
workflow            273.0    314.0    323.0    343.0    343.0
```

- **step turnaround** — completing one task to leasing the next task of the same run. This interval is entirely node-flow: evaluate, schedule, enqueue, deliver. It is the number to watch.
- **first lease** — accepting a start to leasing its first task: admission plus the first schedule.
- **workflow** — start to last task complete. Includes whatever the worker does, so `--work-ms 0` is what isolates the engine.
- **start lag** — how late an open-loop start was issued. Non-zero means the harness itself fell behind, and the run is measuring the harness.

Percentiles are exact and nearest-rank: a reported p99 is a latency some run actually had, not an interpolation between two that did not.

## Profiles

- `chain` — *K* tasks in sequence. Every step is a full engine round trip, so this measures turnaround.
- `fanout` — a `FORK_JOIN` of *K* branches, a `JOIN`, and a tail task. One evaluation schedules *K* tasks and the join re-evaluates on each completion, so this measures the decider under width.

Both use `SIMPLE` tasks. A benchmark of `INLINE` would mostly measure QuickJS, and one of `HTTP` would mostly measure whatever it called.

## Pacing

- `--concurrency N` (closed loop) keeps N runs in flight. Note that a closed loop **cannot show overload**: when the system slows down the harness asks for less, and latency looks fine because nobody is waiting.
- `--rate N` (open loop) starts runs on a schedule regardless of completions. This is what production looks like, and the only mode where queue depth means anything.

## The optional probe

`--database-url` opens one read-only connection and samples what the API cannot answer: queue depth straight from `TaskQueues`, and the WAL rate — the wall a Postgres-backed queue hits before it hits lock contention. Losing the probe never fails a run; it is instrumentation, not the measurement.

## Exit code

`0` only when every run finished. A benchmark that could not drain its load is a failed measurement, not a slow one, so CI must not record it as a passing regression check.

## Using it as a library

`runBenchmark` takes any client with `registerWorkflow`, `startWorkflow`, `lease` and `report` — `NodeFlowClient` satisfies it structurally — which is also how the harness is tested against an engine whose timings are known exactly.
