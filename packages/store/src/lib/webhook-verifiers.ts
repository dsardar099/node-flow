import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature checks for inbound webhooks, one per platform.
 *
 * Each platform signs differently — what is signed, with which hash, encoded
 * how, carried in which header, with or without a timestamp — and getting any
 * detail wrong means either rejecting every real delivery or, worse, accepting
 * forged ones. So each is a preset rather than a set of knobs, and the generic
 * `HMAC` preset is there for everything else.
 *
 * Every check runs over the **raw bytes** the sender signed: a body parsed and
 * re-serialised changes whitespace and key order, and no signature survives it.
 * Comparisons are constant-time. Timestamped schemes reject deliveries older
 * than five minutes, which is what makes a captured request useless later.
 */

export const WEBHOOK_VERIFIERS = ['GITHUB', 'STRIPE', 'SLACK', 'SHOPIFY', 'HMAC', 'HEADER', 'NONE'] as const;
export type WebhookVerifier = (typeof WEBHOOK_VERIFIERS)[number];

export interface HmacVerifierConfig {
  /** Header carrying the signature, e.g. `x-signature`. */
  header: string;
  algorithm?: 'sha256' | 'sha1' | 'sha512';
  encoding?: 'hex' | 'base64';
  /** Text before the digest in the header, e.g. `sha256=`. */
  prefix?: string;
}

export interface HeaderVerifierConfig {
  /** Header whose value must equal the secret, e.g. `x-webhook-token`. */
  header: string;
}

export type WebhookVerifierConfig = Partial<HmacVerifierConfig> & Partial<HeaderVerifierConfig>;

export interface VerificationInput {
  rawBody: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  secret: string | undefined;
  now?: Date;
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function verifyWebhook(
  verifier: WebhookVerifier,
  config: WebhookVerifierConfig,
  input: VerificationInput
): VerificationResult {
  if (verifier === 'NONE') return { ok: true };
  if (!input.secret) return { ok: false, reason: 'the webhook has no secret to verify with' };
  const { rawBody, headers, secret } = input;
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);

  switch (verifier) {
    case 'GITHUB': {
      const header = headers['x-hub-signature-256'];
      if (!header?.startsWith('sha256=')) return missing('X-Hub-Signature-256');
      return compare(header.slice('sha256='.length), hmac('sha256', secret, rawBody, 'hex'));
    }

    case 'STRIPE': {
      const header = headers['stripe-signature'];
      if (!header) return missing('Stripe-Signature');
      const parts = header.split(',').map((part) => part.split('=') as [string, string]);
      const timestamp = parts.find(([key]) => key === 't')?.[1];
      const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
      if (!timestamp || signatures.length === 0) return { ok: false, reason: 'Stripe-Signature is malformed' };
      const stale = tooOld(timestamp, now);
      if (stale) return stale;
      const expected = hmac('sha256', secret, `${timestamp}.${rawBody}`, 'hex');
      // Stripe sends one v1 per active secret during a rotation; any may match.
      return signatures.some((signature) => compare(signature, expected).ok)
        ? { ok: true }
        : { ok: false, reason: 'signature does not match' };
    }

    case 'SLACK': {
      const header = headers['x-slack-signature'];
      const timestamp = headers['x-slack-request-timestamp'];
      if (!header?.startsWith('v0=')) return missing('X-Slack-Signature');
      if (!timestamp) return missing('X-Slack-Request-Timestamp');
      const stale = tooOld(timestamp, now);
      if (stale) return stale;
      return compare(header.slice(3), hmac('sha256', secret, `v0:${timestamp}:${rawBody}`, 'hex'));
    }

    case 'SHOPIFY': {
      const header = headers['x-shopify-hmac-sha256'];
      if (!header) return missing('X-Shopify-Hmac-Sha256');
      return compare(header, hmac('sha256', secret, rawBody, 'base64'));
    }

    case 'HMAC': {
      const name = config.header?.toLowerCase();
      if (!name) return { ok: false, reason: 'the HMAC verifier has no header configured' };
      const header = headers[name];
      if (!header) return missing(config.header as string);
      const prefix = config.prefix ?? '';
      if (!header.startsWith(prefix)) return { ok: false, reason: `${config.header} does not start with "${prefix}"` };
      return compare(
        header.slice(prefix.length),
        hmac(config.algorithm ?? 'sha256', secret, rawBody, config.encoding ?? 'hex')
      );
    }

    case 'HEADER': {
      const name = config.header?.toLowerCase();
      if (!name) return { ok: false, reason: 'the header verifier has no header configured' };
      const header = headers[name];
      if (!header) return missing(config.header as string);
      return compare(header, secret);
    }
  }
}

/**
 * The sender's own id for a delivery, when it provides one.
 *
 * What makes a retried delivery start one workflow rather than two: the id is
 * the idempotency key downstream. Without one a fresh id is minted, so two
 * genuinely identical events are not mistaken for a retry.
 */
export function deliveryIdOf(
  verifier: WebhookVerifier,
  headers: Record<string, string | undefined>,
  body: Record<string, unknown>
): string | undefined {
  switch (verifier) {
    case 'GITHUB':
      return headers['x-github-delivery'];
    case 'STRIPE':
      return typeof body['id'] === 'string' ? body['id'] : undefined;
    case 'SLACK':
      return typeof body['event_id'] === 'string' ? body['event_id'] : undefined;
    case 'SHOPIFY':
      return headers['x-shopify-webhook-id'];
    default:
      return headers['x-delivery-id'] ?? headers['x-request-id'] ?? headers['idempotency-key'];
  }
}

function hmac(algorithm: string, secret: string, data: string, encoding: 'hex' | 'base64'): string {
  return createHmac(algorithm, secret).update(data, 'utf8').digest(encoding);
}

function compare(received: string, expected: string): VerificationResult {
  const a = Buffer.from(received.trim());
  const b = Buffer.from(expected);
  // Length first: timingSafeEqual throws on a mismatch, and a length leaks nothing a digest's does not.
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature does not match' };
}

function missing(header: string): VerificationResult {
  return { ok: false, reason: `missing ${header} header` };
}

function tooOld(timestamp: string, now: number): VerificationResult | undefined {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'the signature timestamp is not a number' };
  return Math.abs(now - sent) > TIMESTAMP_TOLERANCE_SECONDS
    ? { ok: false, reason: 'the signature timestamp is outside the five-minute window' }
    : undefined;
}
