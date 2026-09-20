import type { JsonValue } from '@node-flow-dev/core';

/**
 * A typed client for the `/v1` API.
 *
 * Uses the global `fetch` rather than a HTTP library: it is in Node 24, it is
 * in every browser and edge runtime, and an SDK that drags a client library
 * into a user's dependency tree for four endpoints has made their problem
 * worse.
 */

export class NodeFlowApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's stable error code, e.g. `LEASE_EXPIRED`. */
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'NodeFlowApiError';
  }

  /**
   * Whether retrying the same request could plausibly succeed.
   *
   * 5xx and 429 are transient; 4xx means the request itself is wrong and
   * retrying it just makes the same mistake faster.
   */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export interface ClientCredentials {
  /** A long-lived API key. Simplest, and right for a CLI or CI job. */
  apiKey?: string;
  /**
   * A service-account key/secret, exchanged for short-lived tokens and
   * refreshed automatically. Right for a long-running worker: a captured token
   * is useless within the hour.
   */
  serviceAccount?: { keyId: string; secret: string };
}

export interface ClientOptions extends ClientCredentials {
  baseUrl: string;
  namespace: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface LeasedTask {
  taskId: string;
  workflowId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  /**
   * The W3C trace context of the run this task belongs to, when it was started
   * by a traced caller.
   *
   * A worker that emits its own spans should use this as their parent, so one
   * trace covers the API call that started the workflow, the engine that
   * scheduled the task, and the work itself — which is the difference between
   * "the workflow was slow" and "its third task's call to billing took nine
   * seconds".
   */
  traceparent?: string;
  /**
   * The task's resolved input.
   *
   * Resolved for this delivery only: offloaded payloads are inlined and
   * `${secrets.x}` references are substituted, neither of which is true of what
   * the server stores.
   */
  input: Record<string, JsonValue>;
}

export class NodeFlowClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private token?: { value: string; expiresAt: number };
  private refreshing?: Promise<string>;

  constructor(private readonly options: ClientOptions) {
    if (!options.apiKey && !options.serviceAccount) {
      throw new Error('provide either apiKey or serviceAccount credentials');
    }

    // The origin, not the API root: every request appends `/v1` itself.
    //
    // A trailing `/v1` is accepted and dropped rather than left to produce
    // `/v1/v1/...`, which fails as a 404 on the *first call* with nothing to
    // connect it back to the constructor. This project's own README got it
    // wrong, which is reason enough to assume users will.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  get namespace(): string {
    return this.options.namespace;
  }

  // ------------------------------------------------------------------ workers

  /**
   * Leases tasks, optionally waiting for work to appear.
   *
   * `waitSeconds` is what makes an idle worker free: the request parks on the
   * server and returns the instant a task is enqueued, instead of the worker
   * polling on a timer and choosing between latency and load.
   */
  async lease(options: {
    queue: string;
    workerId: string;
    count?: number;
    waitSeconds?: number;
    leaseSeconds?: number;
    /**
     * Abandons the parked request.
     *
     * Essential for a worker with a long `waitSeconds`: without it, shutdown
     * cannot complete until the poll times out on its own, so a fleet with a
     * 30-second poll takes 30 seconds to stop — longer than the grace period
     * most orchestrators give before SIGKILL, which turns a clean drain into
     * exactly the abrupt termination it was meant to avoid.
     */
    signal?: AbortSignal;
  }): Promise<LeasedTask[]> {
    const body = await this.request<{ tasks: LeasedTask[] }>(
      'POST',
      `/ns/${this.options.namespace}/queues/${encodeURIComponent(options.queue)}/lease`,
      {
        workerId: options.workerId,
        count: options.count ?? 1,
        waitSeconds: options.waitSeconds ?? 0,
        ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
      },
      // The request is *meant* to hang for waitSeconds, so the client timeout
      // has to exceed it or every long-poll aborts itself.
      options.waitSeconds ? (options.waitSeconds + 10) * 1000 : undefined,
      options.signal
    );

    return body.tasks;
  }

