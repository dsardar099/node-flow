/**
 * System tasks and failure semantics, through the running image.
 *
 * The executors have unit tests against fakes. What those cannot show is that
 * an executor is *registered*, reachable from the poller role, and handed the
 * input the decider resolved — which is where a task type quietly stops
 * existing in a built image.
 */
import { createServer } from 'node:http';
import {
  HOST_FROM_CONTAINER,
  NS,
  byRef,
  call,
  check,
  finish,
  register,
  section,
  start,
  unique,
  until,
  workOne,
} from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

/** A throwaway HTTP origin the container can reach, for the HTTP tasks. */
async function withEchoServer(body) {
  const seen = [];
  let failuresLeft = 0;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });

      if (req.url === '/flaky') {
        // Fails a fixed number of times, then succeeds — so a retry policy has
        // something real to recover from.
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'try again' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ recovered: true }));
        return;
      }

      if (req.url === '/always-400') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'never valid' }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ echoed: true, method: req.method, seenBody: chunks.length > 0 }));
    });
  });

  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  const base = `http://${HOST_FROM_CONTAINER}:${port}`;

  try {
    return await body({ base, seen, setFailures: (n) => (failuresLeft = n) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function run() {
  await withEchoServer(async (echo) => {
    await httpTask(echo);
    await httpRetries(echo);
    await nonRetryableFailure(echo);
  });
  await jqAndInline();
  await noopAndSetVariable();
  await signedJwt();
  await optionalTask();
  await scheduleToStartTimeout();
  await failureWorkflow();
}

async function httpTask({ base, seen }) {
  section('HTTP task');
  const name = unique('e2e_http');

  await register({
    name,
    tasks: [
      {
        name: 'fetch',
        taskReferenceName: 'fetch',
        type: 'HTTP',
        inputParameters: {
          http_request: {
            uri: `${base}/echo`,
            method: 'POST',
            body: { hello: 'world' },
            headers: { 'x-e2e': 'yes' },
          },
        },
      },
    ],
    outputParameters: { echoed: '${fetch.output.body.echoed}' },
  });

  const id = await start(name);
  const run = await finish(id, 60_000);

  check('HTTP workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('the request actually left the container', seen.some((r) => r.url === '/echo'), JSON.stringify(seen.map((s) => s.url)));
  check('the response body is readable by later tasks', run.output?.echoed === true, JSON.stringify(run.output));
}

async function httpRetries({ base, setFailures }) {
  section('retries and backoff');
  setFailures(2);
  const name = unique('e2e_retry');

  await register({
    name,
    tasks: [
      {
        name: 'flaky',
        taskReferenceName: 'flaky',
        type: 'HTTP',
        retryCount: 3,
        retryLogic: 'FIXED',
        retryDelaySeconds: 1,
        inputParameters: { http_request: { uri: `${base}/flaky`, method: 'GET' } },
      },
    ],
    outputParameters: { recovered: '${flaky.output.body.recovered}' },
  });

  const id = await start(name);
  const run = await finish(id, 90_000);

  check('retried to success', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  const attempts = byRef(run).get('flaky') ?? [];
  // Two failures then a success: the attempts must be visible, or an operator
  // cannot tell a flaky dependency from a slow one.
  check('every attempt is recorded', attempts.length >= 3, `${attempts.length} attempts`);
  check('the successful attempt is last', attempts.at(-1)?.status === 'COMPLETED', attempts.map((a) => a.status).join(','));
}

async function nonRetryableFailure({ base }) {
  section('non-retryable failure');
  const name = unique('e2e_4xx');

  await register({
    name,
    tasks: [
      {
        name: 'bad',
        taskReferenceName: 'bad',
        type: 'HTTP',
        retryCount: 3,
        retryDelaySeconds: 1,
        inputParameters: { http_request: { uri: `${base}/always-400`, method: 'GET' } },
      },
    ],
  });

  const id = await start(name);
  const run = await finish(id, 90_000);

  check('workflow failed', run.status === 'FAILED', `${run.status}`);
  // A 4xx is the caller's fault and will never succeed; burning the retry
  // budget on it delays the error someone needs to read.
  const attempts = byRef(run).get('bad') ?? [];
  check('a 4xx was not retried', attempts.length === 1, `${attempts.length} attempts`);
}

async function jqAndInline() {
  section('JQ and INLINE');
  const name = unique('e2e_jq');

  await register({
    name,
    tasks: [
      inline('make', 'return { items: [{ n: 1 }, { n: 2 }, { n: 3 }] };'),
      {
        name: 'sum',
        taskReferenceName: 'sum',
        type: 'JSON_JQ_TRANSFORM',
        inputParameters: {
          items: '${make.output.items}',
          queryExpression: '{ total: ([.items[].n] | add), count: (.items | length) }',
        },
      },
    ],
    outputParameters: { total: '${sum.output.result.total}', count: '${sum.output.result.count}' },
  });

  const id = await start(name);
  const run = await finish(id, 60_000);

  check('jq workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('jq computed over a previous output', run.output?.total === 6, JSON.stringify(run.output));
  check('jq returned the second field too', run.output?.count === 3, JSON.stringify(run.output));
}

async function noopAndSetVariable() {
  section('NOOP and SET_VARIABLE');
  const name = unique('e2e_noop');

  await register({
    name,
    tasks: [
      { name: 'gap', taskReferenceName: 'gap', type: 'NOOP' },
      { name: 'vars', taskReferenceName: 'vars', type: 'SET_VARIABLE', inputParameters: { stage: 'shipped' } },
      inline('read', 'return { seen: $.v };', { v: '${workflow.variables.stage}' }),
    ],
    outputParameters: { seen: '${read.output.seen}', direct: '${workflow.variables.stage}' },
  });

  const id = await start(name);
  const run = await finish(id, 60_000);

  check('noop workflow completed', run.status === 'COMPLETED', `${run.status}`);
  check('a variable is readable by a later task', run.output?.seen === 'shipped', JSON.stringify(run.output));
  check('and by the workflow output', run.output?.direct === 'shipped', JSON.stringify(run.output));
}

async function signedJwt() {
  section('GET_SIGNED_JWT');
  const name = unique('e2e_jwt');

  await register({
    name,
    tasks: [
      {
        name: 'token',
        taskReferenceName: 'token',
        type: 'GET_SIGNED_JWT',
        inputParameters: {
          subject: 'e2e',
          issuer: 'node-flow-e2e',
          audience: 'someone',
          algorithm: 'HS256',
          secret: 'a-signing-secret-of-adequate-length',
          // `ttlInSecond` is what the executor reads. Spelled `ttlSeconds`
          // this silently fell back to the one-hour default, and nothing here
          // noticed because nothing asserted on the expiry.
          ttlInSecond: 300,
        },
      },
    ],
    outputParameters: { token: '${token.output.token}' },
  });

  const id = await start(name);
  const run = await finish(id, 60_000);

  check('jwt workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  const token = run.output?.token;
  check('a three-part JWT came back', typeof token === 'string' && token.split('.').length === 3, String(token).slice(0, 40));
  if (typeof token === 'string' && token.split('.').length === 3) {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    check('the claims are the ones asked for', claims.sub === 'e2e' && claims.iss === 'node-flow-e2e', JSON.stringify(claims));
    // Pins the TTL we asked for rather than the executor's default, which is
    // the only thing that would have caught the misspelled field.
    const ttl = claims.exp - claims.iat;
    check('the TTL is the one asked for', ttl === 300, String(ttl));
  }
}

async function optionalTask() {
  section('optional task');
  const name = unique('e2e_optional');
  const queue = unique('mayfail');

  await register({
    name,
    tasks: [
      { name: queue, taskReferenceName: 'risky', type: 'SIMPLE', optional: true, retryCount: 0 },
      inline('after', 'return { reached: true };'),
    ],
    outputParameters: { reached: '${after.output.reached}' },
  });

  const id = await start(name);
  await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'went wrong');
  const run = await finish(id, 60_000);

  // The point of `optional`: the failure is recorded, the workflow carries on.
  check('workflow completed despite the failure', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('the task after it ran', run.output?.reached === true, JSON.stringify(run.output));
  const risky = (byRef(run).get('risky') ?? []).at(-1);
  check('the failure is still recorded on the task', String(risky?.status).startsWith('FAILED'), risky?.status);
}

async function scheduleToStartTimeout() {
  section('scheduleToStart timeout');
  const name = unique('e2e_sts');
  const queue = unique('nobody_polls');

  // Timeouts are a property of the *task definition*, not of the task inside a
  // workflow — so this is where the policy has to be declared.
  const declared = await call('POST', `/v1/ns/${NS}/metadata/task-definitions`, {
    body: {
      name: queue,
      retryCount: 0,
      scheduleToStartTimeout: 3,
      timeoutPolicy: 'TIME_OUT_WF',
    },
  });
  check('task definition registered', declared.status < 300, `${declared.status} ${JSON.stringify(declared.body).slice(0, 160)}`);

  // No worker ever leases this queue, which is exactly the failure the timeout
  // exists to name: a starved queue rather than a slow worker.
  await register({
    name,
    tasks: [{ name: queue, taskReferenceName: 'stranded', type: 'SIMPLE' }],
  });

  const id = await start(name);
  const run = await finish(id, 90_000);

  check('a task nobody leased timed out', ['TIMED_OUT', 'FAILED'].includes(run.status), `${run.status}`);
  check(
    'the reason names the timeout rather than a generic failure',
    /timeout|timed out|schedule/i.test(String(run.reasonForIncompletion ?? '')),
    run.reasonForIncompletion
  );
}

async function failureWorkflow() {
  section('failure workflow');
  const handler = unique('e2e_onfail');
  const name = unique('e2e_fails');
  const queue = unique('doomed');

  await register({
    name: handler,
    tasks: [inline('note', 'return { handled: $.id };', { id: '${workflow.input.workflowId}' })],
    outputParameters: { handled: '${note.output.handled}' },
  });

  await register({
    name,
    failureWorkflow: handler,
    tasks: [{ name: queue, taskReferenceName: 'boom', type: 'SIMPLE', retryCount: 0 }],
  });

  const id = await start(name);
  await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'exploded');
  const run = await finish(id, 60_000);
  check('the workflow failed', run.status === 'FAILED', `${run.status}`);

  // The handler runs as its own execution, given the failed run's id.
  const handled = await until(
    async () => {
      const found = await call('POST', `/v1/ns/${NS}/executions/search`, {
        body: { defName: handler, limit: 5 },
      });
      return (found.body?.executions ?? []).find((e) => e.status === 'COMPLETED') ?? null;
    },
    60_000,
    'the failure workflow to run'
  ).catch(() => null);

  check('a failure workflow execution started and finished', Boolean(handled), 'none found');
  if (handled) {
    const detail = await call('GET', `/v1/ns/${NS}/executions/${handled.workflowId}`, {});
    check('it was told which run failed', detail.body?.output?.handled === id, JSON.stringify(detail.body?.output));
  }
}
