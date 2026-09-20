import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deliveryIdOf, verifyWebhook } from './webhook-verifiers.js';

/**
 * Each preset is checked against a signature computed the way the platform's
 * own documentation says it computes one — and then against the forgeries a
 * preset must refuse: a changed body, a wrong secret, a replayed timestamp.
 */

const secret = 'whsec_test_secret';
// Deliberately not canonical JSON: a verifier that re-serialised would fail here.
const rawBody = '{"action":"opened",  "number": 7}';
const now = new Date('2026-09-17T12:00:00Z');
const ts = String(Math.floor(now.getTime() / 1000));
const hex = (data: string, key = secret, algo = 'sha256') => createHmac(algo, key).update(data).digest('hex');
const b64 = (data: string, key = secret) => createHmac('sha256', key).update(data).digest('base64');

const check = (verifier: Parameters<typeof verifyWebhook>[0], headers: Record<string, string>, overrides: Partial<{ rawBody: string; secret: string; config: object }> = {}) =>
  verifyWebhook(verifier, (overrides.config ?? {}) as never, { rawBody: overrides.rawBody ?? rawBody, headers, secret: overrides.secret ?? secret, now });

describe('GitHub', () => {
  const headers = () => ({ 'x-hub-signature-256': `sha256=${hex(rawBody)}` });
  it('accepts a genuine delivery', () => expect(check('GITHUB', headers())).toEqual({ ok: true }));
  it('refuses a changed body, a wrong secret, or no header', () => {
    expect(check('GITHUB', headers(), { rawBody: '{"action":"opened","number":7}' }).ok).toBe(false);
    expect(check('GITHUB', headers(), { secret: 'other' }).ok).toBe(false);
    expect(check('GITHUB', {})).toEqual({ ok: false, reason: 'missing X-Hub-Signature-256 header' });
  });
});

describe('Stripe', () => {
  const header = (t = ts, extra = '') => ({ 'stripe-signature': `t=${t},v1=${hex(`${t}.${rawBody}`)}${extra}` });
  it('accepts a genuine delivery, including during a secret rotation', () => {
    expect(check('STRIPE', header())).toEqual({ ok: true });
    expect(check('STRIPE', { 'stripe-signature': `t=${ts},v1=${'0'.repeat(64)},v1=${hex(`${ts}.${rawBody}`)}` })).toEqual({ ok: true });
  });
  it('refuses a replay outside five minutes, and a signature over another timestamp', () => {
    const old = String(Number(ts) - 301);
    expect(check('STRIPE', header(old)).ok).toBe(false);
    expect(check('STRIPE', { 'stripe-signature': `t=${ts},v1=${hex(`${old}.${rawBody}`)}` }).ok).toBe(false);
    expect(check('STRIPE', { 'stripe-signature': 'garbage' }).ok).toBe(false);
  });
});

describe('Slack', () => {
  const headers = (t = ts) => ({ 'x-slack-signature': `v0=${hex(`v0:${t}:${rawBody}`)}`, 'x-slack-request-timestamp': t });
  it('accepts a genuine delivery', () => expect(check('SLACK', headers())).toEqual({ ok: true }));
  it('refuses a stale timestamp or a mismatched one', () => {
    expect(check('SLACK', headers(String(Number(ts) - 600))).ok).toBe(false);
    expect(check('SLACK', { ...headers(), 'x-slack-request-timestamp': String(Number(ts) - 1) }).ok).toBe(false);
  });
});

describe('Shopify', () => {
  it('accepts a base64 digest and refuses a hex one', () => {
    expect(check('SHOPIFY', { 'x-shopify-hmac-sha256': b64(rawBody) })).toEqual({ ok: true });
    expect(check('SHOPIFY', { 'x-shopify-hmac-sha256': hex(rawBody) }).ok).toBe(false);
  });
});

describe('generic HMAC and shared header', () => {
  it('honours header, algorithm, encoding and prefix', () => {
    const config = { header: 'X-Signature', algorithm: 'sha512', encoding: 'hex', prefix: 'sha512=' };
    expect(check('HMAC', { 'x-signature': `sha512=${hex(rawBody, secret, 'sha512')}` }, { config })).toEqual({ ok: true });
    expect(check('HMAC', { 'x-signature': hex(rawBody, secret, 'sha512') }, { config }).ok).toBe(false);
    expect(check('HMAC', {}, { config: {} }).ok).toBe(false);
  });

  it('compares a shared token exactly', () => {
    const config = { header: 'X-Webhook-Token' };
    expect(check('HEADER', { 'x-webhook-token': secret }, { config })).toEqual({ ok: true });
    expect(check('HEADER', { 'x-webhook-token': `${secret}x` }, { config }).ok).toBe(false);
  });

  it('refuses everything but NONE when no secret is available', () => {
    expect(verifyWebhook('GITHUB', {}, { rawBody, headers: {}, secret: undefined }).ok).toBe(false);
    expect(verifyWebhook('NONE', {}, { rawBody, headers: {}, secret: undefined }).ok).toBe(true);
  });
});

describe('delivery ids', () => {
  it('uses each platform’s own id', () => {
    expect(deliveryIdOf('GITHUB', { 'x-github-delivery': 'g-1' }, {})).toBe('g-1');
    expect(deliveryIdOf('STRIPE', {}, { id: 'evt_1' })).toBe('evt_1');
    expect(deliveryIdOf('SLACK', {}, { event_id: 'Ev1' })).toBe('Ev1');
    expect(deliveryIdOf('SHOPIFY', { 'x-shopify-webhook-id': 's-1' }, {})).toBe('s-1');
    expect(deliveryIdOf('HMAC', {}, {})).toBeUndefined();
  });
});
