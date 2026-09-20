import type { JsonValue } from '@node-flow-dev/core';
import { randomUUID } from 'node:crypto';
import type { EventDispatcher } from './event-dispatcher.js';
import type { EventSource } from './kafka-source.js';
import type { OutboxHandler } from './outbox-relay.js';
import type { OutboxEvent } from './outbox.repository.js';

/**
 * NATS, AMQP (RabbitMQ) and Amazon SQS — as event sources and as sinks.
 *
 * Each client is an optional dependency loaded on first use, exactly like
 * Kafka: an install that never touches a broker never installs its client.
 *
 * Naming is the same everywhere. A configured connection `default` of kind
 * `nats` is the source `nats:default`; an event handler on that source names a
 * subject as its topic. Publishing goes through the outbox with the sink
 * `nats:default:<subject>` — `amqp:default:<queue>` or
 * `amqp:default:<exchange>/<routingKey>`, `sqs:default:<queue>` — so an EVENT
 * task names its destination in one string.
 *
 * Delivery semantics differ and are stated rather than papered over:
 *  - **SQS and AMQP** are at-least-once: a message is deleted or acknowledged
 *    only after it has been dispatched, and redelivers after a crash.
 *  - **Core NATS** is at-most-once by design; a subscriber that is down misses
 *    messages. A publisher-set `Nats-Msg-Id` header is used as the delivery id.
 */

export interface NatsConnectionConfig {
  servers: string | string[];
  user?: string;
  pass?: string;
  token?: string;
  /** Replicas in the same queue group share messages instead of each getting all. */
  queueGroup?: string;
}

export interface AmqpConnectionConfig {
  /** `amqp://user:pass@host:5672/vhost`. */
  url: string;
  prefetch?: number;
}

export interface RedisConnectionConfig {
  /** `redis://host:6379` or `rediss://` for TLS. */
  url: string;
  /**
   * The consumer group replicas share a stream through.
   *
   * Without one every replica would read every message and start the same
   * workflow N times — the failure mode a group exists to prevent.
   */
  group?: string;
  /** How long a read waits before returning empty, in milliseconds. */
  blockMs?: number;
  /** Messages read per call. */
  count?: number;
}

export interface SqsConnectionConfig {
  region: string;
  /** For LocalStack, ElasticMQ or a VPC endpoint. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Long-poll wait, 1–20 seconds. */
  waitTimeSeconds?: number;
}

/** A broker message's body, as the dispatcher wants it: a JSON object, or the text under `body`. */
export function parseBody(raw: string): Record<string, JsonValue> {
  try {
    const parsed: unknown = raw === '' ? null : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, JsonValue>)
      : { body: parsed as JsonValue };
  } catch {
    return { body: raw };
  }
}

/**
 * A connection's publisher: the relay handler for its sinks, plus `send` for
 * callers that already know the destination, such as a status listener.
 */
export type BrokerSink = OutboxHandler & {
  /** Resolves once the broker has the message. `key` orders related messages where the broker can. */
  send(destination: string, body: string, id: string, key?: string): Promise<void>;
  close(): Promise<void>;
};

/** The body to publish for an outbox event, with the event id alongside for deduplication. */
function outgoing(event: OutboxEvent): { body: string; id: string } {
  const meta = event.payload['_event'];
  const id =
    meta && typeof meta === 'object' && !Array.isArray(meta) && typeof meta['id'] === 'string' ? meta['id'] : `outbox:${event.id}`;
  return { body: JSON.stringify(event.payload), id };
}

/** The destination after the connection prefix: `nats:default:orders.created` → `orders.created`. */
function destinationOf(event: OutboxEvent, prefix: string): string {
  const destination = event.topic.slice(prefix.length);
  if (!destination) throw new Error(`outbox event ${event.id} names no destination after "${prefix}"`);
  return destination;
}

/** Literal imports, so the dependency check sees each optional peer. */
const CLIENTS = {
  nats: () => import('nats'),
  amqplib: () => import('amqplib'),
  '@aws-sdk/client-sqs': () => import('@aws-sdk/client-sqs'),
  ioredis: () => import('ioredis'),
};

async function load<T>(module: keyof typeof CLIENTS, source: string): Promise<T> {
  try {
    return (await CLIENTS[module]()) as unknown as T;
  } catch {
    throw new Error(`"${source}" needs the "${module}" package, which is not installed`);
  }
}

