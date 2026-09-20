import { TaskType, type JsonValue } from '@node-flow-dev/core';
import {
  Server,
  ServerCredentials,
  loadPackageDefinition,
  status as GrpcStatus,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { GrpcTaskExecutor } from './grpc.executor.js';

/**
 * `gRPC`.
 *
 * Against a real server rather than a stub, because everything interesting is
 * the transport's: deadlines, status codes and how a message round-trips. A
 * stubbed client would assert that the executor calls a function.
 *
 * The refusal tests matter most. A task that could be pointed at any address by
 * a workflow definition would reach anything inside the perimeter, and `HTTP`'s
 * private-address guard is no use here because almost every gRPC target *is* a
 * private address.
 */

const here = dirname(fileURLToPath(import.meta.url));
const protoPath = join(here, 'testing', 'pricing.proto');

let server: Server;
let address: string;
const executors: GrpcTaskExecutor[] = [];

const context = (input: Record<string, JsonValue>, signal?: AbortSignal): TaskContext => ({
  taskId: 't-1',
  workflowId: 'w-1',
  namespaceId: 'ns-1',
  input,
  state: {},
  signal: signal ?? new AbortController().signal,
  heartbeat: async () => undefined,
});

function executor(overrides: Record<string, unknown> = {}) {
  const made = new GrpcTaskExecutor({
    services: {
      pricing: { address, protoPath, package: 'pricing.v1', service: 'Pricing' },
    },
    ...overrides,
  });
  executors.push(made);
  return made;
}

beforeAll(async () => {
  const definition = loadSync(protoPath, { keepCase: false, defaults: true, oneofs: true });
  const proto = loadPackageDefinition(definition) as never;
  const service = (proto as Record<string, Record<string, { service: never }>>)['pricing']['v1'];

  server = new Server();
  // The handler signatures are cast wholesale: grpc-js types them against a
  // generated stub this fixture deliberately does not have, and spelling each
  // one out would be more ceremony than the four handlers below are worth.
  const implementation = {
    GetQuote: (
      call: { request: { sku: string; quantity: number } },
      callback: (e: unknown, r?: unknown) => void
    ) =>
      callback(null, {
        sku: call.request.sku,
        total: call.request.quantity * 10,
        currency: { code: 'GBP' },
      }),

    Fail: (
      call: { request: { code: number; message: string } },
      callback: (e: unknown) => void
    ) => callback({ code: call.request.code, details: call.request.message }),

    Slow: (_call: unknown, callback: (e: unknown, r?: unknown) => void) =>
      setTimeout(() => callback(null, { sku: 'late', total: 0 }), 5_000),

    Big: (_call: unknown, callback: (e: unknown, r?: unknown) => void) =>
      callback(null, { blob: Array.from({ length: 5_000 }, () => 'x'.repeat(100)) }),
  } as unknown as UntypedServiceImplementation;

  server.addService(
    (service as unknown as Record<string, { service: never }>)['Pricing'].service,
    implementation
  );

  address = await new Promise<string>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => {
      if (error) return reject(error);
      resolve(`127.0.0.1:${port}`);
    });
  });
}, 60_000);

afterAll(async () => {
  for (const made of executors) made.close();
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
}, 30_000);

