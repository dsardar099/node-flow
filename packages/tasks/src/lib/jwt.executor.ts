import { constants, createHmac, createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `GET_SIGNED_JWT` — mints a signed JWT for calling a downstream service.
 *
 * The task that makes the rest of a workflow able to authenticate. Service
 * accounts at Google, Apple, Snowflake and most enterprise APIs are reached by
 * signing a short-lived assertion with a private key, and without this the only
 * options are an `INLINE` script (which would need the key inside a sandbox
 * that deliberately has no crypto) or a bespoke worker per integration.
 *
 * ## Why the signing happens here and not in a worker
 *
 * The private key is the most sensitive value a workflow ever touches. Keeping
 * the signing in-process means the key is read once, used, and never leaves —
 * rather than being handed to a worker fleet, logged by whatever that fleet
 * logs, and stored in whatever it stores.
 *
 * That same reasoning is why the key is **never echoed into the output**. A
 * task's output is persisted, indexed and displayed in the UI; a private key
 * there outlives its usefulness in a place nobody thinks to rotate.
 */

/**
 * Algorithms, mapped to what `node:crypto` needs.
 *
 * `none` is deliberately absent. It is a legal JWT algorithm and it is the
 * single most exploited weakness in JWT's history — a token signed with `none`
 * validates against any verifier that honours the header. There is no
 * legitimate use for it here.
 */
const ALGORITHMS = {
  HS256: { kind: 'hmac', hash: 'sha256' },
  HS384: { kind: 'hmac', hash: 'sha384' },
  HS512: { kind: 'hmac', hash: 'sha512' },
  RS256: { kind: 'sign', hash: 'RSA-SHA256' },
  RS384: { kind: 'sign', hash: 'RSA-SHA384' },
  RS512: { kind: 'sign', hash: 'RSA-SHA512' },
  ES256: { kind: 'ec', hash: 'RSA-SHA256' },
  ES384: { kind: 'ec', hash: 'RSA-SHA384' },
  ES512: { kind: 'ec', hash: 'RSA-SHA512' },
  PS256: { kind: 'pss', hash: 'RSA-SHA256' },
  PS384: { kind: 'pss', hash: 'RSA-SHA384' },
  PS512: { kind: 'pss', hash: 'RSA-SHA512' },
} as const;

type Algorithm = keyof typeof ALGORITHMS;

const DEFAULT_TTL_SECONDS = 3600;

export class SignedJwtTaskExecutor implements TaskExecutor {
  readonly type = TaskType.GET_SIGNED_JWT;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const algorithm = (readString(context.input, 'algorithm') ?? 'RS256').toUpperCase();
    if (!isAlgorithm(algorithm)) {
      return {
        status: 'FAILED',
        reason: `unsupported algorithm "${algorithm}"; expected one of ${Object.keys(ALGORITHMS).join(', ')}`,
        terminal: true,
      };
    }

    const key = readString(context.input, 'privateKey') ?? readString(context.input, 'secret');
    if (!key) {
      return {
        status: 'FAILED',
        reason: 'GET_SIGNED_JWT requires a "privateKey"',
        terminal: true,
      };
    }

    const ttl = readNumber(context.input, 'ttlInSecond') ?? DEFAULT_TTL_SECONDS;

    // Seconds since the epoch, which is what the spec says and what every
    // verifier reads. Milliseconds here produce a token that looks valid and is
    // rejected everywhere, with a date in the year 56,000.
    const issuedAt = Math.floor(Date.now() / 1000);

    const header: Record<string, JsonValue> = {
      alg: algorithm,
      typ: 'JWT',
      ...(readString(context.input, 'privateKeyId')
        ? { kid: readString(context.input, 'privateKeyId') as string }
        : {}),
    };

    const claims: Record<string, JsonValue> = {
      // Caller-supplied claims first, so the registered ones below cannot be
      // overwritten by a stray `exp` in the payload.
      ...readObject(context.input['payload']),
      ...defined({
        iss: readString(context.input, 'issuer'),
        sub: readString(context.input, 'subject'),
        aud: context.input['audience'] as JsonValue | undefined,
        scope: readString(context.input, 'scopes'),
      }),
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + ttl,
    };

    const signingInput = `${encode(header)}.${encode(claims)}`;

    let signature: string;
    try {
      signature = sign(signingInput, algorithm, key);
    } catch (error) {
      // A malformed key will be malformed on every attempt, so retrying only
      // delays the error someone has to read.
      return {
        status: 'FAILED',
        reason: `could not sign: ${(error as Error).message}`,
        terminal: true,
      };
    }

    return {
      status: 'COMPLETED',
      output: {
        token: `${signingInput}.${signature}`,
        // Useful for a downstream task deciding whether to mint a fresh one,
        // and cheap to carry. The key itself is deliberately not here.
        expiresAt: new Date((issuedAt + ttl) * 1000).toISOString(),
        algorithm,
      },
    };
  }
}

function sign(input: string, algorithm: Algorithm, key: string): string {
  const spec = ALGORITHMS[algorithm];

  if (spec.kind === 'hmac') {
    return base64url(createHmac(spec.hash, key).update(input).digest());
  }

  const privateKey = createPrivateKey(key);
  const signer = createSign(spec.hash);
  signer.update(input);

  if (spec.kind === 'pss') {
    return base64url(
      signer.sign({
        key: privateKey,
        // Named constants, not literals. The first version of this used
        // `1 << 5` for the padding, which is 32 and not the 6 that
        // RSA_PKCS1_PSS_PADDING actually is — every PS-family signature failed.
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      })
    );
  }

  if (spec.kind === 'ec') {
    // JWS wants the raw r‖s pair; OpenSSL produces DER. Signing without this
    // yields a token every conforming verifier rejects, which is a confusing
    // failure because the token looks entirely well-formed.
    return base64url(signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }));
  }

  return base64url(signer.sign(privateKey satisfies KeyObject));
}

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

const encode = (value: Record<string, JsonValue>): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function isAlgorithm(value: string): value is Algorithm {
  return Object.hasOwn(ALGORITHMS, value);
}

function readString(input: Record<string, JsonValue>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readNumber(input: Record<string, JsonValue>, key: string): number | undefined {
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function readObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** Drops absent claims rather than emitting `"iss": undefined`. */
function defined(claims: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(claims).filter(([, value]) => value !== undefined)
  ) as Record<string, JsonValue>;
}
