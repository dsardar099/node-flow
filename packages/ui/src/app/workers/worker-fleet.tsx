'use client';

import { ArrowRotateRight, Cpu } from '@gravity-ui/icons';
import {
  Card,
  Chip,
  EmptyState,
  SearchField,
  Table,
  Tabs,
  Tooltip,
  Button,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { Ago } from '../../components/ui/ago';
import { LocalTime } from '../../components/ui/local-time';
import { fetchJson } from '../../lib/fetch-json';

export interface WorkerSighting {
  queueName: string;
  workerId: string;
  lastPollAt: string;
}

/**
 * A worker polled this recently, so it is listening.
 *
 * Long polls hold for up to 30 seconds, so anything under a minute is a worker
 * mid-poll rather than a worker that has stopped. The same constant governs the
 * Queues screen; they must agree, or the two pages disagree about whether the
 * same fleet is up.
 */
const ONLINE_MS = 60_000;

/** One row per worker, with every queue it polls folded in. */
interface Worker {
  workerId: string;
  queues: string[];
  lastPollAt: string;
  online: boolean;
}

type Filter = 'all' | 'online' | 'offline';

function fold(sightings: WorkerSighting[], now: number): Worker[] {
  const byId = new Map<string, { queues: Set<string>; lastPollAt: string }>();

  for (const sighting of sightings) {
    const existing = byId.get(sighting.workerId);
    if (existing) {
      existing.queues.add(sighting.queueName);
      // The most recent poll across every queue is what decides liveness: a
      // worker serving two queues is up if either one heard from it.
      if (sighting.lastPollAt > existing.lastPollAt)
        existing.lastPollAt = sighting.lastPollAt;
    } else {
      byId.set(sighting.workerId, {
        queues: new Set([sighting.queueName]),
        lastPollAt: sighting.lastPollAt,
      });
    }
  }

  return [...byId.entries()]
    .map(([workerId, entry]) => ({
      workerId,
      queues: [...entry.queues].sort(),
      lastPollAt: entry.lastPollAt,
      online: now - new Date(entry.lastPollAt).getTime() < ONLINE_MS,
    }))
    .sort((a, b) => {
      // Live workers first, then most recently seen — a fleet view is read
      // top-down and the dead ones are the tail, not the headline.
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.lastPollAt.localeCompare(a.lastPollAt);
    });
}

export function WorkerFleet({
  namespace,
  initialWorkers,
}: {
  namespace: string;
  initialWorkers: WorkerSighting[];
}) {
  const [sightings, setSightings] = useState(initialWorkers);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Liveness is a function of the clock, so it has to be recomputed rather than
   * derived once at render. Held in state and ticked, instead of read inline,
   * so the server and the browser agree on the first paint — reading
   * `Date.now()` during render is what broke hydration across this dashboard.
   */
  const [now, setNow] = useState(
    () => Date.parse(initialWorkers[0]?.lastPollAt ?? '') || 0,
  );

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetchJson<{ workers: WorkerSighting[] }>(
        `/v1/ns/${namespace}/queues/workers`,
      );
      setSightings(response.workers);
      setNow(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [namespace]);

  const workers = useMemo(() => fold(sightings, now), [sightings, now]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workers.filter((worker) => {
      if (filter === 'online' && !worker.online) return false;
      if (filter === 'offline' && worker.online) return false;
      if (!needle) return true;
      return (
        worker.workerId.toLowerCase().includes(needle) ||
        worker.queues.some((queue) => queue.toLowerCase().includes(needle))
      );
    });
  }, [workers, filter, query]);

  const online = workers.filter((worker) => worker.online).length;

  return (
    <>
      <PageHeader
        title="Workers"
        description="Every worker that has polled in the last 24 hours, and the queues it serves."
        actions={
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                variant="ghost"
                isIconOnly
                onPress={refresh}
                isDisabled={refreshing}
                aria-label="Refresh"
              >
                <ArrowRotateRight className="size-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Refresh</Tooltip.Content>
          </Tooltip>
        }
      />

      {/* Every other screen wraps its body in this. Without it the content
          sits flush against the sidebar and the window edge. */}
      <div className="space-y-5 px-4 pb-10 md:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Workers seen" value={workers.length} />
          <Stat
            label="Online"
            value={online}
            tone={online > 0 ? 'success' : 'muted'}
          />
          <Stat label="Idle" value={workers.length - online} />
        </div>

        <Card className="mt-6 p-0">
          <div className="flex flex-col gap-3 border-b border-separator p-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              selectedKey={filter}
              onSelectionChange={(key) => setFilter(key as Filter)}
            >
              <Tabs.List>
                <Tabs.Tab id="all">All</Tabs.Tab>
                <Tabs.Tab id="online">Online</Tabs.Tab>
                <Tabs.Tab id="offline">Idle</Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <SearchField
              aria-label="Filter workers"
              value={query}
              onChange={setQuery}
              className="sm:w-72"
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Worker or queue" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>

          {shown.length === 0 ? (
            <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Cpu className="size-6" />
              </span>
              <span className="text-sm font-medium">
                {workers.length === 0
                  ? 'No worker has polled yet'
                  : 'Nothing matches'}
              </span>
              <span className="max-w-md text-sm text-muted">
                {workers.length === 0 ? (
                  <>
                    A worker appears here once it asks for work. If one is
                    running, check it is authorised for its queue and polling
                    the same name — a domain-routed task queues as{' '}
                    <span className="font-mono">name:domain</span>.
                  </>
                ) : (
                  'No worker matches this filter.'
                )}
              </span>
            </EmptyState>
          ) : (
            <Table aria-label="Workers">
              <Table.ScrollContainer>
                <Table.Content className="min-w-175">
                  <Table.Header>
                    <Table.Column isRowHeader>Worker</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Queues</Table.Column>
                    <Table.Column>Last poll</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {shown.map((worker) => (
                      <Table.Row key={worker.workerId} id={worker.workerId}>
                        <Table.Cell className="font-mono text-sm">
                          <span className="flex items-center gap-2">
                            <Cpu className="size-4 shrink-0 text-muted" />
                            <span className="truncate">{worker.workerId}</span>
                          </span>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <span
                              className={`size-2 shrink-0 rounded-full ${
                                worker.online
                                  ? 'bg-success'
                                  : 'bg-default-foreground/30'
                              }`}
                            />
                            <span className="text-sm">
                              {worker.online ? 'Online' : 'Idle'}
                            </span>
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <QueueList queues={worker.queues} />
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          <span className="block text-sm">
                            <Ago value={worker.lastPollAt} />
                          </span>
                          <LocalTime
                            value={worker.lastPollAt}
                            className="tabular block text-xs text-muted"
                          />
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * The queues a worker serves, summarised.
 *
 * A worker polling a dozen queues rendered a dozen chips and made its row four
 * lines tall, which pushed everything else off the screen — the column that
 * matters least dominated the table. A few names plus a count answers "what
 * does this serve?" at a glance, and the rest expand on demand.
 */
function QueueList({ queues }: { queues: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 3;
  const shown = expanded ? queues : queues.slice(0, LIMIT);
  const hidden = queues.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {/*
        Not truncated. A queue name is an identifier you match against your
        worker's configuration, and `conductorwork_178983824344…` is no use for
        that — a half-name is worse than a wrapped one.
      */}
      {shown.map((queue) => (
        <Chip key={queue} size="sm" variant="secondary" className="font-mono">
          {queue}
        </Chip>
      ))}
      {hidden > 0 ? (
        <Button size="sm" variant="ghost" onPress={() => setExpanded(true)}>
          +{hidden} more
        </Button>
      ) : null}
      {expanded && queues.length > LIMIT ? (
        <Button size="sm" variant="ghost" onPress={() => setExpanded(false)}>
          Show fewer
        </Button>
      ) : null}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number;
  tone?: 'success' | 'muted';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone === 'success' ? 'text-success' : ''}`}
      >
        {value}
      </p>
    </Card>
  );
}
