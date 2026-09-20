import { RequestMethod, type INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * The HTTP adapter, configured identically for production and tests.
 *
 * Built here rather than at each call site for the same reason as
 * {@link configureApp}: two constructions drift, and the tests then vouch for
 * an application that is not the one that ships.
 */
export function createAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    // Long-poll holds connections open for the whole wait, so the socket must
    // not time out underneath it. 0 means unbounded, which is deliberate — and
    // is exactly why `forceCloseConnections` below is not optional.
    connectionTimeout: 0,

    // NOTE: `forceCloseConnections: 'idle'` is deliberately NOT set here. It
    // reads as the fix for keep-alive sockets holding shutdown open, but
    // Fastify only honours it when a custom `serverFactory` is supplied — which
    // Nest's adapter does not do — so it is silently a no-op. `HttpShutdownService`
    // calls `closeIdleConnections()` directly instead.

    // Trust the proxy so client IPs survive an ingress or load balancer, which
    // rate limiting and audit logging both depend on.
    trustProxy: true,
  });
}

/**
 * Applies every adapter-level setting the application depends on.
 *
 * Shared by `main.ts` and the integration tests deliberately. When the two
 * configure themselves separately they drift, and the tests then pass against
 * an application that differs from the one that ships — worse than no test,
 * because it reports confidence it has not earned.
 */
/**
 * Controller path prefixes that sit outside the `/v1` prefix.
 *
 * The Conductor compatibility layer owns its own paths — its clients build
 * `/api/...` themselves — so it cannot be versioned under ours. Exported because
 * the OpenAPI document has to describe the paths the router actually serves;
 * when only this file knew, every compatibility route was documented one prefix
 * away from where it lives.
 */
export const UNPREFIXED = ['conductor'];

export async function configureApp(app: INestApplication): Promise<void> {
  app.setGlobalPrefix('v1', {
    exclude: UNPREFIXED.map((path) => ({ path: `${path}/{*rest}`, method: RequestMethod.ALL })),
  });

  // The decider and pollers hold transactions and task leases. Without this a
  // SIGTERM kills them mid-flight and leases expire on a timeout instead of
  // being released promptly.
  app.enableShutdownHooks();

  await app.init();

  allowEmptyJsonBody(app as NestFastifyApplication);

  await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
}

/**
 * Lets a bodyless `POST` carry `Content-Type: application/json`.
 *
 * Several endpoints — pause, resume, retry, decide — take no body. Fastify
 * rejects that header with an empty payload as a 400, and clients like axios
 * set it unconditionally, so an ordinary bodyless POST fails with a parse error
 * that has nothing to do with what the caller did wrong.
 *
 * Replacing the parser rather than adding one, and doing it *after* `init()`,
 * because Nest's Fastify adapter installs its own during initialisation and
 * Fastify refuses a duplicate for the same content type.
 *
 * The replacement delegates to Fastify's own parser, which keeps the
 * prototype- and constructor-poisoning protections. Reimplementing it with a
 * bare `JSON.parse` would quietly drop them, and that is a deserialisation
 * vulnerability rather than a convenience.
 */
function allowEmptyJsonBody(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();
  const { bodyLimit, onProtoPoisoning, onConstructorPoisoning } = fastify.initialConfig;
  const parseJson = fastify.getDefaultJsonParser(
    onProtoPoisoning ?? 'error',
    onConstructorPoisoning ?? 'error'
  );

  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit },
    (request, body: string, done) => {
      // Kept verbatim for signature checks: a webhook signature covers the
      // exact bytes sent, and no re-serialisation reproduces them.
      (request as { rawBody?: string }).rawBody = body;
      if (body === '') return done(null, {});
      parseJson(request, body, done);
    }
  );

  // Form bodies, which some platforms post webhooks as (Slack commands and
  // interactions among them). Without a parser Fastify answers 415 before a
  // verifier ever sees the request. Parsed into a plain object with no
  // prototype, so a field named `__proto__` is only a field.
  if (fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
    fastify.removeContentTypeParser('application/x-www-form-urlencoded');
  }
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit },
    (request, body: string, done) => {
      (request as { rawBody?: string }).rawBody = body;
      const fields: Record<string, string> = Object.create(null);
      for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
      done(null, { ...fields });
    }
  );
}
