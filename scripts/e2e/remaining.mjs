/**
 * The operators and tasks the other sections do not reach.
 *
 * Mostly the ones that wait: a `YIELD` held open until something signals it, a
 * `WAIT_FOR_WEBHOOK` holding a minted callback URL, a `HTTP_POLL` returning to
 * a dependency until it is ready. Waiting is where an orchestrator earns its
 * keep and where a bug is least visible — a run that never resumes looks, from
 * the outside, exactly like a run that is being patient.
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

export async function run() {
  await yieldAndSignal();
  await startWorkflowFireAndForget();
  await subWorkflowFailurePropagates();
  await waitForWebhook();
  await httpPoll();
  await taskLogs();
  await workerPollData();
  await liveStream();
}

async function yieldAndSignal() {
  section('YIELD and signal');
  const name = unique('e2e_yield');

  await register({
    name,
    tasks: [
      { name: 'hold', taskReferenceName: 'hold', type: 'YIELD' },
      inline('after', 'return { resumed: $.v };', { v: '${hold.output.approved}' }),
    ],
    outputParameters: { resumed: '${after.output.resumed}' },
  });

  const id = await start(name);

  // It must actually wait: a YIELD that completes on its own is not a YIELD.
  await until(
    async () => {
      const run = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
      return (run.body?.tasks ?? []).some((t) => t.refName === 'hold') ? run.body : null;
    },
    30_000,
    'the yield to be scheduled'
  );
  await new Promise((r) => setTimeout(r, 2000));

  const held = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
  check('the run waits rather than finishing', held.body?.status === 'RUNNING', `${held.body?.status}`);

  const signalled = await call('POST', `/v1/ns/${NS}/executions/${id}/signal`, {
    body: { taskRef: 'hold', status: 'COMPLETED', output: { approved: true } },
  });
  check('a signal is accepted', signalled.status < 300, `${signalled.status} ${JSON.stringify(signalled.body).slice(0, 200)}`);

  const done = await finish(id, 60_000);
  check('the signal resumed it', done.status === 'COMPLETED', `${done.status} ${done.reasonForIncompletion ?? ''}`);
  check("and carried the signal's output", done.output?.resumed === true, JSON.stringify(done.output));
}

async function startWorkflowFireAndForget() {
  section('START_WORKFLOW');
  const child = unique('e2e_kicked');
  const parent = unique('e2e_kicker');

  await register({ name: child, tasks: [inline('only', 'return { ran: true };')] });
  await register({
    name: parent,
    tasks: [
      {
        name: 'kickoff',
        taskReferenceName: 'kickoff',
        type: 'START_WORKFLOW',
        subWorkflowParam: { name: child, version: 1 },
        inputParameters: { note: 'started and forgotten' },
      },
    ],
  });

  const id = await start(parent);
  const run = await finish(id, 60_000);

  // Fire and forget: the parent must not wait for the child, which is the
  // entire difference from SUB_WORKFLOW.
  check('the parent finished without waiting', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);

  const started = await until(
    async () => {
      const found = await call('POST', `/v1/ns/${NS}/executions/search`, { body: { defName: child, limit: 5 } });
      return (found.body?.executions ?? [])[0] ?? null;
    },
    45_000,
    'the child to have been started'
  ).catch(() => null);
  check('the child was started anyway', Boolean(started), 'none found');
}

async function subWorkflowFailurePropagates() {
  section('sub-workflow failure propagates');
  const child = unique('e2e_badchild');
  const parent = unique('e2e_sadparent');
  const queue = unique('childwork');

  await register({
    name: child,
    tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE', retryCount: 0 }],
  });

  // `retryCount: 0` on the parent's task, so this isolates *propagation*. With
  // the default of 3 the parent would correctly retry — starting a fresh child
  // each time — and the next case covers that.
  await register({
    name: parent,
    tasks: [
      {
        name: 'child',
        taskReferenceName: 'child',
        type: 'SUB_WORKFLOW',
        retryCount: 0,
        subWorkflowParam: { name: child, version: 1 },
      },
      inline('never', 'return { ran: true };'),
    ],
  });

  const id = await start(parent);
  await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'child exploded');

  const run = await finish(id, 90_000);
  // A child that fails must fail its parent, or a failure disappears into a
  // nested run nobody is looking at.
  check('the parent failed too', run.status === 'FAILED', `${run.status}`);
  check(
    'the reason points at the child',
    /child|sub.?workflow|fail/i.test(String(run.reasonForIncompletion ?? '')),
    run.reasonForIncompletion
  );

  const after = byRef(run).get('never') ?? [];
  check('nothing after it ran', after.length === 0 || after.every((t) => t.status !== 'COMPLETED'), after.map((t) => t.status).join(','));

  await retriedSubWorkflowStartsAFreshChild();
}

/**
 * A retried sub-workflow has to run a genuinely new child.
 *
 * `RetryTask` only re-creates the parent's *task*; the child is started by a
 * separate command that the retry path never emitted, and the start was
 * deduplicated on a key that did not include the attempt. Either alone left the
 * retried task with nothing beneath it that could complete it, so the parent
 * sat in `RUNNING` for ever — and since `retryCount` defaults to 3, that was
 * the ordinary path for any sub-workflow whose child failed.
 */
