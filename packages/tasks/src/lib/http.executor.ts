import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { hostKey, type CircuitBreaker, type CircuitOpenError } from './circuit-breaker.js';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `HTTP` — calls an external service.
 *
 * The most-used system task, and the one with the most ways to go wrong. Three
 * concerns shape it:
 *
 *  - **It is a request forgery primitive.** A workflow definition is user
 *    input, and this server sits inside your network with whatever the
 *    perimeter lets it reach — cloud metadata endpoints, internal admin panels,
 *    databases. An unguarded HTTP task is a permanent SSRF hole, so the guard
 *    is on by default and opting out is explicit.
 *  - **It is unbounded by nature.** A remote server can hang forever or stream
 *    gigabytes; both have to be capped, or one bad endpoint takes the process
 *    with it.
 *  - **Its failures are mostly transient.** Distinguishing those from
 *    permanent ones is what makes the retry policy useful rather than a way to
 *    turn one broken URL into twenty.
 */

export interface HttpExecutorOptions {
  /**
   * Allow requests to private, loopback and link-local addresses.
   *
   * Off by default. On only for a deployment that genuinely needs to call
   * internal services and has thought about who can author a workflow — which
   * is why it is a deployment setting rather than a per-task input, where any
   * workflow author could set it themselves.
   */
  allowPrivateAddresses?: boolean;
  /** Hosts always permitted, even when the guard is on. Exact match. */
  allowedHosts?: string[];
  maxResponseBytes?: number;
  defaultTimeoutMs?: number;
  maxRedirects?: number;
  fetch?: typeof globalThis.fetch;
  /**
   * Trips per target host when it starts failing, so one dead dependency
   * cannot occupy the runner that every other workflow shares. Shared with the
   * other outbound tasks, so a host known to be down is known to all of them.
   */
  breaker?: CircuitBreaker;
  /**
   * Resolves a `service` named by a definition into a base URL and headers.
   *
   * Absent, a task naming a service fails with that as the reason rather than
   * falling back to anything.
   */
  services?: HttpServiceResolver;
}

const DEFAULTS = {
  maxResponseBytes: 5 * 1024 * 1024,
  defaultTimeoutMs: 30_000,
  maxRedirects: 3,
};

