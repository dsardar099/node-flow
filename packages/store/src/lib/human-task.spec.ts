import {
  Scope,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyRepository } from './concurrency.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { ExecutionControlService } from './execution-control.service.js';
import { FormTemplateRepository } from './form-template.repository.js';
import { GroupRepository } from './group.repository.js';
import { HumanTaskRepository } from './human-task.repository.js';
import { OutboxRepository } from './outbox.repository.js';
import { SchemaValidator } from './schema-validator.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { UserRepository } from './user.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * `HUMAN` — waiting on a person.
 *
 * An inbox is by construction a shared list several people are looking at at
 * once, so the tests are weighted toward what happens when two of them act on
 * the same row at the same moment. The failure mode there is not an error
 * message: it is two people doing the same work, or one person's answer
 * silently replacing another's.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let users: UserRepository;
let humanTasks: HumanTaskRepository;
let groups: GroupRepository;
let forms: FormTemplateRepository;
let control: ExecutionControlService;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;
let alice: string;
let bob: string;

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(tasks: unknown[]): void {
    this.map.set(
      'wf:1',
      compileBlueprint(workflowDefinitionSchema.parse({ name: 'wf', version: 1, tasks }))
    );
  }
  async load(): Promise<Blueprint> {
    const bp = this.map.get('wf:1');
    if (!bp) throw new Error('no blueprint');
    return bp;
  }
}

const defLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [
        name,
        taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0 }),
      ])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  workflows = new WorkflowRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  timers = new TimerRepository(harness.db);
  users = new UserRepository(harness.db);
  forms = new FormTemplateRepository(harness.db);
  humanTasks = new HumanTaskRepository(harness.db, workflows, decideQueue, forms, new SchemaValidator(), outbox);
  groups = new GroupRepository(harness.db);
  control = new ExecutionControlService(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    timers,
    new ConcurrencyRepository(harness.db),
    undefined,
    undefined,
    humanTasks
  );
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    defLoader,
    timers,
    undefined,
    undefined,
    undefined,
    undefined,
    humanTasks
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

let unique = 0;
let aliceEmail = '';
let bobEmail = '';

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);

  // Fresh accounts per test: a shared one would let a claim leak between tests
  // and turn a race failure into something that looks like flakiness.
  const n = ++unique;
  alice = (
    await users.createUser({
      namespaceId,
      email: (aliceEmail = `alice-${n}@example.com`),
      name: 'Alice',
      password: 'correct-horse-battery-staple-1',
      scopes: [Scope.HUMAN_TASKS_READ, Scope.HUMAN_TASKS_WRITE],
    })
  ).id;
  bob = (
    await users.createUser({
      namespaceId,
      email: (bobEmail = `bob-${n}@example.com`),
      name: 'Bob',
      password: 'correct-horse-battery-staple-2',
      scopes: [Scope.HUMAN_TASKS_READ, Scope.HUMAN_TASKS_WRITE],
    })
  ).id;
});

const humanTask = (ref: string, input: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.HUMAN,
  inputParameters: input,
});

async function start(tasks: unknown[]) {
  blueprints.register(tasks);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  await drain(wf.id);
  return wf;
}

