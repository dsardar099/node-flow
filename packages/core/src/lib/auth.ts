import type { ResourceGrant } from './permissions.js';
/**
 * Who is calling, and what they are allowed to do.
 *
 * Every authentication mechanism — API key now, service-account JWT now, mTLS
 * and OIDC workload identity in Phase 5 — resolves to a {@link Principal}, and
 * **every authorization decision reads only the Principal**. That indirection is
 * the whole point: adding a mechanism later touches the authenticator chain and
 * nothing else. Without it, each new mechanism means revisiting every call site
 * that asked "is this request allowed?".
 *
 * Pure types and string matching, no framework, so the rules are unit-testable
 * without a server.
 */

export const PrincipalType = {
  /** A worker fleet or automation, authenticated by key/secret or API key. */
  SERVICE_ACCOUNT: 'SERVICE_ACCOUNT',
  /** A human, authenticated by SSO. Phase 5. */
  USER: 'USER',
  /** Internal machinery — runners, the relay. Never reachable over HTTP. */
  SYSTEM: 'SYSTEM',
} as const;

export type PrincipalType = (typeof PrincipalType)[keyof typeof PrincipalType];

export interface Principal {
  type: PrincipalType;
  /** Stable identifier — service account id, user id, or `system`. */
  id: string;
  /** Human-readable, for audit lines and error messages. */
  name: string;
  /**
   * The namespace this principal may act in.
   *
   * A principal belongs to exactly one namespace. Cross-namespace access is a
   * separate feature, not a wider scope string, precisely so that no scope typo
   * can ever grant it.
   */
  namespaceId: string;
  scopes: string[];
  /**
   * Tag patterns this principal may reach, from its groups.
   *
   * Absent means "no tag grants", which reaches only untagged resources —
   * never "unrestricted". A principal that could reach anything by omitting a
   * field is the shape of a check that fails open.
   */
  tagGrants?: string[];
  /**
   * Per-resource permissions from the permissions table — for this principal,
   * its groups, or its service account. Absent means none.
   */
  resourceGrants?: ResourceGrant[];
}

/**
 * Scopes are `resource:action` and may end in a `:*` wildcard.
 *
 * Queue scopes carry a third segment — the queue name — because "may lease
 * work" is not a useful granularity for a worker fleet. A fleet that processes
 * `charge` should not be able to drain `send_email`, and expressing that needs
 * the queue in the scope.
 */
export const Scope = {
  WORKFLOWS_READ: 'workflows:read',
  WORKFLOWS_WRITE: 'workflows:write',

  EXECUTIONS_READ: 'executions:read',
  EXECUTIONS_START: 'executions:start',
  /** Pause, resume, retry, terminate — operational control of a live execution. */
  EXECUTIONS_WRITE: 'executions:write',

  /** `queues:lease:<queueName>`; `queues:lease:*` for any queue. */
  QUEUES_LEASE: 'queues:lease',
  /** Reporting a result is fenced by the lease token, so it needs no per-queue scope. */
  TASKS_REPORT: 'tasks:report',

  /**
   * Scraping the metrics endpoint.
   *
   * A separate scope rather than folding it into `admin`, because the scraper
   * is a long-lived automated credential and should not also be able to mint
   * new ones. It is deliberately not public either: the gauges expose
   * install-wide backlog and execution counts.
   */
  METRICS_READ: 'metrics:read',

  /**
   * Seeing and acting on human tasks.
   *
   * Separate from `executions:*` because the audiences are different: the
   * people who approve a refund or review a document are not the people who
   * operate the engine, and granting one should not grant the other. Read
   * covers the inbox; write covers claiming and completing.
   */
  HUMAN_TASKS_READ: 'human-tasks:read',
  HUMAN_TASKS_WRITE: 'human-tasks:write',

  /** Namespace, service-account and API-key administration. */
  ADMIN: 'admin',

  /**
   * Creating and listing **namespaces** — the tenants themselves.
   *
   * Above `admin` rather than inside it, and the one scope `admin` does not
   * satisfy. A namespace administrator runs their tenant; deciding that another
   * tenant should exist, and seeing the list of who the tenants are, is a
   * different job with a different blast radius. Folding it into `admin` would
   * mean every tenant's administrator could enumerate every other tenant by
   * name, which is a disclosure a multi-tenant install cannot make.
   */
  PLATFORM_ADMIN: 'platform:admin',
} as const;

