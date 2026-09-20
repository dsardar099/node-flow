/**
 * Control-flow operators, each driven to completion through the running image.
 *
 * The engine has unit tests for every one of these and they are the right place
 * for exhaustive cases. What they cannot show is that the command an operator
 * emits is actually *applied* — that a `DO_WHILE` re-materialises its body in
 * the database, that a sub-workflow's completion wakes its parent, that a
 * compensation actually runs. Each of those is a decider-plus-store behaviour
 * that only exists once the whole thing is running.
 */
import { NS, byRef, call, check, finish, register, section, start, unique, until, workOne } from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

export async function run() {
  await doWhile();
  await subWorkflow();
  await dynamicFork();
  await exclusiveJoin();
  await dynamicTask();
  await terminate();
  await getWorkflow();
  await saga();
  await waitTask();
}

async function doWhile() {
  section('DO_WHILE');
  const name = unique('e2e_loop');

  await register({
    name,
    tasks: [
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: 'DO_WHILE',
        inputParameters: { limit: '${workflow.input.times}' },
        // `${...}` references, evaluated as JS — not Conductor's `$.loop[...]`,
        // which registration rejects rather than comparing as literal text.
        loopCondition: '${loop.output.iteration} < 3',
        loopOver: [inline('body', 'return { seen: $.i };', { i: '${loop.output.iteration}' })],
      },
    ],
    outputParameters: { iterations: '${loop.output.iteration}' },
  });

  const id = await start(name, { times: 3 });
  const run = await finish(id);

  check('loop workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);

  // The body must exist once per pass, each its own iteration — this is the
  // part that lives in the database rather than in the decider.
  const bodies = byRef(run).get('body') ?? [];
  check('body ran once per iteration', bodies.length === 3, `${bodies.length} bodies`);
  check(
    'each pass recorded a distinct iteration',
    new Set(bodies.map((t) => t.iteration)).size === bodies.length,
    bodies.map((t) => t.iteration).join(',')
  );
}

