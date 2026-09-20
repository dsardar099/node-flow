import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry, started before anything else exists.
 *
 * The ordering is the whole reason this is its own file. Instrumentation works
 * by patching modules as they are required, so the SDK has to start **before**
 * `AppModule`, `pg` or Fastify are imported — start it after and it silently
 * traces nothing, which looks identical to "tracing is off" and is the usual
 * way an OTel setup is wrong for months.
 *
 * ## What is instrumented, and what is not
 *
 * HTTP and `pg`, and deliberately not the kitchen sink. Those two are where
 * this system's latency lives — a request in, a query out — and every extra
 * instrumentation is startup cost plus another library patching the hot path.
 * Anything missing can be added by an install that wants it.
 *
 * ## Off by default
 *
 * Tracing sends data somewhere, and where is a decision an operator makes
 * rather than one an upgrade makes for them. `NODE_FLOW_OTEL_ENABLED=true`
 * turns it on; everything else — endpoint, headers, sampling — is configured
 * with the standard `OTEL_*` environment variables the SDK already reads, so
 * this file adds no second vocabulary for things that already have names.
 */

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (process.env['NODE_FLOW_OTEL_ENABLED'] !== 'true') return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'node-flow',
      [ATTR_SERVICE_VERSION]: process.env['NODE_FLOW_VERSION'] ?? '1.0.0',
    }),
    // The exporter reads `OTEL_EXPORTER_OTLP_ENDPOINT` and its headers itself.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // Health and metrics are scraped every few seconds by things that do
        // not care about traces; including them buries the spans that matter
        // under thousands that never will.
        ignoreIncomingRequestHook: (request) => {
          const url = request.url ?? '';
          return url.startsWith('/v1/health') || url.startsWith('/v1/metrics');
        },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  sdk.start();
}

/**
 * Flushes pending spans on shutdown.
 *
 * Without it the last few seconds of spans — which, during an incident, are the
 * ones someone is waiting to see — die with the process.
 */
export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown().catch(() => undefined);
  sdk = undefined;
}
