/**
 * Shared plumbing for the feature suite.
 *
 * Separate from `scripts/smoke.mjs` on purpose. Smoke is the release gate: a
 * few minutes, run on every tag, answering "is this artefact wired up at all?"
 * This suite answers the different question of whether each *feature* behaves,
 * against the same running image, and it is allowed to take longer and to need
 * a helper server.
 */

export const API = process.env.API ?? 'http://localhost:3000';
export const NS = process.env.NS ?? 'default';
export const KEY = process.env.KEY;

/** How the container reaches a server running on this host. */
export const HOST_FROM_CONTAINER = process.env.HOST_FROM_CONTAINER ?? 'host.docker.internal';

const state = { passed: 0, failures: [], section: '' };

export function section(name) {
  state.section = name;
  console.log(`\n[${name}]`);
}

export function check(name, condition, detail) {
  if (condition) {
    state.passed++;
    console.log(`  ok   ${name}`);
  } else {
    state.failures.push(`${state.section}: ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export async function call(method, path, { body, key = KEY, headers = {}, raw } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

/**
 * Signs a person in and returns a caller that acts as them.
 *
 * Human tasks are deliberately unreachable with an API key — a task assigned to
 * a person has to be acted on by that person — so exercising the inbox needs a
 * real session, cookie and CSRF header included.
 */
export async function signIn(email, password) {
  const response = await fetch(`${API}/v1/ns/${NS}/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`could not sign in as ${email}: ${response.status} ${await response.text()}`);
  }

  const jar = new Map();
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }

  const cookieHeader = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrf = jar.get('nf_csrf');

  return async function asUser(method, path, { body } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        cookie: cookieHeader,
        // Sent on every request rather than only on writes: the guard decides
        // which methods need it, and this way a new one cannot silently skip.
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };
}

export async function until(predicate, timeoutMs = 30_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${label}${last ? `; last saw ${JSON.stringify(last).slice(0, 200)}` : ''}`);
}

/** A name nothing else in the database will collide with. */
let counter = 0;
export const unique = (prefix) => `${prefix}_${Date.now()}_${counter++}`;

/** Registers a definition and fails loudly rather than returning a bad id. */
export async function register(definition) {
  const created = await call('POST', `/v1/ns/${NS}/metadata/workflows`, {
    body: { inputParameters: [], maxConcurrentTasks: 0, tags: [], version: 1, ...definition },
  });
  if (created.status >= 300) {
    throw new Error(`could not register ${definition.name}: ${created.status} ${JSON.stringify(created.body)}`);
  }
  return created.body;
}

export async function start(name, input = {}, extra = {}) {
  const started = await call('POST', `/v1/ns/${NS}/executions/${name}`, { body: { input, ...extra } });
  if (started.status >= 300) {
    throw new Error(`could not start ${name}: ${started.status} ${JSON.stringify(started.body)}`);
  }
  return started.body.id ?? started.body.workflowId;
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'TERMINATED', 'TIMED_OUT']);

export async function finish(id, timeoutMs = 45_000) {
  return until(
    async () => {
      const r = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
      return TERMINAL.has(r.body?.status) ? r.body : null;
    },
    timeoutMs,
    `execution ${id} to finish`
  );
}

export async function execution(id) {
  return (await call('GET', `/v1/ns/${NS}/executions/${id}`, {})).body;
}

/** Tasks of an execution keyed by reference name, newest iteration last. */
export function byRef(run) {
  const map = new Map();
  for (const task of run.tasks ?? []) {
    const list = map.get(task.refName) ?? [];
    list.push(task);
    map.set(task.refName, list);
  }
  return map;
}

/** Leases one task from a queue and completes it with the given output. */
export async function workOne(queue, output = {}, status = 'COMPLETED', reason) {
  const leased = await until(
    async () => {
      const r = await call('POST', `/v1/ns/${NS}/queues/${queue}/lease`, {
        body: { workerId: 'e2e-worker', count: 1, leaseSeconds: 60 },
      });
      return r.body?.tasks?.length ? r.body.tasks[0] : null;
    },
    30_000,
    `a task on ${queue}`
  );

  const reported = await call('POST', `/v1/ns/${NS}/tasks/${leased.taskId}/report`, {
    body: {
      queueName: queue,
      workflowId: leased.workflowId,
      leaseToken: leased.leaseToken,
      status,
      output,
      ...(reason ? { reason } : {}),
    },
  });
  if (reported.status >= 300) {
    throw new Error(`could not report ${leased.taskId}: ${reported.status} ${JSON.stringify(reported.body)}`);
  }
  return leased;
}

export function report() {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`passed: ${state.passed}   failed: ${state.failures.length}`);
  if (state.failures.length) {
    console.log('\nFAILURES:');
    for (const f of state.failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('every feature check passed');
  }
}

export const failures = () => state.failures;
