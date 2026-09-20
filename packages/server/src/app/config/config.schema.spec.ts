import { describe, expect, it } from 'vitest';
import { configSchema } from './config.schema.js';

const base = { DATABASE_URL: 'postgres://x', NODE_FLOW_JWT_SECRET: 'x'.repeat(32) };

describe('broker connections', () => {
  it('parses each kind and defaults to none', () => {
    const config = configSchema.parse({
      ...base,
      NODE_FLOW_NATS_CONNECTIONS: '{"default":{"servers":["nats://a:4222"],"queueGroup":"g"}}',
      NODE_FLOW_AMQP_CONNECTIONS: '{"rabbit":{"url":"amqp://localhost"}}',
    });
    expect(config.NODE_FLOW_NATS_CONNECTIONS).toEqual({ default: { servers: ['nats://a:4222'], queueGroup: 'g' } });
    expect(config.NODE_FLOW_AMQP_CONNECTIONS).toEqual({ rabbit: { url: 'amqp://localhost' } });
    expect(config.NODE_FLOW_SQS_CONNECTIONS).toEqual({});
  });

  it('refuses a boot with a connection missing its address', () => {
    const result = configSchema.safeParse({ ...base, NODE_FLOW_SQS_CONNECTIONS: '{"aws":{"endpoint":"http://x"}}' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/"aws" is missing "region"/);
  });

  // The name becomes part of a sink, `nats:<name>:<subject>`; a colon in it
  // would make the destination ambiguous.
  it('refuses a name that would make a sink ambiguous', () => {
    const result = configSchema.safeParse({ ...base, NODE_FLOW_NATS_CONNECTIONS: '{"a:b":{"servers":"nats://x"}}' });
    expect(result.error?.issues[0]?.message).toMatch(/may use only/);
    expect(configSchema.safeParse({ ...base, NODE_FLOW_AMQP_CONNECTIONS: '[]' }).success).toBe(false);
  });
});

/**
 * Every boolean flag must read `false` as false.
 *
 * `z.coerce.boolean()` does not: coercion follows JavaScript truthiness, and
 * the non-empty *string* `"false"` is true. `NODE_FLOW_MTLS_ENABLED=false`
 * therefore switched mTLS on. That is a bad failure for any setting and a
 * dangerous one for an authentication control, so this walks the whole schema
 * rather than asserting about the one flag that happened to be wrong — a spot
 * check cannot find the next one.
 */
describe('boolean flags', () => {
  const FLAGS = Object.keys(configSchema.shape).filter((key) => {
    const parsed = configSchema.safeParse({ ...base, [key]: 'true' });
    return parsed.success && typeof (parsed.data as Record<string, unknown>)[key] === 'boolean';
  });

  it('finds the flags it means to check', () => {
    expect(FLAGS.length).toBeGreaterThan(3);
    expect(FLAGS).toContain('NODE_FLOW_MTLS_ENABLED');
  });

  it.each(FLAGS)('%s reads "false" as false and "true" as true', (flag) => {
    const off = configSchema.parse({ ...base, [flag]: 'false' }) as Record<string, unknown>;
    const on = configSchema.parse({ ...base, [flag]: 'true' }) as Record<string, unknown>;

    expect(off[flag]).toBe(false);
    expect(on[flag]).toBe(true);
  });

  it.each(FLAGS)('%s refuses a value that is neither', (flag) => {
    // Silently treating "maybe" as one or the other is how a setting ends up
    // meaning the opposite of what an operator wrote.
    expect(configSchema.safeParse({ ...base, [flag]: 'maybe' }).success).toBe(false);
  });
});
