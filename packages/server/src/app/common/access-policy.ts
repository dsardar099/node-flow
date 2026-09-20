import { Scope, mayAccess, type Principal, type ResourceAccess, type ResourceType } from '@node-flow-dev/core';
import type { TagAccess } from '@node-flow-dev/store';

/**
 * A principal's access to workflows, as the repositories ask for it.
 *
 * Which namespace-wide scope stands for each access depends on what is being
 * touched — reading a definition is `workflows:read`, reading its executions
 * `executions:read` — so each caller picks the table; the grant side is the
 * same either way.
 */

export type ScopeTable = Record<ResourceAccess, string>;

/** For a workflow's definition. */
export const DEFINITION_SCOPES: ScopeTable = {
  READ: Scope.WORKFLOWS_READ,
  UPDATE: Scope.WORKFLOWS_WRITE,
  DELETE: Scope.WORKFLOWS_WRITE,
  EXECUTE: Scope.EXECUTIONS_START,
};

/** For a workflow's executions: reading them, and operating on them. */
export const EXECUTION_SCOPES: ScopeTable = {
  READ: Scope.EXECUTIONS_READ,
  EXECUTE: Scope.EXECUTIONS_WRITE,
  UPDATE: Scope.EXECUTIONS_WRITE,
  DELETE: Scope.EXECUTIONS_WRITE,
};

export function accessPolicy(principal: Principal, scopes: ScopeTable = DEFINITION_SCOPES, type: ResourceType = 'WORKFLOW'): TagAccess {
  return {
    tagGrants: [...(principal.tagGrants ?? []), ...principal.scopes],
    can: (need, name, tags) => mayAccess(principal, { type, name, tags }, need, scopes[need]),
  };
}

/** One decision, for code that is not going through a repository. */
export function mayUse(
  principal: Principal,
  need: ResourceAccess,
  resource: { name: string; tags: string[]; type?: ResourceType },
  scopes: ScopeTable = DEFINITION_SCOPES
): boolean {
  return mayAccess(principal, { type: resource.type ?? 'WORKFLOW', name: resource.name, tags: resource.tags }, need, scopes[need]);
}
