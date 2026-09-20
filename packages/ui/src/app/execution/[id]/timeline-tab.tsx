'use client';

import { Button, Card, Label, Slider, Tooltip } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { formatMs, formatTime } from '../../../components/ui/format';
import { statusColor, statusLabel } from '../../../components/ui/status-chip';
import { TERMINAL_WORKFLOW, type ExecutionDetail, type TaskRun } from './types';

/**
 * Where the time went.
 *
 * Each task run is two bars: waiting in the queue, then running. Separating
 * them is the point — a workflow that took twenty minutes because tasks sat
 * unclaimed needs more workers, and one that took twenty minutes because a task
 * ran for nineteen needs a different conversation.
 *
 * The visible range narrows with the slider, because one ten-minute human wait
 * otherwise squeezes every sub-second task into an invisible sliver.
 */
export function TimelineTab({
  execution,
  selectedRef,
  onOpen,
}: {
  execution: ExecutionDetail;
  selectedRef?: string;
  onOpen: (ref: string) => void;
}) {
  const running = !TERMINAL_WORKFLOW.has(execution.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const rows = useMemo(
    () =>
      execution.tasks
        .filter((task) => task.scheduledAt)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [execution.tasks]
  );

  const start = new Date(execution.startedAt).getTime();
  const end = Math.max(
    execution.endedAt ? new Date(execution.endedAt).getTime() : now,
    ...rows.map((t) => (t.endedAt ? new Date(t.endedAt).getTime() : now)),
    start + 1000
  );

  const [range, setRange] = useState<number[]>([0, 100]);
  // Hundreds of rows render slowly and read worse; the first screenful answers
  // most questions, and the rest are one press away.
  const [showAll, setShowAll] = useState(false);
  const viewStart = start + ((end - start) * range[0]) / 100;
  const viewEnd = start + ((end - start) * range[1]) / 100;
  const span = Math.max(1, viewEnd - viewStart);

  const pct = (t: number) => ((t - viewStart) / span) * 100;
  const ticks = Array.from({ length: 6 }, (_, i) => viewStart + (span * i) / 5);

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No task has been scheduled yet.</p>;
  }

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <Card.Title>Timeline</Card.Title>
          <Card.Description>
            {formatMs(end - start)} end to end{running ? ' so far' : ''}
          </Card.Description>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-warning/40" /> Queue wait
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-success" /> Running
          </span>
          {(range[0] !== 0 || range[1] !== 100) && (
            <Button size="sm" variant="ghost" onPress={() => setRange([0, 100])}>
              Reset zoom
            </Button>
          )}
        </div>
      </Card.Header>

      <Card.Content className="space-y-4">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Axis */}
            <div className="grid grid-cols-[16rem_1fr] border-b border-separator pb-2">
              <span className="text-xs font-medium text-muted">Task</span>
              <div className="relative h-4">
                {ticks.map((tick, i) => (
                  <span
                    key={i}
                    title={formatTime(new Date(tick))}
                    className={`tabular absolute whitespace-nowrap text-[11px] text-muted ${
                      i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
                    }`}
                    style={{ left: `${(i / 5) * 100}%` }}
                  >
                    {/* Offsets from the start read at a glance; wall-clock
                        times six seconds apart all look the same. */}
                    {axisLabel(tick - start, span)}
                  </span>
                ))}
              </div>
            </div>

            {(showAll ? rows : rows.slice(0, ROW_LIMIT)).map((task) => (
              <TimelineRow
                key={task.id}
                task={task}
                now={now}
                pct={pct}
                selected={task.refName === selectedRef}
                onOpen={() => onOpen(task.refName)}
              />
            ))}
            {rows.length > ROW_LIMIT && (
              <div className="flex justify-center py-3">
                <Button size="sm" variant="secondary" onPress={() => setShowAll((v) => !v)}>
                  {showAll ? `Show the first ${ROW_LIMIT}` : `Show all ${rows.length} tasks`}
                </Button>
              </div>
            )}
          </div>
        </div>

        <Slider
          aria-label="Visible range"
          minValue={0}
          maxValue={100}
          step={0.5}
          value={range}
          onChange={(value) => setRange(Array.isArray(value) ? value : [0, value])}
          className="px-1"
        >
          <Label className="text-xs text-muted">Visible range</Label>
          <Slider.Track>
            {({ state }) => (
              <>
                <Slider.Fill />
                {state.values.map((_, i) => (
                  <Slider.Thumb key={i} index={i} />
                ))}
              </>
            )}
          </Slider.Track>
        </Slider>
      </Card.Content>
    </Card>
  );
}

function TimelineRow({
  task,
  now,
  pct,
  selected,
  onOpen,
}: {
  task: TaskRun;
  now: number;
  pct: (t: number) => number;
  selected: boolean;
  onOpen: () => void;
}) {
  const scheduled = new Date(task.scheduledAt as string).getTime();
  const started = task.startedAt ? new Date(task.startedAt).getTime() : undefined;
  const ended = task.endedAt ? new Date(task.endedAt).getTime() : undefined;
  // Only worker-dispatched tasks queue. An operator (a loop, a fork, a join) or
  // a task resolved in place never "starts" — drawing its whole life as queue
  // wait made a 5-minute loop look like 5 minutes stuck waiting for a worker.
  const queues = task.taskType === 'SIMPLE' || started !== undefined;
  const queueEnd = queues ? (started ?? ended ?? now) : scheduled;
  const runStart = started ?? (queues ? undefined : scheduled);
  const runEnd = ended ?? now;

  const bar = (from: number, to: number) => {
    const left = Math.max(0, pct(from));
    const right = Math.min(100, pct(to));
    return right <= 0 || left >= 100 ? undefined : { left: `${left}%`, width: `max(${right - left}%, 3px)` };
  };

  const queue = queues ? bar(scheduled, queueEnd) : undefined;
  const run = runStart !== undefined ? bar(runStart, runEnd) : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-[16rem_1fr] items-center border-b border-separator/60 py-2 text-left transition-colors hover:bg-default/60 ${
        selected ? 'bg-accent-soft' : ''
      }`}
    >
      <span className="min-w-0 pr-3">
        <span className="block truncate text-sm font-medium">
          {task.refName}
          {task.iteration > 0 && <span className="ml-1 text-xs text-accent">iter {task.iteration}</span>}
          {task.attempt > 0 && <span className="ml-1 text-xs text-muted">#{task.attempt + 1}</span>}
        </span>
        <span className="block truncate text-xs text-muted">{task.taskDefName}</span>
      </span>
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <span className="relative block h-6">
            {queue && <span className="absolute top-1 h-4 rounded-l-md bg-warning/35" style={queue} />}
            {run && (
              <span
                className={`absolute top-1 h-4 rounded-md ${ended ? '' : 'animate-pulse'}`}
                style={{ ...run, background: statusColor(task.status) }}
              />
            )}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content className="text-xs">
          <p className="font-medium">
            {task.refName} · {statusLabel(task.status)}
          </p>
          <p>Queued {formatMs(queueEnd - scheduled)}</p>
          {runStart !== undefined && <p>Ran {formatMs(runEnd - runStart)}</p>}
        </Tooltip.Content>
      </Tooltip>
    </button>
  );
}

const ROW_LIMIT = 150;

/** Axis offsets, precise enough that neighbouring ticks never read the same. */
function axisLabel(offset: number, span: number): string {
  if (offset <= 0) return '0s';
  if (span < 2_000) return `+${Math.round(offset)}ms`;
  if (span < 60_000) return `+${Number((offset / 1000).toFixed(1))}s`;
  return `+${formatMs(offset)}`;
}
