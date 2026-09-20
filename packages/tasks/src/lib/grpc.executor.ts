import { TaskType, type JsonValue } from '@node-flow-dev/core';
import {
  ChannelCredentials,
  Client,
  Metadata,
  credentials,
  makeGenericClientConstructor,
  status as GrpcStatus,
  type ServiceError,
} from '@grpc/grpc-js';
import {
  loadSync,
  type AnyDefinition,
  type PackageDefinition,
  type ServiceDefinition,
} from '@grpc/proto-loader';
import { type CircuitBreaker, type CircuitOpenError } from './circuit-breaker.js';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `gRPC` — calls a unary method on another service.
 *
 * ## The address comes from the operator, not the workflow
 *
 * The same decision as `JDBC`, for the same reason, and worth repeating because
 * the temptation to accept an address from the definition is identical: a
 * workflow definition is user input, and gRPC services live behind the
 * perimeter where the interesting ones are.
 *
 * `HTTP`'s defence — block private address ranges by default — does not
 * transfer. Almost every gRPC target *is* a private address, so applying that
 * guard would either refuse every legitimate call or be disabled immediately
 * and defend nothing. Named services configured by the operator gives a real
 * boundary instead of a decorative one, and keeps credentials and certificates
 * out of a definition that is stored, versioned and rendered in a UI.
 *
 * ## Unary only
 *
 * Streaming is deliberately unsupported. A task has one input and one output
 * and is retried as a unit; a stream has neither shape nor a meaningful retry,
 * and pretending otherwise would produce a task that appears to work and
 * silently truncates. A workflow that needs a stream needs a worker.
 */

export interface GrpcServiceConfig {
  /** `host:port`. From operator configuration, never from a definition. */
  address: string;
  /** Path to the `.proto` describing the service. */
  protoPath: string;
  /** Proto package, e.g. `pricing.v1`. */
  package: string;
  /** Service name within that package, e.g. `Pricing`. */
  service: string;
  /** TLS. Plaintext is the default because most gRPC is mesh-internal. */
  tls?: boolean;
  /** Extra include directories for imported protos. */
  includeDirs?: string[];
}

export interface GrpcExecutorOptions {
  /** Services a workflow may name, by name. Empty disables the task. */
  services?: Record<string, GrpcServiceConfig>;
  defaultTimeoutMs?: number;
  /** Bounds the result, which is stored and passed to the next task. */
  maxResponseBytes?: number;
  /**
   * Trips when a service starts failing, so a dead backend cannot occupy the
   * runner for a deadline at a time. Shared with `HTTP`, though the keys differ:
   * a gRPC service is named by configuration, not by URL.
   */
  breaker?: CircuitBreaker;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  maxResponseBytes: 1024 * 1024,
};

/**
 * Status codes that will never succeed on a retry.
 *
 * The gRPC analogue of "4xx is terminal, 5xx is not", and the same reasoning:
 * without the distinction a permanently broken call burns its whole retry
 * budget and delays the error someone needs to read by minutes. Everything not
 * listed — `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `ABORTED`,
 * `INTERNAL` — is treated as transient, because each of those is a thing a
 * healthy service does while it is briefly unhealthy.
 */
const TERMINAL_STATUSES = new Set<number>([
  GrpcStatus.INVALID_ARGUMENT,
  GrpcStatus.NOT_FOUND,
  GrpcStatus.ALREADY_EXISTS,
  GrpcStatus.PERMISSION_DENIED,
  GrpcStatus.FAILED_PRECONDITION,
  GrpcStatus.OUT_OF_RANGE,
  GrpcStatus.UNIMPLEMENTED,
  GrpcStatus.UNAUTHENTICATED,
]);

export class GrpcTaskExecutor implements TaskExecutor {
  readonly type = TaskType.GRPC;
  private readonly services: Record<string, GrpcServiceConfig>;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;
  /** One client per service, because a channel is expensive and reusable. */
  private readonly clients = new Map<string, Client>();

