/**
 * Postgres error classification.
 *
 * Repositories that race — two registrations of the same version, two schedules
 * claiming one run — rely on a unique constraint as the real guard and need to
 * tell "someone beat me to it" apart from "the database is broken". That
 * distinction is a five-character SQLSTATE, and it was being rewritten inline
 * in every repository that needed it, so each new one had to rediscover which
 * code to compare against.
 *
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/** `unique_violation` — a UNIQUE constraint or primary key rejected a row. */
export const UNIQUE_VIOLATION = '23505';

/** `foreign_key_violation` — a referenced row does not exist, or is still referenced. */
export const FOREIGN_KEY_VIOLATION = '23503';

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * Whether a unique constraint rejected the write.
 *
 * Callers use this to turn a lost race into the same answer the sequential case
 * would have given, which is why it must match on the SQLSTATE rather than the
 * message: the message names the constraint and changes with the schema.
 */
export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === UNIQUE_VIOLATION;
}

/** Whether a foreign key constraint rejected the write. */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === FOREIGN_KEY_VIOLATION;
}
