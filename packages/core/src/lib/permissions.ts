import { hasScope, mayReachTags, tagMatches, type Principal } from './auth.js';

/**
 * Fine-grained permissions: specific access to specific resources.
 *
 * Scopes say what a principal may do across the namespace; tags narrow that for
 * protected resources. A **resource grant** is the other direction — access to
 * one workflow (or a name prefix, or everything carrying a tag) for someone who
 * does not hold the namespace-wide scope. The two combine as an OR:
 *
 *   - the principal holds the scope for the action *and* can reach the
 *     resource's tags, or
 *   - a grant names the resource (exactly, by prefix, by tag, or `*`) with that
 *     access.
 *
 * A grant naming a resource reaches it even when it is tagged: naming the one
 * workflow a contractor may run is a more specific statement than a tag rule.
 */

export const ResourceAccess = {
  READ: 'READ',
  EXECUTE: 'EXECUTE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;
export type ResourceAccess = (typeof ResourceAccess)[keyof typeof ResourceAccess];
export const RESOURCE_ACCESS: ResourceAccess[] = Object.values(ResourceAccess);

export const ResourceType = {
  WORKFLOW: 'WORKFLOW',
  TASK_DEFINITION: 'TASK_DEFINITION',
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];
export const RESOURCE_TYPES: ResourceType[] = Object.values(ResourceType);

export interface ResourceGrant {
  resourceType: ResourceType;
  /** An exact name, a `prefix*`, `tag:key:value`, or `*` for every resource of the type. */
  resource: string;
  access: ResourceAccess[];
}

const TAG_PREFIX = 'tag:';

/** Whether `resource` is a well-formed grant target. */
export function isValidGrantTarget(resource: string): boolean {
  if (resource === '*') return true;
  if (resource.startsWith(TAG_PREFIX)) return /^[a-z][a-z0-9_.-]*:([^\s:*]+|\*)$/.test(resource.slice(TAG_PREFIX.length));
  return /^[A-Za-z0-9_.-]{1,200}\*?$/.test(resource);
}

/** Whether a grant's target covers a resource with this name and these tags. */
export function grantCovers(target: string, name: string, tags: string[]): boolean {
  if (target === '*') return true;
  if (target.startsWith(TAG_PREFIX)) {
    const pattern = target.slice(TAG_PREFIX.length);
    // The same matching as tag grants: literal, or `key:*`.
    return tags.some((tag) => tagMatches(pattern, tag));
  }
  if (target.endsWith('*')) return name.startsWith(target.slice(0, -1));
  return target === name;
}

/** Any access implies reading: you cannot run or change what you may not see. */
function includes(granted: ResourceAccess[], need: ResourceAccess): boolean {
  return need === ResourceAccess.READ ? granted.length > 0 : granted.includes(need);
}

/** Whether a principal's grants allow `need` on this resource. */
export function grantAllows(
  grants: ResourceGrant[] | undefined,
  type: ResourceType,
  name: string,
  tags: string[],
  need: ResourceAccess
): boolean {
  return (grants ?? []).some((grant) => grant.resourceType === type && includes(grant.access, need) && grantCovers(grant.resource, name, tags));
}

/** Whether a principal has any grant of this type that could allow `need` — the guard's question. */
export function hasAnyGrant(principal: Principal, type: ResourceType, need: ResourceAccess): boolean {
  return (principal.resourceGrants ?? []).some((grant) => grant.resourceType === type && includes(grant.access, need));
}

/**
 * The full decision for one resource: the scope and tags, or a grant.
 *
 * `scope` is the namespace-wide scope this action normally needs — for a
 * workflow's executions that is `executions:read`, for its definition
 * `workflows:read` — which the caller knows and this function does not.
 */
export function mayAccess(
  principal: Principal,
  resource: { type: ResourceType; name: string; tags: string[] },
  need: ResourceAccess,
  scope: string
): boolean {
  const grants = [...(principal.tagGrants ?? []), ...principal.scopes];
  if (hasScope(principal, scope) && mayReachTags(grants, resource.tags)) return true;
  return grantAllows(principal.resourceGrants, resource.type, resource.name, resource.tags, need);
}
