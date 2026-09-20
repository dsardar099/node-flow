/**
 * The execution controls, each tested by trying to defeat it.
 *
 * PLAN.md sets the standard these follow: *a control that has no test that
 * tries to break it is not implemented*. So none of these assert that a limit
 * was accepted by the API — they race against it and assert the limit held.
 *
 * All of them are enforced server-side on purpose, because anything enforced in
 * the SDK is advisory and will be bypassed by the first worker written in
 * another language.
 */
import { NS, call, check, finish, register, section, start, unique, until } from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

/** Leases up to `count` tasks without completing them, so they stay in flight. */
async function leaseOnly(queue, count) {
  const response = await call('POST', `/v1/ns/${NS}/queues/${queue}/lease`, {
    body: { workerId: 'e2e-greedy', count, leaseSeconds: 120 },
  });
  return response.body?.tasks ?? [];
}

async function complete(queue, task, output = {}) {
  return call('POST', `/v1/ns/${NS}/tasks/${task.taskId}/report`, {
    body: {
      queueName: queue,
      workflowId: task.workflowId,
      leaseToken: task.leaseToken,
      status: 'COMPLETED',
      output,
    },
  });
}

export async function run() {
  await concurrentExecLimit();
  await namedSemaphore();
  await rateLimit();
  await workflowRateLimitByKey();
  await taskOutputCache();
  await maxConcurrentTasks();
}

async function concurrentExecLimit() {
  section('concurrentExecLimit');
  const queue = unique('capped');
  const name = unique('e2e_cap');

  const declared = await call('POST', `/v1/ns/${NS}/metadata/task-definitions`, {
    body: { name: queue, concurrentExecLimit: 2 },
  });
  check('a global cap can be declared', declared.status < 300, `${declared.status} ${JSON.stringify(declared.body).slice(0, 150)}`);

  await register({ name, tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }] });

  // Ten runs of the same task type, all wanting to be in flight at once.
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push(await start(name));

  // Ask for all ten. The cap is enforced at dequeue, so the queue itself must
  // refuse to hand out more than two however many a worker asks for.
  await until(async () => {
    const depth = await call('GET', `/v1/ns/${NS}/queues/${queue}/depth`, {});
    return (depth.body?.depth ?? 0) > 0 ? true : null;
  }, 30_000, 'the queue to fill').catch(() => null);

  const leased = await leaseOnly(queue, 10);
  check('never hands out more than the cap', leased.length <= 2, `${leased.length} leased with a cap of 2`);

  // And with the cap's worth already held, a second worker gets nothing.
  const second = await leaseOnly(queue, 10);
  check('a second worker gets nothing while the cap is held', second.length === 0, `${second.length} leased`);

  for (const task of [...leased, ...second]) await complete(queue, task);

  // Released, the rest must flow — a cap that never lets go is a deadlock.
  const after = await until(async () => {
    const more = await leaseOnly(queue, 2);
    return more.length > 0 ? more : null;
  }, 30_000, 'the cap to release').catch(() => []);
  check('the cap releases when a holder finishes', after.length > 0, `${after.length} leased after release`);
  for (const task of after) await complete(queue, task);

  for (const id of ids) await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, { body: { reason: 'e2e cleanup' } });
}

