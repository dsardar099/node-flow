import {
  TaskStatus,
  TaskType,
  parseQueueName,
  queueNameFor,
  queueScope,
  scopeSatisfies,
  taskDefinitionSchema,
  workflowDefinitionSchema,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { ExecutionControlService } from './execution-control.service.js';
import { ConcurrencyRepository } from './concurrency.repository.js';
import { OutboxRepository } from './outbox.repository.js';
import { SchemaValidator } from './schema-validator.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Two settings that were accepted, stored, and then ignored.
 *
 * That is the worst shape a defect takes — the operator sets the knob, the API
 * confirms it, and behaviour never changes — so these tests are specifically
 * about the *effect* of each setting, not about it being persisted.
 */

let harness: PostgresHarness;
let workflows: WorkflowRepository;
let taskQueue: TaskQueueRepository;
let decideQueue: DecideQueueRepository;
let outbox: OutboxRepository;
let timers: TimerRepository;
let concurrency: ConcurrencyRepository;
let dispatch: TaskDispatchService;
let control: ExecutionControlService;
let evaluator: Evaluator;
let validator: SchemaValidator;
let blueprints: StubBlueprints;
let namespaceId: string;
let taskDefs: Map<string, ReturnType<typeof taskDefinitionSchema.parse>>;

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(definition: Record<string, unknown>): void {
    const parsed = workflowDefinitionSchema.parse({ name: 'wf', version: 1, ...definition });
    this.map.set(`${parsed.name}:${parsed.version}`, compileBlueprint(parsed));
  }
  async load(_ns: string, name: string, version: number): Promise<Blueprint> {
    const bp = this.map.get(`${name}:${version}`);
    if (!bp) throw new Error('no blueprint');
    return bp;
  }
}

const defLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [
        name,
        taskDefs.get(name) ??
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
  concurrency = new ConcurrencyRepository(harness.db);
  validator = new SchemaValidator();
  dispatch = new TaskDispatchService(
    harness.db,
    workflows,
    taskQueue,
    decideQueue,
    timers,
    concurrency,
    validator,
    defLoader
  );
  control = new ExecutionControlService(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    timers,
    concurrency
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
    validator
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  taskDefs = new Map();
});

