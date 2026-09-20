import { writeFile } from 'node:fs/promises';
import { NodeFlowClient } from '@node-flow-dev/sdk';
import { runBenchmark, type Probe } from './harness.js';
import { profileFor, type ProfileName } from './profiles.js';
import { formatReport } from './report.js';

/**
 * `nf-bench` — the load harness as a command.
 *
 * Points at a running server and drives it over the ordinary API. Nothing here
 * has privileged access, which is the point: the numbers it reports are
 * numbers a user with an API key can reproduce.
 *
 * The optional `--database-url` is for what the API cannot answer — queue depth
 * straight from the table, and the WAL rate, which is the wall a
 * Postgres-backed queue hits first. It is read-only and sampled once a second.
 */

interface Args {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [name, inline] = token.slice(2).split('=');
    if (inline !== undefined) args[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) args[name] = argv[++index];
    else args[name] = true;
  }
  return args;
}

const USAGE = `nf-bench — node-flow load harness

  --url <base>            server base URL, without /v1 (default http://localhost:3000)
  --namespace <slug>      namespace (default default)
  --api-key <key>         API key, or set NODE_FLOW_API_KEY
  --profile chain|fanout  workflow shape (default chain)
  --steps <n>             tasks per run (default 5)
  --workflows <n>         runs to start (default 200)
  --concurrency <n>       closed loop: runs in flight (default 20)
  --rate <n>              open loop: runs started per second (overrides concurrency)
  --workers <n>           worker loops (default 8)
  --batch <n>             tasks leased per request (default 1)
  --work-ms <n>           simulated work per task (default 0)
  --wait-seconds <n>      worker long-poll seconds (default 1)
  --timeout-ms <n>        give up waiting for the drain (default 120000)
  --database-url <url>    optional read-only probe for queue depth and WAL rate
  --json <file>           also write the report as JSON
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args['help'] || args['h']) {
    process.stdout.write(USAGE);
    return 0;
  }

  const apiKey = (args['api-key'] as string) ?? process.env['NODE_FLOW_API_KEY'];
  if (!apiKey) {
    process.stderr.write('nf-bench: --api-key or NODE_FLOW_API_KEY is required\n');
    return 2;
  }

  const number = (name: string, fallback: number) =>
    args[name] === undefined ? fallback : Number(args[name]);

  const namespace = (args['namespace'] as string) ?? 'default';
  const client = new NodeFlowClient({
    baseUrl: (args['url'] as string) ?? 'http://localhost:3000',
    namespace,
    apiKey,
  });

  const profileName = ((args['profile'] as string) ?? 'chain') as ProfileName;
  const steps = number('steps', 5);
  // A unique name per run: registering over an existing definition would
  // version it, and comparing two benchmarks that ran different versions of the
  // "same" workflow is a trap worth designing out.
  const workflowName = `bench_${profileName}_${steps}_${Date.now().toString(36)}`;
  const profile = profileFor(profileName, { steps, workflowName, queue: `bench_task_${Date.now().toString(36)}` });

  const { probe, close } = await openProbe(args['database-url'] as string | undefined, namespace, profile.queues[0]);

  try {
    const report = await runBenchmark({
      client,
      profile,
      workflows: number('workflows', 200),
      workers: number('workers', 8),
      batchSize: number('batch', 1),
      workDurationMs: number('work-ms', 0),
      waitSeconds: number('wait-seconds', 1),
      timeoutMs: number('timeout-ms', 120_000),
      ...(args['rate'] ? { ratePerSecond: Number(args['rate']) } : { concurrency: number('concurrency', 20) }),
      ...(probe ? { probe } : {}),
    });

    process.stdout.write(`${formatReport(report)}\n`);
    if (typeof args['json'] === 'string') {
      await writeFile(args['json'], JSON.stringify(report, null, 2));
    }

    // A benchmark that did not finish its load is a failed measurement, and
    // exiting 0 would let CI record it as a passing regression check.
    return report.workflows.unfinished > 0 ? 1 : 0;
  } finally {
    await close();
  }
}

/** Queue depth and WAL position, straight from Postgres. Optional by design. */
async function openProbe(
  url: string | undefined,
  namespace: string,
  queueName: string
): Promise<{ probe?: Probe; close: () => Promise<void> }> {
  if (!url) return { close: async () => undefined };

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 1 });

  const probe: Probe = async () => {
    const depth = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "TaskQueues" q
         JOIN "Namespaces" n ON n.id = q."namespaceId"
        WHERE n.slug = $1 AND q."queueName" = $2 AND q."leaseExpiresAt" IS NULL`,
      [namespace, queueName]
    );
    const wal = await pool.query<{ bytes: string }>(
      `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::text AS bytes`
    );
    return { queueDepth: Number(depth.rows[0]?.count ?? 0), walBytes: Number(wal.rows[0]?.bytes ?? 0) };
  };

  return { probe, close: () => pool.end() };
}