/** Status codes worth retrying. Everything else is the caller's problem. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpTaskExecutor implements TaskExecutor {
  readonly type = TaskType.HTTP;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: HttpExecutorOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const request = readRequest(context.input);
    if ('error' in request) {
      return { status: 'FAILED', reason: request.error, terminal: true };
    }

    if (request.service) {
      const resolved = await this.resolveService(context.namespaceId, request);
      if ('error' in resolved) return { status: 'FAILED', reason: resolved.error, terminal: true };
    }

    // Narrowed for the rest of the method: either the definition gave a URL or
    // the registry did.
    const url = request.url as URL;
    const blocked = await this.blockedReason(url);
    if (blocked) return { status: 'FAILED', reason: blocked, terminal: true };

    const key = hostKey(url);
    try {
      this.options.breaker?.assertAllowed(key);
    } catch (error) {
      // Not terminal: the host is expected back, and the retry policy — with
      // its backoff, jitter and budget — is what decides when to look again.
      return { status: 'FAILED', reason: (error as CircuitOpenError).message, terminal: false };
    }

    const timeoutMs = request.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULTS.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Either the task's own deadline or a shutdown ends the request.
    const signal = AbortSignal.any([controller.signal, context.signal]);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal,
        // Redirects are followed manually so each hop can be re-checked against
        // the SSRF guard. `redirect: 'follow'` would let a public URL bounce to
        // 169.254.169.254 and defeat the whole thing.
        redirect: 'manual',
      });

      const outcome = await this.handle(response, request, context, 0);
      // Judged on the *server's* health, not the caller's luck: a 404 means
      // this request was wrong, and counting it would let one bad URL open the
      // breaker for every workflow calling the same host.
      this.options.breaker?.record(key, outcome.status !== 'FAILED' || outcome.terminal === true);
      return outcome;
    } catch (error) {
      const aborted = signal.aborted;
      // A timeout or a connection error is exactly what the breaker is for.
      this.options.breaker?.record(key, false);

      return {
        status: 'FAILED',
        reason: aborted
          ? `request to ${url.host} timed out after ${timeoutMs}ms`
          : `request to ${url.host} failed: ${describe(error)}`,
        // A network failure or timeout is transient by default. Saying
        // otherwise would make a blip permanent.
        terminal: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turns `service` + `path` into a URL and headers, from the registry.
   *
   * The service's own headers are applied *underneath* the task's, so a
   * definition can add a correlation header without being able to overwrite the
   * credential the integration supplies — an author who could replace
   * `Authorization` could send the service's key wherever they liked.
   *
   * The path is joined rather than resolved: a definition asking for
   * `../../admin` must not climb out of the base URL it was given.
   */
  private async resolveService(
    namespaceId: string,
    request: HttpRequest
  ): Promise<{ ok: true } | { error: string }> {
    const services = this.options.services;
    if (!services) {
      return { error: `this install has no service registry, so "${request.service}" cannot be resolved` };
    }

    const resolved = await services.httpService(namespaceId, request.service as string);
    if (!resolved) {
      return { error: `no enabled HTTP service "${request.service}" is registered in this namespace` };
    }

    let url: URL;
    try {
      const base = resolved.baseUrl.endsWith('/') ? resolved.baseUrl : `${resolved.baseUrl}/`;
      const path = (request.path ?? '/').replace(/^\/+/, '');
      url = new URL(path, base);
      if (!url.href.startsWith(new URL(base).href)) {
        return { error: `path "${request.path}" leaves the base URL of service "${resolved.name}"` };
      }
    } catch {
      return { error: `service "${resolved.name}" has an invalid base URL` };
    }

    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value === null || value === undefined) continue;
      url.searchParams.set(name, typeof value === 'string' ? value : JSON.stringify(value));
    }

    request.url = url;
    request.headers = { ...lowercased(resolved.headers), ...request.headers };
    request.timeoutMs ??= resolved.timeoutMs;
    return { ok: true };
  }

  private async handle(
    response: Response,
    request: HttpRequest,
    context: TaskContext,
    hop: number
  ): Promise<TaskOutcome> {
    const maxRedirects = this.options.maxRedirects ?? DEFAULTS.maxRedirects;
    // Set by now: either the definition gave one or the service registry did.
    const url = request.url as URL;

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return { status: 'FAILED', reason: `${response.status} with no Location`, terminal: true };
      }

      if (hop >= maxRedirects) {
        return {
          status: 'FAILED',
          reason: `more than ${maxRedirects} redirects from ${url.host}`,
          terminal: true,
        };
      }

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { status: 'FAILED', reason: `invalid redirect to "${location}"`, terminal: true };
      }

      // Re-checked at every hop, and this is the point of manual redirects.
      const blocked = await this.blockedReason(next);
      if (blocked) return { status: 'FAILED', reason: `redirect ${blocked}`, terminal: true };

      const followed = await this.fetchImpl(next.toString(), {
        method: response.status === 303 ? 'GET' : request.method,
        // Headers are deliberately dropped when the host changes: forwarding an
        // Authorization header to wherever a redirect points is how credentials
        // leak to third parties.
        headers: next.host === url.host ? request.headers : {},
        signal: context.signal,
        redirect: 'manual',
      });

      return this.handle(followed, { ...request, url: next }, context, hop + 1);
    }

    const body = await this.readBody(response);
    if ('error' in body) return { status: 'FAILED', reason: body.error, terminal: true };

    const output: Record<string, JsonValue> = {
      status: response.status,
      headers: safeHeaders(response.headers),
      body: body.value,
    };

    if (response.ok) return { status: 'COMPLETED', output };

    return {
      status: 'FAILED',
      reason: `${request.method} ${url.host} returned ${response.status}`,
      // A 4xx means the request was wrong and will be wrong again; a 5xx or 429
      // is the server having a moment. Retrying the first wastes the budget and
      // delays the real error.
      terminal: !RETRYABLE_STATUSES.has(response.status),
      output,
    };
  }

  /**
   * Reads the body, refusing anything oversized.
   *
   * Streamed and counted rather than buffered whole: `Content-Length` is a
   * hint a hostile or broken server need not honour, so trusting it means a
   * "1 KB" response can still exhaust memory.
   */
  private async readBody(
    response: Response
  ): Promise<{ value: JsonValue } | { error: string }> {
    const limit = this.options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
    const reader = response.body?.getReader();
    if (!reader) return { value: null };

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return { error: `response exceeded ${limit} bytes` };
      }

      chunks.push(value);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '') return { value: null };

    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { value: text };

    try {
      return { value: JSON.parse(text) as JsonValue };
    } catch {
      // Content-Type said JSON and it is not. Returning the raw text beats
      // failing the task — the body is usually an error page, and someone
      // debugging needs to see it.
      return { value: text };
    }
  }

  /**
   * Why this URL may not be called, or undefined if it may.
   *
   * Resolves the hostname and checks the *resolved address*, not the name. A
   * name check alone is trivially bypassed: an attacker points their own domain
   * at 127.0.0.1 and the guard sees a perfectly ordinary hostname.
   *
   * A gap worth naming: this resolves, then `fetch` resolves again, and DNS can
   * change in between — the classic rebinding race. Closing it properly means
   * pinning the checked address for the connection, which needs a custom
   * dispatcher. Documented rather than pretended away.
   */
  private blockedReason(url: URL): Promise<string | undefined> {
    return urlBlockedReason(url, this.options);
  }
}

