import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * Unlike an API key, a password is *chosen by a person* — so it has perhaps 30
 * bits of real entropy against a dictionary, not 256. That is the entire reason
 * this file exists and looks nothing like `hashApiKey`: the only defence
 * against an offline attack on a leaked table is making each guess expensive.
 *
 * scrypt rather than bcrypt or PBKDF2 because it is memory-hard, which is what
 * blunts GPU and ASIC attacks — the ones that matter. Argon2id would be a
 * marginal improvement and needs a native dependency; scrypt is in Node.
 */

/**
 * Cost parameters, stored *with* each hash rather than hard-coded.
 *
 * Hard-coding them means they can never be raised: every existing hash would
 * become unverifiable. Encoding them per-hash makes the cost a property of the
 * stored value, so it can be increased and old hashes upgraded on their owner's
 * next successful login.
 *
 * N=2^15 with r=8 is ~32 MB and ~100ms on current hardware — slow enough to
 * matter to an attacker, fast enough that a login does not feel broken.
 */
const CURRENT = { N: 32_768, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** scrypt needs headroom above 128·N·r, and Node's default is too low for N=2^15. */
const maxmemFor = (N: number, r: number) => 256 * N * r;

export interface PasswordPolicyProblem {
  code: 'too_short' | 'too_long' | 'contains_identifier' | 'too_common';
  message: string;
}

/**
 * Minimum length, and nothing else.
 *
 * Composition rules — an uppercase, a digit, a symbol — are actively harmful:
 * they push people towards `Password1!` and towards reuse, and NIST dropped
 * them for exactly that reason. Length is the property that actually
 * correlates with strength.
 *
 * The upper bound is not a strength rule. It stops a megabyte "password" being
 * fed to a deliberately expensive KDF, which is a denial-of-service against the
 * login endpoint.
 */
const MIN_LENGTH = 12;
const MAX_LENGTH = 200;

/**
 * A short list of the passwords that actually get tried first.
 *
 * Not a substitute for a real breach corpus — that is megabytes and belongs
 * behind a service — but these cost nothing to reject and are what an
 * unattended credential-stuffing run opens with.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456789012',
  'qwertyuiop12', 'administrator', 'letmein12345', 'welcome12345',
  'changeme1234', 'iloveyou1234', 'monkey123456', 'football1234',
]);

/** Returns every problem at once, so a person fixes them in one attempt. */
export function checkPasswordPolicy(
  password: string,
  identifiers: string[] = []
): PasswordPolicyProblem[] {
  const problems: PasswordPolicyProblem[] = [];

  if (password.length < MIN_LENGTH) {
    problems.push({
      code: 'too_short',
      message: `password must be at least ${MIN_LENGTH} characters`,
    });
  }

  if (password.length > MAX_LENGTH) {
    problems.push({
      code: 'too_long',
      message: `password must be at most ${MAX_LENGTH} characters`,
    });
  }

  const lowered = password.toLowerCase();

  if (COMMON.has(lowered)) {
    problems.push({ code: 'too_common', message: 'password is too common' });
  }

  // A password containing the email or name is the first thing tried against a
  // known account, and it defeats the length requirement it appears to satisfy.
  for (const identifier of identifiers) {
    const part = identifier.toLowerCase().split('@')[0];
    if (part.length >= 3 && lowered.includes(part)) {
      problems.push({
        code: 'contains_identifier',
        message: 'password must not contain your name or email',
      });
      break;
    }
  }

  return problems;
}

/**
 * Hashes a password into a self-describing string.
 *
 * Format: `scrypt$N$r$p$salt$hash`, both parts base64url. Modelled on the PHC
 * convention for the same reason it exists — the verifier reads the parameters
 * from the stored value instead of assuming today's.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = CURRENT;
  const derived = await scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem: maxmemFor(N, r) });

  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export interface VerifyResult {
  valid: boolean;
  /** True when the stored hash used weaker parameters than are current. */
  needsRehash: boolean;
}

/**
 * Verifies a password against a stored hash.
 *
 * Never throws on a malformed hash — it returns invalid. A corrupt row must not
 * turn a login into a 500, which would tell an attacker they had found
 * something interesting.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<VerifyResult> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { valid: false, needsRehash: false };

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);

  // Bound the parameters read from storage. They are trusted today, but a hash
  // is attacker-influenced data the moment anything can write one, and
  // `N = 2^40` from a poisoned row is a memory-exhaustion attack.
  if (!Number.isInteger(N) || N < 1024 || N > 1_048_576) return { valid: false, needsRehash: false };
  if (!Number.isInteger(r) || r < 1 || r > 32) return { valid: false, needsRehash: false };
  if (!Number.isInteger(p) || p < 1 || p > 16) return { valid: false, needsRehash: false };

  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });

    const valid =
      derived.length === expected.length && timingSafeEqual(derived, expected);

    return {
      valid,
      needsRehash: valid && (N < CURRENT.N || r < CURRENT.r || p < CURRENT.p),
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/**
 * Burns roughly the time a real verification would.
 *
 * Called when the account does not exist. Returning immediately makes an
 * unknown email measurably faster than a wrong password, which is a
 * user-enumeration oracle — and one that is trivially exploitable, because the
 * difference is the ~100ms the KDF costs.
 */
export async function fakeVerify(password: string): Promise<void> {
  const { N, r, p } = CURRENT;
  await scrypt(password, Buffer.alloc(SALT_BYTES), KEY_BYTES, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
}
