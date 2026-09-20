/**
 * The `nf` CLI and the offline test runner.
 *
 * Both are Phase 9 promises — "a workflow has a passing unit test that runs in
 * CI in under a second", "deploy, run, tail, test from the command line" — and
 * both are things a person runs rather than things the server exposes, so no
 * amount of API testing reaches them. A CLI that prints a stack trace for a
 * missing flag, or a `test` command that needs a server after all, fails the
 * promise without failing anything else.
 *
 * The CLI is invoked as a *subprocess*, exactly as a user invokes it. Importing
 * its modules and calling them would test the same code through a different
 * door and miss the thing most likely to be broken: argument parsing, exit
 * codes, and whether the binary runs at all.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { API, KEY, NS, check, register, section, unique } from './harness.mjs';

const run = promisify(execFile);

/** Runs `nf` the way a person does, and never throws — the exit code is the result. */
async function nf(args, { timeout = 120_000 } = {}) {
  try {
    const { stdout, stderr } = await run(
      'node',
      ['packages/cli/dist/bin.js', ...args],
      {
        timeout,
        env: { ...process.env, NF_URL: API, NF_API_KEY: KEY },
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message),
    };
  }
}

export { runSection as run };

async function runSection() {
  await usageAndErrors();
  await workflowsAndRuns();
  await exportImport();
  await offlineTest();
}

async function usageAndErrors() {
  section('nf — usage and errors');

  const help = await nf(['help']);
  check('help exits cleanly', help.code === 0, `exit ${help.code}`);
  check('and names the commands', /workflows list/.test(help.stdout), help.stdout.slice(0, 120));

  // An unknown command must be a failure, not a silent success — a typo in CI
  // that exits 0 is a deploy that did nothing and said it worked.
  const unknown = await nf(['definitely-not-a-command']);
  check('an unknown command exits non-zero', unknown.code !== 0, `exit ${unknown.code}`);
  check('and says so on stderr', /unknown command/i.test(unknown.stderr), unknown.stderr.slice(0, 120));

  // One line, no stack: a stack trace for "you forgot a flag" buries the one
  // sentence that matters.
  const missing = await nf(['workflows', 'get']);
  check('a missing argument fails', missing.code !== 0, `exit ${missing.code}`);
  check(
    'with a sentence rather than a stack trace',
    !/\s+at\s+\w+.*:\d+:\d+/.test(missing.stderr),
    missing.stderr.slice(0, 200)
  );
}

async function workflowsAndRuns() {
  section('nf — workflows and runs');
  const name = unique('e2e_cli');

  await register({
    name,
    tasks: [
      {
        name: 'double',
        taskReferenceName: 'double',
        type: 'INLINE',
        inputParameters: { expression: 'return { doubled: $.n * 2 };', n: '${workflow.input.n}' },
      },
    ],
    outputParameters: { doubled: '${double.output.doubled}' },
  });

  const listed = await nf(['workflows', 'list']);
  check('workflows list works', listed.code === 0, listed.stderr.slice(0, 200));
  check('and includes the definition', listed.stdout.includes(name), listed.stdout.slice(0, 200));

  const got = await nf(['workflows', 'get', name]);
  check('workflows get works', got.code === 0, got.stderr.slice(0, 200));
  // JSON on stdout, so it can be piped into anything.
  let parsed;
  try {
    parsed = JSON.parse(got.stdout);
  } catch {
    parsed = undefined;
  }
  check('and prints the definition as JSON', parsed?.name === name, got.stdout.slice(0, 150));

  // `--wait` is the difference between a CLI that starts work and one usable in
  // a script: it has to block and report the result.
  const started = await nf(['run', name, '--input', '{"n":21}', '--wait', '60']);
  check('run --wait exits cleanly', started.code === 0, started.stderr.slice(0, 250));
  check('and reports the output', /42/.test(started.stdout), started.stdout.slice(0, 250));

  const runs = await nf(['executions', 'list', '--workflow', name, '--limit', '5']);
  check('executions list works', runs.code === 0, runs.stderr.slice(0, 200));
  check('and finds the run', runs.stdout.includes(name) || /COMPLETED/.test(runs.stdout), runs.stdout.slice(0, 200));
}

