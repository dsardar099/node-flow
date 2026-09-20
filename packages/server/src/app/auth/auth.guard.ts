import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditRepository, ResourceGrantRepository } from '@node-flow-dev/store';
import { AUDIT_KEY } from '../common/audit.interceptor.js';
import type { PresentedCertificate } from './authenticator.js';
import { PrincipalType, hasAllScopes, hasAnyGrant, type Principal, type ResourceAccess, type ResourceType } from '@node-flow-dev/core';
import { safeEquals } from '@node-flow-dev/store';
import { NamespaceResolver } from '../common/namespace.resolver.js';
import { AuthenticatorChain, InvalidCredentialError } from './authenticator.js';
import { PUBLIC_ROUTE, REQUIRED_SCOPES, RESOURCE_GRANT } from './auth.decorators.js';
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from './session.js';

/**
 * Authenticates the request, checks the route's scopes, and confirms the URL's
 * namespace is the caller's own.
 *
 * All three in one guard, in that order, because each depends on the previous
 * one having happened. Splitting them across separate `APP_GUARD` providers put
 * their order in Nest's hands, and the namespace check — reached with no
 * principal yet established — allowed the request through. **A guard that opens
 * when its precondition is missing is not a guard**, and the ordering that made
 * it possible was invisible in review.
 *
 * Registered globally and **default-deny**: a route with no decorators requires
 * a valid principal. Protecting only what is marked protected means every new
 * endpoint is public until someone remembers, and the mistake is the *absence*
 * of a line.
 *
 * What this guard deliberately does *not* do is filter data by namespace. That
 * lives in the repositories, because a filter applied here is one the next
 * non-HTTP caller bypasses without noticing.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly chain: AuthenticatorChain,
    private readonly namespaces: NamespaceResolver,
    private readonly audit?: AuditRepository,
    private readonly grants?: ResourceGrantRepository
  ) {}

  /**
   * Records a refused attempt on an audited route.
   *
   * Best-effort and never allowed to throw: failing to write the log must not
   * turn a 403 into a 500, which would tell the caller more than the refusal
   * itself does.
   */
  private async recordDenial(
    context: ExecutionContext,
    request: { params?: Record<string, string> },
    principal: Principal,
    missing: string[]
  ): Promise<void> {
    if (!this.audit) return;

    const target = this.reflector.getAllAndOverride<{ resource: string; action: string }>(
      AUDIT_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!target) return;

    await this.audit
      .record({
        namespaceId: principal.namespaceId,
        actor: { type: principal.type, id: principal.id, name: principal.name },
        action: `${target.resource}.${target.action}`,
        resource: target.resource,
        resourceId: request.params?.['name'] ?? request.params?.['id'],
        detail: { missingScopes: missing },
        outcome: 'denied',
      })
      .catch(() => undefined);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | string[] | undefined>;
      params?: Record<string, string>;
      principal?: Principal;
      /** Present only when this process terminates TLS itself. */
      socket?: TlsSocketLike;
    }>();

    const principal = await this.resolvePrincipal(request.headers, request.socket);
    if (!principal) {
      throw new UnauthorizedException({
        error: 'unauthenticated',
        message: `provide credentials via ${this.chain.schemes.join(' or ')}`,
      });
    }

    // Fine-grained permissions ride on the principal, so every handler that
    // already decides access from it sees them without another lookup.
    if (this.grants) principal.resourceGrants = await this.grants.forPrincipal(principal);

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const grantRoute = this.reflector.getAllAndOverride<{ resourceType: ResourceType; access: ResourceAccess } | undefined>(
      RESOURCE_GRANT,
      [context.getHandler(), context.getClass()]
    );
    const viaGrant = grantRoute !== undefined && hasAnyGrant(principal, grantRoute.resourceType, grantRoute.access);

    if (!hasAllScopes(principal, required) && !viaGrant) {
      // Naming the missing scope is safe — the caller already knows who they
      // are — and turns an opaque 403 into something self-service.
      const missing = required.filter((scope) => !hasAllScopes(principal, [scope]));

      // Recorded here rather than by the audit interceptor, because guards run
      // *before* interceptors: a refusal never reaches one. "Who tried to read
      // the production secrets and was refused" is the question an incident
      // starts with, so a log that only contains successes answers the wrong
      // half of it.
      await this.recordDenial(context, request, principal, missing);

      throw new ForbiddenException({
        error: 'insufficient_scope',
        message: `missing scope(s): ${missing.join(', ')}`,
        required,
      });
    }

    this.assertCsrf(request, principal);
    await this.assertNamespaceMatches(request.params?.['ns'], principal);

    request.principal = principal;
    return true;
  }

  /**
   * Cross-site request forgery, for cookie-authenticated requests only.
   *
   * The scope of this check is the interesting part. CSRF exists because
   * browsers attach cookies automatically, so another site can cause an
   * authenticated request. An API key or bearer token is *not* attached
   * automatically — an attacking page has no way to add the header — so those
   * requests cannot be forged and do not need a token. Requiring one from them
   * would break every worker for no security gain, which is how CSRF protection
   * usually ends up disabled entirely.
   *
   * Safe methods are exempt: they change nothing, and requiring a header on
   * `GET` would break ordinary navigation.
   *
   * The check itself is double-submit — a value present in both a
   * script-readable cookie and a header the page sets. An attacking site can
   * cause the cookie to be sent but cannot read it, so it cannot produce the
   * matching header.
   */
  private assertCsrf(
    request: { method: string; headers: Record<string, string | string[] | undefined> },
    principal: Principal
  ): void {
    if (principal.type !== PrincipalType.USER) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;

    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;

    const cookie = readCookie(first(request.headers['cookie']), CSRF_COOKIE);
    const header = first(request.headers[CSRF_HEADER]);

    // Both must exist. Treating a missing pair as "nothing to compare, allow"
    // is the mistake that makes double-submit useless — an attacker simply
    // sends neither.
    if (!cookie || !header || !safeEquals(cookie, header)) {
      throw new ForbiddenException({
        error: 'csrf_failed',
        message: `send the ${CSRF_COOKIE} cookie value in the ${CSRF_HEADER} header`,
      });
    }
  }

  /**
   * Confirms the `:ns` path segment names the caller's own namespace.
   *
   * The API is namespace-first, so a namespace arrives twice on every scoped
   * request: in the URL, and in the credential. Three things could be done when
   * they disagree, and only one is safe:
   *
   *  - **Trust the URL.** Any credential could then act in any namespace by
   *    editing a path segment. This is the vulnerability.
   *  - **Ignore the URL.** Safe, but a mistyped namespace silently operates on
   *    the caller's own and returns a confusingly empty result.
   *  - **Require they agree.** A mismatch is a client bug or an attempt, and
   *    both deserve to be told.
   *
   * Handlers therefore always read `principal.namespaceId` and never the path;
   * this is what guarantees the two are the same thing.
   */
  private async assertNamespaceMatches(
    slug: string | undefined,
    principal: Principal
  ): Promise<void> {
    if (!slug) return; // Route is not namespace-scoped.

    const namespaceId = await this.namespaces.idFor(slug);
    if (!namespaceId) {
      throw new NotFoundException({ error: 'NOT_FOUND', message: `no namespace "${slug}"` });
    }

    if (namespaceId !== principal.namespaceId) {
      // Deliberately does not reveal which namespace the credential belongs to.
      throw new ForbiddenException({
        error: 'wrong_namespace',
        message: `these credentials cannot act in namespace "${slug}"`,
      });
    }
  }

  private async resolvePrincipal(
    headers: Record<string, string | string[] | undefined>,
    socket?: TlsSocketLike
  ): Promise<Principal | undefined> {
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;

    // Conductor's SDKs send their token in `X-Authorization`; every other client
    // uses `Authorization`. Both mean the same thing here.
    const authorization = first(headers['authorization']) ?? first(headers['x-authorization']);
    // An API key sent as a bearer token — the one credential header most clients
    // (MCP and Conductor clients among them) know how to send — is an API key,
    // not a token to verify as a JWT. A bare key is accepted too, since
    // Conductor's header carries no scheme.
    const bearerKey = /^(?:bearer\s+)?(nf_\S+)$/i.exec(authorization ?? '')?.[1];

    // A bare JWT, for the same reason and from the same clients.
    //
    // Conductor's SDKs declare `X-Authorization` as an *apiKey* credential,
    // which in OpenAPI means the raw value with no scheme — so the token they
    // mint from `/token` arrives as `eyJhbGci…`, not `Bearer eyJhbGci…`. The
    // scheme is added here rather than loosened downstream, so the
    // authenticators keep taking one well-formed shape.
    //
    // This broke the canonical Conductor flow: an API key worked, because the
    // rule above already tolerated a bare `nf_…`, but a *service account* —
    // keyId and secret exchanged for a token, which is what every Conductor SDK
    // does by default — authenticated and was then refused on every call.
    const bareJwt =
      !bearerKey && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(authorization ?? '')
        ? `Bearer ${authorization}`
        : undefined;

    try {
      return await this.chain.resolve({
        authorization: bearerKey ? undefined : (bareJwt ?? authorization),
        apiKey: first(headers['x-api-key']) ?? bearerKey,
        cookie: first(headers['cookie']),
        clientCertificate: readCertificate(socket),
      });
    } catch (error) {
      if (error instanceof InvalidCredentialError) {
        throw new UnauthorizedException({ error: 'invalid_credentials', message: error.message });
      }
      throw error;
    }
  }
}