async function start(definition: Record<string, unknown>) {
  blueprints.register(definition);
  const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
  await decideQueue.enqueue(namespaceId, wf.id, 'start');
  for (let i = 0; i < 10; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;
  return wf;
}

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

describe('the queue-name rule', () => {
  it('appends the domain', () => {
    expect(queueNameFor('charge')).toBe('charge');
    expect(queueNameFor('charge', 'eu-west')).toBe('charge:eu-west');
  });

  it('round-trips', () => {
    expect(parseQueueName('charge')).toEqual({ taskDefName: 'charge' });
    expect(parseQueueName('charge:eu-west')).toEqual({
      taskDefName: 'charge',
      domain: 'eu-west',
    });
  });
});

describe('task domains', () => {
  // The bug: `domain` was in the DSL, validated, stored — and dropped at
  // enqueue, so every task went to the shared queue while the API went on
  // accepting the routing request.
  it('routes a task to its domain queue', async () => {
    await start({ tasks: [simple('charge', { domain: 'eu-west' })] });

    expect((await taskQueue.depth('charge:eu-west', namespaceId)).available).toBe(1);
    expect((await taskQueue.depth('charge', namespaceId)).total).toBe(0);
  });

  it('leaves an undomained task on the shared queue', async () => {
    await start({ tasks: [simple('charge')] });

    expect((await taskQueue.depth('charge', namespaceId)).available).toBe(1);
  });

  it('records the domain on the task row', async () => {
    const wf = await start({ tasks: [simple('charge', { domain: 'eu-west' })] });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('domain')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.domain).toBe('eu-west');
  });

  it('routes each task to its own domain', async () => {
    await start({
      tasks: [simple('a', { domain: 'fast' }), simple('b', { domain: 'slow' })],
    });

    expect((await taskQueue.depth('a:fast', namespaceId)).available).toBe(1);
  });

  // A retry that changes fleets defeats the point of having them.
  it('keeps a retry on the same domain queue', async () => {
    const wf = await start({ tasks: [simple('charge', { domain: 'eu-west' })] });

    const [leased] = await dispatch.lease({
      namespaceId,
      queueName: 'charge:eu-west',
      workerId: 'w',
    });
    await dispatch.report({
      namespaceId,
      queueName: 'charge:eu-west',
      workflowId: wf.id,
      taskId: leased.taskId,
      leaseToken: leased.leaseToken,
      status: TaskStatus.FAILED,
      reason: 'boom',
    });
    for (let i = 0; i < 10; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;

    await control.retry(wf.id, 'alice');

    expect((await taskQueue.depth('charge:eu-west', namespaceId)).total).toBe(1);
    expect((await taskQueue.depth('charge', namespaceId)).total).toBe(0);
  });

  // Domains exist to isolate fleets, so a fleet must be named explicitly.
  it('requires a scope naming the domain', () => {
    expect(scopeSatisfies('queues:lease:charge', queueScope('charge:eu-west'))).toBe(false);
    expect(scopeSatisfies('queues:lease:charge:eu-west', queueScope('charge:eu-west'))).toBe(
      true
    );
  });

  it('lets a wildcard cover every domain of one task', () => {
    expect(scopeSatisfies('queues:lease:charge:*', queueScope('charge:eu-west'))).toBe(true);
    expect(scopeSatisfies('queues:lease:*', queueScope('charge:eu-west'))).toBe(true);
  });
});

describe('I/O schema validation', () => {
  const withSchema = (name: string, schemas: Record<string, unknown>) => {
    taskDefs.set(
      name,
      taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0, ...schemas })
    );
  };

  it('accepts an input that matches', async () => {
    withSchema('charge', {
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
    });

    const wf = await start({
      tasks: [simple('charge', { inputParameters: { amount: 100 } })],
    });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.SCHEDULED);
  });

  // The bug: `inputSchema` was accepted, stored, and never consulted, so a
  // declared contract was decorative.
  it('fails a task whose input violates its schema', async () => {
    withSchema('charge', {
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
    });

    const wf = await start({
      tasks: [simple('charge', { inputParameters: { amount: 'not-a-number' } })],
    });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['status', 'reasonForIncompletion'])
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.FAILED_WITH_TERMINAL_ERROR);
    // The reason belongs on the task row, not only in the event history: the
    // task view is the first place anyone looks, and it used to say
    // FAILED_WITH_TERMINAL_ERROR and nothing else.
    expect(row.reasonForIncompletion).toContain('amount');
  });

  /**
   * The violation fails the *task*, never the evaluation.
   *
   * Throwing would roll the pass back, the decider would re-derive the same bad
   * input on the next wakeup, and the workflow would spin forever — so nothing
   * must be left on the queue for a worker either.
   */
  it('does not queue a task it rejected, and does not spin', async () => {
    withSchema('charge', { inputSchema: { type: 'object', required: ['amount'] } });

    const wf = await start({ tasks: [simple('charge')] });
    for (let i = 0; i < 5; i++) await evaluator.evaluate(wf.id);

    expect((await taskQueue.depth('charge', namespaceId)).total).toBe(0);

    const rows = await harness.db
      .selectFrom('TaskExecutions')
      .select('id')
      .where('workflowId', '=', wf.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('rejects an output that violates its schema', async () => {
    withSchema('charge', {
      outputSchema: {
        type: 'object',
        properties: { txnId: { type: 'string' } },
        required: ['txnId'],
      },
    });

    const wf = await start({ tasks: [simple('charge')] });
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w' });

    await expect(
      dispatch.report({
        namespaceId,
        queueName: 'charge',
        workflowId: wf.id,
        taskId: leased.taskId,
        leaseToken: leased.leaseToken,
        status: TaskStatus.COMPLETED,
        output: { wrong: true },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('accepts an output that matches', async () => {
    withSchema('charge', {
      outputSchema: { type: 'object', required: ['txnId'] },
    });

    const wf = await start({ tasks: [simple('charge')] });
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w' });

    await expect(
      dispatch.report({
        namespaceId,
        queueName: 'charge',
        workflowId: wf.id,
        taskId: leased.taskId,
        leaseToken: leased.leaseToken,
        status: TaskStatus.COMPLETED,
        output: { txnId: 'tx-1' },
      })
    ).resolves.toBe(true);
  });

  // A failure report is diagnostic. Holding it to the success contract would
  // reject exactly the information someone needs to debug the failure.
  it('does not hold a failure report to the output schema', async () => {
    withSchema('charge', { outputSchema: { type: 'object', required: ['txnId'] } });

    const wf = await start({ tasks: [simple('charge')] });
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'charge', workerId: 'w' });

    await expect(
      dispatch.report({
        namespaceId,
        queueName: 'charge',
        workflowId: wf.id,
        taskId: leased.taskId,
        leaseToken: leased.leaseToken,
        status: TaskStatus.FAILED,
        reason: 'gateway said no',
      })
    ).resolves.toBe(true);
  });

  it('validates nothing when no schema is declared', async () => {
    const wf = await start({ tasks: [simple('charge', { inputParameters: { anything: 1 } })] });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('status')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe(TaskStatus.SCHEDULED);
  });

  it('strips the domain before looking up the definition', async () => {
    withSchema('charge', { outputSchema: { type: 'object', required: ['txnId'] } });

    const wf = await start({ tasks: [simple('charge', { domain: 'eu-west' })] });
    const [leased] = await dispatch.lease({
      namespaceId,
      queueName: 'charge:eu-west',
      workerId: 'w',
    });

    // The definition is `charge`, not `charge:eu-west`; without stripping, the
    // lookup finds nothing and the contract silently stops applying.
    await expect(
      dispatch.report({
        namespaceId,
        queueName: 'charge:eu-west',
        workflowId: wf.id,
        taskId: leased.taskId,
        leaseToken: leased.leaseToken,
        status: TaskStatus.COMPLETED,
        output: { wrong: true },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('the validator itself', () => {
  it('reports every violation, not just the first', () => {
    const violations = validator.check(
      {
        name: 'x',
        inputSchema: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'string' } },
          required: ['a', 'b'],
        },
      } as never,
      'input',
      {}
    );

    expect(violations.length).toBeGreaterThan(1);
  });

  it('understands formats', () => {
    const definition = {
      name: 'x',
      inputSchema: { type: 'object', properties: { at: { type: 'string', format: 'date-time' } } },
    } as never;

    expect(validator.check(definition, 'input', { at: 'not-a-date' })).not.toEqual([]);
    expect(validator.check(definition, 'input', { at: '2026-09-14T00:00:00Z' })).toEqual([]);
  });

  // Failing every task of a type because its schema was mistyped is worse than
  // not enforcing a contract that was never valid.
  it('skips a schema that will not compile rather than failing everything', () => {
    const definition = { name: 'x', inputSchema: { type: 'not-a-type' } } as never;
    expect(validator.check(definition, 'input', { anything: true })).toEqual([]);
  });

  it('reports whether a schema compiles, so registration can refuse it', () => {
    expect(validator.isCompilable({ type: 'object' })).toBe(true);
    expect(validator.isCompilable(undefined)).toBe(true);
    expect(validator.isCompilable({ type: 'not-a-type' })).toBe(false);
  });

  // Coercion would make the value the engine stores differ from the value the
  // worker reported, in a system whose point is an auditable record.
  it('does not coerce the payload it checks', () => {
    const payload = { amount: '100' };
    validator.check(
      { name: 'x', inputSchema: { type: 'object', properties: { amount: { type: 'number' } } } } as never,
      'input',
      payload as never
    );

    expect(payload.amount).toBe('100');
  });
});