// ---------------------------------------------------------------------- NATS

interface NatsModule {
  connect(options: { servers: string | string[]; user?: string; pass?: string; token?: string; name?: string }): Promise<NatsConnection>;
  headers(): { set(name: string, value: string): void };
}

interface NatsMessage {
  subject: string;
  data: Uint8Array;
  headers?: { get(name: string): string; keys(): string[] };
}

interface NatsConnection {
  subscribe(subject: string, options?: { queue?: string }): AsyncIterable<NatsMessage> & { unsubscribe(): void };
  publish(subject: string, data: Uint8Array, options?: { headers?: unknown }): void;
  flush(): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

async function natsConnect(name: string, config: NatsConnectionConfig): Promise<{ nats: NatsModule; connection: NatsConnection }> {
  const nats = await load<NatsModule>('nats', name);
  const connection = await nats.connect({
    servers: config.servers,
    user: config.user,
    pass: config.pass,
    token: config.token,
    name: 'node-flow',
  });
  return { nats, connection };
}

export class NatsEventSource implements EventSource {
  private connection?: NatsConnection;

  constructor(
    readonly name: string,
    private readonly config: NatsConnectionConfig,
    private readonly dispatcher: Pick<EventDispatcher, 'dispatch'>,
    private readonly onError?: (error: unknown, context: { source: string }) => void
  ) {}

