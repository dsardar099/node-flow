/**
 * Operating a running system: human tasks, the operator actions on an
 * execution, search, and the signals that come from outside.
 *
 * These are the paths someone reaches for when something has already gone
 * wrong, which is the worst moment to discover that retry does not resume or
 * that skip leaves a task in the frontier.
 */
import { NS, byRef, call, check, finish, register, section, signIn, start, unique, until, workOne } from './harness.mjs';

// The dashboard user the quickstart creates; override for another stack.
const HUMAN_EMAIL = process.env.HUMAN_EMAIL ?? 'you@example.com';
const HUMAN_PASSWORD = process.env.HUMAN_PASSWORD ?? 'development-password';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

export async function run() {
  await humanTask();
  await retryAfterFailure();
  await skipTask();
  await restartAndRerun();
  await bulkActions();
  await searchAndCorrelation();
  await inboundWebhook();
  await eventHandlerCrud();
  await statusListener();
}

async function humanTask() {
  section('human tasks');
  const name = unique('e2e_human');

  await register({
    name,
    tasks: [
      {
        name: 'approve',
        taskReferenceName: 'approve',
        type: 'HUMAN',
        inputParameters: { title: 'Approve the order', amount: 100 },
      },
    ],
    outputParameters: { decision: '${approve.output.decision}' },
  });

  const id = await start(name);

  // An API key cannot touch the inbox by design — a task assigned to a person
  // is acted on by that person — so this half runs as a signed-in user.
  const refused = await call('GET', `/v1/ns/${NS}/human-tasks`, {});
  check('an API key cannot reach the inbox', refused.status >= 400, `${refused.status}`);

  const asUser = await signIn(HUMAN_EMAIL, HUMAN_PASSWORD);

  const pending = await until(
    async () => {
      const found = await asUser('GET', `/v1/ns/${NS}/human-tasks`);
      const rows = found.body?.tasks ?? found.body?.humanTasks ?? found.body ?? [];
      return (Array.isArray(rows) ? rows : []).find((t) => t.workflowId === id) ?? null;
    },
    30_000,
    'the human task to appear in the inbox'
  );
  check('appears in the inbox', Boolean(pending), 'not found');

  const taskId = pending.id ?? pending.taskId;
  const claimed = await asUser('POST', `/v1/ns/${NS}/human-tasks/${taskId}/claim`, { body: {} });
  check('claimable', claimed.status < 300, `${claimed.status} ${JSON.stringify(claimed.body).slice(0, 150)}`);

  const completed = await asUser('POST', `/v1/ns/${NS}/human-tasks/${taskId}/complete`, {
    body: { output: { decision: 'approved' } },
  });
  check('completable', completed.status < 300, `${completed.status} ${JSON.stringify(completed.body).slice(0, 150)}`);

  const run = await finish(id, 60_000);
  check('the workflow resumed and finished', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check("the person's answer reached the output", run.output?.decision === 'approved', JSON.stringify(run.output));
}

async function retryAfterFailure() {
  section('retry a failed execution');
  const name = unique('e2e_retryop');
  const queue = unique('flaky_worker');

  await register({
    name,
    tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE', retryCount: 0 }],
    outputParameters: { ok: '${step.output.ok}' },
  });

  const id = await start(name);
  await workOne(queue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'first go, deliberately');
  const failed = await finish(id, 60_000);
  check('the run failed', failed.status === 'FAILED', `${failed.status}`);

  // Retry resumes the same execution from the failed task, rather than starting
  // a new one — the distinction from `run-again`.
  const retried = await call('POST', `/v1/ns/${NS}/executions/${id}/retry`, { body: {} });
  check('retry accepted', retried.status < 300, `${retried.status} ${JSON.stringify(retried.body).slice(0, 150)}`);

  await workOne(queue, { ok: true });
  const recovered = await finish(id, 60_000);

  check('the same execution completed', recovered.status === 'COMPLETED', `${recovered.status} ${recovered.reasonForIncompletion ?? ''}`);
  check('and produced the output the retry supplied', recovered.output?.ok === true, JSON.stringify(recovered.output));
}

async function skipTask() {
  section('skip a task');
  const name = unique('e2e_skip');
  const queue = unique('skippable');

  await register({
    name,
    tasks: [
      { name: queue, taskReferenceName: 'step', type: 'SIMPLE' },
      inline('after', 'return { reached: true };'),
    ],
    outputParameters: { reached: '${after.output.reached}' },
  });

  const id = await start(name);

  // Wait for it to be scheduled, then skip it without ever running it.
  await until(
    async () => {
      const run = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
      return (run.body?.tasks ?? []).some((t) => t.refName === 'step') ? true : null;
    },
    30_000,
    'the task to be scheduled'
  );

  const skipped = await call('POST', `/v1/ns/${NS}/executions/${id}/skip-task`, {
    body: { taskRef: 'step' },
  });
  check('skip accepted', skipped.status < 300, `${skipped.status} ${JSON.stringify(skipped.body).slice(0, 150)}`);

  const run = await finish(id, 60_000);
  check('the workflow moved past it', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('the following task ran', run.output?.reached === true, JSON.stringify(run.output));
  check('the skipped task is marked skipped', (byRef(run).get('step') ?? []).some((t) => t.status === 'SKIPPED'), (byRef(run).get('step') ?? []).map((t) => t.status).join(','));
}

async function restartAndRerun() {
  section('restart and run-again');
  const name = unique('e2e_restart');

  await register({
    name,
    tasks: [inline('only', 'return { n: 1 };')],
    outputParameters: { n: '${only.output.n}' },
  });

  const id = await start(name);
  await finish(id, 60_000);

  const again = await call('POST', `/v1/ns/${NS}/executions/${id}/run-again`, { body: {} });
  check('run-again accepted', again.status < 300, `${again.status} ${JSON.stringify(again.body).slice(0, 150)}`);

  const newId = again.body?.id ?? again.body?.workflowId;
  // A fresh execution, not a mutation of the finished one — the original has to
  // remain readable exactly as it was.
  check('it started a different execution', Boolean(newId) && newId !== id, `${newId} vs ${id}`);
  if (newId) {
    const fresh = await finish(newId, 60_000);
    check('the new execution completed', fresh.status === 'COMPLETED', `${fresh.status}`);
  }

  const original = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
  check('the original is untouched', original.body?.status === 'COMPLETED', `${original.body?.status}`);
}

async function bulkActions() {
  section('bulk operations');
  const name = unique('e2e_bulk');
  const queue = unique('bulkwork');

  await register({ name, tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }] });

  const ids = [await start(name), await start(name), await start(name)];

  const terminated = await call('POST', `/v1/ns/${NS}/executions/bulk/terminate`, {
    body: { workflowIds: ids, reason: 'bulk e2e' },
  });
  check('bulk terminate accepted', terminated.status < 300, `${terminated.status} ${JSON.stringify(terminated.body).slice(0, 200)}`);

  let allTerminated = true;
  for (const id of ids) {
    const run = await call('GET', `/v1/ns/${NS}/executions/${id}`, {});
    if (run.body?.status !== 'TERMINATED') allTerminated = false;
  }
  check('every execution in the batch is terminated', allTerminated, 'at least one was not');
}

