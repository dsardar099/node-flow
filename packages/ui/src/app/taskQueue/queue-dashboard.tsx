'use client';

import { ArrowRotateRight, Cpu, Server } from '@gravity-ui/icons';
import { Card, Chip, Drawer, EmptyState, SearchField, Table, Tabs, Tooltip, Button } from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { formatMs } from '../../components/ui/format';
import { fetchJson } from '../../lib/fetch-json';

export interface QueueRow {
  queueName: string;
  available: number;
  leased: number;
  delayed: number;
  total: number;
  workers: number;
  oldestAvailableAt: string | null;
}

export interface WorkerSighting {
  queueName: string;
  workerId: string;
  lastPollAt: string;
}

type Health = 'stalled' | 'backlogged' | 'healthy' | 'idle';

/** A worker that polled this recently is listening. Long polls hold up to 30s. */
const ONLINE_MS = 60_000;
/** Work older than this is a backlog, not ordinary queueing. */
const BACKLOG_MS = 60_000;

const HEALTH: Record<Health, { label: string; color: 'danger' | 'warning' | 'success' | 'default'; hint: string }> = {
  stalled: { label: 'Stalled', color: 'danger', hint: 'Work is waiting and no worker has polled in the last minute.' },
  backlogged: { label: 'Backlogged', color: 'warning', hint: 'Workers are polling, but work has waited over a minute.' },
  healthy: { label: 'Healthy', color: 'success', hint: 'Workers are polling and work is being picked up.' },
  idle: { label: 'Idle', color: 'default', hint: 'Nothing queued and no worker polling.' },
};

interface Row extends QueueRow {
  sightings: WorkerSighting[];
  online: number;
  lastPollAt?: string;
  health: Health;
}

