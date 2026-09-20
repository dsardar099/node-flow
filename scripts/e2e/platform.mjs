/**
 * The control plane: definitions, schemas, variables, people and the record of
 * what they did.
 *
 * These are mostly CRUD, and CRUD is where an end-to-end pass earns its keep in
 * a different way than the engine does — not by finding logic errors but by
 * catching a route that is mounted under the wrong prefix, a scope the guard
 * enforces but the document never mentions, or an isolation rule that holds in
 * a repository test and is bypassed by the controller above it.
 */
import { NS, call, check, register, section, start, finish, unique } from './harness.mjs';

export async function run() {
  await taskDefinitions();
  await schemas();
  await environment();
  await namespaceIsolation();
  await scopes();
  await audit();
  await quotas();
  await versioning();
}

async function taskDefinitions() {
  section('task definitions');
  const name = unique('e2e_taskdef');

  const created = await call('POST', `/v1/ns/${NS}/metadata/task-definitions`, {
    body: { name, retryCount: 2, retryLogic: 'EXPONENTIAL_BACKOFF', retryDelaySeconds: 1, timeoutSeconds: 60 },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 150)}`);

  const fetched = await call('GET', `/v1/ns/${NS}/metadata/task-definitions/${name}`, {});
  check('readable', fetched.status === 200 && fetched.body?.name === name, `${fetched.status}`);
  check('policy round-trips', fetched.body?.retryCount === 2, JSON.stringify(fetched.body).slice(0, 150));

  const listed = await call('GET', `/v1/ns/${NS}/metadata/task-definitions`, {});
  const rows = listed.body?.taskDefs ?? listed.body?.taskDefinitions ?? listed.body ?? [];
  check('appears in the listing', Array.isArray(rows) && rows.some((d) => d.name === name), JSON.stringify(listed.body).slice(0, 150));

  const removed = await call('DELETE', `/v1/ns/${NS}/metadata/task-definitions/${name}`, {});
  check('deleted', removed.status < 300, `${removed.status}`);
}

async function schemas() {
  section('schema registry');
  const name = unique('e2e_schema');

  const registered = await call('POST', `/v1/ns/${NS}/schemas`, {
    body: {
      name,
      data: {
        type: 'object',
        properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
        required: ['orderId'],
      },
    },
  });
  check('registered', registered.status < 300, `${registered.status} ${JSON.stringify(registered.body).slice(0, 150)}`);

  const good = await call('POST', `/v1/ns/${NS}/schemas/${name}/validate`, {
    body: { payload: { orderId: 'o-1', amount: 5 } },
  });
  check('accepts a valid payload', good.status < 300 && good.body?.valid === true, `${good.status} ${JSON.stringify(good.body).slice(0, 150)}`);

  const bad = await call('POST', `/v1/ns/${NS}/schemas/${name}/validate`, {
    body: { payload: { amount: 5 } },
  });
  // Rejection must be reported, not thrown: a caller needs to know which field.
  check('rejects a payload missing a required field', bad.status < 300 && bad.body?.valid === false, `${bad.status} ${JSON.stringify(bad.body).slice(0, 150)}`);
}

async function environment() {
  section('environment variables');
  const name = unique('E2E_VAR').toUpperCase();

  const put = await call('PUT', `/v1/ns/${NS}/environment/${name}`, {
    body: { value: 'from-the-environment' },
  });
  check('set', put.status < 300, `${put.status} ${JSON.stringify(put.body).slice(0, 150)}`);

  // The point of an environment variable is that a definition can read it.
  const wf = unique('e2e_envread');
  await register({
    name: wf,
    tasks: [
      {
        name: 'read',
        taskReferenceName: 'read',
        type: 'INLINE',
        inputParameters: { expression: 'return { seen: $.v };', v: `\${workflow.env.${name}}` },
      },
    ],
    outputParameters: { seen: '${read.output.seen}' },
  });

  const run = await finish(await start(wf), 60_000);
  check('a workflow can read it', run.output?.seen === 'from-the-environment', JSON.stringify(run.output));

  const removed = await call('DELETE', `/v1/ns/${NS}/environment/${name}`, {});
  check('deleted', removed.status < 300, `${removed.status}`);
}

async function namespaceIsolation() {
  section('namespace isolation');

  // A credential names its own namespace; the URL must not be able to select a
  // different one. This is the rule that a multi-tenant install depends on, and
  // it is enforced below the controller on purpose.
  const other = await call('GET', `/v1/ns/not-our-namespace/metadata/workflows`, {});
  check('another namespace is not readable', other.status === 403 || other.status === 404, `${other.status}`);

  const started = await call('POST', `/v1/ns/not-our-namespace/executions/anything`, { body: { input: {} } });
  check('and not writable', started.status >= 400, `${started.status}`);
}

async function scopes() {
  section('scopes');

  // A key scoped to reading executions must not be able to register a
  // definition, however valid the definition is.
  const made = await call('POST', `/v1/auth/api-keys`, {
    body: { name: unique('reader'), scopes: ['executions:read'] },
  });
  check('a narrowly-scoped key can be minted', made.status < 300, `${made.status} ${JSON.stringify(made.body).slice(0, 150)}`);

  const token = made.body?.token ?? made.body?.apiKey?.token;
  if (!token) {
    check('the new key came with a token', false, JSON.stringify(made.body).slice(0, 200));
    return;
  }

  const read = await call('POST', `/v1/ns/${NS}/executions/search`, { body: { limit: 1 }, key: token });
  check('it can do what it was granted', read.status === 200, `${read.status}`);

  const write = await call('POST', `/v1/ns/${NS}/metadata/workflows`, {
    key: token,
    body: { name: unique('nope'), version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] },
  });
  check('and nothing it was not', write.status === 403, `${write.status}`);
}

async function audit() {
  section('audit log');

  const name = unique('e2e_audited');
  await register({ name, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] });

  const log = await call('GET', `/v1/ns/${NS}/audit?limit=50`, {});
  check('readable', log.status === 200, `${log.status}`);

  const entries = log.body?.entries ?? log.body?.events ?? log.body ?? [];
  // Registering a definition is exactly the kind of change an audit log exists
  // to record; if it is absent, the log is decorative.
  check(
    'records a definition being registered',
    Array.isArray(entries) && entries.some((e) => JSON.stringify(e).includes(name)),
    `${Array.isArray(entries) ? entries.length : 0} entries, none mentioning ${name}`
  );
}

async function quotas() {
  section('quotas');

  const current = await call('GET', `/v1/ns/${NS}/quotas`, {});
  check('readable', current.status === 200, `${current.status} ${JSON.stringify(current.body).slice(0, 150)}`);

  // Set a quota, prove it bites, then put it back — a quota that cannot be
  // observed to reject anything is a number in a table.
  const restore = current.body ?? {};
  const set = await call('PUT', `/v1/ns/${NS}/quotas`, { body: { ...restore, maxWorkflowDefinitions: 1 } });
  check('settable', set.status < 300, `${set.status} ${JSON.stringify(set.body).slice(0, 150)}`);

  const refused = await call('POST', `/v1/ns/${NS}/metadata/workflows`, {
    body: { name: unique('over_quota'), version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] },
  });
  check('a quota over the limit is refused', refused.status === 429 || refused.status === 403, `${refused.status} ${JSON.stringify(refused.body).slice(0, 150)}`);

  await call('PUT', `/v1/ns/${NS}/quotas`, { body: restore });
}

async function versioning() {
  section('definition versioning');
  const name = unique('e2e_versioned');

  await register({ name, version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] });
  await register({
    name,
    version: 2,
    tasks: [
      { name: 'a', taskReferenceName: 'a', type: 'NOOP' },
      { name: 'b', taskReferenceName: 'b', type: 'NOOP' },
    ],
  });

  const v1 = await call('GET', `/v1/ns/${NS}/metadata/workflows/${name}?version=1`, {});
  const latest = await call('GET', `/v1/ns/${NS}/metadata/workflows/${name}`, {});

  check('an old version stays readable', v1.body?.tasks?.length === 1, `${v1.status} ${v1.body?.tasks?.length} tasks`);
  check('and the latest is the default', latest.body?.version === 2, `version ${latest.body?.version}`);

  // A run pins its version, so editing the definition cannot change a run in
  // flight — the property the blueprint cache depends on.
  const pinned = await finish(await start(name, {}, { version: 1 }), 60_000);
  check('a run can pin an older version', pinned.defVersion === 1, `ran version ${pinned.defVersion}`);
}
