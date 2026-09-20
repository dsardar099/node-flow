import type { JsonValue } from '@node-flow-dev/core';
import type { EventDispatcher, InboundMessage } from './event-dispatcher.js';
import type { KafkaClusterConfig } from './kafka-sink.js';

/**
 * Consuming from Kafka — the inbound mirror of `KafkaJsProducer`.
 *
 * The client is dynamically imported and optional, exactly as on the producing
 * side, so an install that never consumes from Kafka never installs a Kafka
 * client.
 *
 * **Offsets are committed after dispatch, never before.** Committing first
 * would turn any crash into a silently dropped message; committing after means
 * a crash redelivers, which is why every dispatch carries a delivery id and
 * every action derived from it is idempotent. At-least-once with an
 * idempotency key is a guarantee; at-most-once is a data-loss bug with better
 * marketing.
 */

export interface EventSource {
  readonly name: string;
  start(topics: string[]): Promise<void>;
  stop(): Promise<void>;
}

export class KafkaEventSource implements EventSource {
  private consumer?: KafkaJsConsumerHandle;
  private running = false;

  constructor(
    readonly name: string,
    private readonly config: KafkaClusterConfig & { groupId?: string },
    private readonly dispatcher: EventDispatcher,
    private readonly onError?: (error: unknown, context: { source: string }) => void
  ) {}

  async start(topics: string[]): Promise<void> {
    if (this.running || topics.length === 0) return;
    this.running = true;

    let kafkajs: KafkaJsModule;
    try {
      kafkajs = (await import('kafkajs')) as unknown as KafkaJsModule;
    } catch {
      this.running = false;
      throw new Error(
        `event source "${this.name}" needs the "kafkajs" package, which is not installed`
      );
    }

    const client = new kafkajs.Kafka({
      clientId: this.config.clientId ?? 'node-flow',
      brokers: this.config.brokers,
      ssl: this.config.ssl,
      sasl: this.config.sasl,
    });

    // A stable group id, so restarts resume rather than replaying from the
    // start of every topic — and so several replicas share the partitions
    // between them instead of each consuming everything.
    this.consumer = client.consumer({ groupId: this.config.groupId ?? 'node-flow-events' });

    await this.consumer.connect();
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          await this.dispatcher.dispatch(toInbound(this.name, topic, partition, message));
        } catch (error) {
          // Swallowed after reporting: throwing here makes kafkajs retry the
          // same message indefinitely, and a message no handler can process
          // would stop the partition for every other message behind it.
          this.onError?.(error, { source: this.name });
        }
      },
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    const consumer = this.consumer;
    this.consumer = undefined;
    await consumer?.disconnect().catch(() => undefined);
  }
}

/**
 * A Kafka record as the dispatcher sees it.
 *
 * A non-JSON body is carried as a string under `body` rather than rejected:
 * plenty of real topics carry plain text, and a handler condition can still
 * look at it.
 */
export function toInbound(
  source: string,
  topic: string,
  partition: number,
  message: { key?: Buffer | null; value?: Buffer | null; offset: string; headers?: Record<string, unknown> }
): InboundMessage {
  const raw = message.value?.toString('utf8') ?? '';

  let payload: Record<string, JsonValue>;
  try {
    const parsed: unknown = raw === '' ? null : JSON.parse(raw);
    payload =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, JsonValue>)
        : { body: parsed as JsonValue };
  } catch {
    payload = { body: raw };
  }

  return {
    source,
    topic,
    payload,
    key: message.key?.toString('utf8') ?? null,
    headers: Object.fromEntries(
      Object.entries(message.headers ?? {}).map(([name, value]) => [name, String(value)])
    ),
    // Partition and offset identify a Kafka record exactly, and survive the
    // redelivery that an uncommitted offset causes.
    deliveryId: `${topic}:${partition}:${message.offset}`,
  };
}

interface KafkaJsModule {
  Kafka: new (config: {
    clientId: string;
    brokers: string[];
    ssl?: boolean;
    sasl?: KafkaClusterConfig['sasl'];
  }) => { consumer(options: { groupId: string }): KafkaJsConsumerHandle };
}

interface KafkaJsConsumerHandle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning: boolean }): Promise<void>;
  run(options: {
    eachMessage: (payload: {
      topic: string;
      partition: number;
      message: { key?: Buffer | null; value?: Buffer | null; offset: string; headers?: Record<string, unknown> };
    }) => Promise<void>;
  }): Promise<void>;
}