/**
 * Builds the scope required to lease from one queue.
 *
 * A domained queue (`charge:eu-west`) therefore needs
 * `queues:lease:charge:eu-west`. A grant of `queues:lease:charge` does **not**
 * cover it, which is deliberate: domains exist to isolate fleets, so a fleet
 * must be named explicitly. `queues:lease:charge:*` grants every domain of one
 * task, and `queues:lease:*` grants everything.
 */
export function queueScope(queueName: string): string {
  return `${Scope.QUEUES_LEASE}:${queueName}`;
}

/**
 * Whether `granted` satisfies `required`.
 *
 * Matching is exact or by trailing wildcard, and nothing else. No prefix
 * matching, no hierarchy inference: `executions:read` must never accidentally
 * satisfy `executions:readwrite`, and a scope language rich enough to be
 * surprising is a scope language that will eventually grant something nobody
 * intended.
 *
 * `admin` satisfies everything — one explicit exception, easy to audit.
 */
export function scopeSatisfies(granted: string, required: string): boolean {
  // The one thing `admin` does not cover, and the reason is the whole point of
  // multi-tenancy: a tenant's administrator must not be able to create tenants
  // or enumerate them. Granted only by its exact name — not by `admin`, not by
  // a wildcard — so it can never be acquired by accident.
  if (required === Scope.PLATFORM_ADMIN) return granted === Scope.PLATFORM_ADMIN;

  if (granted === Scope.ADMIN) return true;
  if (granted === required) return true;

  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1); // keep the trailing ':'
    return required.startsWith(prefix) && required.length > prefix.length;
  }

  return false;
}

/** Whether a principal holds a scope. */
export function hasScope(principal: Principal, required: string): boolean {
  return principal.scopes.some((granted) => scopeSatisfies(granted, required));
}

/** Whether a principal holds *every* listed scope. Absent means allow. */
export function hasAllScopes(principal: Principal, required: readonly string[]): boolean {
  return required.every((scope) => hasScope(principal, scope));
}

/**
 * Rejects a scope string that cannot be satisfied.
 *
 * Granting a scope nobody can ever hold is silent: the service account is
 * created, the operator believes it is authorised, and every call 403s. Checked
 * when scopes are assigned rather than when they are evaluated.
 */
export function isValidScope(scope: string): boolean {
  if (scope === Scope.ADMIN) return true;
  // Hyphens are allowed inside a segment but never at either end, so
  // `human-tasks:read` is valid and `-human:read` or `human-:read` are not.
  // The earlier pattern had no hyphen at all, which silently made every
  // multi-word scope name unissuable — found when `human-tasks:read` was
  // rejected as invalid at user creation.
  return /^[a-z]+(-[a-z]+)*:([a-z]+(-[a-z]+)*|\*)(:[A-Za-z0-9_.:*-]+)?$/.test(scope);
}

/** The in-process principal used by runners and other non-HTTP callers. */
export function systemPrincipal(namespaceId: string): Principal {
  return {
    type: PrincipalType.SYSTEM,
    id: 'system',
    name: 'system',
    namespaceId,
    scopes: [Scope.ADMIN],
  };
}

/**
 * Whether a principal may reach a resource carrying these tags.
 *
 * **Tags restrict; they never grant.** An untagged resource is governed by
 * scopes alone — the same access it had before tagging existed. A tagged
 * resource additionally requires a grant matching at least one of its tags.
 *
 * So adding a tag can only narrow access. The mistake it invites is locking
 * yourself out, which is loud; the opposite model — tags as grants — fails
 * quietly, because a resource nobody has tagged yet is reachable by everyone,
 * and forgetting to tag something is far more common than forgetting to grant.
 *
 * Matching reuses the scope rule exactly: literal, or a trailing `*`. One
 * matching syntax in the system rather than two.
 */
export function mayReachTags(granted: string[], tags: string[]): boolean {
  if (tags.length === 0) return true;
  if (granted.includes(Scope.ADMIN)) return true;

  return tags.some((tag) => granted.some((grant) => tagMatches(grant, tag)));
}

/** A grant matches a tag literally, or by trailing wildcard. */
export function tagMatches(grant: string, tag: string): boolean {
  if (grant === tag) return true;

  if (grant.endsWith(':*')) {
    const prefix = grant.slice(0, -1);
    return tag.startsWith(prefix) && tag.length > prefix.length;
  }

  return false;
}

/**
 * Tags are `key:value`, and are validated when set.
 *
 * Rejected at write time rather than silently accepted: a malformed tag can be
 * stored and can never be matched by a grant, which presents later as a
 * resource nobody can reach and nothing to explain why.
 */
export function isValidTag(tag: string): boolean {
  return /^[a-z][a-z0-9-]*:[A-Za-z0-9_.*-]+$/.test(tag);
}