async function retriedSubWorkflowStartsAFreshChild() {
  section('retried sub-workflow');
  const child = unique('e2e_retrychild');
  const parent = unique('e2e_retryparent');
  const queue = unique('retrychildwork');

  await register({
    name: child,
    tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE', retryCount: 0 }],
  });
  await register({
    name: parent,
    tasks: [
      {
        name: 'child',
        taskReferenceName: 'child',
        type: 'SUB_WORKFLOW',
        retryCount: 1,
        retryDelaySeconds: 1,
        subWorkflowParam: { name: child, version: 1 },
      },
    ],
  });

  const id = await start(parent);

  // Two attempts, so two separate children each needing their own worker. If
  // the retry did not start one, the second lease never arrives.
  await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'first child exploded');
  const second = await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'second child exploded').catch(
    () => null
  );
  check('the retry started a second child', Boolean(second), 'no task appeared for a retried child');

  const run = await finish(id, 120_000);
  check('the parent failed rather than hanging', run.status === 'FAILED', `${run.status}`);

  const attempts = byRef(run).get('child') ?? [];
  check('both attempts are recorded', attempts.length >= 2, `${attempts.length} attempts`);
  check(
    'and none is left scheduled',
    attempts.every((t) => t.status !== 'SCHEDULED'),
    attempts.map((t) => `${t.attempt}:${t.status}`).join(' ')
  );
}