describe('calling', () => {
  it('has the declared type', () => {
    expect(new GrpcTaskExecutor().type).toBe(TaskType.GRPC);
  });

  it('round-trips a unary call', async () => {
    const outcome = await executor().execute(
      context({
        service: 'pricing',
        method: 'GetQuote',
        request: { sku: 'WIDGET-1', quantity: 3 },
      })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['response']).toMatchObject({ sku: 'WIDGET-1', total: 30 });
  });

  // Responses are stored and addressed by `${...}` expressions, so they have to
  // be ordinary JSON rather than protobuf wrapper objects.
  it('returns nested messages as plain JSON', async () => {
    const outcome = await executor().execute(
      context({ service: 'pricing', method: 'GetQuote', request: { sku: 'A', quantity: 1 } })
    );

    const response = outcome.output?.['response'] as Record<string, JsonValue>;
    expect(response['currency']).toEqual({ code: 'GBP' });
  });

  it('reuses one channel across calls', async () => {
    const shared = executor();

    for (let i = 0; i < 3; i++) {
      const outcome = await shared.execute(
        context({ service: 'pricing', method: 'GetQuote', request: { sku: 'A', quantity: i } })
      );
      expect(outcome.status).toBe('COMPLETED');
    }
  });

  /**
   * A deadline, not a client-side timer.
   *
   * The server is told when to stop, so a call that outlives its budget is
   * cancelled at both ends rather than abandoned while the server keeps working.
   */
  it('gives up at its deadline', async () => {
    const started = Date.now();
    const outcome = await executor().execute(
      context({ service: 'pricing', method: 'Slow', request: {}, timeoutMs: 500 })
    );

    expect(outcome.status).toBe('FAILED');
    expect(Date.now() - started).toBeLessThan(4_000);
    // Transient: a slow call may be slow because of load.
    expect(outcome).toMatchObject({ terminal: false });
  }, 30_000);

  it('abandons the call when its context is cancelled', async () => {
    const controller = new AbortController();
    const pending = executor().execute(
      context(
        { service: 'pricing', method: 'Slow', request: {}, timeoutMs: 60_000 },
        controller.signal
      )
    );
    setTimeout(() => controller.abort(), 200);

    const started = Date.now();
    expect((await pending).status).toBe('FAILED');
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 30_000);

  // The response is stored, indexed and handed to the next task.
  it('refuses a response over its size limit', async () => {
    const outcome = await executor({ maxResponseBytes: 1_000 }).execute(
      context({ service: 'pricing', method: 'Big', request: {} })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });
});

/**
 * The gRPC analogue of "4xx is terminal, 5xx is not".
 *
 * Without the distinction a permanently broken call burns its whole retry
 * budget and delays the error someone needs to read.
 */
describe('status codes', () => {
  const callFailing = async (code: number) =>
    executor().execute(
      context({
        service: 'pricing',
        method: 'Fail',
        request: { code, message: 'nope' },
      })
    );

  it('treats a caller mistake as permanent', async () => {
    for (const code of [
      GrpcStatus.INVALID_ARGUMENT,
      GrpcStatus.NOT_FOUND,
      GrpcStatus.PERMISSION_DENIED,
      GrpcStatus.UNAUTHENTICATED,
      GrpcStatus.UNIMPLEMENTED,
    ]) {
      const outcome = await callFailing(code);
      expect(outcome.status, String(code)).toBe('FAILED');
      if (outcome.status === 'FAILED') expect(outcome.terminal, String(code)).toBe(true);
    }
  }, 30_000);

  it('treats a service being briefly unwell as retryable', async () => {
    for (const code of [
      GrpcStatus.UNAVAILABLE,
      GrpcStatus.RESOURCE_EXHAUSTED,
      GrpcStatus.ABORTED,
      GrpcStatus.INTERNAL,
    ]) {
      const outcome = await callFailing(code);
      expect(outcome.status, String(code)).toBe('FAILED');
      if (outcome.status === 'FAILED') expect(outcome.terminal, String(code)).toBe(false);
    }
  }, 30_000);

  it('names the status in the reason', async () => {
    const outcome = await callFailing(GrpcStatus.NOT_FOUND);
    if (outcome.status === 'FAILED') {
      expect(outcome.reason).toContain('NOT_FOUND');
      expect(outcome.reason).toContain('nope');
    }
  });
});

describe('refusing to be pointed anywhere', () => {
  it('refuses an address supplied by the definition', async () => {
    for (const key of ['address', 'target', 'host']) {
      const outcome = await executor().execute(
        context({
          service: 'pricing',
          method: 'GetQuote',
          [key]: '10.0.0.1:50051',
          request: {},
        })
      );

      expect(outcome.status, key).toBe('FAILED');
      if (outcome.status === 'FAILED') {
        expect(outcome.reason, key).toContain('does not accept an address');
        expect(outcome.terminal, key).toBe(true);
      }
    }
  });

  it('refuses a service the operator did not configure', async () => {
    const outcome = await executor().execute(
      context({ service: 'internal-admin', method: 'GetQuote', request: {} })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('no gRPC service');
  });

  it('does nothing at all when the install configures none', async () => {
    const outcome = await new GrpcTaskExecutor().execute(
      context({ service: 'pricing', method: 'GetQuote', request: {} })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('requires a service and a method', async () => {
    expect(await executor().execute(context({ method: 'GetQuote' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
    });
    expect(await executor().execute(context({ service: 'pricing' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
    });
  });

  it('refuses a method the service does not have', async () => {
    const outcome = await executor().execute(
      context({ service: 'pricing', method: 'DropDatabase', request: {} })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('no unary method');
  });

  // A deployment fault, not a transient one.
  it('treats an unloadable proto as permanent', async () => {
    const broken = new GrpcTaskExecutor({
      services: {
        pricing: { address, protoPath: '/nope/missing.proto', package: 'p', service: 'S' },
      },
    });
    executors.push(broken);

    const outcome = await broken.execute(
      context({ service: 'pricing', method: 'GetQuote', request: {} })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('says what the proto actually contains when the service is not in it', async () => {
    const wrong = new GrpcTaskExecutor({
      services: { pricing: { address, protoPath, package: 'pricing.v1', service: 'Nope' } },
    });
    executors.push(wrong);

    const outcome = await wrong.execute(
      context({ service: 'pricing', method: 'GetQuote', request: {} })
    );

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('pricing.v1.Pricing');
  });
});
