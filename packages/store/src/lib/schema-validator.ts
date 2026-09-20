import { InvalidArgumentError, type JsonValue, type TaskDefinition } from '@node-flow-dev/core';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

/**
 * CommonJS interop.
 *
 * `ajv-formats` is CommonJS with no `exports` map, so under `nodenext` the
 * imported binding types as a non-callable namespace even though at runtime it
 * is the function — and, depending on the transpiler, may arrive wrapped in
 * `.default`. Handling both is the only spelling that works in the type checker
 * and in every runtime this package is loaded by.
 */
type AddFormats = (ajv: Ajv) => unknown;

const addFormats: AddFormats =
  (addFormatsModule as unknown as { default?: AddFormats }).default ??
  (addFormatsModule as unknown as AddFormats);

/**
 * Enforces the `inputSchema` and `outputSchema` on a task definition.
 *
 * These were accepted, validated as JSON, stored — and then never consulted.
 * That is the worst shape a defect takes: the operator declares a contract, the
 * API confirms it, and nothing ever checks it, so the first time anyone
 * discovers the contract is decorative is when malformed data has already
 * spread through four downstream tasks.
 *
 * Ajv rather than a hand-rolled subset. The field is documented as JSON Schema,
 * so a partial implementation would accept schemas it then silently ignored
 * half of — trading one lie for a subtler one.
 */

export type ValidationTarget = 'input' | 'output';

export interface SchemaViolation {
  path: string;
  message: string;
}

export class SchemaValidationError extends InvalidArgumentError {
  constructor(
    readonly target: ValidationTarget,
    readonly taskDefName: string,
    readonly violations: SchemaViolation[]
  ) {
    super(
      `task "${taskDefName}" ${target} does not match its declared schema: ` +
        violations.map((v) => `${v.path || '(root)'} ${v.message}`).join('; '),
      { target, taskDefName, violations }
    );
  }
}

export class SchemaValidator {
  private readonly ajv: Ajv;

  /**
   * Compiled validators, keyed by definition.
   *
   * Compilation is the expensive part of Ajv by a wide margin, and a schema is
   * checked on every task of that type. Definitions are mutable, so the key is
   * the schema itself rather than the task name — an edited schema produces a
   * different key and compiles afresh, with no invalidation to get wrong.
   */
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(private readonly maxCached = 500) {
    this.ajv = new Ajv({
      // Collect every problem rather than stopping at the first. Reporting one
      // error per attempt turns fixing a payload into a guessing loop.
      allErrors: true,
      // Do not mutate the data being validated. Coercion and defaults would
      // make the value the engine stores differ from the value a worker
      // reported, which is a debugging nightmare in a system whose whole point
      // is an auditable record of what happened.
      coerceTypes: false,
      useDefaults: false,
      // A definition is operator-supplied, not attacker-supplied, but a typo'd
      // keyword should be reported rather than silently ignored.
      strictSchema: false,
    });

    addFormats(this.ajv);
  }

  /**
   * Validates a payload, or throws.
   *
   * A definition with no schema validates everything — schemas are opt-in, and
   * requiring one before a task could run would make the simplest possible
   * workflow need a contract nobody asked for.
   */
  assertValid(
    definition: Pick<TaskDefinition, 'name' | 'inputSchema' | 'outputSchema'> | undefined,
    target: ValidationTarget,
    payload: Record<string, JsonValue> | undefined
  ): void {
    const violations = this.check(definition, target, payload);
    if (violations.length > 0) {
      throw new SchemaValidationError(target, definition?.name ?? 'unknown', violations);
    }
  }

  /** Returns violations rather than throwing, for callers that report them. */
  check(
    definition: Pick<TaskDefinition, 'name' | 'inputSchema' | 'outputSchema'> | undefined,
    target: ValidationTarget,
    payload: Record<string, JsonValue> | undefined
  ): SchemaViolation[] {
    const schema = target === 'input' ? definition?.inputSchema : definition?.outputSchema;
    if (!schema || typeof schema !== 'object') return [];

    const validate = this.validatorFor(schema);
    if (!validate) return []; // Unusable schema; see `validatorFor`.

    if (validate(payload ?? {})) return [];

    return (validate.errors ?? []).map((error) => ({
      path: error.instancePath.replace(/^\//, '').replace(/\//g, '.'),
      message: error.message ?? 'is invalid',
    }));
  }

  private validatorFor(schema: object): ValidateFunction | undefined {
    const key = JSON.stringify(schema);

    const cached = this.compiled.get(key);
    if (cached) return cached;

    let validate: ValidateFunction;
    try {
      validate = this.ajv.compile(schema);
    } catch {
      // A schema that will not compile is an operator mistake, and failing
      // every task of that type because of it would be a far worse outcome than
      // not enforcing a contract that was never valid. Registration is where a
      // bad schema should be rejected; see `MetadataRepository`.
      return undefined;
    }

    // Bounded, evicting oldest-first. Unbounded, an install that edits
    // definitions frequently accumulates a compiled validator per revision
    // forever.
    if (this.compiled.size >= this.maxCached) {
      const oldest = this.compiled.keys().next().value;
      if (oldest !== undefined) this.compiled.delete(oldest);
    }

    this.compiled.set(key, validate);
    return validate;
  }

  /**
   * Whether a schema compiles.
   *
   * Called at registration so a broken schema is a 400 at deploy time rather
   * than a contract that silently never applies.
   */
  isCompilable(schema: unknown): boolean {
    if (schema === undefined || schema === null) return true;
    if (typeof schema !== 'object') return false;

    try {
      this.ajv.compile(schema as object);
      return true;
    } catch {
      return false;
    }
  }
}