async function drain(workflowId: string) {
  for (let i = 0; i < 15; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

const onlyTask = async () => {
  const [task] = await humanTasks.inbox(namespaceId, alice, { includeCompleted: true });
  return task;
};

describe('assignment chains', () => {
  const inboxOf = (userId: string) => humanTasks.inbox(namespaceId, userId);
  const windBack = (minutes: number) =>
    harness.db
      .updateTable('HumanTasks')
      .set({ assignedAt: new Date(Date.now() - minutes * 60_000) })
      .execute();
  const taskStatus = async (workflowId: string) =>
    (await harness.db.selectFrom('TaskExecutions').select('status').where('workflowId', '=', workflowId).executeTakeFirstOrThrow()).status;

  it('assigns the first link and escalates an unclaimed task when its window closes', async () => {
    await start([
      humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 30 }, { user: bobEmail }] }),
    ]);
    expect(await inboxOf(alice)).toHaveLength(1);
    expect(await inboxOf(bob)).toHaveLength(0);

    expect(await humanTasks.escalate()).toBe(0);
    await windBack(31);
    expect(await humanTasks.escalate()).toBe(1);

    expect(await inboxOf(alice)).toHaveLength(0);
    expect(await inboxOf(bob)).toHaveLength(1);
  });

  // Someone is working on it; moving it away from them mid-review is wrong.
  it('never moves a claimed task', async () => {
    await start([humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 5 }, { user: bobEmail }] })]);
    const [task] = await inboxOf(alice);
    await humanTasks.claim(namespaceId, task.id, alice);
    await windBack(60);

    expect(await humanTasks.escalate()).toBe(0);
  });

  it('times the task out at the end of a TERMINATE chain, and lets the workflow decide', async () => {
    const wf = await start([
      humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 10 }], assignmentCompletionStrategy: 'TERMINATE' }),
    ]);
    await windBack(11);
    await humanTasks.escalate();
    await drain(wf.id);

    expect(await taskStatus(wf.id)).toBe(TaskStatus.TIMED_OUT);
    expect(await inboxOf(alice)).toHaveLength(0);
  });

  it('leaves the task with its last assignee under LEAVE_OPEN', async () => {
    await start([humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 10 }] })]);
    await windBack(11);
    await humanTasks.escalate();
    await windBack(60);

    expect(await humanTasks.escalate()).toBe(0);
    expect(await inboxOf(alice)).toHaveLength(1);
  });

  it('routes through a group link', async () => {
    const team = await groups.create({ namespaceId, name: 'reviewers' });
    await groups.addMember(namespaceId, 'reviewers', bob);
    await start([humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 1 }, { group: 'reviewers' }] })]);
    await windBack(2);
    await humanTasks.escalate();

    expect(await humanTasks.inbox(namespaceId, bob, { groupIds: [team.id] })).toHaveLength(1);
  });

  it('fails the task when a link names nobody', async () => {
    const wf = await start([humanTask('approve', { assignments: [{ user: 'nobody@example.com' }] })]);
    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(row.reasonForIncompletion).toMatch(/no user "nobody@example.com"/);
  });

  it('reassigning releases the claim and restarts the chain', async () => {
    await start([humanTask('approve', { assignments: [{ user: aliceEmail }] })]);
    const [task] = await inboxOf(alice);
    await humanTasks.claim(namespaceId, task.id, alice);

    const moved = await humanTasks.reassign(namespaceId, task.id, [{ kind: 'user', id: bob, label: bobEmail, slaMinutes: 0 }]);
    expect(moved).toMatchObject({ claimedBy: null, assigneeId: bob });
    expect(await inboxOf(bob)).toHaveLength(1);
  });

  it('skipping lets the workflow continue with the reason recorded', async () => {
    const wf = await start([humanTask('approve'), { name: 'after', taskReferenceName: 'after', type: TaskType.NOOP }]);
    const task = await onlyTask();

    expect(await humanTasks.skip(namespaceId, task.id, alice, 'duplicate request')).toMatchObject({ ok: true });
    await drain(wf.id);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });
});

describe('user forms', () => {
  const refundForm = {
    'ui:order': ['decision', 'note'],
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['approve', 'reject'] },
      note: { type: 'string' },
    },
  };

  const claimAndComplete = async (output: Record<string, JsonValue>) => {
    const task = await onlyTask();
    await humanTasks.claim(namespaceId, task.id, alice);
    return humanTasks.complete(namespaceId, task.id, alice, output);
  };

  // Editing a template must not change what someone mid-approval is looking at.
  it('copies the template onto the task when it opens', async () => {
    await forms.register(namespaceId, { name: 'refund', schema: refundForm });
    await start([humanTask('approve', { form: { template: 'refund' } })]);
    await forms.register(namespaceId, { name: 'refund', schema: { properties: { other: { type: 'string' } } } });

    const task = await onlyTask();
    expect(task.form).toMatchObject({ required: ['decision'] });
    expect([task.formTemplate, task.formVersion]).toEqual(['refund', 1]);
  });

  // Thrown, a missing template would roll the evaluation back and retry forever.
  it('fails the task, not the evaluation, when the template does not exist', async () => {
    const wf = await start([humanTask('approve', { form: { template: 'ghost' } })]);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(row.reasonForIncompletion).toMatch(/form "ghost"/);
  });

  // Enforced on the server: a response posted straight to the API was
  // accepted whatever it contained.
  it('refuses a response that does not match the form', async () => {
    await forms.register(namespaceId, { name: 'refund', schema: refundForm });
    await start([humanTask('approve', { form: { template: 'refund' } })]);

    const result = await claimAndComplete({ note: 'no decision' });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect((await onlyTask()).completedAt).toBeNull();

    expect(await humanTasks.complete(namespaceId, (await onlyTask()).id, alice, { decision: 'approve' })).toMatchObject({
      ok: true,
    });
  });
});