async function waitForWebhook() {
  section('WAIT_FOR_WEBHOOK');
  const name = unique('e2e_callback');

  await register({
    name,
    tasks: [
      { name: 'await_call', taskReferenceName: 'await_call', type: 'WAIT_FOR_WEBHOOK' },
      inline('after', 'return { got: $.v };', { v: '${await_call.output.token}' }),
    ],
    outputParameters: { got: '${after.output.got}' },
  });

  const id = await start(name);

  // The engine mints a URL for this exact task instance; without it there is
  // nothing for the external system to call.
  const task = await until(
    async () => {
      const run = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
      return (run.body?.tasks ?? []).find((t) => t.refName === 'await_call' && t.output?.callbackPath) ?? null;
    },
    45_000,
    'the callback URL to be minted'
  ).catch(() => null);

  check('a callback URL is minted for the waiting task', Boolean(task), 'none appeared');
  if (!task) return;

  // A path rather than a URL, deliberately: the server does not know what
  // hostname it is reached on, and guessing one would publish a callback
  // address that does not resolve.
  const path = String(task.output.callbackPath);

  // Unauthenticated: the caller is an external system with no credential.
  const delivered = await call('POST', path, { body: { token: 'callback-arrived' }, key: null });
  check('the callback is accepted unauthenticated', delivered.status < 300, `${delivered.status} ${JSON.stringify(delivered.body).slice(0, 150)}`);

  const run = await finish(id, 60_000);
  check('the callback resumed the workflow', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
}

async function httpPoll() {
  section('HTTP_POLL');

  // Not ready for the first two calls, then ready — so the poll has something
  // to come back for rather than succeeding immediately.
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: calls >= 3 ? 'ready' : 'pending', calls }));
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;

  try {
    const name = unique('e2e_poll');
    await register({
      name,
      tasks: [
        {
          name: 'poll',
          taskReferenceName: 'poll',
          type: 'HTTP_POLL',
          inputParameters: {
            http_request: {
              uri: `http://${HOST_FROM_CONTAINER}:${port}/status`,
              method: 'GET',
            },
            // Top level, not inside the request, and evaluated as JavaScript
            // with the HTTP response bound as `$` — the same shape an INLINE
            // task gets, so an author who has written one knows this already.
            // Defensive on purpose: a poll that has not reached the endpoint yet, or a
            // transient 5xx, arrives with no body — and a condition that throws is
            // treated as unrecoverable rather than as "not ready".
            terminationCondition: 'return Boolean($.body) && $.body.state === "ready";',
            // Seconds, defaulting to 60 — a poll meant for a slow dependency.
            pollIntervalSeconds: 1,
            pollCount: 10,
          },
        },
      ],
      outputParameters: { state: '${poll.output.body.state}' },
    });

    const id = await start(name);
    const run = await finish(id, 120_000);

    if (run.status !== 'COMPLETED' && /private and loopback/i.test(String(run.reasonForIncompletion))) {
      check('HTTP_POLL reached the endpoint', false, 'blocked by the SSRF guard — set NODE_FLOW_HTTP_ALLOW_PRIVATE for this section');
      return;
    }

    check('the poll completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
    check('it stopped on the termination condition', run.output?.state === 'ready', JSON.stringify(run.output));
    check('and really polled more than once', calls >= 2, `${calls} calls`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function taskLogs() {
  section('task logs');
  const name = unique('e2e_logs');
  const queue = unique('loggingwork');

  await register({ name, tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }] });
  const id = await start(name);

  const leased = await until(
    async () => {
      const r = await call('POST', `/v1/ns/${NS}/queues/${queue}/lease`, {
        body: { workerId: 'e2e-logger', count: 1, leaseSeconds: 60 },
      });
      return r.body?.tasks?.length ? r.body.tasks[0] : null;
    },
    30_000,
    'a task to log against'
  );

  const written = await call('POST', `/v1/ns/${NS}/tasks/${leased.taskId}/logs`, {
    body: {
      workflowId: leased.workflowId,
      leaseToken: leased.leaseToken,
      logs: [{ message: 'charging the card', level: 'info' }],
    },
  });
  check('a worker can write a log line', written.status < 300, `${written.status} ${JSON.stringify(written.body).slice(0, 150)}`);

  const read = await call('GET', `/v1/ns/${NS}/executions/${id}/tasks/${leased.taskId}/logs`, {});
  const lines = read.body?.logs ?? read.body ?? [];
  // The point of task logs: the lines explaining a failure are beside the task
  // when someone opens it, rather than in a server log nobody can reach.
  check('and read it back beside the task', Array.isArray(lines) && lines.some((l) => String(l.message).includes('charging the card')), JSON.stringify(read.body).slice(0, 200));

  await call('POST', `/v1/ns/${NS}/tasks/${leased.taskId}/report`, {
    body: { queueName: queue, workflowId: leased.workflowId, leaseToken: leased.leaseToken, status: 'COMPLETED', output: {} },
  });
  await finish(id, 60_000).catch(() => undefined);
}

async function workerPollData() {
  section('worker poll data');

  const workers = await call('GET', `/v1/ns/${NS}/queues/workers`, {});
  check('worker activity is readable', workers.status === 200, `${workers.status}`);

  const rows = workers.body?.workers ?? workers.body ?? [];
  // Earlier sections leased as several worker ids, so something must be here —
  // "is anything polling this queue?" is the first question of every incident.
  check('it records the workers that have polled', Array.isArray(rows) && rows.length > 0, JSON.stringify(workers.body).slice(0, 200));
}

async function liveStream() {
  section('live execution stream');
  const name = unique('e2e_stream');
  const queue = unique('streamwork');

  await register({ name, tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }] });
  const id = await start(name);

  // Server-sent events: the dashboard follows a run without polling, so the
  // stream has to stay open and actually emit.
  const controller = new AbortController();
  const response = await fetch(`${process.env.API ?? 'http://localhost:3000'}/v1/ns/${NS}/executions/${id}/stream`, {
    headers: { authorization: `Bearer ${process.env.KEY}`, accept: 'text/event-stream' },
    signal: controller.signal,
  }).catch(() => null);

  check('the stream opens', Boolean(response?.ok), `${response?.status}`);
  check('as an event stream', String(response?.headers.get('content-type')).includes('text/event-stream'), String(response?.headers.get('content-type')));

  if (response?.ok && response.body) {
    const reader = response.body.getReader();
    const deadline = Date.now() + 30_000;
    let seen = '';

    // Drive the run so there is something to report.
    await workOne(queue, { ok: true });

    while (Date.now() < deadline && !seen.includes('data:')) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ done: true }), 5000)),
      ]);
      if (chunk.done) break;
      seen += new TextDecoder().decode(chunk.value);
    }

    check('and emits at least one event', seen.includes('data:'), JSON.stringify(seen).slice(0, 200));
    controller.abort();
  }

  await finish(id, 60_000).catch(() => undefined);
}
