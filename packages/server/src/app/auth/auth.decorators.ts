import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal, ResourceAccess, ResourceType } from '@node-flow-dev/core';

/**
 * Route-level authorization, declared next to the handler it protects.
 *
 * Keeping the requirement on the handler rather than in a central table is
 * deliberate: a reviewer reading the endpoint can see what it demands without
 * cross-referencing anything, and adding an endpoint without a decision is a
 * 403 rather than an accidental grant.
 */

export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
export const REQUIRED_SCOPES = Symbol('REQUIRED_SCOPES');

/**
 * Marks a route as reachable without credentials.
 *
 * Rare and deliberately awkward to grant: health checks, the OpenAPI document
 * and the token-exchange endpoint itself. Everything else is protected by
 * default, which is the only ordering that fails safe — a forgotten decorator
 * denies access rather than granting it.
 */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Every listed scope is required, not merely one of them. */
export const RequireScopes = (...scopes: string[]) => SetMetadata(REQUIRED_SCOPES, scopes);

export const RESOURCE_GRANT = Symbol('RESOURCE_GRANT');

/**
 * Lets a principal without the route's scopes through when it holds a
 * resource grant of this type and access — someone granted EXECUTE on one
 * workflow can start that workflow without `executions:start` everywhere.
 *
 * The guard only checks that *some* grant of the kind exists; the handler must
 * then check the specific resource, which it already does for tags. A route
 * without this decorator keeps its scopes as the only way in.
 */
export const AllowResourceGrant = (resourceType: ResourceType, access: ResourceAccess) =>
  SetMetadata(RESOURCE_GRANT, { resourceType, access });

/**
 * Injects the authenticated principal.
 *
 * Never optional. A handler reaching this point has passed the guard, so a
 * missing principal is a programming error rather than an anonymous caller, and
 * it throws instead of handing back `undefined` for a call site to forget.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    if (!request.principal) {
      throw new Error('no principal on the request — is AuthGuard registered?');
    }
    return request.principal;
  }
);
