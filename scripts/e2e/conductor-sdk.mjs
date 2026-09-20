/**
 * Conductor compatibility, driven by Conductor's own SDK.
 *
 * The rest of the compatibility coverage writes its definitions by hand, and
 * that turned out to be the reason three bugs reached a user: a hand-written
 * definition carries the fields *we* thought of, and the SDK's builder carries
 * the fields *it* always sets. The difference is not academic —
 *
 *   - `ConductorWorkflow` initialises `failureWorkflow` to `""` and emits it
 *     whether or not it was set, so every builder-made workflow without one was
 *     rejected as "too short";
 *   - `switchTask()` emits `evaluatorType: 'value-param'` with `expression`
 *     naming an *input parameter* rather than an expression;
 *   - the SDKs declare `X-Authorization` as an apiKey credential, meaning the
 *     raw token with no `Bearer`, so a service account authenticated and was
 *     then refused on every call.
 *
 * None of those are reachable by a test that builds its own JSON. So this
 * section imports the real `@io-orkes/conductor-javascript`, builds workflows
 * through its builders, and registers them through its client.
 */
import {
  ConductorWorkflow,
  orkesConductorClient,
  simpleTask,
  WorkflowExecutor,
  switchTask,
} from '@io-orkes/conductor-javascript';
import { API, KEY, NS, call, check, section, unique } from './harness.mjs';

/** The SDK appends `/api/...` itself, so it is given the prefix, not the root. */
const SERVER_URL = `${API}/conductor`;

