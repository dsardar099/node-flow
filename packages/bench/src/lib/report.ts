import type { BenchmarkReport } from './harness.js';
import type { Percentiles } from './stats.js';

/**
 * The report, printed for a person.
 *
 * Deliberately shows the counts next to the rates. A throughput figure without
 * "how many finished, how many did not" is how benchmarks end up quoting the
 * speed of a system that dropped half the load.
 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  const pacing =
    report.pacing.mode === 'open'
      ? `open loop at ${report.pacing.ratePerSecond}/s`
      : `closed loop, ${report.pacing.concurrency} in flight`;

  lines.push(`profile           ${report.profile}  (${pacing}, ${report.workers} workers)`);
  lines.push(`duration          ${report.durationSeconds}s`);
  lines.push(
    `workflows         ${report.workflows.completed} completed, ${report.workflows.failed} failed, ${report.workflows.unfinished} unfinished (of ${report.workflows.started} started)`
  );
  lines.push(`tasks             ${report.tasks.completed} completed`);
  lines.push(
    `throughput        ${report.throughput.workflowsPerSecond} workflows/s, ${report.throughput.tasksPerSecond} tasks/s`
  );
  lines.push('');
  lines.push('latency (ms)      p50      p90      p95      p99      max');
  lines.push(row('first lease', report.latency.firstLeaseMs));
  lines.push(row('step turnaround', report.latency.stepTurnaroundMs));
  lines.push(row('workflow', report.latency.workflowMs));
  if (report.latency.startLagMs.count > 0) lines.push(row('start lag', report.latency.startLagMs));

  if (report.queueDepth) lines.push(`\nqueue depth       max ${report.queueDepth.max} over ${report.queueDepth.samples} samples`);
  if (report.walBytesPerSecond !== undefined) {
    lines.push(`WAL               ${(report.walBytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`);
  }

  const total = report.errors.starts + report.errors.leases + report.errors.reports;
  if (total > 0) {
    lines.push(
      `\nerrors            ${report.errors.starts} starts, ${report.errors.leases} leases, ${report.errors.reports} reports`
    );
    for (const example of report.errors.examples) lines.push(`                  ${example}`);
  }

  // Unfinished runs invalidate the throughput number rather than reducing it,
  // so it is said plainly instead of left for the reader to notice.
  if (report.workflows.unfinished > 0) {
    lines.push(
      `\nNOTE: ${report.workflows.unfinished} runs never finished — this run hit a limit or a timeout, and the rates above are not a sustained figure.`
    );
  }

  return lines.join('\n');
}

function row(label: string, p: Percentiles): string {
  const cells = [p.p50, p.p90, p.p95, p.p99, p.max].map((value) => value.toFixed(1).padStart(8));
  return `${label.padEnd(18)}${cells.join(' ')}`;
}