  async start(topics: string[]): Promise<void> {
    if (this.connection || topics.length === 0) return;
    const { connection } = await natsConnect(this.name, this.config);
    this.connection = connection;
    const decoder = new TextDecoder();
    for (const subject of topics) {
      const subscription = connection.subscribe(subject, { queue: this.config.queueGroup ?? 'node-flow' });
      void (async () => {
        for await (const message of subscription) {
          const headers = Object.fromEntries((message.headers?.keys() ?? []).map((key) => [key, message.headers?.get(key) ?? '']));
          try {
            await this.dispatcher.dispatch({
              source: this.name,
              topic: subject,
              payload: parseBody(decoder.decode(message.data)),
              // The handler matched the subscribed pattern; the concrete subject is kept for conditions.
              headers: { ...headers, 'nats-subject': message.subject },
              key: null,
              deliveryId: headers['Nats-Msg-Id'] || `${message.subject}:${randomUUID()}`,
            });
          } catch (error) {
            this.onError?.(error, { source: this.name });
          }
        }
      })();
    }
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    await connection?.drain().catch(() => connection.close());
  }
}

/** Publishes `nats:<connection>:<subject>` outbox events, flushing so the relay's success means the server has them. */
export function natsOutboxHandler(name: string, config: NatsConnectionConfig): BrokerSink {
  let pending: Promise<{ nats: NatsModule; connection: NatsConnection }> | undefined;
  const prefix = `${name}:`;
  const send = async (subject: string, body: string, id: string) => {
    pending ??= natsConnect(name, config).catch((error) => {
      pending = undefined;
      throw error;
    });
    const { nats, connection } = await pending;
    const headers = nats.headers();
    headers.set('Nats-Msg-Id', id);
    connection.publish(subject, new TextEncoder().encode(body), { headers });
    await connection.flush();
  };
  const handler = async (event: OutboxEvent) => {
    const { body, id } = outgoing(event);
    await send(destinationOf(event, prefix), body, id);
  };
  return Object.assign(handler, {
    send,
    close: async () => {
      const current = pending;
      pending = undefined;
      await current?.then((c) => c.connection.drain()).catch(() => undefined);
    },
  });
}

// ---------------------------------------------------------------------- AMQP

interface AmqpModule {
  connect(url: string): Promise<AmqpConnection>;
}

interface AmqpConnection {
  createChannel(): Promise<AmqpChannel>;
  createConfirmChannel(): Promise<AmqpChannel & { waitForConfirms(): Promise<void> }>;
  close(): Promise<void>;
  on(event: 'error' | 'close', listener: (error?: unknown) => void): void;
}

interface AmqpMessage {
  content: Buffer;
  fields: { deliveryTag: number; routingKey: string };
  properties: { messageId?: string; headers?: Record<string, unknown> };
}

interface AmqpChannel {
  assertQueue(queue: string, options?: { durable?: boolean }): Promise<unknown>;
  prefetch(count: number): Promise<unknown>;
  consume(queue: string, onMessage: (message: AmqpMessage | null) => void): Promise<unknown>;
  ack(message: AmqpMessage): void;
  sendToQueue(queue: string, content: Buffer, options?: { persistent?: boolean; messageId?: string; contentType?: string }): boolean;
  publish(exchange: string, routingKey: string, content: Buffer, options?: { persistent?: boolean; messageId?: string; contentType?: string }): boolean;
  close(): Promise<void>;
}

export class AmqpEventSource implements EventSource {
  private connection?: AmqpConnection;
  private channel?: AmqpChannel;
  /** Messages being handled; a stop waits for them so their acknowledgements are sent. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    readonly name: string,
    private readonly config: AmqpConnectionConfig,
    private readonly dispatcher: Pick<EventDispatcher, 'dispatch'>,
    private readonly onError?: (error: unknown, context: { source: string }) => void
  ) {}

  async start(topics: string[]): Promise<void> {
    if (this.connection || topics.length === 0) return;
    const amqp = await load<AmqpModule>('amqplib', this.name);
    const connection = await amqp.connect(this.config.url);
    connection.on('error', (error) => this.onError?.(error, { source: this.name }));
    this.connection = connection;
    const channel = await connection.createChannel();
    this.channel = channel;
    await channel.prefetch(this.config.prefetch ?? 10);
    for (const queue of topics) {
      await channel.assertQueue(queue, { durable: true });
      await channel.consume(queue, (message) => {
        if (!message) return;
        const handling = (async () => {
          try {
            await this.dispatcher.dispatch({
              source: this.name,
              topic: queue,
              payload: parseBody(message.content.toString('utf8')),
              headers: Object.fromEntries(Object.entries(message.properties.headers ?? {}).map(([k, v]) => [k, String(v)])),
              key: message.fields.routingKey || null,
              // A redelivered message keeps its message id; a delivery tag does not survive a reconnect.
              // Without one there is nothing stable to deduplicate on, and deriving it from the
              // body would merge two different messages that happen to be equal.
              deliveryId: message.properties.messageId ?? `${queue}:${randomUUID()}`,
            });
          } catch (error) {
            this.onError?.(error, { source: this.name });
          }
          // Acknowledged after dispatch, never before: a crash redelivers instead of losing the message.
          channel.ack(message);
        })();
        this.inFlight.add(handling);
        void handling.finally(() => this.inFlight.delete(handling));
      });
    }
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    await Promise.allSettled([...this.inFlight]);
    // The channel first: amqplib multiplexes frames across channels, so a
    // connection close can overtake an acknowledgement still buffered on one.
    await this.channel?.close().catch(() => undefined);
    this.channel = undefined;
    await connection?.close().catch(() => undefined);
  }
}

/**
 * Publishes `amqp:<connection>:<queue>` or `amqp:<connection>:<exchange>/<routingKey>`
 * on a confirm channel, so the relay marks an event delivered only once the
 * broker has confirmed it.
 */
export function amqpOutboxHandler(name: string, config: AmqpConnectionConfig): BrokerSink {
  let pending: Promise<{ connection: AmqpConnection; channel: AmqpChannel & { waitForConfirms(): Promise<void> } }> | undefined;
  const prefix = `${name}:`;
  const open = async () => {
    const amqp = await load<AmqpModule>('amqplib', name);
    const connection = await amqp.connect(config.url);
    // A dropped connection is reopened on the next event rather than reused broken.
    connection.on('close', () => (pending = undefined));
    connection.on('error', () => (pending = undefined));
    return { connection, channel: await connection.createConfirmChannel() };
  };
  const send = async (destination: string, body: string, id: string) => {
    pending ??= open().catch((error) => {
      pending = undefined;
      throw error;
    });
    const { channel } = await pending;
    const options = { persistent: true, messageId: id, contentType: 'application/json' };
    const slash = destination.indexOf('/');
    if (slash >= 0) {
      channel.publish(destination.slice(0, slash), destination.slice(slash + 1), Buffer.from(body), options);
    } else {
      await channel.assertQueue(destination, { durable: true });
      channel.sendToQueue(destination, Buffer.from(body), options);
    }
    await channel.waitForConfirms();
  };
  const handler = async (event: OutboxEvent) => {
    const { body, id } = outgoing(event);
    await send(destinationOf(event, prefix), body, id);
  };
  return Object.assign(handler, {
    send,
    close: async () => {
      const current = pending;
      pending = undefined;
      await current?.then((c) => c.connection.close()).catch(() => undefined);
    },
  });
}

// ----------------------------------------------------------------------- SQS

interface SqsModule {
  SQSClient: new (config: {
    region: string;
    endpoint?: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  }) => { send(command: unknown): Promise<Record<string, unknown>>; destroy(): void };
  GetQueueUrlCommand: new (input: { QueueName: string }) => unknown;
  ReceiveMessageCommand: new (input: Record<string, unknown>) => unknown;
  DeleteMessageCommand: new (input: { QueueUrl: string; ReceiptHandle: string }) => unknown;
  SendMessageCommand: new (input: Record<string, unknown>) => unknown;
}

type SqsClient = InstanceType<SqsModule['SQSClient']>;

async function sqsClient(name: string, config: SqsConnectionConfig): Promise<{ sqs: SqsModule; client: SqsClient }> {
  const sqs = await load<SqsModule>('@aws-sdk/client-sqs', name);
  const client = new sqs.SQSClient({
    region: config.region,
    endpoint: config.endpoint,
    credentials:
      config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
  });
  return { sqs, client };
}

/** A queue name or a full queue URL, resolved once. */
async function queueUrl(sqs: SqsModule, client: SqsClient, queue: string, cache: Map<string, string>): Promise<string> {
  if (/^https?:\/\//.test(queue)) return queue;
  const hit = cache.get(queue);
  if (hit) return hit;
  const result = await client.send(new sqs.GetQueueUrlCommand({ QueueName: queue }));
  const url = String(result['QueueUrl']);
  cache.set(queue, url);
  return url;
}

export class SqsEventSource implements EventSource {
  private running = false;
  private client?: SqsClient;
  private loops: Promise<void>[] = [];

  constructor(
    readonly name: string,
    private readonly config: SqsConnectionConfig,
    private readonly dispatcher: Pick<EventDispatcher, 'dispatch'>,
    private readonly onError?: (error: unknown, context: { source: string }) => void
  ) {}

  async start(topics: string[]): Promise<void> {
    if (this.running || topics.length === 0) return;
    const { sqs, client } = await sqsClient(this.name, this.config);
    this.client = client;
    this.running = true;
    const urls = new Map<string, string>();
    for (const queue of topics) {
      const url = await queueUrl(sqs, client, queue, urls);
      this.loops.push(this.poll(sqs, client, queue, url));
    }
  }

  private async poll(sqs: SqsModule, client: SqsClient, queue: string, url: string): Promise<void> {
    while (this.running) {
      try {
        const result = await client.send(
          new sqs.ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: Math.min(Math.max(this.config.waitTimeSeconds ?? 10, 1), 20),
            MessageAttributeNames: ['All'],
          })
        );
        for (const message of (result['Messages'] as Record<string, unknown>[] | undefined) ?? []) {
          const attributes = (message['MessageAttributes'] ?? {}) as Record<string, { StringValue?: string }>;
          try {
            await this.dispatcher.dispatch({
              source: this.name,
              topic: queue,
              payload: parseBody(String(message['Body'] ?? '')),
              headers: Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, v.StringValue ?? ''])),
              key: null,
              // A node-flow sink's event id survives a duplicate send, which the SQS message id does not.
              deliveryId: attributes['nodeflow-event-id']?.StringValue || String(message['MessageId']),
            });
          } catch (error) {
            this.onError?.(error, { source: this.name });
          }
          // Deleted after dispatch: until then the visibility timeout brings it back.
          await client.send(new sqs.DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: String(message['ReceiptHandle']) }));
        }
      } catch (error) {
        if (!this.running) return;
        this.onError?.(error, { source: this.name });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    const client = this.client;
    this.client = undefined;
    // In-flight long polls end on their own within the wait time; destroying the client ends them now.
    client?.destroy();
    await Promise.allSettled(this.loops);
    this.loops = [];
  }
}

