import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AmqpEventSource,
  NatsEventSource,
  RedisEventSource,
  SqsEventSource,
  amqpOutboxHandler,
  natsOutboxHandler,
  parseBody,
  redisOutboxHandler,
  sqsOutboxHandler,
} from './brokers.js';
import type { InboundMessage } from './event-dispatcher.js';
import type { OutboxEvent } from './outbox.repository.js';

/**
 * NATS, RabbitMQ and SQS (ElasticMQ, which speaks the SQS API), each against a
 * real broker: publish through the outbox handler exactly as the relay would,
 * and receive through the event source exactly as a handler would.
 */

function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;
  const home = homedir();
  const socket = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ].find((path) => existsSync(path));
  if (!socket) return;
  process.env['DOCKER_HOST'] = `unix://${socket}`;
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

const event = (topic: string, payload: Record<string, unknown>, id = 'evt-1'): OutboxEvent => ({
  id: '1',
  namespaceId: 'ns',
  topic,
  payload: { ...payload, _event: { id, workflowId: 'wf-1', sink: topic } } as never,
  createdAt: new Date(),
  attempts: 0,
});

/** A dispatcher that records what arrives, and can wait for it. */
function recorder() {
  const received: InboundMessage[] = [];
  return {
    received,
    dispatch: async (message: InboundMessage) => {
      received.push(message);
      return { matched: 0, started: [], completed: [], skipped: 0, failed: [] } as never;
    },
    async waitFor(count: number, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      while (received.length < count) {
        if (Date.now() > deadline) throw new Error(`received ${received.length} of ${count}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}

describe('message bodies', () => {
  it('keeps objects as they are and wraps anything else under body', () => {
    expect(parseBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseBody('[1,2]')).toEqual({ body: [1, 2] });
    expect(parseBody('plain text')).toEqual({ body: 'plain text' });
    expect(parseBody('')).toEqual({ body: null });
  });
});

describe('NATS', () => {
  let container: StartedTestContainer;
  let servers: string;

  beforeAll(async () => {
    ensureDockerHost();
    container = await new GenericContainer('nats:2.10-alpine').withExposedPorts(4222).withWaitStrategy(Wait.forLogMessage(/Server is ready/)).start();
    servers = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  }, 60_000);

  it('delivers a published event to a subscribed source, with the event id to deduplicate on', async () => {
    const inbox = recorder();
    const source = new NatsEventSource('nats:default', { servers }, inbox);
    await source.start(['orders.created']);
    const publish = natsOutboxHandler('nats:default', { servers });

    await publish(event('nats:default:orders.created', { orderId: 'A-1' }, 'evt-nats'));
    await inbox.waitFor(1);

    expect(inbox.received[0]).toMatchObject({
      source: 'nats:default',
      topic: 'orders.created',
      payload: { orderId: 'A-1' },
      deliveryId: 'evt-nats',
      headers: { 'nats-subject': 'orders.created' },
    });
    await source.stop();
    await publish.close();
  });

  // A handler on `orders.*` must match what arrives, so the topic is the
  // subscribed pattern and the concrete subject travels in a header.
  it('matches a wildcard subscription under its pattern', async () => {
    const inbox = recorder();
    const source = new NatsEventSource('nats:default', { servers }, inbox);
    await source.start(['orders.*']);
    const publish = natsOutboxHandler('nats:default', { servers });

    await publish(event('nats:default:orders.shipped', { orderId: 'A-2' }, 'evt-wild'));
    await inbox.waitFor(1);

    expect(inbox.received[0]).toMatchObject({ topic: 'orders.*', headers: { 'nats-subject': 'orders.shipped' } });
    await source.stop();
    await publish.close();
  });

  it('refuses an event that names no subject, so the relay dead-letters it', async () => {
    const publish = natsOutboxHandler('nats:default', { servers });
    await expect(publish(event('nats:default:', {}))).rejects.toThrow(/names no destination/);
    await publish.close();
  });
});

describe('AMQP (RabbitMQ)', () => {
  let container: StartedRabbitMQContainer;
  let url: string;

  beforeAll(async () => {
    ensureDockerHost();
    container = await new RabbitMQContainer('rabbitmq:3.13-alpine').start();
    url = container.getAmqpUrl();
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  }, 60_000);

  it('delivers to a queue, acknowledges after dispatch, and survives a restart of the consumer', async () => {
    const publish = amqpOutboxHandler('amqp:default', { url });
    // Published before anyone consumes: a durable queue holds it.
    await publish(event('amqp:default:refunds', { refundId: 'R-1' }, 'evt-amqp-1'));

    const inbox = recorder();
    const source = new AmqpEventSource('amqp:default', { url }, inbox);
    await source.start(['refunds']);
    await inbox.waitFor(1);
    expect(inbox.received[0]).toMatchObject({ topic: 'refunds', payload: { refundId: 'R-1' }, deliveryId: 'evt-amqp-1' });
    await source.stop();

    // Acknowledged: a new consumer does not see it again, only what comes next.
    await publish(event('amqp:default:refunds', { refundId: 'R-2' }, 'evt-amqp-2'));
    const again = recorder();
    const restarted = new AmqpEventSource('amqp:default', { url }, again);
    await restarted.start(['refunds']);
    await again.waitFor(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(again.received.map((m) => m.deliveryId)).toEqual(['evt-amqp-2']);
    await restarted.stop();
    await publish.close();
  });
});

describe('SQS (ElasticMQ)', () => {
  let container: StartedTestContainer;
  let endpoint: string;
  const config = () => ({ region: 'us-east-1', endpoint, accessKeyId: 'x', secretAccessKey: 'x', waitTimeSeconds: 1 });

  beforeAll(async () => {
    ensureDockerHost();
    container = await new GenericContainer('softwaremill/elasticmq-native:1.6.9')
      .withExposedPorts(9324)
      .withWaitStrategy(Wait.forLogMessage(/started/i))
      .start();
    endpoint = `http://${container.getHost()}:${container.getMappedPort(9324)}`;
    const { SQSClient, CreateQueueCommand } = await import('@aws-sdk/client-sqs');
    const client = new SQSClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'x', secretAccessKey: 'x' } });
    await client.send(new CreateQueueCommand({ QueueName: 'payments' }));
    client.destroy();
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  }, 60_000);

  it('delivers by queue name, deduplicates on the event id, and deletes after dispatch', async () => {
    const publish = sqsOutboxHandler('sqs:default', config());
    await publish(event('sqs:default:payments', { paymentId: 'P-1' }, 'evt-sqs'));

    const inbox = recorder();
    const source = new SqsEventSource('sqs:default', config(), inbox);
    await source.start(['payments']);
    await inbox.waitFor(1);
    expect(inbox.received[0]).toMatchObject({
      source: 'sqs:default',
      topic: 'payments',
      payload: { paymentId: 'P-1' },
      headers: { 'nodeflow-event-id': 'evt-sqs' },
    });
    expect(inbox.received[0].deliveryId).toBe('evt-sqs');
    await source.stop();

    // Deleted: a second consumer finds nothing.
    const again = recorder();
    const second = new SqsEventSource('sqs:default', config(), again);
    await second.start(['payments']);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(again.received).toEqual([]);
    await second.stop();
    await publish.close();
  }, 30_000);
});

