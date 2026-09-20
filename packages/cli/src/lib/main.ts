import { createDatabase, migrate } from '@node-flow-dev/store';
import { optionalList, parseArgs, requireString } from './args.js';
import { bootstrap, createUser } from './bootstrap.js';
import { executions, exportDefinitions, importDefinitions, replay, runWorkflow, tail, test, workflows, type Io } from './commands.js';

/**
 * `nf` — the node-flow CLI.
 *
 * `bootstrap`, `create-user` and `migrate` talk to the database, because they
 * cannot be done through the API: `bootstrap` breaks the credential
 * chicken-and-egg, and `migrate` runs schema changes as a deliberate step rather
 * than racing them across every replica. Everything else talks to a running
 * server, except `test`, which runs definitions through the engine with none.
 */

const USAGE = `nf — node-flow CLI

Usage:
  nf bootstrap --namespace <slug> [options]   Create the first namespace and an admin key
  nf create-user --namespace <slug> --email <email> --password <pw> [options]
                                              Create a human account for the UI
  nf migrate [options]                        Apply pending migrations

  nf workflows list                           Latest version of every workflow
  nf workflows get <name> [--version N]       A definition, as JSON
  nf workflows register <file|dir>...         Register definitions from JSON files
  nf run <workflow> [--input JSON|@file] [--wait S]
                                              Start a run; with --wait, wait for its result
  nf executions list [--workflow W] [--status S] [--limit N]
  nf executions get <id>                      A run and its tasks
  nf executions cancel-task <id> <task-ref>   Stop a running task; pauses the run
  nf executions rerun-tasks <id> <ref>... [--cascade]
                                              Run tasks again; --cascade takes their dependents too
  nf tail <id>                                Follow a run until it ends
  nf replay <id> [--version N]                Replay a run against a definition version
  nf export [--workflows a,b] [--out file]    Export definitions as a bundle
  nf import <bundle.json> [--dry-run]         Import a bundle
  nf test <test.json|dir>...                  Run workflow tests offline, no server needed
  nf help                                     Show this message

Options:
  --url <url>             API base URL. Defaults to $NF_URL, then http://localhost:3000.
  --api-key <key>         API key. Defaults to $NF_API_KEY.
  --database-url <url>    Postgres URL. Defaults to $DATABASE_URL.
  --namespace <slug>      Namespace slug to create or reuse.
  --key-name <name>       Name for the issued credential (default: bootstrap).
  --scopes <a,b,c>        Scopes to grant (default: admin).
  --email <email>         Email address, for create-user.
  --name <name>           Display name, for create-user.
  --password <pw>         Password, for create-user. Must satisfy the policy.
  --no-migrate            Skip migrations during bootstrap.
  --json                  Machine-readable output.

Examples:
  nf bootstrap --namespace default
  nf bootstrap --namespace acme --scopes executions:read,executions:start --json
  nf create-user --namespace default --email ada@example.com --name Ada --password '...'
`;

const processIo: Io = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  fetch: (...args) => fetch(...args),
  env: process.env,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function run(argv: string[], io: Io = processIo): Promise<number> {
  const { command, flags, positional } = parseArgs(argv);

  if (!command || command === 'help' || flags['help']) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    switch (command) {
      case 'bootstrap':
        return await runBootstrap(flags);
      case 'create-user':
        return await runCreateUser(flags);
      case 'migrate':
        return await runMigrate(flags);
      case 'workflows':
        return await workflows(positional[0], positional.slice(1), flags, io);
      case 'run':
        return await runWorkflow(positional, flags, io);
      case 'executions':
        return await executions(positional[0], positional.slice(1), flags, io);
      case 'tail':
        return await tail(positional, flags, io);
      case 'replay':
        return await replay(positional, flags, io);
      case 'export':
        return await exportDefinitions(flags, io);
      case 'import':
        return await importDefinitions(positional, flags, io);
      case 'test':
        return await test(positional, flags, io);
      default:
        process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    // One line, no stack. A stack trace for "you forgot --namespace" buries the
    // one sentence that matters.
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runBootstrap(flags: Record<string, string | boolean>): Promise<number> {
  const result = await bootstrap({
    databaseUrl: requireString(flags, 'database-url', process.env['DATABASE_URL']),
    namespace: requireString(flags, 'namespace'),
    keyName: typeof flags['key-name'] === 'string' ? flags['key-name'] : undefined,
    scopes: optionalList(flags, 'scopes'),
    migrate: flags['no-migrate'] !== true,
  });

  if (flags['json']) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const lines = [
    result.namespaceCreated
      ? `Created namespace "${flags['namespace']}" (${result.namespaceId})`
      : `Using existing namespace "${flags['namespace']}" (${result.namespaceId})`,
    result.migrationsApplied.length > 0
      ? `Applied migrations: ${result.migrationsApplied.join(', ')}`
      : 'Schema already up to date',
    '',
    'API key:',
    `  ${result.token}`,
    '',
    // Said plainly, because the alternative is a support conversation with
    // someone who closed the terminal.
    'This is shown once and cannot be recovered. Store it now.',
    '',
    'Try it:',
    `  curl -H "X-API-Key: ${result.token}" http://localhost:3000/v1/auth/whoami`,
    '',
  ];

  process.stdout.write(lines.join('\n'));
  return 0;
}

async function runCreateUser(flags: Record<string, string | boolean>): Promise<number> {
  const email = requireString(flags, 'email');

  const created = await createUser({
    databaseUrl: requireString(flags, 'database-url', process.env['DATABASE_URL']),
    namespace: requireString(flags, 'namespace'),
    email,
    name: typeof flags['name'] === 'string' ? flags['name'] : email,
    password: requireString(flags, 'password'),
    scopes: optionalList(flags, 'scopes'),
  });

  if (flags['json']) {
    process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    [
      `Created user ${email} (${created.id})`,
      '',
      'Log in at the dashboard, or:',
      `  curl -c jar -X POST -H 'content-type: application/json' \\`,
      `    -d '{"email":"${email}","password":"..."}' \\`,
      `    http://localhost:3000/v1/ns/${flags['namespace'] as string}/users/login`,
      '',
    ].join('\n')
  );

  return 0;
}

async function runMigrate(flags: Record<string, string | boolean>): Promise<number> {
  const db = createDatabase({
    url: requireString(flags, 'database-url', process.env['DATABASE_URL']),
    maxConnections: 2,
  });

  try {
    const applied = await migrate(db);

    if (flags['json']) {
      process.stdout.write(`${JSON.stringify({ applied }, null, 2)}\n`);
    } else {
      process.stdout.write(
        applied.length > 0
          ? `Applied migrations:\n${applied.map((name) => `  ${name}`).join('\n')}\n`
          : 'Schema already up to date\n'
      );
    }

    return 0;
  } finally {
    await db.destroy();
  }
}
