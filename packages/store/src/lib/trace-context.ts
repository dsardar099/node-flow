import { context, propagation, trace } from '@opentelemetry/api';

/**
 * W3C trace context, carried across the gap a workflow opens.
 *
 * Every other hop in a traced system is synchronous: a request calls a service,
 * which calls a database, and the context lives in memory for the whole chain.
 * A workflow breaks that. The request that starts a run returns in
 * milliseconds; the work happens later, in another process, sometimes days
 * afterwards, and often on a machine that did not exist when the run began.
 * Nothing in memory bridges that, so the context is written down with the
 * execution and handed back out when a worker leases a task.
 *
 * The result is the property the plan promises: **one trace spans the API call,
 * the engine, the worker and whatever the worker calls next** — which is the
 * difference between "the workflow was slow" and "the third task's HTTP call to
 * billing took nine seconds".
 *
 * These functions are no-ops when OpenTelemetry is not configured. `@opentelemetry/api`
 * with no SDK registered returns an invalid span and an empty carrier, so an
 * install with tracing switched off pays two function calls and stores a null.
 */

/** The active span as a `traceparent`, or undefined when nothing is being traced. */
export function currentTraceparent(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;

  const { traceId, spanId, traceFlags } = span.spanContext();
  // An all-zero id is what the API hands back when no SDK is registered.
  if (!traceId || traceId === '00000000000000000000000000000000') return undefined;

  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  // Prefer the propagator's own output — it knows the version prefix and any
  // vendor state — and fall back to composing the header only if it declined.
  return carrier['traceparent'] ?? `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;
}

/**
 * Runs `work` as a child of a stored `traceparent`.
 *
 * Used by the decider and the system-task runner so their spans hang off the
 * run that caused them rather than floating unattached. A missing or malformed
 * header simply runs the work untraced: a broken trace must never stop a
 * workflow, which is the whole reason this is instrumentation and not a
 * dependency.
 */
export function withTraceparent<T>(traceparent: string | null | undefined, work: () => T): T {
  if (!traceparent) return work();

  try {
    const parent = propagation.extract(context.active(), { traceparent });
    return context.with(parent, work);
  } catch {
    return work();
  }
}
