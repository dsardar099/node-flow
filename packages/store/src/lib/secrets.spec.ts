import { randomBytes } from 'node:crypto';
import { InvalidArgumentError, TaskType, isSealedValue, type JsonValue } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { OutputSealer } from './output-sealer.js';
import { SecretCipher, parseMasterKeys, type SealedSecret } from './secret-crypto.js';
import { SecretRepository } from './secret.repository.js';
import { SecretResolver } from './secret-resolver.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { TimerRepository } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';
import { compileBlueprint, resolveValue, type Blueprint } from '@node-flow-dev/engine';
import { taskDefinitionSchema, workflowDefinitionSchema } from '@node-flow-dev/core';

/**
 * Secrets.
 *
 * Two properties carry everything: a sealed value is unreadable without the
 * master key, and a resolved value is never written down. The second is the one
 * that is easy to lose in a refactor, so it is tested against the actual rows.
 */

const keyA = `a:${randomBytes(32).toString('base64')}`;
const keyB = `b:${randomBytes(32).toString('base64')}`;

let harness: PostgresHarness;
let secrets: SecretRepository;
let resolver: SecretResolver;
let workflows: WorkflowRepository;
let evaluator: Evaluator;
let blueprints: StubBlueprints;
let namespaceId: string;

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

let decideQueue: DecideQueueRepository;

beforeAll(async () => {
  harness = await startPostgresHarness();
  secrets = new SecretRepository(harness.db, new SecretCipher(parseMasterKeys(keyA)));
  resolver = new SecretResolver(secrets);
  workflows = new WorkflowRepository(harness.db);
  decideQueue = new DecideQueueRepository(harness.db);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    new TaskQueueRepository(harness.db),
    new OutboxRepository(harness.db),
    blueprints,
    defLoader,
    new TimerRepository(harness.db)
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
});

describe('sealing', () => {
  it('round-trips a value', async () => {
    await secrets.put({ namespaceId, name: 'DB_PASSWORD', value: 'hunter2' });

    expect(await secrets.resolve(namespaceId, ['DB_PASSWORD'])).toEqual({
      DB_PASSWORD: 'hunter2',
    });
  });

  // A database dump must yield nothing without the master key.
  it('stores no trace of the plaintext', async () => {
    await secrets.put({ namespaceId, name: 'DB_PASSWORD', value: 'hunter2-very-distinctive' });

    const row = await harness.db
      .selectFrom('Secrets')
      .select(['value', 'keyId'])
      .executeTakeFirstOrThrow();

    expect(JSON.stringify(row.value)).not.toContain('hunter2');
    expect(row.keyId).toBe('a');
  });

  it('never returns a sealed value from a listing', async () => {
    await secrets.put({ namespaceId, name: 'DB_PASSWORD', value: 'hunter2' });

    const [listed] = await secrets.list(namespaceId);

    expect(listed.name).toBe('DB_PASSWORD');
    expect(JSON.stringify(listed)).not.toContain('hunter2');
    expect(listed.value).toBeUndefined();
  });

  it('uses a distinct data key per secret', async () => {
    await secrets.put({ namespaceId, name: 'A', value: 'same-value' });
    await secrets.put({ namespaceId, name: 'B', value: 'same-value' });

    const rows = await harness.db.selectFrom('Secrets').select('value').execute();
    const wrapped = rows.map((r) => (r.value as unknown as SealedSecret).wrappedKey);

    // Identical plaintext, different envelopes: one leaked data key exposes one
    // secret rather than all of them.
    expect(wrapped[0]).not.toBe(wrapped[1]);
  });

  it('replaces a value in place', async () => {
    await secrets.put({ namespaceId, name: 'API_KEY', value: 'old' });
    await secrets.put({ namespaceId, name: 'API_KEY', value: 'new' });

    expect(await secrets.resolve(namespaceId, ['API_KEY'])).toEqual({ API_KEY: 'new' });
    expect(await secrets.list(namespaceId)).toHaveLength(1);
  });

  // A name that cannot be written in an expression can be stored and never
  // used, which presents later as "my secret does not work".
  it('refuses a name no expression could reference', async () => {
    for (const name of ['has space', '1leading', 'has$dollar', '']) {
      await expect(secrets.put({ namespaceId, name, value: 'x' })).rejects.toThrow(
        InvalidArgumentError
      );
    }
  });

  // Not a credential, and being readable is the point.
  it('stores an environment variable in clear and returns it', async () => {
    await secrets.put({ namespaceId, name: 'REGION', value: 'eu-west-1', sealed: false });

    const [listed] = await secrets.list(namespaceId);
    expect(listed.sealed).toBe(false);
    expect(listed.value).toBe('eu-west-1');
  });
});