/**
 * Why a workflow may not reach this URL, or undefined if it may: http or https
 * only, and never a private, loopback or link-local address unless the
 * deployment allows it. Shared by every task that fetches a URL a definition names.
 */
export async function urlBlockedReason(url: URL, options: Pick<HttpExecutorOptions, 'allowPrivateAddresses' | 'allowedHosts'> = {}): Promise<string | undefined> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `to ${url.protocol} is not allowed; only http and https`;
  }

  if (options.allowPrivateAddresses) return undefined;
  if (options.allowedHosts?.includes(url.hostname)) return undefined;

  // WHATWG `hostname` keeps the brackets on an IPv6 literal, so `isIP` says
  // no and the address falls through to a DNS lookup that cannot succeed. It
  // still ends up blocked, but for the wrong reason and via the wrong path —
  // and "does not resolve" sends whoever reads it looking at DNS.
  const host = url.hostname.replace(/^\[|\]$/g, '');

  const addresses = isIP(host) ? [host] : await resolveAll(host);

  if (addresses.length === 0) return `to ${url.hostname} failed: host does not resolve`;

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      return `to ${url.hostname} (${address}) is blocked: private and loopback addresses are not reachable from a workflow`;
    }
  }

  return undefined;
}

async function resolveAll(hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true });
    return results.map((r) => r.address);
  } catch {
    return [];
  }
}

interface HttpRequest {
  /** Absent until a `service` has been resolved into a base URL. */
  url?: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** A registered service to call, instead of a URL the definition supplies. */
  service?: string;
  /** The path within that service. */
  path?: string;
  /** Query parameters, as a map, so a caller need not encode them by hand. */
  query?: Record<string, JsonValue>;
  timeoutMs?: number;
}

