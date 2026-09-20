import type { JsonValue } from './definitions.js';

/**
 * Masking: hiding sensitive values from people reading an execution.
 *
 * A workflow declares `maskedFields` — key names such as `password` or
 * `cardNumber` — and wherever an execution is *read* (the API, the UI, the
 * history, the live stream) the value under any key with one of those names is
 * replaced, at any depth. What is stored is untouched: workers and expressions
 * still need the real value, which is the difference from sealing, where the
 * value is encrypted and only ever unsealed for a worker.
 */

export const MASKED_VALUE = '***';

/** A copy of `value` with every property named in `fields` replaced. Returns `value` itself when there is nothing to mask. */
export function maskFields<T>(value: T, fields: ReadonlySet<string>): T {
  if (fields.size === 0) return value;
  return mask(value as unknown as JsonValue, fields) as unknown as T;
}

function mask(value: JsonValue, fields: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map((item) => mask(item, fields));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, JsonValue> = {};
  for (const [key, inner] of Object.entries(value)) {
    // `null` stays null: masking it would claim there was a secret where there was none.
    out[key] = fields.has(key) && inner !== null ? MASKED_VALUE : mask(inner, fields);
  }
  return out;
}
