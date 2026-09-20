'use client';

import {
  ArrowRight,
  ArrowRotateRight,
  BroadcastSignal,
  CircleCheck,
  CircleExclamation,
  CirclePlay,
  Clock,
  Person,
  Plus,
  Pulse,
  Server,
} from '@gravity-ui/icons';
import { Button, Card, Chip, ListBox, Select, Tooltip } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { formatMs, formatRelative, formatTime } from '../../components/ui/format';
import { StatusChip } from '../../components/ui/status-chip';
import { fetchJson } from '../../lib/fetch-json';
import { RunWorkflowModal } from '../workflowDef/run-workflow-modal';
import { Ago } from '../../components/ui/ago';

export interface ExecutionOverview {
  hours: number;
  bucketMinutes: number;
  byStatus: Record<string, number>;
  started: number;
  running: number;
  paused: number;
  queued: number;
  oldestRunningAt: string | null;
  series: { at: string; started: number; completed: number; failed: number }[];
  durationMs: { p50: number | null; p95: number | null };
  hotspots: { defName: string; total: number; failed: number; completed: number }[];
  recentFailures: {
    workflowId: string;
    defName: string;
    status: string;
    reason: string | null;
    endedAt: string;
    failedTask: string | null;
  }[];
}

/** Signals from elsewhere. `undefined` means the viewer cannot see that area, so it is left out. */
export interface Attention {
  stalledQueues?: string[];
  openHumanTasks?: number;
  overdueHumanTasks?: number;
  failedEvents?: number;
}

const WINDOWS = [
  { id: '1', label: 'Last hour', range: '1h' },
  { id: '6', label: 'Last 6 hours', range: '24h' },
  { id: '24', label: 'Last 24 hours', range: '24h' },
  { id: '168', label: 'Last 7 days', range: '7d' },
];

/**
 * The first screen: is everything all right, and if not, where to look.
 *
 * Ordered by the questions in the order they are asked. What is running right
 * now; is it succeeding; how the last hours have gone; and then, only if
 * something needs a person, the short list of what — each item a link to the
 * screen that fixes it. A page of charts nobody acts on is decoration; every
 * number here is a way in.
 */
