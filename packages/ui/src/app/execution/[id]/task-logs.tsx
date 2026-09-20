'use client';

import { Chip, EmptyState, SearchField, Spinner, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalTime } from '../../../components/ui/local-time';
import { fetchJson } from '../../../lib/fetch-json';
import { TERMINAL_TASK, type TaskRun } from './types';

interface LogLine {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  at: string;
}

const LEVEL_COLOR = { debug: 'default', info: 'accent', warn: 'warning', error: 'danger' } as const;

/**
 * What the worker said while running this task.
 *
 * Polled while the task is still running, appending only lines past the last
 * one seen — so a long-running task's log grows in place instead of reloading
 * and losing the reader's scroll position.
 */
export function TaskLogs({ namespace, workflowId, task }: { namespace: string; workflowId: string; task: TaskRun }) {
  const [lines, setLines] = useState<LogLine[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<Set<string>>(new Set(['debug', 'info', 'warn', 'error']));
  const last = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  // Follows the tail like `tail -f`, until the reader scrolls up to read
  // something — then it stays put rather than yanking them back down.
  const following = useRef(true);
  const running = !TERMINAL_TASK.has(task.status);

  useEffect(() => {
    let cancelled = false;
    last.current = undefined;
    setLines(undefined);

    const load = async () => {
      try {
        const after = last.current === undefined ? '' : `?after=${last.current}`;
        const { logs } = await fetchJson<{ logs: LogLine[] }>(
          `/v1/ns/${namespace}/executions/${workflowId}/tasks/${task.id}/logs${after}`
        );
        if (cancelled) return;
        if (logs.length) last.current = logs[logs.length - 1].id;
        setLines((current) => [...(current ?? []), ...logs]);
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      }
    };

    void load();
    if (!running) return () => void (cancelled = true);
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [namespace, workflowId, task.id, running]);

  useEffect(() => {
    const element = scroller.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (lines ?? []).filter(
      (line) => levels.has(line.level) && (!needle || line.message.toLowerCase().includes(needle))
    );
  }, [lines, query, levels]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-separator px-5 py-3">
        <SearchField aria-label="Search logs" value={query} onChange={setQuery} className="min-w-40 flex-1">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search logs" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <ToggleButtonGroup
          aria-label="Levels"
          size="sm"
          selectionMode="multiple"
          selectedKeys={levels}
          onSelectionChange={(keys) => setLevels(new Set([...keys].map(String)))}
        >
          {(['debug', 'info', 'warn', 'error'] as const).map((level) => (
            <ToggleButton key={level} id={level} className="capitalize">
              {level}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {running && <Chip size="sm" color="accent" variant="soft">Live</Chip>}
      </div>

      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-surface-secondary/40 py-2 font-mono text-xs"
      >
        {error ? (
          <p className="px-5 py-4 text-danger">{error}</p>
        ) : lines === undefined ? (
          <Spinner className="mx-auto my-8 block" />
        ) : shown.length === 0 ? (
          <EmptyState className="px-5 py-10 text-center font-sans text-sm text-muted">
            {lines.length === 0
              ? running
                ? 'No logs yet. Lines appear here as the worker writes them with context.log().'
                : 'The worker wrote no logs for this task. Workers add lines with context.log().'
              : 'No lines match.'}
          </EmptyState>
        ) : (
          shown.map((line) => (
            <div key={line.id} className="grid grid-cols-[4.5rem_3.5rem_1fr] gap-2 px-5 py-0.5 hover:bg-default/60">
              <LocalTime value={line.at} timeOnly className="tabular text-muted" />
              <span>
                <Chip size="sm" variant="soft" color={LEVEL_COLOR[line.level]} className="h-4 px-1 text-[10px] uppercase">
                  {line.level}
                </Chip>
              </span>
              <span className="whitespace-pre-wrap break-words">{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