/** Sends `sqs:<connection>:<queue>` outbox events; a FIFO queue gets the event id as its deduplication id. */
export function sqsOutboxHandler(name: string, config: SqsConnectionConfig): BrokerSink {
  let pending: Promise<{ sqs: SqsModule; client: SqsClient }> | undefined;
  const urls = new Map<string, string>();
  const prefix = `${name}:`;
  const send = async (queue: string, body: string, id: string, key?: string) => {
    pending ??= sqsClient(name, config).catch((error) => {
      pending = undefined;
      throw error;
    });
    const { sqs, client } = await pending;
    const url = await queueUrl(sqs, client, queue, urls);
    await client.send(
      new sqs.SendMessageCommand({
        QueueUrl: url,
        MessageBody: body,
        MessageAttributes: { 'nodeflow-event-id': { DataType: 'String', StringValue: id } },
        // On a FIFO queue the key is the ordering group, so one execution's changes stay in order.
        ...(url.endsWith('.fifo')
          ? { MessageDeduplicationId: id.replace(/[^\w-]/g, '-').slice(0, 128), MessageGroupId: (key || 'node-flow').replace(/[^\w-]/g, '-').slice(0, 128) }
          : {}),
      })
    );
  };
  const handler = async (event: OutboxEvent) => {
    const { body, id } = outgoing(event);
    await send(destinationOf(event, prefix), body, id);
  };
  return Object.assign(handler, {
    send,
    close: async () => {
      const current = pending;
      pending = undefined;
      await current?.then((c) => c.client.destroy()).catch(() => undefined);
    },
  });
}