export function Overview({
  namespace,
  userName,
  initialOverview,
  attention,
  workflowNames,
  mayStart,
  mayWrite,
}: {
  namespace: string;
  userName: string;
  initialOverview: ExecutionOverview;
  attention: Attention;
  workflowNames: string[];
  mayStart: boolean;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [hours, setHours] = useState(String(initialOverview.hours));
  const [runOpen, setRunOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setOverview(await fetchJson<ExecutionOverview>(`/v1/ns/${namespace}/executions/overview?hours=${hours}`));
    } finally {
      setRefreshing(false);
    }
  }, [namespace, hours]);

  useEffect(() => {
    if (String(overview.hours) !== hours) void refresh().catch(() => undefined);
  }, [hours, overview.hours, refresh]);

  useEffect(() => {
    const timer = setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const window = WINDOWS.find((w) => w.id === hours) ?? WINDOWS[2];
  const completed = overview.byStatus['COMPLETED'] ?? 0;
  const failed = (overview.byStatus['FAILED'] ?? 0) + (overview.byStatus['TIMED_OUT'] ?? 0);
  const terminated = overview.byStatus['TERMINATED'] ?? 0;
  const finished = completed + failed;
  const successRate = finished > 0 ? completed / finished : undefined;
  const executionsLink = (params: Record<string, string>) =>
    `/executions?${new URLSearchParams({ range: window.range, ...params })}`;

  return (
    <>
      <PageHeader
        // One text child, not two. `suppressHydrationWarning` covers an
        // element's *direct text children*, and `{a}, {b}` is three nodes,
        // which React reconciles individually — so the suppression does not
        // reliably cover the one that differs. The greeting reads the clock and
        // the timezone, so UTC on the server and local in the browser disagree
        // across every hour boundary.
        title={<span suppressHydrationWarning>{`${greeting()}, ${userName.split(' ')[0]}`}</span>}
        description={`What is running in ${namespace}, how it is going, and what needs you.`}
        actions={
          <>
            <Select
              aria-label="Window"
              className="w-44"
              value={hours}
              onChange={(value) => value !== null && setHours(String(value))}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {WINDOWS.map((w) => (
                    <ListBox.Item key={w.id} id={w.id} textValue={w.label}>
                      {w.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" aria-label="Refresh" isPending={refreshing} onPress={() => void refresh()}>
                  <ArrowRotateRight />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh — also updates every 15 seconds</Tooltip.Content>
            </Tooltip>
            {mayWrite && (
              <Button variant="secondary" onPress={() => router.push('/newWorkflowDef')}>
                <Plus />
                New workflow
              </Button>
            )}
            {mayStart && (
              <Button onPress={() => setRunOpen(true)}>
                <CirclePlay />
                Run workflow
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-5 px-4 md:px-8 pb-10">
        <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            href="/executions?status=RUNNING"
            icon={Pulse}
            tone="accent"
            label="Running now"
            value={overview.running}
            pulse={overview.running > 0}
            footnote={
              [
                overview.paused ? `${overview.paused} paused` : null,
                overview.queued ? `${overview.queued} queued by rate limit` : null,
                overview.oldestRunningAt ? `oldest started ${formatRelative(overview.oldestRunningAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing in flight'
            }
          />
          <Kpi
            href={executionsLink({})}
            icon={CirclePlay}
            tone="default"
            label={`Started, ${window.label.toLowerCase()}`}
            value={overview.started}
            footnote={
              [`${completed} completed`, `${failed} failed`, terminated ? `${terminated} terminated` : null]
                .filter(Boolean)
                .join(' · ')
            }
          />
          <Link
            href={executionsLink({ status: 'FAILED,TIMED_OUT' })}
            className="group rounded-3xl focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Card className="h-full flex-row items-center gap-4 p-5 transition group-hover:bg-surface-secondary">
              <SuccessRing rate={successRate} />
              <div className="min-w-0">
                <p className="text-sm text-muted">Success rate</p>
                <p className="tabular text-2xl font-semibold">
                  {successRate === undefined ? '—' : `${(successRate * 100).toFixed(successRate > 0.995 && successRate < 1 ? 1 : 0)}%`}
                </p>
                <p className="truncate text-xs text-muted">
                  {finished === 0 ? 'Nothing finished yet' : `${failed} of ${finished} finished runs failed`}
                </p>
              </div>
            </Card>
          </Link>
          <Kpi
            icon={Clock}
            tone="default"
            label="Duration (completed)"
            value={overview.durationMs.p50 === null ? '—' : formatMs(overview.durationMs.p50)}
            valueSuffix="median"
            footnote={overview.durationMs.p95 === null ? 'No completed runs yet' : `p95 ${formatMs(overview.durationMs.p95)}`}
          />
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="min-w-0 gap-3 p-5 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Throughput</h2>
                <p className="text-xs text-muted">
                  Runs finishing per {overview.bucketMinutes >= 60 ? `${overview.bucketMinutes / 60} h` : `${overview.bucketMinutes} min`}, and runs started
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted">
                <Legend className="bg-success" label="Completed" />
                <Legend className="bg-danger" label="Failed" />
                <Legend className="h-0.5 w-4 rounded-none bg-accent" label="Started" />
              </div>
            </div>
            <ThroughputChart series={overview.series} bucketMinutes={overview.bucketMinutes} />
          </Card>

          <AttentionPanel attention={attention} overview={overview} failed={failed} executionsLink={executionsLink} />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card className="min-w-0 gap-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Workflows by failures</h2>
                <p className="text-xs text-muted">Where failures cluster, {window.label.toLowerCase()}</p>
              </div>
              <Link href={executionsLink({})} className="text-sm text-accent hover:underline">
                All executions
              </Link>
            </div>
            {overview.hotspots.length === 0 ? (
              <Quiet text="No runs in this window." />
            ) : (
              <ul className="space-y-3">
                {overview.hotspots.map((spot) => {
                  const rate = spot.total ? spot.failed / spot.total : 0;
                  return (
                    <li key={spot.defName}>
                      <Link
                        href={executionsLink({ workflowType: spot.defName, ...(spot.failed ? { status: 'FAILED,TIMED_OUT' } : {}) })}
                        className="group block rounded-xl px-2 py-1.5 -mx-2 hover:bg-surface-secondary"
                      >
                        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate font-medium group-hover:text-accent">{spot.defName}</span>
                          <span className="tabular shrink-0 text-xs text-muted">
                            {spot.failed > 0 ? <span className="text-danger">{spot.failed} failed</span> : 'no failures'} · {spot.total} runs
                          </span>
                        </div>
                        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                          <span className="bg-success" style={{ width: `${spot.total ? (spot.completed / spot.total) * 100 : 0}%` }} />
                          <span className="bg-danger" style={{ width: `${rate * 100}%` }} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="min-w-0 gap-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Recent failures</h2>
                <p className="text-xs text-muted">Open one to see the task that failed and why</p>
              </div>
              <Link href={executionsLink({ status: 'FAILED,TIMED_OUT' })} className="text-sm text-accent hover:underline">
                All failures
              </Link>
            </div>
            {overview.recentFailures.length === 0 ? (
              <Quiet icon={CircleCheck} text="No failures in this window." tone="success" />
            ) : (
              <ul className="-mx-2 divide-y divide-separator">
                {overview.recentFailures.map((failure) => (
                  <li key={failure.workflowId}>
                    <Link
                      href={`/execution/${failure.workflowId}${failure.failedTask ? `?task=${encodeURIComponent(failure.failedTask)}` : ''}`}
                      className="group flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-secondary"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
                        <CircleExclamation className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium group-hover:text-accent">{failure.defName}</span>
                          {failure.status !== 'FAILED' && <StatusChip status={failure.status} />}
                          {failure.failedTask && (
                            <span className="truncate font-mono text-xs text-muted">at {failure.failedTask}</span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted">{failure.reason ?? 'No reason recorded'}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted"><Ago value={failure.endedAt} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <RunWorkflowModal namespace={namespace} workflowNames={workflowNames} isOpen={runOpen} onOpenChange={setRunOpen} />
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const TONE = {
  accent: 'bg-accent-soft text-accent',
  default: 'bg-surface-secondary text-muted',
};

function Kpi({
  href,
  icon: Icon,
  tone,
  label,
  value,
  valueSuffix,
  footnote,
  pulse,
}: {
  href?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: keyof typeof TONE;
  label: string;
  value: number | string;
  valueSuffix?: string;
  footnote: string;
  pulse?: boolean;
}) {
  const body = (
    <Card className={`h-full flex-row items-center gap-4 p-5 ${href ? 'transition group-hover:bg-surface-secondary' : ''}`}>
      <span className={`relative flex size-11 shrink-0 items-center justify-center rounded-2xl ${TONE[tone]}`}>
        <Icon className="size-5" />
        {pulse && <span className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-accent" />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-muted">{label}</p>
        <p className="tabular text-2xl font-semibold">
          {value}
          {valueSuffix && <span className="ms-1.5 text-xs font-normal text-muted">{valueSuffix}</span>}
        </p>
        <p className="truncate text-xs text-muted">{footnote}</p>
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="group rounded-3xl focus-visible:outline-2 focus-visible:outline-accent">
      {body}
    </Link>
  ) : (
    body
  );
}

function SuccessRing({ rate }: { rate: number | undefined }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const color = rate === undefined ? 'var(--muted)' : rate >= 0.99 ? 'var(--success)' : rate >= 0.9 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={radius} fill="none" stroke="var(--surface-secondary)" strokeWidth="5" />
      {rate !== undefined && (
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * rate} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      )}
    </svg>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

/**
 * Completed and failed as stacked columns, started as a line over them.
 *
 * Drawn by hand in SVG rather than with a chart library: it is one chart, the
 * theme's own colour tokens style it in both modes, and hovering a column
 * names its exact counts — which is all the page asks of it.
 */
function ThroughputChart({ series, bucketMinutes }: { series: ExecutionOverview['series']; bucketMinutes: number }) {
  const [hover, setHover] = useState<number>();
  // Drawn at the container's real size, so text and strokes never stretch.
  const box = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 720, height: 224 });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0) setSize({ width: Math.round(w), height: Math.round(h) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pad = { top: 12, right: 8, bottom: 24, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = useMemo(
    () => Math.max(1, ...series.map((b) => Math.max(b.started, b.completed + b.failed))),
    [series]
  );
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const step = innerW / Math.max(series.length, 1);
  const barW = Math.max(2, step * 0.62);
  const y = (value: number) => pad.top + innerH - (value / top) * innerH;
  const line = series.map((b, i) => `${i === 0 ? 'M' : 'L'}${pad.left + step * i + step / 2},${y(b.started)}`).join(' ');
  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(innerW / 90)));
  const hovered = hover === undefined ? undefined : series[hover];
  const empty = series.every((b) => b.started === 0 && b.completed === 0 && b.failed === 0);

  return (
    <div ref={box} className="relative min-h-56 flex-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Executions over time"
        onMouseLeave={() => setHover(undefined)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--separator)" strokeDasharray={tick === 0 ? undefined : '3 4'} />
            <text x={pad.left - 8} y={y(tick) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {tick}
            </text>
          </g>
        ))}
        {series.map((bucket, i) => {
          const x = pad.left + step * i + (step - barW) / 2;
          const completedH = (bucket.completed / top) * innerH;
          const failedH = (bucket.failed / top) * innerH;
          const base = pad.top + innerH;
          return (
            <g key={bucket.at} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + step * i} y={pad.top} width={step} height={innerH} fill={hover === i ? 'var(--surface-secondary)' : 'transparent'} />
              {bucket.completed > 0 && <rect x={x} y={base - completedH} width={barW} height={completedH} rx="2" fill="var(--success)" opacity="0.85" />}
              {bucket.failed > 0 && <rect x={x} y={base - completedH - failedH} width={barW} height={failedH} rx="2" fill="var(--danger)" />}
              {i % labelEvery === 0 && (
                // The axis is labelled in the reader's timezone, so the server
                // (UTC) and the browser disagree about every label. That is a
                // hydration mismatch, and the same class of bug as `<Ago>` and
                // `<LocalTime>` — but inside an SVG, where neither fits.
                <text
                  x={pad.left + step * i + step / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--muted)"
                  suppressHydrationWarning
                >
                  {bucketLabel(bucket.at, bucketMinutes)}
                </text>
              )}
            </g>
          );
        })}
        {!empty && <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />}
        {hovered && hover !== undefined && (
          <circle cx={pad.left + step * hover + step / 2} cy={y(hovered.started)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" pointerEvents="none" />
        )}
      </svg>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
          No runs in this window
        </div>
      )}

      {hovered && hover !== undefined && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-separator bg-overlay px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((pad.left + step * hover + step / 2) / width) * 100}%`,
            transform: hover > series.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          }}
        >
          {/* Timezone-dependent, like every other label on this chart. */}
          <p className="mb-1 font-medium" suppressHydrationWarning>
            {bucketRange(hovered.at, bucketMinutes)}
          </p>
          <p className="flex justify-between gap-4"><span className="text-muted">Started</span><span className="tabular">{hovered.started}</span></p>
          <p className="flex justify-between gap-4"><span className="text-success">Completed</span><span className="tabular">{hovered.completed}</span></p>
          <p className="flex justify-between gap-4"><span className="text-danger">Failed</span><span className="tabular">{hovered.failed}</span></p>
        </div>
      )}
    </div>
  );
}

function niceTicks(max: number): number[] {
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const unit = [1, 2, 5, 10].map((m) => m * magnitude).find((m) => m >= rough) ?? magnitude * 10;
  const stepUnit = Math.max(1, unit);
  const count = Math.ceil(max / stepUnit);
  return Array.from({ length: count + 1 }, (_, i) => i * stepUnit);
}

function bucketLabel(at: string, bucketMinutes: number): string {
  const date = new Date(at);
  if (bucketMinutes >= 360) return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return formatTime(date).slice(0, 5);
}

function bucketRange(at: string, bucketMinutes: number): string {
  const start = new Date(at);
  const end = new Date(start.getTime() + bucketMinutes * 60_000);
  const day = bucketMinutes >= 360 ? `${start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ` : '';
  return `${day}${formatTime(start).slice(0, 5)} – ${formatTime(end).slice(0, 5)}`;
}

function AttentionPanel({
  attention,
  overview,
  failed,
  executionsLink,
}: {
  attention: Attention;
  overview: ExecutionOverview;
  failed: number;
  executionsLink: (params: Record<string, string>) => string;
}) {
  const items: { key: string; href: string; icon: ComponentType<SVGProps<SVGSVGElement>>; tone: 'danger' | 'warning' | 'accent'; title: string; detail: string }[] = [];

  if (attention.stalledQueues?.length) {
    items.push({
      key: 'queues',
      href: `/taskQueue?queue=${encodeURIComponent(attention.stalledQueues[0])}`,
      icon: Server,
      tone: 'danger',
      title: `${attention.stalledQueues.length} stalled queue${attention.stalledQueues.length === 1 ? '' : 's'}`,
      detail: `Work waiting and no worker polling: ${attention.stalledQueues.slice(0, 3).join(', ')}`,
    });
  }
  if (failed > 0) {
    items.push({
      key: 'failed',
      href: executionsLink({ status: 'FAILED,TIMED_OUT' }),
      icon: CircleExclamation,
      tone: 'danger',
      title: `${failed} failed run${failed === 1 ? '' : 's'}`,
      detail: 'Retry them in bulk, or open one to see why',
    });
  }
  if (attention.overdueHumanTasks) {
    items.push({
      key: 'overdue',
      href: '/human/tasks',
      icon: Person,
      tone: 'warning',
      title: `${attention.overdueHumanTasks} human task${attention.overdueHumanTasks === 1 ? '' : 's'} overdue`,
      detail: 'Past their due date and still open',
    });
  }
  if (attention.openHumanTasks) {
    items.push({
      key: 'human',
      href: '/human/tasks',
      icon: Person,
      tone: 'accent',
      title: `${attention.openHumanTasks} human task${attention.openHumanTasks === 1 ? '' : 's'} waiting`,
      detail: 'Workflows paused for a person to decide',
    });
  }
  if (attention.failedEvents) {
    items.push({
      key: 'events',
      href: '/eventMonitor',
      icon: BroadcastSignal,
      tone: 'warning',
      title: `${attention.failedEvents} event${attention.failedEvents === 1 ? '' : 's'} failed`,
      detail: 'Handlers that could not act on a message today',
    });
  }
  if (overview.queued) {
    items.push({
      key: 'queued',
      href: executionsLink({ status: 'RUNNING' }),
      icon: Clock,
      tone: 'accent',
      title: `${overview.queued} run${overview.queued === 1 ? '' : 's'} queued by rate limit`,
      detail: 'They start on their own as slots free',
    });
  }

  const toneClass = { danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', accent: 'bg-accent-soft text-accent' };

  return (
    <Card className="min-w-0 gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Needs attention</h2>
        {items.length > 0 && (
          <Chip size="sm" variant="soft" color={items.some((i) => i.tone === 'danger') ? 'danger' : 'warning'}>
            {items.length}
          </Chip>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success">
            <CircleCheck className="size-6" />
          </span>
          <p className="text-sm font-medium">All clear</p>
          <p className="max-w-56 text-xs text-muted">No stalled queues, failed runs or waiting tasks in this window.</p>
        </div>
      ) : (
        <ul className="-mx-2 space-y-1">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-secondary">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${toneClass[item.tone]}`}>
                  <item.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted">{item.detail}</span>
                </span>
                <ArrowRight className="size-4 text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Quiet({ text, icon: Icon, tone }: { text: string; icon?: ComponentType<SVGProps<SVGSVGElement>>; tone?: 'success' }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-secondary px-4 py-6 text-sm text-muted">
      {Icon && <Icon className={`size-4 ${tone === 'success' ? 'text-success' : ''}`} />}
      {text}
    </div>
  );
}
