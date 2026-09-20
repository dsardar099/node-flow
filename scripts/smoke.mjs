/**
 * The release gate: the built image, over HTTP, as a user would reach it.
 *
 * Deliberately not part of the test suite, and deliberately not importing a
 * line of this repository. The suite exercises the *source*; a release ships an
 * *artefact*, and the gap between the two is where the defects that survive a
 * green build live. Every bug this caught before 1.0.0 was invisible to
 * `build test lint typecheck`: a module webpack left out of the bundle so the
 * container died on boot, a readiness probe that passed against a schema behind
 * the binary, a status code, and a `${workflow.variables.x}` that resolved to
 * null rather than raising.
 *
 * Run it against a stack that is already up:
 *
 *   docker compose -f docker/docker-compose.yml up -d
 *   pnpm nf bootstrap --namespace default --json   # gives you a token
 *   KEY=nf_... node scripts/smoke.mjs
 *
 * Exits non-zero on the first failing expectation, so CI can gate on it.
 */
const API = process.env.API ?? 'http://localhost:3000';
const KEY = process.env.KEY;
const NS = process.env.NS ?? 'default';

if (!KEY) {
  console.error('set KEY to an API token with admin scope — see the comment above');
  process.exit(2);
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, { body, key = KEY, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function until(predicate, timeoutMs = 30_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${label}`);
}

// ---------------------------------------------------------------- health
console.log('\n[health]');
{
  const { status, body } = await call('GET', '/v1/health', { key: null });
  check('health is public and ok', status === 200 && body.status === 'ok', JSON.stringify(body));
  check(
    'schema reported up to date',
    body.checks?.find((c) => c.name === 'migrations')?.detail === 'schema up to date'
  );

  /**
   * Fastify is still the adapter, asserted at the wire.
   *
   * The swap from Express is invisible to every controller by design — that is
   * the property `configure-app.ts` exists to preserve — so nothing in the
   * application can tell you it happened. Fastify advertises a keep-alive
   * timeout on every response and Express does not, which makes this the one
   * place the difference is observable.
   *
   * It matters because worker polling is the highest-volume endpoint here and
   * adapter throughput sets how many workers one server holds. Something
   * quietly putting Express back in the request path would not fail a single
   * test otherwise.
   *
   * This lived in `server-e2e`, a package of Nx scaffold that could never pass:
   * its sibling test asserted a `GET /v1` hello-world route that has not
   * existed for a long time, and its setup waited for a server nothing started.
   */
  const { headers } = await call('GET', '/v1/health', { key: null });
  check('served by the Fastify adapter', /timeout=\d+/.test(headers.get('keep-alive') ?? ''), headers.get('keep-alive') ?? 'no keep-alive header');
}

// ---------------------------------------------------------------- auth
console.log('\n[auth]');
{
  const anon = await call('GET', `/v1/ns/${NS}/metadata/workflows`, { key: null });
  check('unauthenticated request refused', anon.status === 401, `got ${anon.status}`);

  const bad = await call('GET', `/v1/ns/${NS}/metadata/workflows`, { key: 'nf_not_a_real_key' });
  check('unknown key refused', bad.status === 401, `got ${bad.status}`);

  const good = await call('GET', `/v1/ns/${NS}/metadata/workflows`, {});
  check('bootstrap key accepted', good.status === 200, `got ${good.status}`);

  // Namespace isolation: the credential's namespace must win over the URL.
  const other = await call('GET', `/v1/ns/someone-else/metadata/workflows`, {});
  check('cross-namespace read refused', other.status === 403 || other.status === 404, `got ${other.status}`);
}

// ---------------------------------------------------------------- register
console.log('\n[metadata]');
const WF = `e2e_flow_${Date.now()}`;
// The SIMPLE queue name has to be unique too, or a previous run's worker
// could lease this run's task.
const QUEUE = `charge_${Date.now()}`;
{
  const definition = {
    name: WF,
    version: 1,
    inputParameters: [],
    maxConcurrentTasks: 0,
    tags: [],
    tasks: [
      {
        name: 'seed',
        taskReferenceName: 'seed',
        type: 'INLINE',
        inputParameters: {
          expression: 'return { n: $.amount * 2 };',
          amount: '${workflow.input.amount}',
        },
      },
      {
        name: 'branch',
        taskReferenceName: 'branch',
        type: 'SWITCH',
        inputParameters: { switchCaseValue: '${seed.output.n}' },
        evaluatorType: 'value-param',
        expression: 'switchCaseValue',
        decisionCases: {
          20: [
            {
              name: 'big',
              taskReferenceName: 'big',
              type: 'SET_VARIABLE',
              inputParameters: { size: 'big' },
            },
          ],
        },
        defaultCase: [
          {
            name: 'small',
            taskReferenceName: 'small',
            type: 'SET_VARIABLE',
            inputParameters: { size: 'small' },
          },
        ],
      },
      {
        name: 'fan',
        taskReferenceName: 'fan',
        type: 'FORK_JOIN',
        forkTasks: [
          [
            {
              name: 'left',
              taskReferenceName: 'left',
              type: 'INLINE',
              inputParameters: { expression: 'return { side: "left" };' },
            },
          ],
          [
            {
              name: 'right',
              taskReferenceName: 'right',
              type: 'INLINE',
              inputParameters: { expression: 'return { side: "right" };' },
            },
          ],
        ],
      },
      {
        name: 'join',
        taskReferenceName: 'join',
        type: 'JOIN',
        joinOn: ['left', 'right'],
      },
      {
        // The worker-facing path: this one is leased and completed over HTTP.
        name: QUEUE,
        taskReferenceName: 'charge',
        type: 'SIMPLE',
        inputParameters: { n: '${seed.output.n}' },
      },
      {
        name: 'shape',
        taskReferenceName: 'shape',
        type: 'JSON_JQ_TRANSFORM',
        inputParameters: {
          n: '${seed.output.n}',
          size: '${workflow.variables.size}',
          queryExpression: '{ total: .n, size: .size }',
        },
      },
    ],
    outputParameters: {
      total: '${shape.output.result.total}',
      size: '${shape.output.result.size}',
      charged: '${charge.output.ok}',
    },
  };

  const created = await call('POST', `/v1/ns/${NS}/metadata/workflows`, { body: definition });
  check('workflow registered', created.status === 201 || created.status === 200, JSON.stringify(created.body).slice(0, 300));

  const fetched = await call('GET', `/v1/ns/${NS}/metadata/workflows/${WF}`, {});
  check('workflow readable', fetched.status === 200 && fetched.body.name === WF);

  // Immutability of a registered version is a core guarantee.
  const rewrite = await call('POST', `/v1/ns/${NS}/metadata/workflows`, {
    body: { ...definition, tasks: definition.tasks.slice(0, 1) },
  });
  check('re-registering same version refused', rewrite.status === 409, `got ${rewrite.status}`);

  const invalid = await call('POST', `/v1/ns/${NS}/metadata/workflows`, {
    body: { ...definition, name: `e2e_broken_${Date.now()}`, version: 1, tasks: [
      { name: 'x', taskReferenceName: 'x', type: 'INLINE',
        inputParameters: { expression: 'return {};', v: '${nope.output.v}' } },
    ] },
  });
  check('unknown ${ref} rejected at registration', invalid.status === 400, `got ${invalid.status}`);
}

// ---------------------------------------------------------------- run
console.log('\n[execution]');
let executionId;
{
  const started = await call('POST', `/v1/ns/${NS}/executions/${WF}`, {
    body: { input: { amount: 10 } },
  });
  check('workflow started', started.status === 201 || started.status === 200, JSON.stringify(started.body).slice(0, 200));
  executionId = started.body.id ?? started.body.workflowId;
  check('execution id returned', Boolean(executionId));

  // The SIMPLE task has to be leased and completed by a worker, which is the
  // whole point of a language-agnostic engine.
  const leased = await until(async () => {
    const r = await call('POST', `/v1/ns/${NS}/queues/${QUEUE}/lease`, {
      body: { workerId: 'e2e-worker', count: 1, leaseSeconds: 60 },
    });
    return r.body?.tasks?.length ? r.body.tasks[0] : null;
  }, 30_000, 'a leased task');
  check('task leased from queue', Boolean(leased.taskId ?? leased.id));
  check('lease carries a fencing token', Boolean(leased.leaseToken));
  check('task input resolved from another task output', leased.input?.n === 20, JSON.stringify(leased.input));

  const taskId = leased.taskId ?? leased.id;

  // A stale fencing token must not be able to complete the task.
  const stolen = await call('POST', `/v1/ns/${NS}/tasks/${taskId}/report`, {
    body: {
      queueName: QUEUE,
      workflowId: executionId,
      leaseToken: '00000000-0000-0000-0000-000000000000',
      status: 'COMPLETED',
      output: { ok: false },
    },
  });
  check('wrong fencing token refused', stolen.status >= 400, `got ${stolen.status}`);

  const completed = await call('POST', `/v1/ns/${NS}/tasks/${taskId}/report`, {
    body: {
      queueName: QUEUE,
      workflowId: executionId,
      leaseToken: leased.leaseToken,
      status: 'COMPLETED',
      output: { ok: true },
    },
  });
  check('task completed by worker', completed.status < 300, JSON.stringify(completed.body).slice(0, 200));

  const done = await until(async () => {
    const r = await call('GET', `/v1/ns/${NS}/executions/${executionId}`, {});
    return ['COMPLETED', 'FAILED', 'TERMINATED', 'TIMED_OUT'].includes(r.body?.status) ? r.body : null;
  }, 45_000, 'the workflow to finish');

  check('workflow completed', done.status === 'COMPLETED', `status=${done.status} reason=${done.reasonForIncompletion}`);
  check('INLINE ran in the sandbox', done.output?.total === 20, JSON.stringify(done.output));
  check('SWITCH took the matching branch', done.output?.size === 'big', JSON.stringify(done.output));
  check('worker output reached workflow output', done.output?.charged === true, JSON.stringify(done.output));

  // A skipped branch is still recorded as a task, so presence proves nothing —
  // the status is the assertion.
  const byRef = new Map((done.tasks ?? []).map((t) => [t.refName, t]));
  const summary = [...byRef.values()].map((t) => `${t.refName}=${t.status}`).join(' ');
  check('fork branches both ran',
    byRef.get('left')?.status === 'COMPLETED' && byRef.get('right')?.status === 'COMPLETED', summary);
  check('join ran', byRef.get('join')?.status === 'COMPLETED', summary);
  check('taken switch branch executed', byRef.get('big')?.status === 'COMPLETED', summary);
  check('untaken switch branch skipped, not run', byRef.get('small')?.status === 'SKIPPED', summary);
}

// ---------------------------------------------------------------- search + ops
console.log('\n[operations]');
{
  const search = await call('POST', `/v1/ns/${NS}/executions/search`, {
    body: { defName: WF, limit: 10 },
  });
  check('search finds the execution', search.status === 200 &&
    search.body.executions?.some((r) => r.workflowId === executionId),
    `status=${search.status} count=${search.body?.executions?.length}`);

  const status = await call('GET', `/v1/ns/${NS}/executions/${executionId}/status`, {});
  check('lightweight status endpoint', status.status === 200 && status.body.status === 'COMPLETED');

  // Rerun a finished workflow: a new execution, not a mutation of the old one.
  const again = await call('POST', `/v1/ns/${NS}/executions/${executionId}/run-again`, { body: {} });
  check('run-again starts a fresh execution', again.status < 300, `got ${again.status} ${JSON.stringify(again.body).slice(0,150)}`);

  // Rerun targets a specific task, so it must say which one.
  const rerun = await call('POST', `/v1/ns/${NS}/executions/${executionId}/rerun`, {
    body: { fromTaskRef: 'shape' },
  });
  check('rerun from a named task accepted', rerun.status < 300, `got ${rerun.status} ${JSON.stringify(rerun.body).slice(0,150)}`);
}

// ---------------------------------------------------------------- pause/terminate
console.log('\n[lifecycle]');
{
  const started = await call('POST', `/v1/ns/${NS}/executions/${WF}`, {
    body: { input: { amount: 1 } },
  });
  const id = started.body.id ?? started.body.workflowId;

  const paused = await call('POST', `/v1/ns/${NS}/executions/${id}/pause`, { body: {} });
  check('pause accepted', paused.status < 300, `got ${paused.status}`);

  const afterPause = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
  check('execution reports paused', afterPause.body.status === 'PAUSED', afterPause.body.status);

  const resumed = await call('POST', `/v1/ns/${NS}/executions/${id}/resume`, { body: {} });
  check('resume accepted', resumed.status < 300, `got ${resumed.status}`);

  const terminated = await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, {
    body: { reason: 'e2e teardown' },
  });
  check('terminate accepted', terminated.status < 300, `got ${terminated.status}`);

  const final = await until(async () => {
    const r = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
    return r.body?.status === 'TERMINATED' ? r.body : null;
  }, 15_000, 'termination');
  check('terminate reason recorded', String(final.reasonForIncompletion ?? '').includes('e2e teardown'),
    final.reasonForIncompletion);
}

// ---------------------------------------------------------------- idempotency
console.log('\n[idempotency]');
{
  const key = `e2e-${Date.now()}`;
  const first = await call('POST', `/v1/ns/${NS}/executions/${WF}`, {
    body: { input: { amount: 10 }, idempotencyKey: key },
  });
  const second = await call('POST', `/v1/ns/${NS}/executions/${WF}`, {
    body: { input: { amount: 10 }, idempotencyKey: key },
  });
  const a = first.body.id ?? first.body.workflowId;
  const b = second.body.id ?? second.body.workflowId;
  check('idempotency key returns the same execution', a === b, `${a} vs ${b}`);
}

// ---------------------------------------------------------------- secrets
//
// Encryption keys come from the environment, so a secret that writes and reads
// back proves the image's key material is wired up — something no in-process
// test can tell you about *this* container.
console.log('\n[secrets]');
{
  const name = `e2e_secret_${Date.now()}`;
  const put = await call('PUT', `/v1/ns/${NS}/secrets/${name}`, {
    body: { value: 'a-value-only-the-engine-should-see', description: 'smoke test' },
  });
  check('secret stored', put.status < 300, `got ${put.status}`);

  const listed = await call('GET', `/v1/ns/${NS}/secrets`, {});
  const found = (listed.body?.secrets ?? listed.body ?? []).find?.((s) => s.name === name);
  check('secret listed', Boolean(found), JSON.stringify(listed.body).slice(0, 200));

  // The listing must never carry the value: it is the screen most likely to be
  // shared, screenshotted or logged.
  check(
    'secret value never returned by the listing',
    !JSON.stringify(listed.body).includes('a-value-only-the-engine-should-see')
  );

  const removed = await call('DELETE', `/v1/ns/${NS}/secrets/${name}`, {});
  check('secret deleted', removed.status < 300, `got ${removed.status}`);
}

// ---------------------------------------------------------------- the poller
//
// Everything above runs on the API path. A schedule firing is the only check
// here that proves the *poller* role actually started in this container — a
// role that fails to start looks exactly like a healthy server until something
// that should have fired never does.
//
// It costs a cron boundary, so SMOKE_SKIP_SCHEDULE=1 leaves it out.
if (process.env.SMOKE_SKIP_SCHEDULE === '1') {
  console.log('\n[poller] skipped (SMOKE_SKIP_SCHEDULE=1)');
} else {
  console.log('\n[poller] — waits for a cron boundary, up to 90s');
  const name = `e2e_schedule_${Date.now()}`;
  const created = await call('POST', `/v1/ns/${NS}/schedules`, {
    body: { name, cron: '* * * * *', timezone: 'UTC', workflow: { name: WF }, input: { amount: 10 } },
  });
  check('schedule created', created.status < 300, JSON.stringify(created.body).slice(0, 200));

  try {
    const fired = await until(async () => {
      const r = await call('GET', `/v1/ns/${NS}/schedules/${name}`, {});
      return (r.body?.runCount ?? 0) > 0 ? r.body : null;
    }, 90_000, 'the schedule to fire');
    check('poller fired the schedule', fired.runCount > 0, `runCount=${fired.runCount}`);
    check('firing started a workflow', Boolean(fired.lastWorkflowId), JSON.stringify(fired).slice(0, 200));
  } catch (error) {
    check('poller fired the schedule', false, String(error.message));
  } finally {
    await call('DELETE', `/v1/ns/${NS}/schedules/${name}`, {});
  }
}

// ---------------------------------------------------------------- observability
console.log('\n[observability]');
{
  const anonMetrics = await call('GET', '/v1/metrics', { key: null });
  check('metrics are not public', anonMetrics.status === 401, `got ${anonMetrics.status}`);

  const metrics = await call('GET', '/v1/metrics', {});
  check('metrics exposed to a credential', metrics.status === 200 && String(metrics.body).includes('# HELP'), `got ${metrics.status}`);

  const openapi = await call('GET', '/v1/openapi.json', { key: null });
  const doc = openapi.body;
  check('openapi document served', openapi.status === 200 && Boolean(doc?.paths), `got ${openapi.status}`);
  check('openapi documents the start endpoint',
    Boolean(doc?.paths?.['/v1/ns/{ns}/executions/{name}']?.post),
    Object.keys(doc?.paths ?? {}).length + ' paths');
}

// ---------------------------------------------------------------- report
console.log(`\n${'='.repeat(60)}`);
console.log(`passed: ${passed}   failed: ${failures.length}`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('all checks passed');