async function namedSemaphore() {
  section('named semaphore');
  const gate = unique('fragile_api');
  const queueA = unique('semA');
  const queueB = unique('semB');
  const name = unique('e2e_sem');

  // Two *different* task types sharing one cap — the thing a per-task-def limit
  // cannot express, and the reason named semaphores exist.
  for (const queue of [queueA, queueB]) {
    const declared = await call('POST', `/v1/ns/${NS}/metadata/task-definitions`, {
      body: { name: queue, semaphores: [gate] },
    });
    check(`${queue} declares the semaphore`, declared.status < 300, `${declared.status} ${JSON.stringify(declared.body).slice(0, 120)}`);
  }

  const permits = await call('PUT', `/v1/ns/${NS}/semaphores/${gate}`, { body: { permits: 1 } });
  check('the semaphore can be given permits', permits.status < 300, `${permits.status} ${JSON.stringify(permits.body).slice(0, 150)}`);

  if (permits.status >= 300) return;

  await register({
    name,
    tasks: [
      {
        name: 'fan',
        taskReferenceName: 'fan',
        type: 'FORK_JOIN',
        forkTasks: [
          [{ name: queueA, taskReferenceName: 'a', type: 'SIMPLE' }],
          [{ name: queueB, taskReferenceName: 'b', type: 'SIMPLE' }],
        ],
      },
      { name: 'join', taskReferenceName: 'join', type: 'JOIN', joinOn: ['a', 'b'] },
    ],
  });

  const id = await start(name);

  // Both branches are ready at once; one permit means only one may run.
  await new Promise((r) => setTimeout(r, 3000));
  const a = await leaseOnly(queueA, 5);
  const b = await leaseOnly(queueB, 5);
  check('one permit lets only one of two task types run', a.length + b.length <= 1, `${a.length} + ${b.length} in flight`);

  for (const task of a) await complete(queueA, task);
  for (const task of b) await complete(queueB, task);

  // The other must then get its turn rather than starving.
  const next = await until(async () => {
    const more = [...(await leaseOnly(queueA, 5)), ...(await leaseOnly(queueB, 5))];
    return more.length > 0 ? more : null;
  }, 30_000, 'the permit to be handed on').catch(() => []);
  check('the permit is handed on, not leaked', next.length > 0, 'nothing ran after the first released');

  for (const task of next) await complete(queueA, task).catch(() => complete(queueB, task));
  await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, { body: { reason: 'e2e cleanup' } });
}

async function rateLimit() {
  section('task rate limit');
  const queue = unique('throttled');
  const name = unique('e2e_rate');

  const declared = await call('POST', `/v1/ns/${NS}/metadata/task-definitions`, {
    body: { name: queue, rateLimitPerFrequency: 2, rateLimitFrequencySeconds: 60 },
  });
  check('a rate limit can be declared', declared.status < 300, `${declared.status} ${JSON.stringify(declared.body).slice(0, 150)}`);

  await register({ name, tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }] });

  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await start(name));

  await until(async () => {
    const depth = await call('GET', `/v1/ns/${NS}/queues/${queue}/depth`, {});
    return (depth.body?.depth ?? 0) >= 3 ? true : null;
  }, 30_000, 'the queue to fill').catch(() => null);

  // A whole minute's budget is two. Completing them must not refill it.
  const first = await leaseOnly(queue, 6);
  for (const task of first) await complete(queue, task);
  const second = await leaseOnly(queue, 6);

  check(
    'the window budget is not exceeded',
    first.length + second.length <= 2,
    `${first.length} + ${second.length} dispatched against a budget of 2/60s`
  );
  for (const task of second) await complete(queue, task);

  for (const id of ids) await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, { body: { reason: 'e2e cleanup' } });
}

async function workflowRateLimitByKey() {
  section('workflow rate limit by key');
  const name = unique('e2e_wfrate');
  const queue = unique('wfratework');

  await register({
    name,
    rateLimitConfig: { rateLimitKey: '${workflow.input.tenant}', concurrentExecLimit: 1 },
    tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }],
  });

  // Three runs for one tenant, one for another: the cap is per resolved key, so
  // the second tenant must not be held up by the first.
  const busy = [await start(name, { tenant: 'acme' }), await start(name, { tenant: 'acme' }), await start(name, { tenant: 'acme' })];
  const other = await start(name, { tenant: 'globex' });

  await new Promise((r) => setTimeout(r, 3000));

  const runs = await Promise.all(busy.map(async (id) => (await call('GET', `/v1/ns/${NS}/executions/${id}`, {})).body));
  const admitted = runs.filter((r) => r?.awaitingAdmission !== true);
  const held = runs.filter((r) => r?.awaitingAdmission === true);

  check('only one execution per key is admitted', admitted.length === 1, `${admitted.length} admitted, ${held.length} held`);
  check('the rest are held rather than failed', held.every((r) => r.status === 'RUNNING'), held.map((r) => r.status).join(','));

  const otherRun = (await call('GET', `/v1/ns/${NS}/executions/${other}`, {})).body;
  check('a different key is unaffected', otherRun?.awaitingAdmission !== true, `awaitingAdmission=${otherRun?.awaitingAdmission}`);

  for (const id of [...busy, other]) await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, { body: { reason: 'e2e cleanup' } });
}