// --------------------------------------------------------------- Redis Streams

/**
 * Redis Streams, the one transport the plan named and this did not have.
 *
 * A stream rather than pub/sub, and the difference is the whole reason it is
 * usable here: pub/sub drops anything sent while nobody is listening, so a
 * restart loses every event in the gap. A stream is durable, and a **consumer
 * group** gives what an orchestrator needs — replicas share the work instead of
 * each starting the same workflow, and a message stays pending until it is
 * acknowledged, so a consumer that dies mid-dispatch does not lose it.
 *
 * `XAUTOCLAIM` on each pass is what makes that promise real: entries left
 * pending by a dead consumer are taken over after `claimAfterMs` rather than
 * sitting unread forever. Without it a crash quietly strands whatever that
 * replica had in flight — visible only as a workflow that never started.
 *
 * `ioredis` is an **optional peer**, like every other broker client here: an
 * install that never names a Redis connection never loads it.
 */
interface RedisClient {
  xadd(...args: unknown[]): Promise<string | null>;
  xreadgroup(...args: unknown[]): Promise<unknown>;
  xgroup(...args: unknown[]): Promise<unknown>;
  xack(key: string, group: string, id: string): Promise<number>;
  xautoclaim(...args: unknown[]): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

interface RedisModule {
  default: new (url: string, options?: Record<string, unknown>) => RedisClient;
}

async function redisClient(name: string, config: RedisConnectionConfig): Promise<RedisClient> {
  const redis = await load<RedisModule>('ioredis', name);
  const Client = redis.default ?? (redis as unknown as RedisModule['default']);
  // `maxRetriesPerRequest: null` because a blocking read is *meant* to sit
  // there; the default would abort it as a stuck command.
  const client = new Client(config.url, { maxRetriesPerRequest: null, lazyConnect: false });

  // ioredis emits `error` on every reconnect attempt, and an EventEmitter with
  // no `error` listener throws — so a Redis blip would take the process down
  // rather than the connection. Reconnection is the client's job; this just
  // stops it being fatal.
  (client as unknown as { on(event: string, handler: (error: unknown) => void): void }).on('error', () => undefined);

  return client;
}

/** The consumer group name, shared by every replica of one install. */
const defaultGroup = (config: RedisConnectionConfig) => config.group ?? 'node-flow';

export class RedisEventSource implements EventSource {
  private running = false;
  private client?: RedisClient;
  private loops: Promise<void>[] = [];
  /** One name per process, so `XAUTOCLAIM` can tell replicas apart. */
  private readonly consumer = `node-flow-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    readonly name: string,
    private readonly config: RedisConnectionConfig,
    private readonly dispatcher: Pick<EventDispatcher, 'dispatch'>,
    private readonly onError?: (error: unknown, context: { source: string }) => void
  ) {}

  async start(streams: string[]): Promise<void> {
    if (this.running || streams.length === 0) return;
    this.client = await redisClient(this.name, this.config);
    this.running = true;

    for (const stream of streams) {
      // `MKSTREAM` so a consumer may start before any producer exists, and
      // BUSYGROUP is success: another replica created it first.
      //
      // `$` — new messages only — is deliberate for a *new* group. A stream
      // usually already holds history, and `0` would replay all of it, which
      // for an event source means starting a workflow for every event that ever
      // happened. The cost is the other direction: anything published before a
      // handler existed is not seen, which is the same contract a Kafka
      // consumer group with `latest` has. Once the group exists its position is
      // durable, so a restart misses nothing.
      await this.client
        .xgroup('CREATE', stream, defaultGroup(this.config), '$', 'MKSTREAM')
        .catch((error: Error) => {
          if (!/BUSYGROUP/.test(error.message)) throw error;
        });
      this.loops.push(this.read(stream));
    }
  }

  private async read(stream: string): Promise<void> {
    const group = defaultGroup(this.config);
    const block = this.config.blockMs ?? 5_000;
    const count = this.config.count ?? 10;

    while (this.running) {
      try {
        // Anything a dead replica left pending, before new work: a message
        // stuck in someone else's pending list is a workflow that never ran.
        const claimed = (await this.client?.xautoclaim(
          stream,
          group,
          this.consumer,
          this.config.blockMs ?? 30_000,
          '0-0',
          'COUNT',
          count
        )) as [string, [string, string[]][]] | undefined;
        await this.handle(stream, group, claimed?.[1] ?? []);

        const response = (await this.client?.xreadgroup(
          'GROUP',
          group,
          this.consumer,
          'COUNT',
          count,
          'BLOCK',
          block,
          'STREAMS',
          stream,
          '>'
        )) as [string, [string, string[]][]][] | null | undefined;

        for (const [, entries] of response ?? []) await this.handle(stream, group, entries);
      } catch (error) {
        if (!this.running) return;
        this.onError?.(error, { source: this.name });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  private async handle(stream: string, group: string, entries: [string, string[]][]): Promise<void> {
    for (const [id, fields] of entries) {
      const message = fieldsToObject(fields);
      try {
        await this.dispatcher.dispatch({
          source: this.name,
          topic: stream,
          payload: parseBody(message['body'] ?? ''),
          headers: Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'body')),
          key: message['key'] ?? null,
          // A node-flow sink writes its own event id, which survives a
          // duplicate send where the stream entry id would not.
          deliveryId: message['nodeflow-event-id'] || `${stream}:${id}`,
        });
      } catch (error) {
        this.onError?.(error, { source: this.name });
        // Deliberately not acknowledged: it stays pending and another pass —
        // or another replica — claims it. Acknowledging here would lose it.
        continue;
      }
      await this.client?.xack(stream, group, id).catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    const client = this.client;
    this.client = undefined;
    // `quit` waits for the blocking read to return; `disconnect` is the
    // backstop so shutdown is never held hostage by one.
    await Promise.race([
      client?.quit().catch(() => undefined) ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    client?.disconnect();
    await Promise.all(this.loops).catch(() => undefined);
    this.loops = [];
  }
}

/** Publishes outbox events to a Redis stream: `redis:<connection>:<stream>`. */
export function redisOutboxHandler(name: string, config: RedisConnectionConfig): BrokerSink {
  let pending: Promise<RedisClient> | undefined;
  const prefix = `${name}:`;

  const send = async (stream: string, body: string, id: string, key?: string) => {
    pending ??= redisClient(name, config).catch((error) => {
      pending = undefined;
      throw error;
    });
    const client = await pending;
    await client.xadd(stream, '*', 'body', body, 'nodeflow-event-id', id, ...(key ? ['key', key] : []));
  };

  const handler = async (event: OutboxEvent) => {
    const { body, id } = outgoing(event);
    await send(destinationOf(event, prefix), body, id);
  };

  return Object.assign(handler, {
    send,
    close: async () => {
      const current = pending;
      pending = undefined;
      await current?.then((client) => client.quit()).catch(() => undefined);
    },
  });
}

/** Redis returns stream fields as a flat `[name, value, name, value]` array. */
function fieldsToObject(fields: string[]): Record<string, string> {
  const object: Record<string, string> = {};
  for (let index = 0; index + 1 < fields.length; index += 2) object[fields[index]] = fields[index + 1];
  return object;
}
