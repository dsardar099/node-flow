import { type NextRequest } from 'next/server';

/**
 * The API, proxied at **runtime**.
 *
 * Next's `rewrites()` would be the obvious mechanism and it is the wrong one:
 * its results are baked into the build, so the API's address would be fixed
 * when the image is built. For something self-hosted that means a rebuild to
 * point the dashboard at a different server, which is not a deployment story
 * anyone should accept. A route handler reads the environment per request.
 *
 * The proxy exists at all so the browser believes the API is same-origin. The
 * session is an `HttpOnly` cookie; cross-origin would mean `SameSite=None`, a
 * CORS allowlist and credentialed fetches — three things to get wrong for no
 * gain, since a real deployment fronts both with one hostname anyway.
 */

const API = () => process.env.NODE_FLOW_API_URL ?? 'http://localhost:3000';

/**
 * Headers that must not be forwarded.
 *
 * `host` would make the API think it was addressed as the dashboard, which
 * breaks any absolute URL it builds — an OIDC redirect URI, most visibly. The
 * hop-by-hop headers describe *this* connection and say nothing true about the
 * next one.
 */
const STRIP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'content-length',
]);

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${API()}/v1/${path.map(encodeURIComponent).join('/')}${
    request.nextUrl.search
  }`;

  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!STRIP.has(name.toLowerCase())) headers.set(name, value);
  });

  // The address the API sees, so its own logs and audit entries record the
  // browser rather than this process.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
    // The dashboard follows redirects itself: an SSO login must reach the
    // browser as a 302 so the address bar changes, not be followed here and
    // returned as somebody else's page.
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  response.headers.forEach((value, name) => {
    // `set-cookie` is handled below: `Headers.forEach` collapses repeats into
    // one comma-joined value, which silently corrupts a login that sets both a
    // session and a CSRF cookie.
    if (name.toLowerCase() !== 'set-cookie') out.set(name, value);
  });

  for (const cookie of response.headers.getSetCookie()) {
    out.append('set-cookie', cookie);
  }

  return new Response(response.body, { status: response.status, headers: out });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await context.params).path);
}

export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
