'use client';
import { Card, Chip, Link, ProgressBar } from '@heroui/react';
import { useMemo, type ReactNode } from 'react';
import { CopyButton } from '../../../components/ui/copy-button';
import { useTicker } from '../../../components/ui/use-ticker';
import { formatDuration } from '../../../components/ui/format';
import { LocalTime } from '../../../components/ui/local-time';
import { TERMINAL_TASK, TERMINAL_WORKFLOW, type ExecutionDetail } from './types';
import { Ago } from '../../../components/ui/ago';
/**
 * The five things someone opening an execution wants before anything else:
 * when it started, how long it has taken, how far it has got, what ties it to
 * the outside world, and what started it.
 */
export function OverviewStrip({ execution }: { execution: ExecutionDetail }) {
  const terminal = TERMINAL_WORKFLOW.has(execution.status);
  // A running duration should tick. Once a second is enough, and it stops the
  // moment the execution finishes.
  useTicker(!terminal);
  // Progress counts task references, not rows: a task retried three times is
  // one task, and a loop body is one task per iteration it ran.
  const progress = useMemo(() => {
    const latest = new Map<string, string>();
    for (const task of execution.tasks) latest.set(`${task.refName}#${task.iteration}`, task.status);
    const total = latest.size;
    const done = [...latest.values()].filter((status) => TERMINAL_TASK.has(status)).length;
    return { total, done };
  }, [execution.tasks]);
  const tone =
    execution.status === 'COMPLETED' ? 'success' : ['FAILED', 'TIMED_OUT', 'TERMINATED'].includes(execution.status) ? 'danger' : 'accent';
  return (
    <Card className="p-0">
      <dl className="grid grid-cols-2 divide-separator md:grid-cols-5 md:divide-x">
        <Stat label="Started">
          <LocalTime value={execution.startedAt} className="tabular" />
          <span className="block text-xs text-muted"><Ago value={execution.startedAt} /></span>
        </Stat>
        <Stat label={terminal ? 'Duration' : 'Running for'}>
          {/*
            While the workflow is still running this measures to `Date.now()`,
            so — like every other clock-dependent string here — the server and
            the browser disagree about it. Once it has ended it is a difference
            of two fixed instants and stable, but the element cannot know which
            it is at render time, so it is always marked.
          */}
          <span className="tabular text-lg font-semibold" suppressHydrationWarning>
            {formatDuration(execution.startedAt, execution.endedAt)}
          </span>
          {execution.endedAt && (
            <span className="block text-xs text-muted">
              ended <LocalTime value={execution.endedAt} timeOnly />
            </span>
          )}
        </Stat>
        <Stat label="Tasks">
          <ProgressBar
            aria-label="Tasks finished"
            size="sm"
            color={tone}
            value={progress.total ? (progress.done / progress.total) * 100 : 0}
            className="mt-1"
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <span className="mt-1 block text-xs text-muted">
            <span className="tabular font-medium text-foreground">{progress.done}</span> of{' '}
            <span className="tabular">{progress.total}</span> finished
            {execution.tasksTruncated ? ' (list truncated)' : ''}
          </span>
        </Stat>
        <Stat label="Correlation id">
          {execution.correlationId ? (
            <span className="flex items-center gap-1">
              <span className="truncate font-mono text-sm">{execution.correlationId}</span>
              <CopyButton value={execution.correlationId} label="Copy correlation id" />
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Stat>
        <Stat label="Triggered by">
          <Trigger execution={execution} />
        </Stat>
      </dl>
      {execution.taskToDomain && Object.keys(execution.taskToDomain).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-separator px-5 py-3 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Task domains</span>
          {Object.entries(execution.taskToDomain)
            // `*` last: it is the fallback, read after the specific routes.
            .sort(([a], [b]) => (a === '*' ? 1 : b === '*' ? -1 : a.localeCompare(b)))
            .map(([task, domain]) => (
              <Chip key={task} size="sm" variant="soft" color="accent">
                <span className="font-mono">{task === '*' ? 'every worker task' : task}</span>
                <span className="mx-1 opacity-60">→</span>
                <span className="font-mono">{domain}</span>
              </Chip>
            ))}
        </div>
      )}
    </Card>
  );
}
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-sm">{children}</dd>
    </div>
  );
}
const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+):(\d+)$/i;
/**
 * What started this run, named and linked.
 *
 * Every trigger leaves a mark the engine already writes — a parent id, a
 * failure-workflow key, a `START_WORKFLOW` key, the `_schedule` or `_event`
 * the scheduler and event dispatcher put in the input — so this reads them
 * rather than asking the server to remember a separate "trigger" field.
 */
function Trigger({ execution }: { execution: ExecutionDetail }) {
  const key = execution.idempotencyKey ?? '';
  const input = (execution.input ?? {}) as Record<string, unknown>;
  const schedule = input['_schedule'] as { name?: string; scheduledFor?: string } | undefined;
  const event = input['_event'] as { source?: string; topic?: string } | undefined;
  const started = key.match(UUID_PREFIX);
  let label: ReactNode = <span>Direct start</span>;
  let detail: ReactNode = key ? <span title={key}>key {key}</span> : null;
  if (execution.parentWorkflowId) {
    label = (
      <Link href={`/execution/${execution.parentWorkflowId}`} className="text-accent hover:underline">
        Sub-workflow of parent
      </Link>
    );
  } else if (key.startsWith('failure-workflow:')) {
    const failed = key.slice('failure-workflow:'.length);
    label = (
      <Link href={`/execution/${failed}`} className="text-danger hover:underline">
        Failure of {failed.slice(0, 8)}
      </Link>
    );
    detail = <span>{String(input['failureStatus'] ?? 'FAILED').toLowerCase().replace('_', ' ')} · {String(input['workflowType'] ?? '')}</span>;
  } else if (started) {
    label = (
      <Link href={`/execution/${started[1]}?task=${encodeURIComponent(started[2])}`} className="text-accent hover:underline">
        Started by {started[1].slice(0, 8)}
      </Link>
    );
    detail = <span className="font-mono">task {started[2]}</span>;
  } else if (schedule?.name) {
    label = (
      <Link href="/scheduleDef" className="text-accent hover:underline">
        Schedule {schedule.name}
      </Link>
    );
    detail = schedule.scheduledFor ? <span>for <LocalTime value={schedule.scheduledFor} /></span> : null;
  } else if (event?.source) {
    const webhook = event.source === 'webhook';
    label = (
      <Link href={webhook ? '/webhooks' : '/eventMonitor'} className="text-accent hover:underline">
        {webhook ? `Webhook ${event.topic}` : `Event on ${event.topic}`}
      </Link>
    );
    detail = <span className="font-mono">{event.source}</span>;
  }
  return (
    <>
      <span className="block truncate text-sm">{label}</span>
      {detail && <span className="block truncate text-xs text-muted">{detail}</span>}
    </>
  );
}