async function subWorkflow() {
  section('SUB_WORKFLOW');
  const child = unique('e2e_child');
  const parent = unique('e2e_parent');

  await register({
    name: child,
    tasks: [inline('double', 'return { doubled: $.n * 2 };', { n: '${workflow.input.n}' })],
    outputParameters: { doubled: '${double.output.doubled}' },
  });

  await register({
    name: parent,
    tasks: [
      {
        name: 'child',
        taskReferenceName: 'child',
        type: 'SUB_WORKFLOW',
        subWorkflowParam: { name: child, version: 1 },
        inputParameters: { n: '${workflow.input.n}' },
      },
    ],
    outputParameters: { fromChild: '${child.output.doubled}' },
  });

  const id = await start(parent, { n: 21 });
  const run = await finish(id, 60_000);

  check('parent completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  // The whole point: the child finishing has to wake the parent and its output
  // has to reach the parent's expressions.
  check("child's output reached the parent", run.output?.fromChild === 42, JSON.stringify(run.output));
}

async function dynamicFork() {
  section('FORK_JOIN_DYNAMIC');
  const name = unique('e2e_dynfork');
  const queue = unique('dynwork');

  await register({
    name,
    tasks: [
      inline(
        'plan',
        'return { tasks: $.names.map((n, i) => ({ name: "' +
          queue +
          '", taskReferenceName: "item_" + i, type: "SIMPLE" })), inputs: Object.fromEntries($.names.map((n, i) => ["item_" + i, { item: n }])) };',
        { names: '${workflow.input.names}' }
      ),
      {
        name: 'fan',
        taskReferenceName: 'fan',
        type: 'FORK_JOIN_DYNAMIC',
        inputParameters: {
          dynamicTasks: '${plan.output.tasks}',
          dynamicTasksInput: '${plan.output.inputs}',
        },
        dynamicForkTasksParam: 'dynamicTasks',
        dynamicForkTasksInputParamName: 'dynamicTasksInput',
      },
      { name: 'join', taskReferenceName: 'join', type: 'JOIN' },
    ],
  });

  const id = await start(name, { names: ['a', 'b', 'c'] });

  // Three branches materialised at runtime, each needing a worker.
  for (let i = 0; i < 3; i++) await workOne(queue, { done: true });

  const run = await finish(id, 60_000);
  check('dynamic fork completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);

  const refs = [...byRef(run).keys()];
  check(
    'one branch per runtime item',
    ['item_0', 'item_1', 'item_2'].every((r) => refs.includes(r)),
    refs.join(',')
  );
}

async function exclusiveJoin() {
  section('EXCLUSIVE_JOIN');
  const name = unique('e2e_xjoin');

  await register({
    name,
    tasks: [
      {
        name: 'pick',
        taskReferenceName: 'pick',
        type: 'SWITCH',
        inputParameters: { switchCaseValue: '${workflow.input.route}' },
        evaluatorType: 'value-param',
        expression: 'switchCaseValue',
        decisionCases: { left: [inline('left', 'return { side: "left" };')] },
        defaultCase: [inline('right', 'return { side: "right" };')],
      },
      {
        name: 'merge',
        taskReferenceName: 'merge',
        type: 'EXCLUSIVE_JOIN',
        joinOn: ['left', 'right'],
      },
    ],
    outputParameters: { side: '${merge.output.side}' },
  });

  const id = await start(name, { route: 'left' });
  const run = await finish(id);

  check('exclusive join completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  // The distinction from JOIN: it takes the branch that ran and ignores the
  // one that was skipped, rather than waiting for both.
  check('took the branch that ran', run.output?.side === 'left', JSON.stringify(run.output));
}

async function dynamicTask() {
  section('DYNAMIC');
  const name = unique('e2e_dynamic');
  const queue = unique('chosen');

  await register({
    name,
    tasks: [
      {
        name: 'pick',
        taskReferenceName: 'pick',
        type: 'DYNAMIC',
        dynamicTaskNameParam: 'taskToExecute',
        inputParameters: { taskToExecute: queue, payload: 'hello' },
      },
    ],
    outputParameters: { answer: '${pick.output.answer}' },
  });

  const id = await start(name);
  await workOne(queue, { answer: 'resolved at runtime' });
  const run = await finish(id);

  check('dynamic task completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('task name resolved from an expression', run.output?.answer === 'resolved at runtime', JSON.stringify(run.output));
}

async function terminate() {
  section('TERMINATE');
  const name = unique('e2e_terminate');

  await register({
    name,
    tasks: [
      {
        name: 'stop',
        taskReferenceName: 'stop',
        type: 'TERMINATE',
        inputParameters: {
          terminationStatus: 'COMPLETED',
          workflowOutput: { reason: 'stopped early on purpose' },
        },
      },
      inline('never', 'return { ran: true };'),
    ],
  });

  const id = await start(name);
  const run = await finish(id);

  check('terminate ended the workflow', run.status === 'COMPLETED', `${run.status}`);
  check('terminate set the output', run.output?.reason === 'stopped early on purpose', JSON.stringify(run.output));
  // The task after it must never run — that is what makes TERMINATE useful.
  const after = byRef(run).get('never') ?? [];
  check(
    'nothing after TERMINATE executed',
    after.length === 0 || after.every((t) => t.status === 'SKIPPED'),
    after.map((t) => t.status).join(',')
  );
}

async function getWorkflow() {
  section('GET_WORKFLOW');
  const name = unique('e2e_getwf');

  await register({
    name,
    tasks: [{ name: 'meta', taskReferenceName: 'meta', type: 'GET_WORKFLOW' }],
    outputParameters: { defName: '${meta.output.defName}', correlationId: '${meta.output.correlationId}' },
  });

  const id = await start(name, {}, { correlationId: 'corr-e2e-1' });
  const run = await finish(id);

  check('get workflow completed', run.status === 'COMPLETED', `${run.status}`);
  check('reported its own definition name', run.output?.defName === name, JSON.stringify(run.output));
  check('reported the correlation id it was started with', run.output?.correlationId === 'corr-e2e-1', JSON.stringify(run.output));
}

async function saga() {
  section('saga / compensation');
  const name = unique('e2e_saga');
  const bookQueue = unique('book');
  const cancelQueue = unique('cancel');
  const chargeQueue = unique('charge');

  await register({
    name,
    tasks: [
      {
        name: bookQueue,
        taskReferenceName: 'book',
        type: 'SIMPLE',
        compensateWith: cancelQueue,
      },
      { name: chargeQueue, taskReferenceName: 'charge', type: 'SIMPLE' },
    ],
  });

  const id = await start(name);

  await workOne(bookQueue, { bookingId: 'b-1' });
  // The charge fails terminally, which should unwind the booking.
  await workOne(chargeQueue, {}, 'FAILED_WITH_TERMINAL_ERROR', 'card declined');

  // The compensation is itself a task a worker has to run.
  const compensation = await workOne(cancelQueue, { cancelled: true });
  check('compensation was scheduled for the completed step', Boolean(compensation), 'no compensation task appeared');

  const run = await finish(id, 60_000);
  check('workflow ended failed', run.status === 'FAILED', `${run.status}`);

  const refs = byRef(run);
  const compensated = [...refs.entries()].find(([ref]) => ref.includes('compensate') || ref.includes('cancel'));
  check('a compensation task is recorded on the run', Boolean(compensated), [...refs.keys()].join(','));
}

async function waitTask() {
  section('WAIT');
  const name = unique('e2e_wait');

  await register({
    name,
    tasks: [
      {
        name: 'pause',
        taskReferenceName: 'pause',
        type: 'WAIT',
        inputParameters: { duration: '2s' },
      },
      inline('after', 'return { ran: true };'),
    ],
    outputParameters: { ran: '${after.output.ran}' },
  });

  const startedAt = Date.now();
  const id = await start(name);
  const run = await finish(id, 60_000);
  const elapsed = Date.now() - startedAt;

  check('wait workflow completed', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
  check('the task after the wait ran', run.output?.ran === true, JSON.stringify(run.output));
  // A durable timer, not a sleep in the request: it must actually have waited.
  check('it really waited', elapsed >= 1800, `${elapsed}ms`);
}
