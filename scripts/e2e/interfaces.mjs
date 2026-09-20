/**
 * The ways in, other than the `/v1` API: the Conductor compatibility layer, the
 * REST and MCP gateways, BPMN import, the starter templates and replay.
 *
 * Each of these is a promise made to someone outside the project — an existing
 * Conductor SDK, an agent, a BPMN tool — so each is worth proving against the
 * built image rather than against a unit test that shares our assumptions.
 */
import { NS, call, check, finish, register, section, start, unique, until, workOne } from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

export async function run() {
  await conductorCompat();
  await restGateway();
  await mcpGateway();
  await bpmnImport();
  await replay();
  await openApiAndDocs();
}

async function conductorCompat() {
  section('Conductor compatibility');
  const name = unique('e2e_conductor');
  const queue = unique('conductorwork');

  // Registered through Conductor's own endpoint, with Conductor's payload —
  // the shape an unmodified Conductor SDK sends.
  const registered = await call('POST', '/conductor/api/metadata/workflow', {
    body: {
      name,
      version: 1,
      tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE', inputParameters: {} }],
      outputParameters: { ok: '${step.output.ok}' },
    },
  });
  check('registers through /conductor/api', registered.status < 300, `${registered.status} ${JSON.stringify(registered.body).slice(0, 200)}`);

  const started = await call('POST', `/conductor/api/workflow/${name}`, { body: { }, });
  check('starts through /conductor/api', started.status < 300, `${started.status} ${JSON.stringify(started.body).slice(0, 200)}`);

  // Conductor returns the id as a bare string, not an object — an SDK reads it
  // directly, so the shape matters as much as the status.
  const id = typeof started.body === 'string' ? started.body : started.body?.workflowId ?? started.body?.id;
  check('returns a workflow id', typeof id === 'string' && id.length > 0, JSON.stringify(started.body).slice(0, 120));

  if (typeof id === 'string') {
    // Conductor's poll/ack pair, rather than our lease/report.
    const polled = await until(
      async () => {
        const r = await call('GET', `/conductor/api/tasks/poll/${queue}?workerid=e2e`, {});
        return r.body && r.body.taskId ? r.body : null;
      },
      30_000,
      'a Conductor-style poll to return a task'
    ).catch(() => null);
    check('polls a task the Conductor way', Boolean(polled), 'no task returned');

    if (polled) {
      const acked = await call('POST', '/conductor/api/tasks', {
        body: { taskId: polled.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: { ok: true } },
      });
      check('accepts a Conductor-style update', acked.status < 300, `${acked.status} ${JSON.stringify(acked.body).slice(0, 150)}`);

      const run = await finish(id, 60_000);
      check('the workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
      check('the worker output reached the output', run.output?.ok === true, JSON.stringify(run.output));
    }
  }
}

async function restGateway() {
  section('REST gateway');
  const name = unique('e2e_route');

  // Tagged `api:route`, which is what exposes it as an HTTP endpoint of its own.
  await register({
    name,
    tags: ['api:route'],
    tasks: [inline('compute', 'return { doubled: $.n * 2 };', { n: '${workflow.input.n}' })],
    outputParameters: { doubled: '${compute.output.doubled}' },
  });

  const answered = await call('POST', `/v1/ns/${NS}/api/${name}`, { body: { n: 21 } });
  check('answers on its own route', answered.status < 300, `${answered.status} ${JSON.stringify(answered.body).slice(0, 200)}`);
  check('with the workflow output as the body', answered.body?.doubled === 42, JSON.stringify(answered.body).slice(0, 150));

  // An untagged workflow must be invisible here — 404, not 403, so the gateway
  // does not confirm that a workflow exists to someone who cannot reach it.
  const hidden = unique('e2e_unexposed');
  await register({ name: hidden, tasks: [inline('only', 'return { n: 1 };')] });
  const refused = await call('POST', `/v1/ns/${NS}/api/${hidden}`, { body: {} });
  check('an untagged workflow is not exposed', refused.status === 404, `${refused.status}`);
}

async function mcpGateway() {
  section('MCP gateway');
  const name = unique('e2e_tool');

  await register({
    name,
    tags: ['mcp:tool'],
    description: 'Doubles a number, for the end-to-end suite.',
    tasks: [inline('compute', 'return { doubled: $.n * 2 };', { n: '${workflow.input.n}' })],
    outputParameters: { doubled: '${compute.output.doubled}' },
  });

  // Streamable HTTP requires both content types; a client offering neither is
  // correctly refused, so this is the header a real MCP client sends.
  const MCP_HEADERS = { accept: 'application/json, text/event-stream' };

  const listed = await call('POST', `/v1/ns/${NS}/mcp`, {
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    headers: MCP_HEADERS,
  });
  check('speaks JSON-RPC', listed.status < 300, `${listed.status} ${JSON.stringify(listed.body).slice(0, 200)}`);

  const tools = listed.body?.result?.tools ?? [];
  check('lists a tagged workflow as a tool', tools.some((t) => t.name === name), tools.map((t) => t.name).join(',').slice(0, 200));

  const called = await call('POST', `/v1/ns/${NS}/mcp`, {
    body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { n: 21 } } },
    headers: MCP_HEADERS,
  });
  check('calls it', called.status < 300 && !called.body?.error, `${called.status} ${JSON.stringify(called.body).slice(0, 200)}`);
  check('and returns the result', JSON.stringify(called.body?.result ?? {}).includes('42'), JSON.stringify(called.body?.result ?? {}).slice(0, 200));
}