async function taskOutputCache() {
  section('task output cache');
  const name = unique('e2e_cache');
  const queue = unique('expensive');

  await register({
    name,
    tasks: [
      {
        name: queue,
        taskReferenceName: 'step',
        type: 'SIMPLE',
        cacheConfig: { key: '${workflow.input.key}', ttlInSecond: 300 },
      },
    ],
    outputParameters: { value: '${step.output.value}' },
  });

  const first = await start(name, { key: 'shared-key' });
  const task = await until(async () => {
    const leased = await leaseOnly(queue, 1);
    return leased.length ? leased[0] : null;
  }, 30_000, 'the first run to reach a worker');
  await complete(queue, task, { value: 'computed once' });
  const firstRun = await finish(first, 60_000);
  check('the first run computed it', firstRun.output?.value === 'computed once', JSON.stringify(firstRun.output));

  // Same key: the second run must reuse the answer without a worker seeing it.
  const second = await start(name, { key: 'shared-key' });
  const secondRun = await finish(second, 60_000);
  check('a second run with the same key completes', secondRun.status === 'COMPLETED', `${secondRun.status}`);
  check('it reused the cached output', secondRun.output?.value === 'computed once', JSON.stringify(secondRun.output));
  // Recorded on the run's history rather than on the task row: the task itself
  // is an ordinary completed task, and what an operator needs to know — why it
  // finished without a worker ever seeing it — belongs in the event stream.
  const history = await call('GET', `/v1/ns/${NS}/executions/${second}/history`, {});
  const events = history.body?.events ?? history.body ?? [];
  check(
    'and the history says it was served from cache',
    Array.isArray(events) && events.some((e) => e?.payload?.fromCache === true),
    JSON.stringify(events).slice(0, 250)
  );

  // A different key must not be served the same answer.
  const third = await start(name, { key: 'other-key' });
  const pending = await until(async () => {
    const leased = await leaseOnly(queue, 1);
    return leased.length ? leased[0] : null;
  }, 20_000, 'a different key to reach a worker').catch(() => null);
  check('a different key is not served from cache', Boolean(pending), 'it was answered from cache');
  if (pending) await complete(queue, pending, { value: 'computed again' });
  await finish(third, 60_000).catch(() => undefined);
}

async function maxConcurrentTasks() {
  section('maxConcurrentTasks');
  const name = unique('e2e_fanoutcap');
  const queue = unique('fanoutwork');

  // Eight branches, but the instance may only have two tasks in flight — the
  // control that bounds a fork's blast radius.
  await register({
    name,
    maxConcurrentTasks: 2,
    tasks: [
      {
        name: 'fan',
        taskReferenceName: 'fan',
        type: 'FORK_JOIN',
        forkTasks: Array.from({ length: 8 }, (_, i) => [
          { name: queue, taskReferenceName: `branch_${i}`, type: 'SIMPLE' },
        ]),
      },
      {
        name: 'join',
        taskReferenceName: 'join',
        type: 'JOIN',
        joinOn: Array.from({ length: 8 }, (_, i) => `branch_${i}`),
      },
    ],
  });

  const id = await start(name);
  await new Promise((r) => setTimeout(r, 3000));

  const run = (await call('GET', `/v1/ns/${NS}/executions/${id}`, {})).body;
  const live = (run?.tasks ?? []).filter((t) => ['SCHEDULED', 'IN_PROGRESS'].includes(t.status) && t.refName?.startsWith('branch_'));
  check('fan-out is bounded to the cap', live.length <= 2, `${live.length} branches in flight against a cap of 2`);

  await call('POST', `/v1/ns/${NS}/executions/${id}/terminate`, { body: { reason: 'e2e cleanup' } });
}