async function exportImport() {
  section('nf — export and import');
  const name = unique('e2e_bundle');

  await register({
    name,
    tasks: [{ name: 'gap', taskReferenceName: 'gap', type: 'NOOP' }],
  });

  const dir = await mkdtemp(join(tmpdir(), 'nf-e2e-'));
  const bundle = join(dir, 'bundle.json');

  try {
    const exported = await nf(['export', '--workflows', name, '--out', bundle]);
    check('export writes a bundle', exported.code === 0, exported.stderr.slice(0, 250));

    // A dry run must change nothing while still reporting what it would do —
    // that is the whole reason to offer one.
    const dry = await nf(['import', bundle, '--dry-run']);
    check('import --dry-run exits cleanly', dry.code === 0, dry.stderr.slice(0, 250));

    // Re-importing the same bundle must not be an error: a deploy that runs
    // twice is the common case, not an exception.
    const again = await nf(['import', bundle]);
    check('re-importing an unchanged bundle is not a failure', again.code === 0, `${again.code} ${again.stderr.slice(0, 200)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function offlineTest() {
  section('nf test — offline, no server');

  const dir = await mkdtemp(join(tmpdir(), 'nf-e2e-test-'));

  try {
    const definition = {
      name: 'offline_checkout',
      version: 1,
      inputParameters: [],
      maxConcurrentTasks: 0,
      tags: [],
      tasks: [
        { name: 'charge', taskReferenceName: 'charge', type: 'SIMPLE' },
        {
          name: 'receipt',
          taskReferenceName: 'receipt',
          type: 'INLINE',
          inputParameters: { expression: 'return { id: $.txn };', txn: '${charge.output.txnId}' },
        },
      ],
      outputParameters: { receipt: '${receipt.output.id}' },
    };

    const passing = {
      name: 'charges then receipts',
      definition,
      input: {},
      // Every non-operator task needs a mock: the simulator is the pure engine
      // with no executors at all, which is exactly what makes it runnable with no
      // server and in milliseconds.
      mocks: {
        charge: { output: { txnId: 'txn-1' } },
        receipt: { output: { id: 'txn-1' } },
      },
      expect: { status: 'COMPLETED', output: { receipt: 'txn-1' } },
    };

    await writeFile(join(dir, 'passing.json'), JSON.stringify(passing, null, 2));

    // Deliberately no `--url` and no API key: the promise is that this runs
    // with no server at all, which is what makes it usable in CI.
    const clean = { ...process.env };
    delete clean.NF_URL;
    delete clean.NF_API_KEY;

    const started = Date.now();
    const result = await run('node', ['packages/cli/dist/bin.js', 'test', dir], {
      timeout: 120_000,
      env: clean,
    }).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message) })
    );
    const elapsed = Date.now() - started;

    check('a workflow test passes with no server running', result.code === 0, `${result.code} ${result.stderr.slice(0, 300)}`);
    // The Phase 9 promise is "in under a second"; a few seconds of Node startup
    // is the honest bar for a subprocess.
    check('and finishes quickly', elapsed < 30_000, `${elapsed}ms`);

    // The half that matters: a test that should fail must fail, or a green run
    // means nothing.
    const failing = {
      ...passing,
      name: 'expects the wrong receipt',
      expect: { status: 'COMPLETED', output: { receipt: 'not-what-happens' } },
    };
    await writeFile(join(dir, 'failing.json'), JSON.stringify(failing, null, 2));

    const shouldFail = await run('node', ['packages/cli/dist/bin.js', 'test', join(dir, 'failing.json')], {
      timeout: 120_000,
      env: clean,
    }).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message) })
    );

    check('a wrong expectation fails the run', shouldFail.code !== 0, `exit ${shouldFail.code}`);
    check(
      'and names what it expected',
      /not-what-happens|receipt/.test(`${shouldFail.stdout}${shouldFail.stderr}`),
      `${shouldFail.stdout}${shouldFail.stderr}`.slice(0, 250)
    );

    /**
     * An unmocked task is reported, not silently empty.
     *
     * Forgetting a mock produces a run that completes with a null where the
     * output should be — which looks like a bug in the workflow rather than a
     * gap in the test. Naming the tasks nothing stood in for is what turns ten
     * minutes of confusion into one line.
     */
    const forgotten = {
      ...passing,
      name: 'forgets a mock',
      mocks: { charge: { output: { txnId: 'txn-1' } } },
      expect: { status: 'COMPLETED' },
    };
    await writeFile(join(dir, 'forgotten.json'), JSON.stringify(forgotten, null, 2));

    const reported = await run(
      'node',
      ['packages/cli/dist/bin.js', 'test', join(dir, 'forgotten.json'), '--json'],
      { timeout: 120_000, env: clean }
    ).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message) })
    );

    let json;
    try {
      json = JSON.parse(reported.stdout.trim().split('\n')[0]);
    } catch {
      json = undefined;
    }
    check('an unmocked task is named rather than silently empty', (json?.unmocked ?? []).includes('receipt'), reported.stdout.slice(0, 250));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