describe('opening', () => {
  it('never reaches a queue', async () => {
    const wf = await start([humanTask('approve')]);

    expect(
      await harness.db
        .selectFrom('TaskQueues')
        .select('taskId')
        .where('workflowId', '=', wf.id)
        .execute()
    ).toEqual([]);
  });

  it('sits IN_PROGRESS with an inbox entry', async () => {
    const wf = await start([humanTask('approve', { title: 'Approve the refund' })]);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.IN_PROGRESS);

    const task = await onlyTask();
    expect(task.title).toBe('Approve the refund');
    expect(task.workflowId).toBe(wf.id);
  });

  it('carries the form through for a UI to render', async () => {
    await start([
      humanTask('approve', {
        title: 'Approve',
        form: { type: 'object', properties: { approved: { type: 'boolean' } } },
      }),
    ]);

    expect((await onlyTask()).form).toMatchObject({ type: 'object' });
  });

  /**
   * Group routing, which the engine refused to accept until groups existed.
   *
   * It was refused rather than ignored on purpose: dropping the routing on a
   * task that decides whether a refund goes out would have sent it to an open
   * pool, where it would sit until it timed out with nothing to explain why.
   * Now it resolves.
   */
  it('routes a task to a group by name', async () => {
    const group = await groups.create({ namespaceId, name: 'payments' });
    const wf = await start([humanTask('approve', { candidateGroup: 'payments' })]);

    const row = await harness.db
      .selectFrom('HumanTasks')
      .select(['assigneeGroupId', 'assigneeId'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.assigneeGroupId).toBe(group.id);
    expect(row.assigneeId).toBeNull();
  });

  // Landing it in everyone's inbox is exactly the mistake naming a group was
  // meant to prevent.
  it('fails the task when the named group does not exist', async () => {
    const wf = await start([humanTask('approve', { candidateGroup: 'no-such-team' })]);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    // The *task* fails, not the pass. Throwing would roll the evaluation back
    // and the decider would re-derive the same routing forever.
    expect(row.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(row.reasonForIncompletion).toContain('no-such-team');

    // And nothing landed in an open pool it was never meant for.
    expect(await humanTasks.inbox(namespaceId, alice)).toEqual([]);
  });
});

describe('claiming', () => {
  it('gives the task to whoever claims it', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    const result = await humanTasks.claim(namespaceId, task.id, alice);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.claimedBy).toBe(alice);
  });

  /**
   * The race the conditional update exists for.
   *
   * Two people opening the same inbox and both clicking Claim. Without the
   * `claimedBy IS NULL` predicate both updates succeed, both start work, and
   * one of them wastes their time.
   */
  it('has exactly one winner under concurrency', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    const results = await Promise.all([
      humanTasks.claim(namespaceId, task.id, alice),
      humanTasks.claim(namespaceId, task.id, bob),
      humanTasks.claim(namespaceId, task.id, alice),
      humanTasks.claim(namespaceId, task.id, bob),
    ]);

    const winners = new Set(results.filter((r) => r.ok).map((r) => r.task.claimedBy));
    expect(winners.size).toBe(1);
  });

  it('lets the holder re-claim, because a double click is not an error', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    expect((await humanTasks.claim(namespaceId, task.id, alice)).ok).toBe(true);
  });

  it('refuses someone else’s held task', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    const result = await humanTasks.claim(namespaceId, task.id, bob);

    expect(result).toMatchObject({ ok: false, reason: 'held_by_other' });
  });

  // Otherwise assignment is decorative.
  it('refuses to claim past an assignment', async () => {
    await start([humanTask('approve', { assigneeId: bob })]);
    const [task] = await humanTasks.inbox(namespaceId, bob);

    expect(await humanTasks.claim(namespaceId, task.id, alice)).toMatchObject({
      ok: false,
      reason: 'not_yours',
    });
    expect((await humanTasks.claim(namespaceId, task.id, bob)).ok).toBe(true);
  });

  it('releases back to the pool without losing the assignment', async () => {
    await start([humanTask('approve', { assigneeId: alice })]);
    const [task] = await humanTasks.inbox(namespaceId, alice);

    await humanTasks.claim(namespaceId, task.id, alice);
    const released = await humanTasks.release(namespaceId, task.id, alice);

    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.task.claimedBy).toBeNull();
      // Still hers to do.
      expect(released.task.assigneeId).toBe(alice);
    }
  });

  it('refuses a release by someone who is not holding it', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    expect(await humanTasks.release(namespaceId, task.id, bob)).toMatchObject({
      ok: false,
      reason: 'not_holder',
    });
  });
});