async function bpmnImport() {
  section('BPMN import');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="e2e">
  <bpmn:process id="e2e_process" name="e2e process" isExecutable="true">
    <bpmn:startEvent id="start" />
    <bpmn:serviceTask id="doWork" name="doWork" />
    <bpmn:endEvent id="end" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="doWork" />
    <bpmn:sequenceFlow id="f2" sourceRef="doWork" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

  const imported = await call('POST', `/v1/ns/${NS}/metadata/workflows/import-bpmn`, { body: { xml } });
  check('accepts a BPMN process', imported.status < 300, `${imported.status} ${JSON.stringify(imported.body).slice(0, 250)}`);

  const draft = imported.body?.definition ?? imported.body?.draft ?? imported.body;
  // Names are sanitised into identifiers on the way in — "Check stock levels"
  // becomes check_stock_levels — so this compares the sanitised form.
  check('converts the service task', JSON.stringify(draft ?? {}).toLowerCase().includes('dowork'), JSON.stringify(draft ?? {}).slice(0, 200));

  // A draft, never a registration: an imported diagram is a starting point that
  // someone reviews, not something that silently becomes runnable.
  const registeredAnyway = await call('GET', `/v1/ns/${NS}/metadata/workflows/e2e_process`, {});
  check('but does not register it', registeredAnyway.status === 404, `${registeredAnyway.status}`);
}

/*
 * Starter templates are not tested here, and the omission is deliberate.
 *
 * They ship inside `@node-flow-dev/core` and the dashboard imports them directly;
 * there is no HTTP route to exercise, so a check here could only assert that a
 * route we never built is missing. What matters about a template — that it
 * compiles, so a starter can never teach a mistake — is asserted in
 * `packages/store/src/lib/templates.spec.ts`, which runs every one of them
 * through the same compiler registration uses.
 */

async function replay() {
  section('replay');
  const name = unique('e2e_replay');
  const queue = unique('replaywork');

  await register({
    name,
    tasks: [
      { name: queue, taskReferenceName: 'step', type: 'SIMPLE' },
      inline('after', 'return { doubled: $.n * 2 };', { n: '${step.output.n}' }),
    ],
    outputParameters: { doubled: '${after.output.doubled}' },
  });

  const id = await start(name);
  await workOne(queue, { n: 21 });
  const run = await finish(id, 60_000);
  check('the original run completed', run.status === 'COMPLETED', `${run.status}`);

  // Replay re-derives the run through the engine from what was recorded, so it
  // must reach the same answer without a worker touching it again.
  const replayed = await call('POST', `/v1/ns/${NS}/executions/${id}/replay`, { body: {} });
  check('replay accepted', replayed.status < 300, `${replayed.status} ${JSON.stringify(replayed.body).slice(0, 200)}`);
  check(
    'it reports no divergence from the recorded run',
    JSON.stringify(replayed.body ?? {}).match(/"divergences?":\s*(\[\]|0)/) !== null ||
      replayed.body?.diverged === false ||
      (Array.isArray(replayed.body?.divergences) && replayed.body.divergences.length === 0),
    JSON.stringify(replayed.body).slice(0, 250)
  );
}

async function openApiAndDocs() {
  section('OpenAPI and docs');

  const doc = await call('GET', '/v1/openapi.json', { key: null });
  check('document is public', doc.status === 200, `${doc.status}`);

  const paths = Object.keys(doc.body?.paths ?? {});
  check('it covers the v1 API', paths.some((p) => p.startsWith('/v1/ns/')), `${paths.length} paths`);
  check('and the Conductor layer', paths.some((p) => p.startsWith('/conductor/')), `${paths.length} paths`);

  // Every operation needs an id and a tag or the generated clients come out
  // with unnamed methods.
  const operations = Object.values(doc.body?.paths ?? {}).flatMap((p) => Object.values(p));
  check(
    'every operation has an id',
    operations.every((o) => typeof o.operationId === 'string' && o.operationId.length > 0),
    `${operations.filter((o) => !o.operationId).length} without one`
  );

  // No Swagger UI on the server, by decision — serving one would pull
  // `@fastify/static` back into a JSON API. The dashboard renders the reference
  // from this document instead, so nothing should answer here.
  const docs = await call('GET', '/v1/docs', { key: null });
  check('the server serves no viewer of its own', docs.status === 404, `${docs.status}`);
}
