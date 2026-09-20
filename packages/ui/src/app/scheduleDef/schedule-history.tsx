'use client';

import { ArrowRotateRight, ArrowUpRightFromSquare, CircleExclamation, ClockArrowRotateLeft } from '@gravity-ui/icons';
import { Button, Chip, Drawer, EmptyState, Link, Spinner, Tabs } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';
import { formatRelative } from '../../components/ui/format';
import { LocalTime } from '../../components/ui/local-time';
import { StatusChip } from '../../components/ui/status-chip';
import { fetchJson } from '../../lib/fetch-json';
import type { Schedule } from './schedule-list';
import { Ago } from '../../components/ui/ago';

type Outcome = 'STARTED' | 'SKIPPED' | 'FAILED';

interface ScheduleRun {
  id: string;
  scheduledFor: string;
  firedAt: string;
  outcome: Outcome;
  workflowId: string | null;
  reason: string | null;
  workflowStatus: string | null;
  workflowEndedAt: string | null;
  workflowVersion: number | null;
}

const FILTERS: { id: 'all' | Outcome; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'STARTED', label: 'Started' },
  { id: 'SKIPPED', label: 'Skipped' },
  { id: 'FAILED', label: 'Failed to start' },
];

/** A firing more than this after its occurrence is shown as late: downtime, a catch-up, a stalled poller. */
const LATE_MS = 60_000;

/**
 * Every firing of one schedule — what started (and how that run went), what was
 * skipped because the last run was still going, and what failed to start.
 *
 * The question it answers is "did my 3 a.m. job run last night, and did it
 * work?", which the schedule row alone — one last run, one last error — cannot.
 */
export function ScheduleHistory({
  namespace,
  schedule,
  onOpenChange,
}: {
  namespace: string;
  schedule?: Schedule;
  onOpenChange: (open: boolean) => void;
}) {
  const [filter, setFilter] = useState<'all' | Outcome>('all');
  const [runs, setRuns] = useState<ScheduleRun[]>();
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);

  const url = useCallback(
    (before?: string) => {
      if (!schedule) return '';
      const params = new URLSearchParams({ limit: '50' });
      if (filter !== 'all') params.set('outcome', filter);
      if (before) params.set('before', before);
      return `/v1/ns/${namespace}/schedules/${encodeURIComponent(schedule.name)}/runs?${params}`;
    },
    [namespace, schedule, filter]
  );

  const reload = useCallback(async () => {
    if (!schedule) return;
    try {
      const page = await fetchJson<{ runs: ScheduleRun[]; nextCursor?: string }>(url());
      setRuns(page.runs);
      setCursor(page.nextCursor);
      setError(undefined);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [schedule, url]);

  useEffect(() => {
    setRuns(undefined);
    void reload();
  }, [reload]);

  // Reset the filter when a different schedule is opened.
  useEffect(() => setFilter('all'), [schedule?.name]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchJson<{ runs: ScheduleRun[]; nextCursor?: string }>(url(cursor));
      setRuns((current) => [...(current ?? []), ...page.runs]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Drawer.Backdrop isOpen={schedule !== undefined} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[40rem]">
          <Drawer.CloseTrigger />
          {schedule && (
            <>
              <Drawer.Header>
                <Drawer.Heading>{schedule.name}</Drawer.Heading>
                <p className="text-sm text-muted">
                  Run history · <code className="font-mono text-xs">{schedule.cron}</code> {schedule.timezone} · starts{' '}
                  {schedule.workflow.name}
                </p>
              </Drawer.Header>
              <Drawer.Body className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <Tabs selectedKey={filter} onSelectionChange={(key) => setFilter(key as typeof filter)}>
                    <Tabs.ListContainer>
                      <Tabs.List aria-label="Filter firings" className="w-auto">
                        {FILTERS.map((f) => (
                          <Tabs.Tab key={f.id} id={f.id} className="w-auto flex-none px-3">
                            {f.label}
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        ))}
                      </Tabs.List>
                    </Tabs.ListContainer>
                  </Tabs>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" onPress={() => void reload()}>
                    <ArrowRotateRight />
                  </Button>
                </div>

                {error ? (
                  <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
                ) : runs === undefined ? (
                  <div className="flex justify-center py-12">
                    <Spinner />
                  </div>
                ) : runs.length === 0 ? (
                  <EmptyState className="flex flex-col items-center gap-3 py-12 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                      <ClockArrowRotateLeft className="size-6" />
                    </span>
                    <span className="text-sm font-medium">{filter === 'all' ? 'No firings yet' : 'None of these'}</span>
                    <span className="max-w-sm text-sm text-muted" suppressHydrationWarning>
                      {filter === 'all'
                        ? schedule.nextRunAt
                          ? `The first firing is ${formatRelative(schedule.nextRunAt).replace(' ago', '')} away. History is kept for 30 days.`
                          : 'History is kept for 30 days.'
                        : 'Nothing with this outcome in the last 30 days.'}
                    </span>
                  </EmptyState>
                ) : (
                  <ol className="divide-y divide-separator overflow-hidden rounded-xl border border-separator">
                    {runs.map((run) => {
                      const late = new Date(run.firedAt).getTime() - new Date(run.scheduledFor).getTime();
                      return (
                        <li key={run.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <LocalTime value={run.scheduledFor} className="tabular block text-sm font-medium" />
                            <p className="text-xs text-muted">
                              {late > LATE_MS ? (
                                <span className="text-warning">Fired {formatDuration(late)} late, <Ago value={run.firedAt} /></span>
                              ) : (
                                <>Fired <Ago value={run.firedAt} /></>
                              )}
                            </p>
                            {run.reason && (
                              <p
                                className={`mt-1 flex items-start gap-1.5 text-xs ${run.outcome === 'FAILED' ? 'text-danger' : 'text-muted'}`}
                              >
                                {run.outcome === 'FAILED' && <CircleExclamation className="mt-px size-3.5 shrink-0" />}
                                <span className="break-words">{run.reason}</span>
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {run.outcome === 'STARTED' ? (
                              run.workflowStatus ? (
                                <StatusChip status={run.workflowStatus} />
                              ) : (
                                <Chip size="sm" variant="soft">
                                  Archived
                                </Chip>
                              )
                            ) : (
                              <Chip size="sm" variant="soft" color={run.outcome === 'FAILED' ? 'danger' : 'default'}>
                                {run.outcome === 'FAILED' ? 'Failed to start' : 'Skipped'}
                              </Chip>
                            )}
                            {run.workflowId && (
                              <Link href={`/execution/${run.workflowId}`} className="text-xs" aria-label="Open execution">
                                {run.workflowVersion ? `v${run.workflowVersion}` : 'Open'}
                                <ArrowUpRightFromSquare className="ml-1 inline size-3" />
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {cursor && (
                  <div className="flex justify-center">
                    <Button size="sm" variant="secondary" isPending={loadingMore} onPress={loadMore}>
                      Load older firings
                    </Button>
                  </div>
                )}
              </Drawer.Body>
            </>
          )}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