/**
 * The peer certificate, normalised for an authenticator that must not know HTTP.
 *
 * `authorized` is read from the socket and carried alongside the subject, so no
 * authenticator can read one without the other. A certificate is present on any
 * connection where the client sent one; only the TLS layer knows whether it
 * chains to a trusted CA, and reading the subject without that verdict is
 * authentication by self-assertion.
 */
function readCertificate(socket?: TlsSocketLike): PresentedCertificate | undefined {
  if (!socket?.getPeerCertificate) return undefined;

  const certificate = socket.getPeerCertificate();
  // An empty object is what Node returns when no certificate was presented.
  if (!certificate || Object.keys(certificate).length === 0) return undefined;

  return {
    authorized: socket.authorized === true,
    authorizationError: socket.authorizationError?.message,
    subject: formatName(certificate.subject),
    issuer: formatName(certificate.issuer),
    spiffeId: (certificate.subjectaltname ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('URI:spiffe://'))
      ?.slice('URI:'.length),
  };
}

/**
 * A distinguished name in a stable order.
 *
 * Node hands back an object, and object key order is not something to bind an
 * identity to — `CN=a,OU=b` and `OU=b,CN=a` are the same name and must produce
 * the same string, or a binding stops matching after a library upgrade.
 */
function formatName(parts?: Record<string, string | string[]>): string | undefined {
  if (!parts) return undefined;

  const entries = Object.entries(parts)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]))
    .map(([key, value]) => `${key}=${value}`)
    .sort();

  return entries.length > 0 ? entries.join(',') : undefined;
}

interface TlsSocketLike {
  authorized?: boolean;
  authorizationError?: Error;
  getPeerCertificate?: () => {
    subject?: Record<string, string | string[]>;
    issuer?: Record<string, string | string[]>;
    subjectaltname?: string;
  };
}