/** What a registered HTTP service resolves to, at call time. */
export interface ResolvedHttpService {
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpServiceResolver {
  httpService(namespaceId: string, name: string): Promise<ResolvedHttpService | undefined>;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function readRequest(input: Record<string, JsonValue>): HttpRequest | { error: string } {
  // Conductor nests these under `http_request`; accepting both spellings costs
  // nothing and makes a ported definition work unchanged.
  const raw = (isRecord(input['http_request']) ? input['http_request'] : input) as Record<
    string,
    JsonValue
  >;

  const uri = raw['uri'] ?? raw['url'];
  const service = raw['service'];
  if (typeof service === 'string' && service !== '') {
    if (typeof uri === 'string' && uri !== '') {
      // Refused rather than silently preferring one: the author expected both
      // to matter, and guessing which would make the *other* a silent no-op.
      return { error: 'give either "service" or "uri", not both' };
    }
    // The URL is filled in later, from the registry. Anything the definition
    // could have smuggled into it — a host, a scheme — is not consulted.
    return finishRequest(raw, undefined, service, typeof raw['path'] === 'string' ? raw['path'] : '/');
  }

  if (typeof uri !== 'string' || uri === '') {
    return { error: 'http task requires a "uri", or a "service" naming a registered one' };
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { error: `"${uri}" is not a valid absolute URL` };
  }

  return finishRequest(raw, url);
}

/** The parts of a request that do not depend on where it is going. */
function finishRequest(
  raw: Record<string, JsonValue>,
  url: URL | undefined,
  service?: string,
  path?: string
): HttpRequest | { error: string } {

  const method = String(raw['method'] ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) return { error: `unsupported HTTP method "${method}"` };

  const headers: Record<string, string> = { accept: 'application/json, text/plain, */*' };
  if (isRecord(raw['headers'])) {
    for (const [name, value] of Object.entries(raw['headers'])) {
      if (typeof value === 'string' || typeof value === 'number') {
        headers[name.toLowerCase()] = String(value);
      }
    }
  }

  let body: string | undefined;
  const rawBody = raw['body'];
  if (rawBody !== undefined && rawBody !== null && method !== 'GET' && method !== 'HEAD') {
    body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    headers['content-type'] ??= 'application/json';
  }

  const timeout = raw['timeoutMs'] ?? raw['connectionTimeOut'];

  return {
    url,
    method,
    headers,
    body,
    service,
    path,
    query: isRecord(raw['query']) ? raw['query'] : undefined,
    timeoutMs: typeof timeout === 'number' && timeout > 0 ? timeout : undefined,
  };
}

/**
 * Response headers, minus the ones that should not be recorded.
 *
 * A task's output is stored, searchable and shown in the UI. `set-cookie` in
 * particular is a credential, and putting it there means it outlives the
 * request in a place nobody thinks to look.
 */
const REDACTED = new Set(['set-cookie', 'authorization', 'proxy-authorization']);

function safeHeaders(headers: Headers): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};

  headers.forEach((value, name) => {
    result[name] = REDACTED.has(name.toLowerCase()) ? '[redacted]' : value;
  });

  return result;
}

/**
 * Address ranges a workflow must not reach.
 *
 * Loopback and the private blocks are the obvious ones. `169.254.0.0/16`
 * matters most in practice: it is where every major cloud puts its instance
 * metadata service, and reading it usually yields credentials.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, and cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      a >= 224 // multicast and reserved
    );
  }

  if (version === 6) {
    const normalised = address.toLowerCase();
    if (normalised === '::1' || normalised === '::') return true;
    // Unique-local and link-local.
    if (/^f[cd]/.test(normalised) || normalised.startsWith('fe80')) return true;
    // IPv4-mapped: ::ffff:127.0.0.1 must not slip past the v4 rules.
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // Not an address at all — refuse rather than guess.
  return true;
}

const isRedirect = (status: number) => [301, 302, 303, 307, 308].includes(status);

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Header names are case-insensitive; lowercasing both sides is what makes the merge predictable. */
function lowercased(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