export async function run() {
  section('Conductor SDK — the real client, the real builders');

  // A service account, because that is what the SDKs use by default and what
  // the API-key path does not exercise: a key is handed back unchanged, a
  // service account mints a JWT that then has to be accepted bare.
  const created = await call('POST', '/v1/auth/service-accounts', {
    body: {
      name: unique('conductor_sdk'),
      scopes: ['workflows:read', 'workflows:write', 'executions:read', 'executions:start'],
    },
  });
  const account = created.body;

  check('service account created', Boolean(account?.keyId && account?.secret), JSON.stringify(account).slice(0, 120));
  if (!account?.keyId) return;

  let client;
  let executor;
  try {
    client = await orkesConductorClient({
      serverUrl: SERVER_URL,
      keyId: account.keyId,
      keySecret: account.secret,
    });
    check('the SDK authenticated against node-flow', true);
    // `ConductorWorkflow` builds against an executor, not the bare client —
    // the same wiring the user's project uses.
    executor = new WorkflowExecutor(client);
  } catch (error) {
    check('the SDK authenticated against node-flow', false, String(error).slice(0, 200));
    return;
  }

  // ---------------------------------------------------------------- plain
  const plain = unique('sdk_plain');
  const plainTask = unique('sdk_step');

  const plainWorkflow = new ConductorWorkflow(executor, plain, 1)
    .description('Built by the Conductor SDK, registered against node-flow.')
    .ownerEmail('ops@example.com')
    .add(simpleTask('step', plainTask, { value: '${workflow.input.value}' }));

  try {
    await plainWorkflow.register(true);
    check('a builder-made workflow registers', true);
  } catch (error) {
    check('a builder-made workflow registers', false, String(error?.message ?? error).slice(0, 240));
  }

  // The property that broke: nothing above set a failure workflow, so the
  // builder sent `failureWorkflow: ""`. Asserted on the stored definition
  // rather than on the call succeeding, because "accepted and mangled" would
  // pass the check above.
  const stored = (await call('GET', `/v1/ns/${NS}/metadata/workflows/${plain}`)).body;
  check(
    'an unset failureWorkflow is stored as none, not as an empty name',
    stored?.name === plain && !stored.failureWorkflow,
    JSON.stringify(stored?.failureWorkflow),
  );

  // ---------------------------------------------------------------- switch
  const branching = unique('sdk_switch');
  const gateTask = unique('sdk_gate');
  const thenTask = unique('sdk_then');

  const branchingWorkflow = new ConductorWorkflow(executor, branching, 1)
    .ownerEmail('ops@example.com')
    .add(simpleTask('gate', gateTask, {}))
    // `value-param` with `expression` naming an input parameter — the SDK's
    // convention, and not the one a hand-written definition would use.
    .add(switchTask('choose', '${gate.output.decision}', { proceed: [simpleTask('then', thenTask, {})] }));

  try {
    await branchingWorkflow.register(true);
    check('a builder-made SWITCH registers', true);
  } catch (error) {
    check('a builder-made SWITCH registers', false, String(error?.message ?? error).slice(0, 240));
  }

  const storedSwitch = (await call('GET', `/v1/ns/${NS}/metadata/workflows/${branching}`)).body;
  const gate = storedSwitch?.tasks?.find((task) => task.taskReferenceName === 'choose');
  check(
    'the SWITCH kept its value-param wiring',
    gate?.evaluatorType === 'value-param' && gate?.expression === 'switchCaseValue',
    JSON.stringify({ evaluatorType: gate?.evaluatorType, expression: gate?.expression }),
  );
  check(
    'and its branch',
    Array.isArray(gate?.decisionCases?.proceed) && gate.decisionCases.proceed.length === 1,
    JSON.stringify(Object.keys(gate?.decisionCases ?? {})),
  );

  // ------------------------------------------------------- failure workflow
  // The other half: a failure workflow that *is* set must survive.
  const withFailure = unique('sdk_withfail');
  const failureName = unique('sdk_onfail');

  await new ConductorWorkflow(executor, failureName, 1)
    .ownerEmail('ops@example.com')
    .add(simpleTask('cleanup', unique('sdk_cleanup'), {}))
    .register(true)
    .catch(() => undefined);

  const withFailureWorkflow = new ConductorWorkflow(executor, withFailure, 1)
    .ownerEmail('ops@example.com')
    .failureWorkflow(failureName)
    .add(simpleTask('step', plainTask, {}));

  try {
    await withFailureWorkflow.register(true);
    const saved = (await call('GET', `/v1/ns/${NS}/metadata/workflows/${withFailure}`)).body;
    check('a failure workflow that is set is kept', saved.failureWorkflow === failureName, String(saved.failureWorkflow));
  } catch (error) {
    check('a failure workflow that is set is kept', false, String(error?.message ?? error).slice(0, 240));
  }

  // ------------------------------------------------- deploy idempotence
  // What a deploy pipeline actually does: list what the server holds, diff it
  // against what the code builds, register what differs. Two things have to
  // hold for that to work twice in a row.

  // One: the shape the server returns has to be the shape the SDK sends, or a
  // client-side diff reports a change that is not one. `failureWorkflow` is the
  // case that bit — the builder always sends ``, node-flow stores none as
  // absent, and ` !== undefined` made every workflow look changed.
  const listed = (await call('GET', '/conductor/api/metadata/workflow')).body;
  const asConductorSeesIt = Array.isArray(listed) ? listed.find((w) => w.name === plain) : undefined;
  check(
    'an unset failureWorkflow comes back as the empty string the SDK sent',
    asConductorSeesIt?.failureWorkflow === '',
    JSON.stringify(asConductorSeesIt?.failureWorkflow),
  );

  // Two: re-registering something unchanged must not be an error. Versions are
  // immutable here, so this used to 409 and fail every deploy after the first.
  try {
    await plainWorkflow.register(true);
    check('re-registering an unchanged definition is accepted', true);
  } catch (error) {
    check('re-registering an unchanged definition is accepted', false, String(error?.message ?? error).slice(0, 240));
  }

  // But a *changed* definition at the same version is still refused, because a
  // running instance is pinned to it and its branches must not move.
  const conflicting = await call('POST', '/conductor/api/metadata/workflow', {
    key: KEY,
    body: {
      name: plain,
      version: 1,
      ownerEmail: 'ops@example.com',
      tasks: [{ name: 'different', taskReferenceName: 'different', type: 'SIMPLE', inputParameters: {} }],
    },
  });
  check(
    'a changed definition at the same version is still refused',
    conflicting.status === 409 && String(conflicting.body?.message ?? '').includes('new version'),
    `${conflicting.status} ${String(conflicting.body?.message ?? '').slice(0, 90)}`,
  );

  // ------------------------------------------------------------- rejection
  // A rejection has to say what is wrong *in the message*, because that is the
  // only part Conductor's SDKs surface. This is asserted through the raw API
  // rather than the SDK, so the assertion is about our message and not about
  // how the SDK happens to format it.
  const rejection = await call('POST', '/conductor/api/metadata/workflow', {
    key: KEY,
    body: {
      name: unique('sdk_bad'),
      version: 1,
      tasks: [{ name: 'a', taskReferenceName: 'a', type: 'SIMPLE', inputParameters: ['wrong'] }],
    },
  });

  const message = String(rejection.body?.message ?? '');
  check('a rejected definition names the offending path', message.includes('tasks.0.inputParameters'), message.slice(0, 200));
}