describe('the inbox', () => {
  it('shows unassigned work to everyone', async () => {
    await start([humanTask('approve')]);

    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(1);
    expect(await humanTasks.inbox(namespaceId, bob)).toHaveLength(1);
  });

  // An inbox that shows work you cannot take is an inbox people stop reading.
  it('hides another person’s assignment', async () => {
    await start([humanTask('approve', { assigneeId: alice })]);

    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(1);
    expect(await humanTasks.inbox(namespaceId, bob)).toHaveLength(0);
  });

  it('hides work someone else is already holding', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);

    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(1);
    expect(await humanTasks.inbox(namespaceId, bob)).toHaveLength(0);
  });

  it('hides completed work unless asked', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    await humanTasks.complete(namespaceId, task.id, alice, { approved: true });

    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(0);
    expect(await humanTasks.inbox(namespaceId, alice, { includeCompleted: true })).toHaveLength(1);
  });

  // One tenant's approvals must never appear in another's inbox.
  it('never crosses a namespace', async () => {
    await start([humanTask('approve')]);
    const other = await seedNamespace(harness.db, 'other');

    expect(await humanTasks.inbox(other, alice)).toEqual([]);
  });
});

describe('completing', () => {
  it('finishes the task and moves the workflow on', async () => {
    const wf = await start([
      humanTask('approve'),
      { name: 'after', taskReferenceName: 'after', type: TaskType.NOOP },
    ]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    const result = await humanTasks.complete(namespaceId, task.id, alice, { approved: true });

    expect(result.ok).toBe(true);
    await drain(wf.id);

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'output'])
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'approve')
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.COMPLETED);
    expect((row.output as Record<string, JsonValue>)['approved']).toBe(true);
    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });

  // An approval that does not say who approved it is not worth much when
  // somebody asks six months later.
  it('records who did it', async () => {
    const wf = await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    await humanTasks.complete(namespaceId, task.id, alice, { approved: true });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('output')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect((row.output as Record<string, JsonValue>)['completedBy']).toBe(alice);
  });

  /**
   * The lost-update case.
   *
   * Without requiring the claim, Bob can answer a task Alice is actively
   * working and his answer silently becomes the decision.
   */
  it('refuses completion by someone who is not holding it', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    const result = await humanTasks.complete(namespaceId, task.id, bob, { approved: false });

    expect(result).toMatchObject({ ok: false, reason: 'not_holder' });
  });

  it('refuses completion with no claim at all', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    expect(await humanTasks.complete(namespaceId, task.id, alice, {})).toMatchObject({
      ok: false,
      reason: 'not_holder',
    });
  });

  it('accepts an answer exactly once', async () => {
    await start([humanTask('approve')]);
    const task = await onlyTask();

    await humanTasks.claim(namespaceId, task.id, alice);
    expect((await humanTasks.complete(namespaceId, task.id, alice, { n: 1 })).ok).toBe(true);
    expect(await humanTasks.complete(namespaceId, task.id, alice, { n: 2 })).toMatchObject({
      ok: false,
      reason: 'completed',
    });
  });

  it('refuses when the workflow is no longer waiting', async () => {
    const wf = await start([humanTask('approve')]);
    const task = await onlyTask();
    await humanTasks.claim(namespaceId, task.id, alice);

    await control.terminate(wf.id, 'changed our minds', 'operator');

    const result = await humanTasks.complete(namespaceId, task.id, alice, { approved: true });
    expect(result.ok).toBe(false);
  });
});

