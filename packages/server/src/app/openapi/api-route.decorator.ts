import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Describes one endpoint for the OpenAPI document.
 *
 * The schemas here are the *same objects* the validation pipes use — not a
 * restatement of them. That is the whole point: a hand-written spec drifts from
 * the code the day someone adds a field, and a spec generated from decorator
 * DTOs drifts from the zod schemas the engine actually validates against.
 * Passing the real schema means the document cannot describe a shape the server
 * would reject.
 */

export const API_ROUTE = Symbol('API_ROUTE');

export interface ApiRouteSpec {
  summary: string;
  description?: string;
  tags?: string[];
  /** Request body schema. Omit for endpoints that take none. */
  body?: ZodType;
  /** Success response schema. */
  response?: ZodType;
  /** Path and query parameters, as a zod object of primitives. */
  query?: ZodType;
  /** Status returned on success. Defaults to the handler's `@HttpCode`. */
  status?: number;
}

export const ApiRoute = (spec: ApiRouteSpec) => SetMetadata(API_ROUTE, spec);
