'use client';

import { ChevronLeft, ChevronRight, ClockArrowRotateLeft, Pause, Play, Xmark } from '@gravity-ui/icons';
import { Button, Slider, Tooltip } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { momentsOf, statusesAt, type TimedTaskRun } from '../../../lib/dag/status';

interface Change {
  refName: string;
  what: string;
}

function changesAt(tasks: readonly TimedTaskRun[], moment: number): Change[] {
  const out: Change[] = [];
  for (const task of tasks) {
    const label = task.attempt > 0 ? `${task.refName} (retry ${task.attempt})` : task.iteration > 0 ? `${task.refName} #${task.iteration}` : task.refName;
    if (task.scheduledAt && Date.parse(task.scheduledAt) === moment) out.push({ refName: task.refName, what: `${label} scheduled` });
    if (task.startedAt && Date.parse(task.startedAt) === moment) out.push({ refName: task.refName, what: `${label} started` });
    if (task.endedAt && Date.parse(task.endedAt) === moment) out.push({ refName: task.refName, what: `${label} ${task.status.toLowerCase().replace(/_/g, ' ')}` });
  }
  return out;
}

function offset(ms: number): string {
  if (ms < 1000) return `+${ms} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `+${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * Time travel over a run's diagram.
 *
 * Steps through every instant at which a task changed and redraws the graph as
 * it stood then — which branch had been taken, what was running, which attempt
 * failed before the retry succeeded. Rebuilt from the task rows' own
 * timestamps, so it works for every run ever recorded, not only new ones.
 */
export function useTimeTravel(tasks: readonly TimedTaskRun[], startedAt: string, endedAt?: string | null) {
  const moments = useMemo(() => momentsOf(tasks, startedAt, endedAt), [tasks, startedAt, endedAt]);
  const [index, setIndex] = useState<number>();
  const statuses = useMemo(() => (index === undefined ? undefined : statusesAt(tasks, moments[Math.min(index, moments.length - 1)])), [tasks, moments, index]);
  return { moments, index, setIndex, statuses };
}

export function TimeTravelBar({
  tasks,
  moments,
  index,
  setIndex,
  onFocus,
}: {
  tasks: readonly TimedTaskRun[];
  moments: number[];
  index: number | undefined;
  setIndex: (index: number | undefined) => void;
  onFocus?: (refName: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const last = moments.length - 1;

  useEffect(() => {
    if (!playing || index === undefined) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex(index + 1), 700);
    return () => clearTimeout(timer);
  }, [playing, index, last, setIndex]);

  if (moments.length < 2) return null;

  if (index === undefined) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <Button size="sm" variant="secondary" className="pointer-events-auto shadow-md" onPress={() => setIndex(0)}>
          <ClockArrowRotateLeft />
          Time travel
        </Button>
      </div>
    );
  }

  const moment = moments[index];
  const changes = changesAt(tasks, moment);

  return (
    <div className="absolute inset-x-4 bottom-4 flex justify-center">
      <div className="flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-separator bg-surface p-3 shadow-lg" role="group" aria-label="Time travel">
        <div className="flex items-center gap-2">
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Previous change" isDisabled={index === 0} onPress={() => setIndex(index - 1)}>
              <ChevronLeft />
            </Button>
            <Tooltip.Content>Previous change</Tooltip.Content>
          </Tooltip>
          <Button
            isIconOnly
            size="sm"
            variant="primary"
            aria-label={playing ? 'Pause' : 'Play'}
            onPress={() => {
              if (!playing && index >= last) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Next change" isDisabled={index >= last} onPress={() => setIndex(index + 1)}>
              <ChevronRight />
            </Button>
            <Tooltip.Content>Next change</Tooltip.Content>
          </Tooltip>
          <Slider
            aria-label="Moment in the run"
            className="mx-2 flex-1"
            minValue={0}
            maxValue={last}
            step={1}
            value={index}
            onChange={(value) => {
              setPlaying(false);
              setIndex(Array.isArray(value) ? value[0] : value);
            }}
          >
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{offset(moment - moments[0])}</span>
          <Tooltip delay={300}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Back to now"
              onPress={() => {
                setPlaying(false);
                setIndex(undefined);
              }}
            >
              <Xmark />
            </Button>
            <Tooltip.Content>Back to now</Tooltip.Content>
          </Tooltip>
        </div>
        <p className="truncate px-1 text-xs text-muted" aria-live="polite">
          <span className="font-medium text-foreground">
            Step {index + 1} of {moments.length}
          </span>
          {' · '}
          {changes.length === 0
            ? index === 0
              ? 'run started'
              : 'run ended'
            : changes.map((change, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <button type="button" className="hover:text-accent hover:underline" onClick={() => onFocus?.(change.refName)}>
                    {change.what}
                  </button>
                </span>
              ))}
        </p>
      </div>
    </div>
  );
}
