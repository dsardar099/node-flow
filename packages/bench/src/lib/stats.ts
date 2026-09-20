/**
 * Latency, recorded so the tail is visible.
 *
 * Averages hide everything worth knowing about an orchestrator: a mean task
 * latency of 12 ms is compatible with one run in a hundred taking four
 * seconds, and it is that run people file bugs about. Every sample is kept and
 * percentiles are computed exactly — a benchmark run holds tens of thousands of
 * samples, not billions, so an approximate histogram would trade the only
 * property that matters here for memory nobody is short of.
 */

export interface Percentiles {
  count: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export class Samples {
  private readonly values: number[] = [];

  record(value: number): void {
    this.values.push(value);
  }

  get count(): number {
    return this.values.length;
  }

  percentiles(): Percentiles {
    if (this.values.length === 0) {
      return { count: 0, min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0 };
    }

    const sorted = [...this.values].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);

    return {
      count: sorted.length,
      min: sorted[0],
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: sorted[sorted.length - 1],
      mean: round(sum / sorted.length),
    };
  }
}

/**
 * The nearest-rank percentile.
 *
 * Chosen over interpolation because an interpolated p99 reports a latency that
 * no request actually had, and the first question asked of a bad percentile is
 * always "which request was that?".
 */
export function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