/**
 * Redis Streams.
 *
 * A stream rather than pub/sub, and the tests are about what that buys: a
 * consumer group so replicas share work instead of each starting the same
 * workflow, and messages that stay pending until acknowledged so a consumer
 * dying mid-dispatch loses nothing.
 */
describe('Redis Streams', () => {
  let container: StartedTestContainer;
  let url: string;
  const config = () => ({ url, group: 'node-flow-test', blockMs: 500, count: 10 });

  beforeAll(async () => {
    ensureDockerHost();
    container = await new GenericContainer('redis:8-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  }, 60_000);

  it('publishes to a stream and consumes it, keeping the event id', async () => {
    const inbox = recorder();
    const source = new RedisEventSource('redis:default', config(), inbox);
    // Started first, deliberately: a *new* consumer group begins at `$`, so it
    // sees messages published from that point on rather than replaying a
    // stream's whole history as fresh workflows. Same contract as a Kafka
    // consumer group with `latest`.
    await source.start(['orders']);

    const publish = redisOutboxHandler('redis:default', config());
    await publish(event('redis:default:orders', { orderId: 'A-1' }, 'evt-redis'));
    await inbox.waitFor(1);

    expect(inbox.received[0]).toMatchObject({
      source: 'redis:default',
      topic: 'orders',
      payload: { orderId: 'A-1' },
    });
    // The sink's own id, not the stream entry id: it survives a duplicate send
    // where Redis's would not, which is what makes dispatch idempotent.
    expect(inbox.received[0].deliveryId).toBe('evt-redis');

    await source.stop();
    await publish.close();
  }, 60_000);

  /**
   * The property a consumer group exists for. Without it every replica reads
   * every message and starts the same workflow N times — the multi-replica
   * failure that is invisible until someone counts the executions.
   */
  it('shares a stream between replicas instead of delivering twice', async () => {
    const publish = redisOutboxHandler('redis:default', config());
    const first = recorder();
    const second = recorder();
    const one = new RedisEventSource('redis:default', config(), first);
    const two = new RedisEventSource('redis:default', config(), second);

    await one.start(['shared']);
    await two.start(['shared']);

    for (let index = 0; index < 6; index++) {
      await publish(event('redis:default:shared', { index }, `evt-shared-${index}`));
    }

    const deadline = Date.now() + 15_000;
    while (first.received.length + second.received.length < 6) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const all = [...first.received, ...second.received].map((message) => message.deliveryId);
    expect(all).toHaveLength(6);
    // Six distinct deliveries, not six each.
    expect(new Set(all).size).toBe(6);

    await one.stop();
    await two.stop();
    await publish.close();
  }, 60_000);

  it('leaves a message pending when dispatch throws, so nothing is lost', async () => {
    // A consumer that fails: the message must not be acknowledged, or the only
    // record of it disappears with the failure.
    const failing = {
      dispatch: async () => {
        throw new Error('handler exploded');
      },
    };
    const errors: unknown[] = [];
    const first = new RedisEventSource('redis:default', config(), failing as never, (error) => errors.push(error));
    await first.start(['retry']);

    const publish = redisOutboxHandler('redis:default', config());
    await publish(event('redis:default:retry', { attempt: 1 }, 'evt-retry'));

    const deadline = Date.now() + 10_000;
    while (errors.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await first.stop();
    expect(errors.length).toBeGreaterThan(0);

    // A second consumer claims what the first left pending, and gets it.
    const inbox = recorder();
    const second = new RedisEventSource('redis:default', config(), inbox);
    await second.start(['retry']);
    await inbox.waitFor(1, 20_000);
    expect(inbox.received[0].deliveryId).toBe('evt-retry');

    await second.stop();
    await publish.close();
  }, 90_000);
});
