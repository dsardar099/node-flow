import type { JsonValue } from './definitions.js';

/**
 * A value that is stored encrypted and resolved only at dispatch.
 *
 * The marker lives in `core` because three layers have to agree on it without
 * being able to see each other's code:
 *
 *  - the **store** produces it, when a task declares `secretOutputFields`;
 *  - the **engine** must recognise it and *defer* rather than resolve — it is
 *    pure and has no key, and resolving it would write ciphertext into the next
 *    task's input where a plaintext value belongs;
 *  - the **dispatch path** opens it, into the copy handed to an executor.
 *
 * Shaped as an object with a reserved key rather than a wrapper class, because
 * it round-trips through JSONB and a class would not survive the journey.
 */

export const SEALED_MARKER = '__nfSealed';

export interface SealedValue {
  [SEALED_MARKER]: true;
  /** The envelope, opaque to everything but the cipher that made it. */
  envelope: JsonValue;
  /** Index signature so a sealed value is itself ordinary JSON. */
  [key: string]: JsonValue;
}

export function isSealedValue(value: unknown): value is SealedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[SEALED_MARKER] === true
  );
}

export function sealedValue(envelope: JsonValue): SealedValue {
  return { [SEALED_MARKER]: true, envelope };
}

/**
 * Walks a dotted path and replaces what it finds.
 *
 * Returns a new object; the input is never mutated, because the caller usually
 * still holds the plaintext it is about to hand to something else.
 */
export function replaceAtPath(
  root: Record<string, JsonValue>,
  path: string,
  replace: (current: JsonValue) => JsonValue
): Record<string, JsonValue> {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return root;

  const [head, ...rest] = segments;
  if (!(head in root)) return root;

  const current = root[head];

  if (rest.length === 0) {
    return { ...root, [head]: replace(current) };
  }

  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    return root;
  }

  return {
    ...root,
    [head]: replaceAtPath(current as Record<string, JsonValue>, rest.join('.'), replace),
  };
}

/** Whether a dotted path resolves to anything. */
export function hasPath(root: Record<string, JsonValue>, path: string): boolean {
  const segments = path.split('.').filter(Boolean);
  let cursor: JsonValue | undefined = root;

  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return false;
    if (!(segment in (cursor as Record<string, JsonValue>))) return false;
    cursor = (cursor as Record<string, JsonValue>)[segment];
  }

  return true;
}