  async heartbeat(options: {
    taskId: string;
    queueName: string;
    leaseToken: string;
    leaseSeconds?: number;
  }): Promise<void> {
    await this.request('POST', `/ns/${this.options.namespace}/tasks/${options.taskId}/heartbeat`, {
      queueName: options.queueName,
      leaseToken: options.leaseToken,
      ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
    });
  }

  /** Appends log lines to a task this worker holds. */
  async appendLogs(options: {
    taskId: string;
    workflowId: string;
    leaseToken: string;
    logs: { message: string; level?: 'debug' | 'info' | 'warn' | 'error' }[];
  }): Promise<void> {
    await this.request('POST', `/ns/${this.options.namespace}/tasks/${options.taskId}/logs`, {
      workflowId: options.workflowId,
      leaseToken: options.leaseToken,
      logs: options.logs,
    });
  }

  async report(options: {
    taskId: string;
    queueName: string;
    workflowId: string;
    leaseToken: string;
    status: 'COMPLETED' | 'FAILED' | 'FAILED_WITH_TERMINAL_ERROR';
    output?: Record<string, JsonValue>;
    reason?: string;
  }): Promise<void> {
    await this.request('POST', `/ns/${this.options.namespace}/tasks/${options.taskId}/report`, {
      queueName: options.queueName,
      workflowId: options.workflowId,
      leaseToken: options.leaseToken,
      status: options.status,
      ...(options.output ? { output: options.output } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });
  }

  // --------------------------------------------------------------- executions

  async startWorkflow(options: {
    name: string;
    input?: Record<string, JsonValue>;
    version?: number;
    correlationId?: string;
    idempotencyKey?: string;
  }): Promise<{ workflowId: string; status: string }> {
    return this.request(
      'POST',
      `/ns/${this.options.namespace}/executions/${encodeURIComponent(options.name)}`,
      {
        input: options.input ?? {},
        ...(options.version ? { version: options.version } : {}),
        ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      }
    );
  }

  async executionStatus(workflowId: string): Promise<{ status: string; workflowId: string }> {
    return this.request('GET', `/ns/${this.options.namespace}/executions/${workflowId}/status`);
  }

  async registerWorkflow(definition: unknown): Promise<{ name: string; version: number }> {
    return this.request('POST', `/ns/${this.options.namespace}/metadata/workflows`, definition);
  }

  // ------------------------------------------------------------------ internals

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.options.timeoutMs ?? 30_000
    );

    // Either the timeout or the caller can abort. `AbortSignal.any` is Node 20+
    // and avoids the listener-leak that hand-wiring the two together invites.
    const signal = externalSignal
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(await this.authHeaders()),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
      });

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!response.ok) {
        throw new NodeFlowApiError(
          response.status,
          typeof parsed['error'] === 'string' ? parsed['error'] : 'unknown',
          typeof parsed['message'] === 'string' ? parsed['message'] : response.statusText,
          parsed['details'] ?? parsed['issues']
        );
      }

      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.options.apiKey) return { 'x-api-key': this.options.apiKey };
    return { authorization: `Bearer ${await this.accessToken()}` };
  }

  /**
   * A valid access token, refreshed when it is close to expiring.
   *
   * Refreshed 60 seconds early rather than on expiry: a token that expires
   * between the check and the server receiving the request produces a 401 that
   * looks like a credential problem, and clock skew between client and server
   * makes the exact boundary unknowable anyway.
   *
   * Concurrent callers share one refresh — a worker leasing on eight queues
   * would otherwise mint eight tokens the moment one expires.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;

    this.refreshing ??= this.exchange().finally(() => {
      this.refreshing = undefined;
    });

    return this.refreshing;
  }

  private async exchange(): Promise<string> {
    const account = this.options.serviceAccount;
    if (!account) throw new Error('no service account configured');

    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: account.keyId, secret: account.secret }),
    });

    if (!response.ok) {
      throw new NodeFlowApiError(
        response.status,
        'invalid_credentials',
        'could not exchange service-account credentials for a token'
      );
    }

    const body = (await response.json()) as { accessToken: string; expiresIn: number };
    this.token = {
      value: body.accessToken,
      expiresAt: Date.now() + body.expiresIn * 1000,
    };

    return body.accessToken;
  }
}
