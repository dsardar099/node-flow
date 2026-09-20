import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, z } from 'zod';

/**
 * Validates a request against a zod schema.
 *
 * `class-validator` is the Nest default and is deliberately not used. The DSL,
 * the storage types and the OpenAPI document are already generated from zod
 * schemas in `core`; validating requests with a second, decorator-based system
 * would mean maintaining two descriptions of the same shapes and letting them
 * drift. One source of truth was the point of choosing zod at all.
 *
 * The pipe also *parses*: defaults are applied and unknown keys stripped, so a
 * handler receives exactly the declared shape rather than whatever was sent.
 */
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Every problem at once. Returning only the first turns fixing a request
    // into a guessing loop, one round trip per field.
    throw new BadRequestException({
      error: 'validation_failed',
      message: 'request did not match the expected shape',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
}

/** Convenience for the common `@Body(zodBody(schema))` case. */
export const zodBody = <T extends ZodType>(schema: T) => new ZodValidationPipe(schema);