  constructor(private readonly options: GrpcExecutorOptions = {}) {
    this.services = options.services ?? {};
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULTS.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const name = context.input['service'];
    if (typeof name !== 'string' || name === '') {
      return {
        status: 'FAILED',
        reason: 'gRPC requires a "service" naming one configured on the server',
        terminal: true,
      };
    }

    // Refused rather than ignored: the author clearly expected it to be used,
    // and quietly calling a different host would be worse than saying no.
    if (context.input['address'] ?? context.input['target'] ?? context.input['host']) {
      return {
        status: 'FAILED',
        reason:
          'gRPC does not accept an address from a workflow definition; ' +
          'reference a service configured on the server by name instead',
        terminal: true,
      };
    }

    const config = this.services[name];
    if (!config) {
      const known = Object.keys(this.services);
      return {
        status: 'FAILED',
        reason: known.length
          ? `no gRPC service "${name}" is configured; available: ${known.join(', ')}`
          : `no gRPC service "${name}" is configured, and this install has none`,
        terminal: true,
      };
    }

    const method = context.input['method'];
    if (typeof method !== 'string' || method === '') {
      return { status: 'FAILED', reason: 'gRPC requires a "method"', terminal: true };
    }

    let client: Client;
    try {
      client = this.clientFor(name, config);
    } catch (error) {
      // A proto that will not load is a deployment fault, not a transient one.
      return {
        status: 'FAILED',
        reason: `could not load ${config.protoPath}: ${(error as Error).message}`,
        terminal: true,
      };
    }

    const handler = (client as unknown as Record<string, unknown>)[method];
    if (typeof handler !== 'function') {
      return {
        status: 'FAILED',
        reason: `service "${name}" has no unary method "${method}"`,
        terminal: true,
      };
    }

    // Keyed by the configured service rather than its address: that is the
    // name an operator knows, and two services on one host still fail apart.
    const key = `grpc:${name}`;
    try {
      this.options.breaker?.assertAllowed(key);
    } catch (error) {
      return { status: 'FAILED', reason: (error as CircuitOpenError).message, terminal: false };
    }

    const outcome = await this.call(client, handler as GrpcCall, context);
    // A terminal failure is the caller's fault — a bad argument, an unknown
    // method — and says nothing about whether the service is healthy.
    this.options.breaker?.record(key, outcome.status !== 'FAILED' || outcome.terminal === true);
    return outcome;
  }

  private call(client: Client, handler: GrpcCall, context: TaskContext): Promise<TaskOutcome> {
    const request = readObject(context.input['request']);
    const timeoutMs = readNumber(context.input['timeoutMs']) ?? this.defaultTimeoutMs;

    const metadata = new Metadata();
    for (const [key, value] of Object.entries(readObject(context.input['metadata']))) {
      if (typeof value === 'string' || typeof value === 'number') {
        metadata.set(key, String(value));
      }
    }

    return new Promise<TaskOutcome>((resolve) => {
      const call = handler.call(
        client,
        request,
        metadata,
        // A deadline, not a client-side timer: the server is told when to stop,
        // so a call that outlives its budget is cancelled at both ends rather
        // than abandoned while the server keeps working on it.
        { deadline: Date.now() + timeoutMs },
        (error: ServiceError | null, response: unknown) => {
          if (error) return resolve(this.toFailure(error));

          const encoded = JSON.stringify(response ?? null) ?? 'null';
          if (encoded.length > this.maxResponseBytes) {
            return resolve({
              status: 'FAILED',
              reason: `gRPC response of ${encoded.length} bytes exceeds the ${this.maxResponseBytes}-byte limit`,
              terminal: true,
            });
          }

          resolve({
            status: 'COMPLETED',
            output: { response: (response ?? null) as JsonValue },
          });
        }
      );

      // Shutdown and the task's own deadline. Without this a drain waits for
      // the slowest call in flight.
      context.signal.addEventListener(
        'abort',
        () => {
          call.cancel();
          resolve({ status: 'FAILED', reason: 'cancelled', terminal: false });
        },
        { once: true }
      );
    });
  }

  private toFailure(error: ServiceError): TaskOutcome {
    const name = GrpcStatus[error.code] ?? String(error.code);

    return {
      status: 'FAILED',
      reason: `gRPC ${name}: ${error.details || error.message}`,
      terminal: TERMINAL_STATUSES.has(error.code),
    };
  }

  /**
   * One client per service, built on first use.
   *
   * Proto loading and channel setup both cost real time, and a task that did
   * them per call would spend more time connecting than calling.
   */
  private clientFor(name: string, config: GrpcServiceConfig): Client {
    const existing = this.clients.get(name);
    if (existing) return existing;

    const definition: PackageDefinition = loadSync(config.protoPath, {
      // Plain JS values rather than wrapper objects, so a response is ordinary
      // JSON the rest of the engine can store and expressions can address.
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: config.includeDirs,
    });

    const qualified = `${config.package}.${config.service}`;
    const entry = definition[qualified];
    if (!entry || !isServiceDefinition(entry)) {
      // Names a message type, or nothing at all. Listing what is actually in
      // the file turns "no service" into something fixable without guessing.
      const available = Object.keys(definition).join(', ');
      throw new Error(`no service "${qualified}" in the proto; found: ${available}`);
    }

    const channel = config.tls
      ? credentials.createSsl()
      : (ChannelCredentials.createInsecure() as ChannelCredentials);

    const ServiceClient = makeGenericClientConstructor(entry, config.service);
    const client = new ServiceClient(config.address, channel) as Client;

    this.clients.set(name, client);
    return client;
  }

  /** Closes every channel. For shutdown. */
  close(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}

type GrpcCall = (
  request: unknown,
  metadata: Metadata,
  options: { deadline: number },
  callback: (error: ServiceError | null, response: unknown) => void
) => { cancel(): void };

/**
 * A package entry is either a service or a message type.
 *
 * proto-loader marks message types with `format`; services are a plain map of
 * method name to definition.
 */
function isServiceDefinition(entry: AnyDefinition): entry is ServiceDefinition {
  return !('format' in entry);
}

function readObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function readNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