describe('lifecycle', () => {
  // Otherwise someone opens an approval hours later and is told off for doing
  // exactly what they were asked to do.
  it('clears the inbox when the workflow is terminated', async () => {
    const wf = await start([humanTask('approve')]);
    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(1);

    await control.terminate(wf.id, 'cancelled', 'operator');

    expect(await humanTasks.inbox(namespaceId, alice)).toHaveLength(0);
  });

  // Completed ones are the audit trail and must survive.
  it('keeps completed tasks when the workflow ends', async () => {
    const wf = await start([humanTask('approve'), humanTask('second')]);
    const [first] = await humanTasks.inbox(namespaceId, alice);

    await humanTasks.claim(namespaceId, first.id, alice);
    await humanTasks.complete(namespaceId, first.id, alice, { approved: true });
    await control.terminate(wf.id, 'cancelled', 'operator');

    const remaining = await humanTasks.inbox(namespaceId, alice, { includeCompleted: true });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].completedAt).not.toBeNull();
  });
});

describe('auto-claim, triggers and operator search', () => {
  const registerWorkflow = (name: string) =>
    harness.db
      .insertInto('WorkflowDefinitions')
      .values({ namespaceId, name, version: 1, definition: JSON.stringify({ name }), blueprint: JSON.stringify({}) })
      .execute();

  const triggerStarts = async () =>
    (
      await harness.db
        .selectFrom('OutboxEvents')
        .select('payload')
        .where('namespaceId', '=', namespaceId)
        .where('topic', '=', 'workflow.start')
        .orderBy('id')
        .execute()
    ).map((row) => row.payload as { defName: string; input: Record<string, JsonValue>; idempotencyKey: string });

  it('claims for a single assignee as the task opens', async () => {
    await start([humanTask('approve', { assignments: [{ user: aliceEmail }], autoClaim: true })]);
    const [task] = await humanTasks.inbox(namespaceId, alice);
    expect(task).toMatchObject({ assigneeId: alice, claimedBy: alice, autoClaim: true });
    // Held by alice, so it can be completed without a click that says nothing.
    expect(await humanTasks.complete(namespaceId, task.id, alice, {})).toMatchObject({ ok: true });
  });

  it('does not claim for a group', async () => {
    const team = await groups.create({ namespaceId, name: 'ops' });
    await start([humanTask('approve', { assignments: [{ group: 'ops' }], autoClaim: true })]);
    const [task] = await humanTasks.search(namespaceId).then((r) => r.tasks);
    expect(task).toMatchObject({ assigneeGroupId: team.id, claimedBy: null });
  });

  it('still escalates an auto-claimed task nobody acted on, and claims for the next person', async () => {
    await start([
      humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 5 }, { user: bobEmail }], autoClaim: true }),
    ]);
    await harness.db.updateTable('HumanTasks').set({ assignedAt: sql`now() - interval '10 minutes'`, claimedAt: sql`now() - interval '10 minutes'` }).execute();

    expect(await humanTasks.escalate()).toBe(1);
    const [task] = (await humanTasks.search(namespaceId)).tasks;
    expect(task).toMatchObject({ assigneeId: bob, claimedBy: bob });
  });

  it('does not escalate a task its assignee released and claimed again by hand', async () => {
    await start([humanTask('approve', { assignments: [{ user: aliceEmail, slaMinutes: 5 }, { user: bobEmail }], autoClaim: true })]);
    const [task] = (await humanTasks.search(namespaceId)).tasks;
    await humanTasks.release(namespaceId, task.id, alice);
    await humanTasks.claim(namespaceId, task.id, alice);
    await harness.db.updateTable('HumanTasks').set({ assignedAt: sql`now() - interval '10 minutes'` }).execute();

    expect(await humanTasks.escalate()).toBe(0);
  });

  it('starts trigger workflows through the outbox as the task changes state', async () => {
    await registerWorkflow('on_claim');
    await registerWorkflow('on_done');
    const wf = await start([
      humanTask('approve', {
        title: 'Approve refund',
        triggers: [
          { on: 'CLAIMED', workflow: 'on_claim' },
          { on: 'COMPLETED', workflow: 'on_done' },
        ],
      }),
    ]);
    expect(await triggerStarts()).toEqual([]);

    const task = await onlyTask();
    await humanTasks.claim(namespaceId, task.id, alice);
    // A second claim of a task already held is not a state change.
    await humanTasks.claim(namespaceId, task.id, alice);
    await humanTasks.complete(namespaceId, task.id, alice, { decision: 'approve' });

    const starts = await triggerStarts();
    expect(starts.map((s) => s.defName)).toEqual(['on_claim', 'on_done']);
    expect(starts[0].input).toMatchObject({ event: 'CLAIMED', humanTaskId: task.id, workflowId: wf.id, claimedBy: alice, title: 'Approve refund' });
    expect(starts[1].input).toMatchObject({ event: 'COMPLETED', completedBy: alice, output: { decision: 'approve' } });
    expect(new Set(starts.map((s) => s.idempotencyKey)).size).toBe(2);
  });

  it('fires nothing for a claim that lost the race', async () => {
    await registerWorkflow('on_claim');
    await start([humanTask('approve', { triggers: [{ on: 'CLAIMED', workflow: 'on_claim' }] })]);
    const task = await onlyTask();

    const results = await Promise.all([humanTasks.claim(namespaceId, task.id, alice), humanTasks.claim(namespaceId, task.id, bob)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await triggerStarts()).toHaveLength(1);
  });

  it('fires ASSIGNED on open, escalation and reassignment, and SKIPPED', async () => {
    await registerWorkflow('audit');
    await start([
      humanTask('approve', {
        assignments: [{ user: aliceEmail, slaMinutes: 5 }, { user: bobEmail }],
        triggers: [
          { on: 'ASSIGNED', workflow: 'audit' },
          { on: 'SKIPPED', workflow: 'audit' },
        ],
      }),
    ]);
    await harness.db.updateTable('HumanTasks').set({ assignedAt: sql`now() - interval '10 minutes'` }).execute();
    await humanTasks.escalate();
    const [task] = (await humanTasks.search(namespaceId)).tasks;
    await humanTasks.reassign(namespaceId, task.id, [{ kind: 'user', id: alice, label: aliceEmail, slaMinutes: 0 }]);
    await humanTasks.skip(namespaceId, task.id, alice, 'not needed');

    expect((await triggerStarts()).map((s) => [s.input['event'], s.input['assigneeId']])).toEqual([
      ['ASSIGNED', alice],
      ['ASSIGNED', bob],
      ['ASSIGNED', alice],
      ['SKIPPED', alice],
    ]);
  });

  it('fails the task when a trigger names a workflow that does not exist', async () => {
    const wf = await start([humanTask('approve', { triggers: [{ on: 'COMPLETED', workflow: 'missing' }] })]);
    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    expect(row.reasonForIncompletion).toMatch(/no workflow "missing"/);

    const bad = await start([humanTask('approve', { triggers: [{ on: 'OPENED', workflow: 'x' }] })]);
    const badRow = await harness.db.selectFrom('TaskExecutions').select('reasonForIncompletion').where('workflowId', '=', bad.id).executeTakeFirstOrThrow();
    expect(badRow.reasonForIncompletion).toMatch(/on must be one of ASSIGNED/);
  });

  it('searches every task by state, person, text and age', async () => {
    await start([humanTask('approve', { title: 'Approve refund', assignments: [{ user: aliceEmail }] })]);
    await start([humanTask('review', { title: 'Review contract', assignments: [{ user: bobEmail }] })]);
    const all = (await humanTasks.search(namespaceId)).tasks;
    expect(all.map((t) => t.title)).toEqual(['Approve refund', 'Review contract']);

    await humanTasks.claim(namespaceId, all[1].id, bob);
    expect((await humanTasks.search(namespaceId, { state: 'claimed' })).tasks.map((t) => t.title)).toEqual(['Review contract']);
    expect((await humanTasks.search(namespaceId, { state: 'unclaimed' })).tasks.map((t) => t.title)).toEqual(['Approve refund']);
    expect((await humanTasks.search(namespaceId, { userId: alice })).tasks.map((t) => t.title)).toEqual(['Approve refund']);
    expect((await humanTasks.search(namespaceId, { text: 'CONTRACT' })).tasks).toHaveLength(1);
    // LIKE wildcards in the text are literal.
    expect((await humanTasks.search(namespaceId, { text: '%' })).tasks).toHaveLength(0);
    expect((await humanTasks.search(namespaceId, { olderThanMinutes: 30 })).tasks).toHaveLength(0);

    const page = await humanTasks.search(namespaceId, { limit: 1 });
    expect(page).toMatchObject({ hasMore: true, tasks: [{ title: 'Approve refund' }] });
    expect(await humanTasks.search(namespaceId, { limit: 1, offset: 1 })).toMatchObject({ hasMore: false, tasks: [{ title: 'Review contract' }] });

    await humanTasks.complete(namespaceId, all[1].id, bob, {});
    expect((await humanTasks.search(namespaceId, { state: 'completed' })).tasks.map((t) => t.title)).toEqual(['Review contract']);
  });
});
