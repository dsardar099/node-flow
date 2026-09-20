'use client';

import { ArrowRotateLeft, ArrowUpRightFromSquare, ChevronsRight, CirclePlay, CircleStop, Xmark } from '@gravity-ui/icons';
import type { WorkflowTask } from '@node-flow-dev/core';
import {
  AlertDialog,
  Button,
  Checkbox,
  Chip,
  Label,
  ListBox,
  Select,
  Tabs,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { CopyButton } from '../../../components/ui/copy-button';
import { formatDateTime, formatMs, msBetween } from '../../../components/ui/format';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { AgentSteps } from './agent-steps';
import { StatusChip, statusLabel } from '../../../components/ui/status-chip';
import { useTicker } from '../../../components/ui/use-ticker';
import { mutate } from '../../../lib/mutate';
import { TaskLogs } from './task-logs';
import { ResumeDialog } from './resume-dialog';
import { TERMINAL_TASK, TERMINAL_WORKFLOW, type ExecutionDetail, type TaskRun } from './types';

const WIDTH_KEY = 'nf.taskPanel.width';

/**
 * One task, beside whatever the page is showing.
 *
 * Every attempt is reachable. A task that failed twice and then succeeded is
 * shown by its success, but the failures are usually why someone is looking, so
 * they are one choice away rather than gone.
 *
 * Resizable by dragging its edge, remembered per browser: a payload with long
 * keys needs the room, and a diagram with many branches needs it back.
 */
export function TaskPanel({
  namespace,
  execution,
  refName,
  definitionTask,
  mayOperate,
  onClose,
}: {
  namespace: string;
  execution: ExecutionDetail;
  refName: string;
  definitionTask?: WorkflowTask;
  mayOperate: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const attempts = useMemo(
    () =>
      execution.tasks
        .filter((task) => task.refName === refName)
        .sort((a, b) => b.iteration - a.iteration || b.attempt - a.attempt),
    [execution.tasks, refName]
  );
  const [chosenId, setChosenId] = useState<string>();
  const task: TaskRun | undefined = attempts.find((a) => a.id === chosenId) ?? attempts[0];
  const [confirm, setConfirm] = useState<ConfirmAction>();
  const [cascade, setCascade] = useState(false);
  const [resuming, setResuming] = useState(false);

  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return 520;
    try {
      return Number(localStorage.getItem(WIDTH_KEY)) || 520;
    } catch {
      return 520;
    }
  });
  const dragging = useRef(false);

  const startDrag = useCallback((event: React.PointerEvent) => {
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, []);
  const onDrag = useCallback((event: React.PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(Math.max(window.innerWidth - event.clientX, 380), window.innerWidth * 0.7);
    setWidth(next);
  }, []);
  const endDrag = useCallback(() => {
    dragging.current = false;
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      /* storage unavailable */
    }
  }, [width]);

  const run = async (action: string, body: Record<string, unknown>, done: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/executions/${execution.id}/${action}`, { body });
      toast.success(done);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  /**
   * Re-run this one task, reporting what it leaves behind.
   *
   * Separate from `run` because the response matters: without cascade the
   * server names the tasks still holding output from the run being replaced,
   * and dropping that on the floor would make a half-replaced execution look
   * like a clean one.
   */
  const rerunOne = async () => {
    try {
      const result = await mutate<{ staleDownstream: string[] }>(
        `/v1/ns/${namespace}/executions/${execution.id}/rerun-tasks`,
        { body: { taskRefs: [refName], cascade } }
      );

      toast.success(
        result.staleDownstream.length > 0
          ? `Re-running ${refName}. Still stale: ${result.staleDownstream.join(', ')}`
          : `Re-running ${refName}`
      );
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const workflowTerminal = TERMINAL_WORKFLOW.has(execution.status);
  useTicker(Boolean(task?.startedAt && !task.endedAt));

  return (
    // A side panel from `md` up; below that a full-screen sheet, since a
    // 520px panel on a phone pushes its own close button off the screen.
    <aside
      className="fixed inset-0 z-40 flex w-full flex-col bg-surface md:relative md:inset-auto md:z-auto md:w-[var(--task-panel-width)] md:shrink-0 md:border-l md:border-separator md:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]"
      style={{ '--task-panel-width': `${width}px` } as React.CSSProperties}
      aria-label={`Task ${refName}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize task panel"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize hover:bg-accent/30 md:block"
      />

      {/* Header */}
      <div className="border-b border-separator px-5 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Task</p>
            <h2 className="truncate text-lg font-semibold">{refName}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {task && <StatusChip status={task.status} />}
              <Chip size="sm" variant="secondary" className="font-mono text-[11px]">
                {task?.taskType ?? definitionTask?.type}
              </Chip>
              {(task?.taskDefName ?? definitionTask?.name) !== refName && (
                <span className="truncate text-xs text-muted">{task?.taskDefName ?? definitionTask?.name}</span>
              )}
            </div>
          </div>
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Close task panel" onPress={onClose}>
                <Xmark />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Close</Tooltip.Content>
          </Tooltip>
        </div>

        {task && (
          <p className="mt-2 flex items-center gap-1 font-mono text-xs text-muted">
            {task.id}
            <CopyButton value={task.id} label="Copy task id" />
          </p>
        )}

        {task && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {attempts.length > 1 && (
              <Select
                aria-label="Attempt"
                className="w-56"
                value={task.id}
                onChange={(value) => setChosenId(String(value))}
              >
                <Label className="sr-only">Attempt</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {attempts.map((a) => (
                      <ListBox.Item key={a.id} id={a.id} textValue={attemptLabel(a)}>
                        {attemptLabel(a)}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
            {mayOperate && workflowTerminal && (
              <Button size="sm" onPress={() => setConfirm('rerun')}>
                <ArrowRotateLeft />
                Re-run from here
              </Button>
            )}
            {/*
              Re-running one task, as opposed to everything from here onward.
              Offered on a run that has stopped — finished or paused — because
              doing it to a live one races the decider for the frontier.
            */}
            {mayOperate && (workflowTerminal || execution.status === 'PAUSED') && (
              <Button size="sm" variant="secondary" onPress={() => setConfirm('rerun-one')}>
                <ArrowRotateLeft />
                Re-run just this
              </Button>
            )}
            {/*
              Stopping a task an operator has decided is going wrong. Not a
              failure: no retry is spent and no failure workflow runs.
            */}
            {mayOperate && !workflowTerminal && !TERMINAL_TASK.has(task.status) && (
              <Button size="sm" variant="secondary" onPress={() => setConfirm('cancel')}>
                <CircleStop />
                Stop
              </Button>
            )}
            {mayOperate && !workflowTerminal && ((task.taskType === 'WAIT' && task.status === 'IN_PROGRESS') || (task.taskType === 'YIELD' && !TERMINAL_TASK.has(task.status))) && (
              <Button size="sm" onPress={() => setResuming(true)}>
                <CirclePlay />
                Resume
              </Button>
            )}
            {mayOperate && !workflowTerminal && !TERMINAL_TASK.has(task.status) && (
              <Button size="sm" variant="secondary" onPress={() => setConfirm('skip')}>
                <ChevronsRight />
                Skip
              </Button>
            )}
            {task.taskType === 'SIMPLE' && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => router.push(`/taskDef/${encodeURIComponent(task.taskDefName)}`)}
              >
                <ArrowUpRightFromSquare />
                Task definition
              </Button>
            )}
          </div>
        )}
      </div>

      {!task ? (
        <p className="p-6 text-sm text-muted">
          {refName} has not run in this execution — the workflow has not reached it.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-4 divide-x divide-separator border-b border-separator">
            <Metric label="Queue wait">{task.startedAt ? formatMs(msBetween(task.scheduledAt, task.startedAt)) : '—'}</Metric>
            {/* A task the engine settles itself (NOOP, SET_VARIABLE, a cache hit) never
                records a start, but it still took from scheduling to ending. */}
            <Metric label="Duration">
              {task.startedAt
                ? formatMs(msBetween(task.startedAt, task.endedAt))
                : task.endedAt
                  ? formatMs(msBetween(task.scheduledAt, task.endedAt))
                  : '—'}
            </Metric>
            <Metric label="Attempt">{task.attempt + 1}</Metric>
            <Metric label="Worker">
              <span className="block truncate font-mono text-xs" title={task.workerId ?? undefined}>
                {task.workerId ?? '—'}
              </span>
            </Metric>
          </dl>

          <Tabs key={task.id} variant="secondary" className="flex min-h-0 flex-1 flex-col" defaultSelectedKey={task.taskType === 'AGENT' ? 'agent' : 'overview'}>
            <Tabs.ListContainer className="px-3">
              <Tabs.List aria-label="Task details">
                {[...(task.taskType === 'AGENT' ? ['Agent'] : []), 'Overview', 'Input', 'Output', 'Logs', 'JSON', 'Definition'].map((label) => (
                  <Tabs.Tab key={label} id={label.toLowerCase()} className="w-auto flex-none px-3">
                    {label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>

            {task.taskType === 'AGENT' && (
              <Tabs.Panel id="agent" className="min-h-0 flex-1 overflow-y-auto p-5">
                <AgentSteps output={task.output as Record<string, unknown> | undefined} />
              </Tabs.Panel>
            )}
            <Tabs.Panel id="overview" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {task.reasonForIncompletion && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-danger">Reason</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{task.reasonForIncompletion}</pre>
                </div>
              )}
              <Facts
                rows={[
                  ['Status', statusLabel(task.status)],
                  ['Reference', task.refName],
                  ['Task name', task.taskDefName],
                  ['Type', task.taskType],
                  ['Iteration', task.iteration > 0 ? task.iteration : undefined],
                  ['Domain', task.domain],
                  ['Scheduled', formatDateTime(task.scheduledAt)],
                  ['Started', formatDateTime(task.startedAt)],
                  ['Ended', formatDateTime(task.endedAt)],
                ]}
              />
            </Tabs.Panel>
            <Tabs.Panel id="input" className="min-h-0 flex-1 overflow-y-auto p-5">
              <JsonViewer title="Input" value={task.input} filename={`${task.refName}-input`} maxHeight="none" />
            </Tabs.Panel>
            <Tabs.Panel id="output" className="min-h-0 flex-1 overflow-y-auto p-5">
              <JsonViewer
                title="Output"
                value={task.output}
                filename={`${task.refName}-output`}
                maxHeight="none"
                emptyText={TERMINAL_TASK.has(task.status) ? 'This task produced no output.' : 'Produced when the task finishes.'}
              />
            </Tabs.Panel>
            <Tabs.Panel id="logs" className="min-h-0 flex-1 overflow-hidden">
              <TaskLogs namespace={namespace} workflowId={execution.id} task={task} />
            </Tabs.Panel>
            <Tabs.Panel id="json" className="min-h-0 flex-1 overflow-y-auto p-5">
              <JsonViewer title="Task run" value={task} filename={task.id} maxHeight="none" />
            </Tabs.Panel>
            <Tabs.Panel id="definition" className="min-h-0 flex-1 overflow-y-auto p-5">
              <JsonViewer
                title="As defined in the workflow"
                value={definitionTask}
                filename={`${task.refName}-definition`}
                maxHeight="none"
                emptyText="This task is not in the definition version this run used."
              />
            </Tabs.Panel>
          </Tabs>
        </>
      )}

      <ResumeDialog
        namespace={namespace}
        workflowId={execution.id}
        refName={refName}
        isOpen={resuming}
        onOpenChange={setResuming}
        onResumed={() => router.refresh()}
      />

      <AlertDialog.Backdrop isOpen={confirm !== undefined} onOpenChange={(open) => !open && setConfirm(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status={confirm === 'skip' || confirm === 'cancel' ? 'warning' : 'accent'} />
              <AlertDialog.Heading>{CONFIRM_TITLE[confirm ?? 'rerun'](refName)}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">{CONFIRM_BODY[confirm ?? 'rerun']}</p>

              {/*
                Offered rather than assumed. Without it the tasks that consumed
                this one's output keep results derived from a run that no longer
                exists — sometimes exactly what you want after fixing a worker,
                sometimes a silently wrong execution. The API reports which
                tasks are left stale; this says so before the fact.
              */}
              {confirm === 'rerun-one' && (
                <Checkbox isSelected={cascade} onChange={setCascade}>
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="text-sm">Re-run everything that depended on it too</span>
                  </Checkbox.Content>
                </Checkbox>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button
                slot="close"
                onPress={() => {
                  if (confirm === 'rerun') {
                    return run('rerun', { fromTaskRef: refName }, `Re-running from ${refName}`);
                  }
                  if (confirm === 'skip') {
                    return run('skip-task', { taskRef: refName }, `Skipped ${refName}`);
                  }
                  if (confirm === 'cancel') {
                    return run(
                      'tasks/cancel',
                      { taskRef: refName },
                      `Stopped ${refName}; the workflow is paused`
                    );
                  }
                  return rerunOne();
                }}
              >
                {CONFIRM_ACTION[confirm ?? 'rerun']}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </aside>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-3 text-center">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const present = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  return (
    <dl className="divide-y divide-separator rounded-xl border border-separator">
      {present.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5 text-sm">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function attemptLabel(task: TaskRun): string {
  const iteration = task.iteration > 0 ? `Iteration ${task.iteration} · ` : '';
  return `${iteration}Attempt ${task.attempt + 1} · ${statusLabel(task.status)}`;
}

/** The confirmations this panel can raise, and what each one says. */
type ConfirmAction = 'rerun' | 'rerun-one' | 'skip' | 'cancel';

const CONFIRM_TITLE: Record<ConfirmAction, (ref: string) => string> = {
  rerun: (ref) => `Re-run from ${ref}?`,
  'rerun-one': (ref) => `Re-run ${ref}?`,
  skip: (ref) => `Skip ${ref}?`,
  cancel: (ref) => `Stop ${ref}?`,
};

const CONFIRM_BODY: Record<ConfirmAction, string> = {
  rerun:
    'Results from this task onward are discarded and the workflow runs again from here. Earlier tasks keep their results.',
  'rerun-one':
    'This task runs again with the input it had before. Everything else keeps its result — including tasks that read this one’s output, unless you also re-run them below.',
  skip: 'The task is marked skipped without running, and the workflow continues past it.',
  cancel:
    'The task is stopped and the workflow pauses. It is not marked failed, so no retry is spent and no failure workflow runs. The worker is not stopped — its result is refused when it reports.',
};

const CONFIRM_ACTION: Record<ConfirmAction, string> = {
  rerun: 'Re-run',
  'rerun-one': 'Re-run',
  skip: 'Skip',
  cancel: 'Stop',
};
