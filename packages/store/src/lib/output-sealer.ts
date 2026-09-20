import {
  hasPath,
  isSealedValue,
  replaceAtPath,
  sealedValue,
  type JsonValue,
  type TaskDefinition,
} from '@node-flow-dev/core';
import type { SealedSecret, SecretCipher } from './secret-crypto.js';

/**
 * Seals the output fields a task declares as credentials.
 *
 * The problem this solves is narrow and was demonstrated rather than assumed: a
 * task that fetches a token writes it to its output, completing a task persists
 * its output, and so the credential sits in the execution history in clear for
 * the retention period. `UPDATE_SECRET` can avoid adding a *second* copy; only
 * this can prevent the first.
 *
 * ## Why sealing rather than redaction
 *
 * Redacting is the obvious move and it breaks the only flow that matters: the
 * next task needs the value. `${mint.output.token}` has to resolve to a token,
 * not to `"[redacted]"`.
 *
 * So the field is stored as an encrypted envelope and the engine **defers** any
 * expression that lands on one — the same mechanism `${secrets.x}` already uses,
 * for the same reason. The value reaches the task that needs it, at dispatch,
 * and is never written down in clear anywhere.
 *
 * The cost, stated because it is a real one: a sealed field cannot be used in a
 * `SWITCH` condition or a loop predicate, because the decider genuinely cannot
 * see it. That is the correct trade — a credential steering control flow would
 * have to be readable by the component that must never read it.
 */
export class OutputSealer {
  constructor(private readonly cipher?: SecretCipher) {}

  get enabled(): boolean {
    return this.cipher !== undefined;
  }

  /**
   * Seals the declared fields of a task's output.
   *
   * Returns the input untouched when nothing is declared, which is every task
   * but a handful — so the common path costs one property read.
   */
  seal(
    output: Record<string, JsonValue> | undefined,
    definition: TaskDefinition | undefined,
    context: { namespaceId: string; taskDefName: string }
  ): Record<string, JsonValue> | undefined {
    const fields = definition?.secretOutputFields ?? [];
    if (!output || fields.length === 0) return output;

    if (!this.cipher) {
      // Refusing beats storing it in clear: the definition asked for this field
      // to be protected, and quietly ignoring that is how a credential ends up
      // somewhere its author was told it would not be.
      throw new Error(
        `task "${context.taskDefName}" declares secretOutputFields but this install ` +
          'has no master key: set NODE_FLOW_SECRET_KEYS'
      );
    }

    let sealed = output;

    for (const field of fields) {
      // A field the task did not produce is not an error. Outputs are shaped by
      // whatever the task actually returned, and a conditional field that was
      // absent this time is normal.
      if (!hasPath(sealed, field)) continue;

      sealed = replaceAtPath(sealed, field, (current) => {
        if (isSealedValue(current)) return current;

        // The envelope binds to the namespace and a name derived from the task
        // and field, so a sealed value cannot be moved to a different field or
        // tenant and still open. Same reasoning as a stored secret.
        const envelope = this.cipher!.seal(
          JSON.stringify(current),
          context.namespaceId,
          `task:${context.taskDefName}:${field}`
        );

        return sealedValue(envelope as unknown as JsonValue);
      });
    }

    return sealed;
  }

  /** Opens a sealed value, for the dispatch path only. */
  open(value: JsonValue, context: { namespaceId: string; taskDefName: string; field: string }): JsonValue {
    if (!isSealedValue(value)) return value;

    if (!this.cipher) {
      throw new Error(
        'a sealed output field cannot be opened: this install has no master key configured'
      );
    }

    const plaintext = this.cipher.open(
      value.envelope as unknown as SealedSecret,
      context.namespaceId,
      `task:${context.taskDefName}:${context.field}`
    );

    return JSON.parse(plaintext) as JsonValue;
  }
}