function since(at: string | null | undefined): number {
  return at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Queues, and whether anyone is working them.
 *
 * Depth alone is the number people watch and the wrong one to judge by: 500
 * tasks that arrived a second ago with ten workers polling is healthy, and 3
 * tasks nobody has polled for in an hour is an outage. So every queue is
 * classified by *waiting and listening together*, stalled ones sort first, and
 * a defined task type with nothing queued still appears — "idle" is an answer
 * too, where an absent row is a question.
 */
export function QueueDashboard({
  namespace,
  initialQueues,
  initialWorkers,
  definedTasks,
  initialQueue,
}: {
  namespace: string;
  initialQueues: QueueRow[];
  initialWorkers: WorkerSighting[];
  definedTasks: string[];
  initialQueue?: string;
}) {
  const [queues, setQueues] = useState(initialQueues);
  const [workers, setWorkers] = useState(initialWorkers);
  const [query, setQuery] = useState(initialQueue ?? '');
  const [filter, setFilter] = useState<'all' | 'attention' | 'active'>('all');
  const [open, setOpen] = useState<string>();
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    const [q, w] = await Promise.all([
      fetchJson<{ queues: QueueRow[] }>(`/v1/ns/${namespace}/queues`),
      fetchJson<{ workers: WorkerSighting[] }>(`/v1/ns/${namespace}/queues/workers`),
    ]);
    setQueues(q.queues);
    setWorkers(w.workers);
  }, [namespace]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
      tick((n) => n + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rows = useMemo<Row[]>(() => {
    const names = new Set([...definedTasks, ...queues.map((q) => q.queueName), ...workers.map((w) => w.queueName)]);
    return [...names]
      .map((name) => {
        const queue = queues.find((q) => q.queueName === name) ?? {
          queueName: name,
          available: 0,
          leased: 0,
          delayed: 0,
          total: 0,
          workers: 0,
          oldestAvailableAt: null,
        };
        const sightings = workers.filter((w) => w.queueName === name);
        const online = sightings.filter((w) => since(w.lastPollAt) < ONLINE_MS).length;
        const health: Health =
          queue.available > 0 && online === 0 && queue.workers === 0
            ? 'stalled'
            : queue.available > 0 && since(queue.oldestAvailableAt) > BACKLOG_MS
              ? 'backlogged'
              : online > 0 || queue.total > 0
                ? 'healthy'
                : 'idle';
        return { ...queue, sightings, online, lastPollAt: sightings[0]?.lastPollAt, health };
      })
      .sort((a, b) => {
        const order: Health[] = ['stalled', 'backlogged', 'healthy', 'idle'];
        return order.indexOf(a.health) - order.indexOf(b.health) || since(b.oldestAvailableAt) - since(a.oldestAvailableAt) || a.queueName.localeCompare(b.queueName);
      });
  }, [definedTasks, queues, workers]);

  const shown = rows.filter((row) => {
    if (query && !row.queueName.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === 'attention') return row.health === 'stalled' || row.health === 'backlogged';
    if (filter === 'active') return row.health !== 'idle';
    return true;
  });

  const totals = {
    waiting: rows.reduce((sum, row) => sum + row.available, 0),
    running: rows.reduce((sum, row) => sum + row.leased, 0),
    online: new Set(workers.filter((w) => since(w.lastPollAt) < ONLINE_MS).map((w) => w.workerId)).size,
    attention: rows.filter((row) => row.health === 'stalled' || row.health === 'backlogged').length,
  };

  const selected = rows.find((row) => row.queueName === open);

  return (
    <>
      <PageHeader
        title="Queues"
        description="Work waiting for workers, and whether any worker is listening. Updates every few seconds."
        actions={
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Button isIconOnly variant="ghost" aria-label="Refresh" onPress={() => void refresh()}>
                <ArrowRotateRight />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Refresh now</Tooltip.Content>
          </Tooltip>
        }
      />

      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Waiting" value={totals.waiting} />
          <Stat label="Running" value={totals.running} />
          <Stat label="Workers online" value={totals.online} />
          <Stat label="Need attention" value={totals.attention} tone={totals.attention > 0 ? 'danger' : undefined} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs selectedKey={filter} onSelectionChange={(key) => setFilter(key as typeof filter)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Show" className="w-auto">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'attention', label: 'Needs attention' },
                  { id: 'active', label: 'Active' },
                ].map((tab) => (
                  <Tabs.Tab key={tab.id} id={tab.id} className="w-auto flex-none px-4">
                    {tab.label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <SearchField aria-label="Search queues" value={query} onChange={setQuery} className="min-w-64 max-w-md flex-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search queues" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>

        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Queues"
                className="min-w-[860px]"
                onRowAction={(key) => setOpen(String(key))}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Queue</Table.Column>
                  <Table.Column>Health</Table.Column>
                  <Table.Column className="text-end">Waiting</Table.Column>
                  <Table.Column className="text-end">Running</Table.Column>
                  <Table.Column className="text-end">Backing off</Table.Column>
                  <Table.Column>Oldest wait</Table.Column>
                  <Table.Column>Workers</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Server className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {rows.length === 0 ? 'No queues yet' : 'Nothing to show with these filters'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {rows.length === 0
                          ? 'A queue appears when a task is scheduled, a task type is defined, or a worker polls.'
                          : 'Everything here is healthy or idle.'}
                      </span>
                    </EmptyState>
                  )}
                >
                  {shown.map((row) => {
                    const health = HEALTH[row.health];
                    return (
                      <Table.Row key={row.queueName} id={row.queueName} className="cursor-pointer">
                        <Table.Cell>
                          <span className="font-mono text-sm font-medium">{row.queueName}</span>
                        </Table.Cell>
                        <Table.Cell>
                          <Tooltip delay={200}>
                            <Tooltip.Trigger>
                              <Chip size="sm" variant="soft" color={health.color}>
                                <span
                                  className={`mr-1 inline-block size-1.5 rounded-full bg-current ${row.health === 'stalled' ? 'animate-pulse' : ''}`}
                                />
                                {health.label}
                              </Chip>
                            </Tooltip.Trigger>
                            <Tooltip.Content>{health.hint}</Tooltip.Content>
                          </Tooltip>
                        </Table.Cell>
                        <Table.Cell className="tabular text-end">{row.available || <span className="text-muted">0</span>}</Table.Cell>
                        <Table.Cell className="tabular text-end">{row.leased || <span className="text-muted">0</span>}</Table.Cell>
                        <Table.Cell className="tabular text-end text-muted">{row.delayed}</Table.Cell>
                        <Table.Cell className="tabular whitespace-nowrap">
                          {/* The ages below are measured against `Date.now()`,
                              so the server and the browser disagree on them. */}
                          {row.oldestAvailableAt ? (
                            <span
                              className={since(row.oldestAvailableAt) > BACKLOG_MS ? 'text-warning' : ''}
                              suppressHydrationWarning
                            >
                              {formatMs(since(row.oldestAvailableAt))}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          {row.sightings.length === 0 ? (
                            <span className="text-sm text-muted">None seen</span>
                          ) : (
                            <span className="text-sm">
                              <span className={row.online > 0 ? 'text-success' : 'text-muted'}>{row.online} online</span>
                              <span className="block text-xs text-muted" suppressHydrationWarning>
                                last poll {formatMs(since(row.lastPollAt))} ago
                              </span>
                            </span>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <Drawer.Backdrop isOpen={selected !== undefined} onOpenChange={(isOpen) => !isOpen && setOpen(undefined)}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="sm:w-[30rem]">
            <Drawer.CloseTrigger />
            {selected && (
              <>
                <Drawer.Header>
                  <Drawer.Heading className="font-mono">{selected.queueName}</Drawer.Heading>
                  <p className="text-sm text-muted">{HEALTH[selected.health].hint}</p>
                </Drawer.Header>
                <Drawer.Body className="space-y-5">
                  <dl className="grid grid-cols-3 gap-3">
                    <Mini label="Waiting" value={selected.available} />
                    <Mini label="Running" value={selected.leased} />
                    <Mini label="Backing off" value={selected.delayed} />
                  </dl>
                  <div>
                    <p className="mb-2 text-sm font-medium">Workers seen in the last 24 hours</p>
                    {selected.sightings.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-separator p-4 text-sm text-muted">
                        No worker has polled <span className="font-mono">{selected.queueName}</span>. Check the worker is
                        running, authorised for this queue, and polling the same name — a domain-routed task queues as{' '}
                        <span className="font-mono">name:domain</span>.
                      </p>
                    ) : (
                      <ul className="divide-y divide-separator rounded-xl border border-separator">
                        {selected.sightings.map((worker) => {
                          const online = since(worker.lastPollAt) < ONLINE_MS;
                          return (
                            <li key={worker.workerId} className="flex items-center gap-3 px-4 py-3">
                              <Cpu className="size-4 text-muted" />
                              <span className="min-w-0 flex-1 truncate font-mono text-sm">{worker.workerId}</span>
                              <span className="flex items-center gap-1.5 text-xs text-muted">
                                <span className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-default'}`} />
                                <span suppressHydrationWarning>{formatMs(since(worker.lastPollAt))} ago</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </Drawer.Body>
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <Card className="flex-row items-center justify-between px-5 py-4">
      <span className="text-sm text-muted">{label}</span>
      <span className={`tabular text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</span>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-secondary px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular text-lg font-semibold">{value}</dd>
    </div>
  );
}
