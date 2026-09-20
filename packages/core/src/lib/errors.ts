/**
 * Error taxonomy.
 *
 * Every error carries a stable `code` so the API layer can map to HTTP status
 * without string-matching messages, and so operators can alert on classes of
 * failure rather than on text that changes.
 */

export const ErrorCode = {
  INVALID_DEFINITION: 'INVALID_DEFINITION',
  COMPILATION_FAILED: 'COMPILATION_FAILED',
  EXPRESSION_FAILED: 'EXPRESSION_FAILED',
  UNKNOWN_TASK_TYPE: 'UNKNOWN_TASK_TYPE',
  UNKNOWN_TASK_REFERENCE: 'UNKNOWN_TASK_REFERENCE',
  /**
   * The caller sent something malformed that no schema could catch — a cursor
   * that does not decode, for instance.
   *
   * Distinct from `INVALID_DEFINITION`, which is specifically about a workflow
   * or task definition. Without a general code, these end up as plain `Error`s,
   * which the API layer cannot recognise and so reports as 500s — telling the
   * caller the server is broken when in fact their input was.
   */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
  TERMINAL_STATE: 'TERMINAL_STATE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class NodeFlowError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** A request argument was malformed. Maps to 400, not 500. */
export class InvalidArgumentError extends NodeFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.INVALID_ARGUMENT, message, details);
  }
}

/** A workflow definition failed validation or referential integrity checks. */
export class InvalidDefinitionError extends NodeFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.INVALID_DEFINITION, message, details);
  }
}

/** A definition was structurally valid but could not be compiled to a blueprint. */
export class CompilationError extends NodeFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.COMPILATION_FAILED, message, details);
  }
}

/** An expression could not be evaluated against the current execution state. */
export class ExpressionError extends NodeFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.EXPRESSION_FAILED, message, details);
  }
}

/**
 * A control tripped — a concurrency cap, rate limit, quota or retry budget.
 *
 * `control` names which one, because "why is my task not running?" must be
 * answerable from the execution view rather than from server logs.
 */
export class LimitExceededError extends NodeFlowError {
  constructor(control: string, message: string, details?: Record<string, unknown>) {
    super(ErrorCode.LIMIT_EXCEEDED, message, { control, ...details });
  }
}