async function searchAndCorrelation() {
  section('search and correlation');
  const name = unique('e2e_search');
  const correlationId = unique('corr');

  await register({ name, tasks: [inline('only', 'return { n: 1 };')] });
  const id = await start(name, {}, { correlationId });
  await finish(id, 60_000);

  const byName = await call('POST', `/v1/ns/${NS}/executions/search`, { body: { defName: name, limit: 10 } });
  check('findable by definition name', (byName.body?.executions ?? []).some((e) => e.workflowId === id), `${byName.status}`);

  const byStatus = await call('POST', `/v1/ns/${NS}/executions/search`, {
    body: { defName: name, status: ['COMPLETED'], limit: 10 },
  });
  check('filterable by status', (byStatus.body?.executions ?? []).every((e) => e.status === 'COMPLETED'), JSON.stringify(byStatus.body).slice(0, 150));

  // Correlation is how a caller finds "the run for *my* order" without having
  // kept the execution id.
  const byCorrelation = await call('GET', `/v1/ns/${NS}/executions/by-correlation/${correlationId}`, {});
  const rows = byCorrelation.body?.executions ?? byCorrelation.body ?? [];
  check('findable by correlation id', Array.isArray(rows) && rows.some((e) => (e.workflowId ?? e.id) === id), `${byCorrelation.status} ${JSON.stringify(byCorrelation.body).slice(0, 150)}`);
}