describe('the envelope itself', () => {
  const cipher = new SecretCipher(parseMasterKeys(keyA));

  it('authenticates, so a tampered ciphertext fails rather than decrypting', () => {
    const sealed = cipher.seal('hunter2', 'ns-1', 'NAME');
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[bytes.length - 1] ^= 0xff;

    expect(() =>
      cipher.open({ ...sealed, ciphertext: bytes.toString('base64') }, 'ns-1', 'NAME')
    ).toThrow();
  });

  /**
   * Whoever can write to the database must not be able to move a sealed value
   * between namespaces, or rename it onto a more valuable key, and have it
   * still decrypt.
   */
  it('binds the ciphertext to its namespace and name', () => {
    const sealed = cipher.seal('hunter2', 'ns-1', 'STAGING_DB');

    expect(() => cipher.open(sealed, 'ns-2', 'STAGING_DB')).toThrow();
    expect(() => cipher.open(sealed, 'ns-1', 'PROD_DB')).toThrow();
    expect(cipher.open(sealed, 'ns-1', 'STAGING_DB')).toBe('hunter2');
  });

  it('produces a different ciphertext each time', () => {
    const first = cipher.seal('hunter2', 'ns-1', 'NAME');
    const second = cipher.seal('hunter2', 'ns-1', 'NAME');

    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  // The message that saves an afternoon: "unable to decrypt" sends people
  // looking for corruption.
  it('says which key is missing', () => {
    const sealed = cipher.seal('hunter2', 'ns-1', 'NAME');
    const other = new SecretCipher(parseMasterKeys(keyB));

    expect(() => other.open(sealed, 'ns-1', 'NAME')).toThrow(/master key "a"/);
  });

  it('refuses a malformed key configuration', () => {
    expect(() => parseMasterKeys('nokey')).toThrow();
    expect(() => parseMasterKeys('a:tooshort')).toThrow();
    expect(() => parseMasterKeys(`${keyA},${keyA}`)).toThrow(/twice/);
  });
});

describe('rotation', () => {
  it('re-seals under the new key without changing the value', async () => {
    await secrets.put({ namespaceId, name: 'DB_PASSWORD', value: 'hunter2' });

    // The new key seals; the old one is kept so existing values still open.
    const rotated = new SecretRepository(
      harness.db,
      new SecretCipher(parseMasterKeys(`${keyB},${keyA}`))
    );

    const result = await rotated.rotate();
    expect(result).toMatchObject({ rotated: 1, failed: [] });

    const row = await harness.db.selectFrom('Secrets').select('keyId').executeTakeFirstOrThrow();
    expect(row.keyId).toBe('b');
    expect(await rotated.resolve(namespaceId, ['DB_PASSWORD'])).toEqual({
      DB_PASSWORD: 'hunter2',
    });
  });

  it('is a no-op when everything is already current', async () => {
    await secrets.put({ namespaceId, name: 'A', value: 'x' });

    expect(await secrets.rotate()).toMatchObject({ rotated: 0 });
  });

  // One unreadable secret must not abort the rest of a rotation.
  it('reports what it could not re-seal and keeps going', async () => {
    const orphaned = new SecretRepository(
      harness.db,
      new SecretCipher(parseMasterKeys(keyB))
    );
    await orphaned.put({ namespaceId, name: 'ORPHAN', value: 'x' });
    await secrets.put({ namespaceId, name: 'FINE', value: 'y' });

    // Only key A is configured, so ORPHAN (sealed by B) cannot be opened.
    const result = await secrets.rotate();

    expect(result.failed.map((f) => f.name)).toEqual(['ORPHAN']);
    expect(result.rotated).toBe(0);
    expect(await secrets.resolve(namespaceId, ['FINE'])).toEqual({ FINE: 'y' });
  });
});

/**
 * The property that is easiest to lose in a refactor, and worst to lose.
 */
describe('a resolved secret is never written down', () => {
  async function runWorkflow(inputParameters: Record<string, unknown>) {
    blueprints.register([
      { name: 'call', taskReferenceName: 'call', type: TaskType.HTTP, inputParameters },
    ]);
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    for (let i = 0; i < 10; i++) if (!(await evaluator.evaluate(wf.id)).evaluated) break;
    return wf;
  }

  it('leaves the reference intact in the stored task input', async () => {
    await secrets.put({ namespaceId, name: 'API_KEY', value: 'super-secret-value' });
    const wf = await runWorkflow({ uri: 'https://x', token: '${secrets.API_KEY}' });

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select('input')
      .where('workflowId', '=', wf.id)
      .executeTakeFirstOrThrow();

    const input = row.input as Record<string, JsonValue>;
    expect(input['token']).toBe('${secrets.API_KEY}');
    expect(JSON.stringify(row.input)).not.toContain('super-secret-value');
  });

  // The whole point: substituted for the executor, and nowhere else.
  it('substitutes it into the copy handed to an executor', async () => {
    await secrets.put({ namespaceId, name: 'API_KEY', value: 'super-secret-value' });

    const resolved = await resolver.resolve(namespaceId, {
      uri: 'https://x',
      token: '${secrets.API_KEY}',
    });

    expect(resolved['token']).toBe('super-secret-value');
  });

  it('leaves an input that references nothing untouched', async () => {
    const input = { uri: 'https://x', plain: 'value' };
    expect(await resolver.resolve(namespaceId, input)).toBe(input);
  });

  it('resolves a reference nested in objects and arrays', async () => {
    await secrets.put({ namespaceId, name: 'TOKEN', value: 'abc' });

    const resolved = await resolver.resolve(namespaceId, {
      headers: { authorization: 'Bearer ${secrets.TOKEN}' },
      list: ['${secrets.TOKEN}'],
    });

    expect((resolved['headers'] as Record<string, JsonValue>)['authorization']).toBe('Bearer abc');
    expect(resolved['list']).toEqual(['abc']);
  });

  /**
   * Substituting an empty string would authenticate with "" and produce a 401
   * from somewhere far away, with the reason nowhere near it.
   */
  it('fails loudly when a referenced secret does not exist', async () => {
    await expect(
      resolver.resolve(namespaceId, { token: '${secrets.MISSING}' })
    ).rejects.toThrow(/MISSING/);
  });

  // One credential referenced must not decrypt every other one into memory.
  it('reads only the secrets actually referenced', async () => {
    await secrets.put({ namespaceId, name: 'WANTED', value: 'a' });
    await secrets.put({ namespaceId, name: 'UNWANTED', value: 'b' });

    const resolved = await resolver.resolve(namespaceId, { x: '${secrets.WANTED}' });

    expect(resolved['x']).toBe('a');
    expect(JSON.stringify(resolved)).not.toContain('b');
  });

  // Namespacing is enforced by the lookup, and again by the AAD binding.
  it('cannot reach another namespace’s secret', async () => {
    const other = await seedNamespace(harness.db, 'other');
    await secrets.put({ namespaceId: other, name: 'THEIRS', value: 'not-yours' });

    await expect(
      resolver.resolve(namespaceId, { token: '${secrets.THEIRS}' })
    ).rejects.toThrow(/THEIRS/);
  });
});

/**
 * Sealed task output — the gap `UPDATE_SECRET` exposed.
 *
 * A task that fetches a token writes it to its output, and completing a task
 * persists that output, so by default the credential sits in the execution
 * history in clear. Declaring the field seals it instead, and the value still
 * reaches the task that needs it.
 */
describe('sealed task output', () => {
  const TOKEN = 'tok-live-do-not-persist-4a7';

  const withSecretOutput = taskDefinitionSchema.parse({
    name: 'mint',
    retryCount: 0,
    retryDelaySeconds: 0,
    secretOutputFields: ['token', 'nested.inner'],
  });

  const sealer = () => new OutputSealer(new SecretCipher(parseMasterKeys(keyA)));

  it('replaces the declared field with an envelope', () => {
    const output = sealer().seal(
      { token: TOKEN, keep: 'visible' },
      withSecretOutput,
      { namespaceId: 'ns-1', taskDefName: 'mint' }
    );

    expect(JSON.stringify(output)).not.toContain(TOKEN);
    // Everything not declared is untouched, so an output stays readable.
    expect(output?.['keep']).toBe('visible');
    expect(isSealedValue(output?.['token'])).toBe(true);
  });

  it('seals a nested field by path', () => {
    const output = sealer().seal(
      { nested: { inner: TOKEN, sibling: 'fine' } },
      withSecretOutput,
      { namespaceId: 'ns-1', taskDefName: 'mint' }
    );

    const nested = output?.['nested'] as Record<string, JsonValue>;
    expect(isSealedValue(nested['inner'])).toBe(true);
    expect(nested['sibling']).toBe('fine');
  });

  it('round-trips through the seal', () => {
    const made = sealer();
    const output = made.seal({ token: TOKEN }, withSecretOutput, {
      namespaceId: 'ns-1',
      taskDefName: 'mint',
    });

    expect(
      made.open(output!['token'], { namespaceId: 'ns-1', taskDefName: 'mint', field: 'token' })
    ).toBe(TOKEN);
  });

  // A conditional field that was absent this time is normal, not an error.
  it('ignores a declared field the task did not produce', () => {
    const output = sealer().seal({ other: 1 }, withSecretOutput, {
      namespaceId: 'ns-1',
      taskDefName: 'mint',
    });

    expect(output).toEqual({ other: 1 });
  });

  it('leaves a task that declares nothing untouched', () => {
    const plain = taskDefinitionSchema.parse({ name: 'x', retryCount: 0, retryDelaySeconds: 0 });
    const output = { token: TOKEN };

    expect(sealer().seal(output, plain, { namespaceId: 'ns-1', taskDefName: 'x' })).toBe(output);
  });

  /**
   * Refusing beats storing it in clear: the definition asked for the field to
   * be protected, and quietly ignoring that is how a credential ends up
   * somewhere its author was told it would not be.
   */
  it('refuses to store a declared field with no master key', () => {
    expect(() =>
      new OutputSealer().seal({ token: TOKEN }, withSecretOutput, {
        namespaceId: 'ns-1',
        taskDefName: 'mint',
      })
    ).toThrow(/NODE_FLOW_SECRET_KEYS/);
  });

  // Same reasoning as a stored secret: a value cannot be moved to a different
  // field or tenant and still open.
  it('binds the envelope to its namespace, task and field', () => {
    const made = sealer();
    const output = made.seal({ token: TOKEN }, withSecretOutput, {
      namespaceId: 'ns-1',
      taskDefName: 'mint',
    });

    expect(() =>
      made.open(output!['token'], { namespaceId: 'ns-2', taskDefName: 'mint', field: 'token' })
    ).toThrow();
    expect(() =>
      made.open(output!['token'], { namespaceId: 'ns-1', taskDefName: 'other', field: 'token' })
    ).toThrow();
  });

  /**
   * The property the whole mechanism exists for.
   *
   * The decider must *defer* an expression that lands on a sealed value rather
   * than resolving it — resolving would write the envelope into the next task's
   * input, where a plaintext value belongs, and persist it there.
   */
  it('is deferred by the decider rather than resolved', () => {
    const made = sealer();
    const sealed = made.seal({ token: TOKEN }, withSecretOutput, {
      namespaceId: 'ns-1',
      taskDefName: 'mint',
    });

    const resolved = resolveValue({ header: '${mint.output.token}' } as JsonValue, {
      tasks: new Map([['mint', { output: sealed }]]),
      workflow: {},
      variables: {},
    }) as Record<string, JsonValue>;

    expect(resolved['header']).toBe('${mint.output.token}');
  });

  it('a plain output field still resolves normally', () => {
    const resolved = resolveValue({ v: '${mint.output.keep}' } as JsonValue, {
      tasks: new Map([['mint', { output: { keep: 'visible' } }]]),
      workflow: {},
      variables: {},
    }) as Record<string, JsonValue>;

    expect(resolved['v']).toBe('visible');
  });
});

describe('an install with no master key', () => {
  it('refuses to store a secret rather than storing it in clear', async () => {
    const unconfigured = new SecretRepository(harness.db);

    await expect(
      unconfigured.put({ namespaceId, name: 'API_KEY', value: 'x' })
    ).rejects.toThrow(/NODE_FLOW_SECRET_KEYS/);
  });

  it('still stores environment variables', async () => {
    const unconfigured = new SecretRepository(harness.db);
    await unconfigured.put({ namespaceId, name: 'REGION', value: 'eu', sealed: false });

    expect(await unconfigured.resolve(namespaceId, ['REGION'])).toEqual({ REGION: 'eu' });
  });
});
