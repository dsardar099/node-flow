import type { JsonValue } from '@node-flow-dev/core';
import type { OutboxEvent } from './outbox.repository.js';
import type { OutboxHandler } from './outbox-relay.js';

/**
 * Delivering `KAFKA_PUBLISH` messages to a broker.
 *
 * Registered as an **outbox handler**, not called from a task executor. That
 * placement is the design:
 *
 *  - the message is written in the same transaction as the task that produced
 *    it, so "the task succeeded" and "the message exists" are inseparable;
 *  - delivery inherits the relay's retry, backoff and dead-letter machinery, so
 *    a broker outage delays messages instead of failing workflows;
 *  - nothing is silently dropped — an install with no Kafka configured
 *    dead-letters visibly rather than appearing to succeed.
 *
 * ## Kafka is optional, and stays optional
 *
 * The client is **dynamically imported** and declared as an optional peer
 * dependency. node-flow's whole positioning is that Postgres is the only thing
 * you must run; a Kafka client in the dependency tree of every install — worse,
 * a native one needing a toolchain at install time — would undo that for the
 * large majority who never publish to Kafka.
 *
 * The client is also behind `KafkaProducer` rather than used directly, so which
 * library an install uses is a contained decision. The bundled implementation
 * uses `kafkajs` because it is pure JavaScript and installs everywhere; a
 * deployment preferring the native Confluent client can supply its own producer
 * without touching this file.
 */

export interface KafkaMessage {
  topic: string;
  key: string | null;
  value: JsonValue;
  headers: Record<string, string>;
}

/** The seam between the relay and whichever client an install uses. */
export interface KafkaProducer {
  send(message: KafkaMessage): Promise<void>;
  disconnect(): Promise<void>;
}

export interface KafkaClusterConfig {
  brokers: string[];
  clientId?: string;
  ssl?: boolean;
  sasl?: { mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'; username: string; password: string };
  /** Acknowledgements to wait for. -1 (all replicas) is the durable default. */
  acks?: number;
  requestTimeoutMs?: number;
}

/**
 * Lazily connects a `kafkajs` producer for one cluster.
 *
 * Lazy because a cluster may be configured and never used, and connecting at
 * boot would turn an unreachable broker into a server that will not start.
 */
export class KafkaJsProducer implements KafkaProducer {
  private producer?: Promise<KafkaJsProducerHandle>;

  constructor(private readonly config: KafkaClusterConfig) {}

  async send(message: KafkaMessage): Promise<void> {
    const producer = await (this.producer ??= this.connect());

    await producer.send({
      topic: message.topic,
      messages: [
        {
          key: message.key,
          // Kafka carries bytes. JSON is the only encoding the DSL can express,
          // and a consumer expecting Avro would need a schema registry, which
          // is an integration rather than a serialisation choice.
          value: JSON.stringify(message.value),
          headers: message.headers,
        },
      ],
      acks: this.config.acks ?? -1,
    });
  }

  async disconnect(): Promise<void> {
    const pending = this.producer;
    this.producer = undefined;
    if (!pending) return;

    // Swallowed: disconnecting from a broker that is already gone is the normal
    // case during a shutdown caused by that broker being gone.
    await pending.then((p) => p.disconnect()).catch(() => undefined);
  }

  private async connect(): Promise<KafkaJsProducerHandle> {
    let kafkajs: KafkaJsModule;

    try {
      kafkajs = (await import('kafkajs')) as unknown as KafkaJsModule;
    } catch {
      // A configuration error, not a transient one, and worth saying exactly
      // what to do about it — the alternative is a MODULE_NOT_FOUND in a relay
      // log that reads like a bug in node-flow.
      throw new Error(
        'a Kafka cluster is configured but the "kafkajs" package is not installed; ' +
          'install it, or remove the cluster from NODE_FLOW_KAFKA_CLUSTERS'
      );
    }

    const client = new kafkajs.Kafka({
      clientId: this.config.clientId ?? 'node-flow',
      brokers: this.config.brokers,
      ssl: this.config.ssl,
      sasl: this.config.sasl,
      requestTimeout: this.config.requestTimeoutMs ?? 30_000,
      // The relay already retries, backs off and dead-letters. A second retry
      // loop inside the client would multiply against it, and — worse — the
      // relay holds a database transaction open for the whole delivery, so a
      // client that retries for a minute is a minute of held transaction.
      retry: { retries: 0 },
    });

    // **Not** an idempotent producer, which kafkajs anyway refuses to pair with
    // retries disabled. Kafka's idempotence deduplicates a producer's *own*
    // internal retries, and there are none here by design. Redeliveries come
    // from the relay, which is a different session — outside what producer
    // idempotence covers.
    //
    // Duplicates are handled where they can be: delivery is at-least-once and
    // every message carries `_event.id`, a stable identity derived from the
    // task, for the consumer to deduplicate on.
    const producer = client.producer();
    await producer.connect();
    return producer;
  }
}

/**
 * The relay handler for one cluster.
 *
 * Throwing is how a handler reports failure to the relay, which is what earns
 * the retry and the eventual dead letter — so nothing here catches.
 */
export function kafkaOutboxHandler(producer: KafkaProducer): OutboxHandler {
  return async (event: OutboxEvent) => {
    const message = readMessage(event);
    await producer.send(message);
  };
}

function readMessage(event: OutboxEvent): KafkaMessage {
  const payload = event.payload;
  const topic = payload['topic'];

  if (typeof topic !== 'string' || topic === '') {
    // Dead-letters rather than retrying: a malformed message will be malformed
    // on every attempt, and the dead letter is where it can be looked at.
    throw new Error(`outbox event ${event.id} has no Kafka topic`);
  }

  const key = payload['key'];
  const headers = payload['headers'];

  return {
    topic,
    key: typeof key === 'string' ? key : null,
    value: payload['value'] ?? null,
    headers: readHeaders(headers),
  };
}

function readHeaders(value: JsonValue | undefined): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string' || typeof entry === 'number')
      .map(([name, entry]) => [name, String(entry)])
  );
}

/** The slice of `kafkajs` used here, so the optional import needs no types. */
interface KafkaJsModule {
  Kafka: new (config: {
    clientId: string;
    brokers: string[];
    ssl?: boolean;
    sasl?: KafkaClusterConfig['sasl'];
    requestTimeout?: number;
    retry?: { retries: number };
  }) => { producer(): KafkaJsProducerHandle };
}

interface KafkaJsProducerHandle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(record: {
    topic: string;
    messages: { key: string | null; value: string; headers: Record<string, string> }[];
    acks: number;
  }): Promise<unknown>;
}