async function inboundWebhook() {
  section('inbound webhook');
  const hookName = unique('e2e_hook');

  const created = await call('POST', `/v1/ns/${NS}/incoming-webhooks`, {
    body: { name: hookName, verifier: 'NONE', enabled: true },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  // The server hands back the URL to publish rather than making the caller
  // assemble one, so use exactly that — a test that builds its own would still
  // pass if the published path were wrong.
  const path = created.body?.path;
  check('it returns the URL to publish', typeof path === 'string' && path.length > 0, String(path));

  if (typeof path === 'string') {
    // Unauthenticated on purpose: the point is that a third party posts to it
    // with no node-flow credential at all.
    const delivered = await call('POST', path, { body: { anything: true }, key: null });
    check('accepts an unauthenticated delivery', delivered.status < 300, `${delivered.status} ${JSON.stringify(delivered.body).slice(0, 150)}`);

    const wrong = await call('POST', '/v1/hooks/00000000-0000-0000-0000-000000000000', { body: {}, key: null });
    check('an unknown hook is refused', wrong.status >= 400, `${wrong.status}`);
  }

  const listed = await call('GET', `/v1/ns/${NS}/incoming-webhooks`, {});
  const rows = listed.body?.webhooks ?? listed.body?.incomingWebhooks ?? listed.body ?? [];
  check('listed', Array.isArray(rows) && rows.some((w) => w.name === hookName), JSON.stringify(listed.body).slice(0, 150));

  await call('DELETE', `/v1/ns/${NS}/incoming-webhooks/${hookName}`, {});
}

async function eventHandlerCrud() {
  section('event handlers');
  const handler = unique('e2e_handler');
  const name = unique('e2e_evtwf');

  await register({ name, tasks: [inline('only', 'return { ok: true };')] });

  const created = await call('POST', `/v1/ns/${NS}/event-handlers`, {
    body: {
      name: handler,
      source: 'internal',
      topic: unique('topic'),
      action: 'START_WORKFLOW',
      workflow: { name },
      enabled: true,
    },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  const listed = await call('GET', `/v1/ns/${NS}/event-handlers`, {});
  const rows = listed.body?.handlers ?? listed.body?.eventHandlers ?? listed.body ?? [];
  check('listed', Array.isArray(rows) && rows.some((h) => h.name === handler), JSON.stringify(listed.body).slice(0, 150));

  const disabled = await call('POST', `/v1/ns/${NS}/event-handlers/${handler}/disable`, { body: {} });
  check('disablable', disabled.status < 300, `${disabled.status}`);

  await call('DELETE', `/v1/ns/${NS}/event-handlers/${handler}`, {});
}

async function statusListener() {
  section('status listeners');
  const listener = unique('e2e_listener');

  const created = await call('POST', `/v1/ns/${NS}/status-listeners`, {
    body: {
      name: listener,
      workflowNames: ['*'],
      events: ['COMPLETED', 'FAILED'],
      sink: 'WEBHOOK',
      config: { url: 'https://example.invalid/hook' },
    },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  const listed = await call('GET', `/v1/ns/${NS}/status-listeners`, {});
  const rows = listed.body?.listeners ?? listed.body?.statusListeners ?? listed.body ?? [];
  check('listed', Array.isArray(rows) && rows.some((l) => l.name === listener), JSON.stringify(listed.body).slice(0, 150));

  await call('DELETE', `/v1/ns/${NS}/status-listeners/${listener}`, {});
}
