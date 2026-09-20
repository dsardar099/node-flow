'use client';

import {
  ArrowRotateRight,
  ArrowUpRightFromSquare,
  ChevronDown,
  CirclePause,
  CirclePlay,
  CircleStop,
  ArrowRotateLeft,
  ClockArrowRotateLeft,
} from '@gravity-ui/icons';
import type { WorkflowTask } from '@node-flow-dev/core';
import {
  Alert,
  AlertDialog,
  Button,
  Chip,
  Dropdown,
  EmptyState,
  Description,
  Input,
  Label,
  TextField,
  Tabs,
  Tooltip,
  toast,
} from '@heroui/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { WorkflowGraph } from '../../../components/dag/workflow-graph';
import { TimeTravelBar, useTimeTravel } from './time-travel';
import { ReplayDialog } from './replay-dialog';
import { PageHeader } from '../../../components/shell/page-header';
import { CopyButton } from '../../../components/ui/copy-button';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { StatusChip } from '../../../components/ui/status-chip';
import type { Definition } from '../../../lib/dag/edit';
import { pathOfRef } from '../../../lib/dag/edit';
import { getIn, type Path } from '../../../lib/dag/path';
import { latestStatusByRef } from '../../../lib/dag/status';
import { mutate } from '../../../lib/mutate';
import { EventsTab } from './events-tab';
import { MessagesTab } from './messages-tab';
import { LiveUpdates } from './live';
import { OverviewStrip } from './overview-strip';
import { TaskPanel } from './task-panel';
import { TasksTab } from './tasks-tab';
import { TimelineTab } from './timeline-tab';
import { FAILED_TASK, TERMINAL_WORKFLOW, type ExecutionDetail } from './types';
import { triggerClass } from '../../../components/ui/dropdown-trigger';

const TABS = [
  { id: 'diagram', label: 'Diagram' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'io', label: 'Input & output' },
  { id: 'variables', label: 'Variables' },
  { id: 'events', label: 'Events' },
  { id: 'messages', label: 'Messages' },
  { id: 'json', label: 'JSON' },
] as const;

/**
 * An execution: what it is, how far it got, and — through the task panel —
 * exactly what each task received, produced and logged.
 *
 * The selected task and the tab live in the URL, so "look at this task on the
 * timeline" is a link someone can send. The task panel opens beside whichever
 * tab is showing, rather than forcing a jump back to the diagram.
 */
export function ExecutionView({
  namespace,
  execution,
  definition,
  failureRun,
  mayOperate,
  mayStart,
}: {
  namespace: string;
  execution: ExecutionDetail;
  definition?: Definition;
  /** The failure workflow this run started, if it failed and has one. */
  failureRun?: { workflowId: string; defName: string; status: string };
  mayOperate: boolean;
  mayStart: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : 'diagram';
  const selectedRef = params.get('task') ?? undefined;

  const setQuery = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const openTask = (ref: string | undefined) => setQuery({ task: ref });

  const liveStatuses = useMemo(() => latestStatusByRef(execution.tasks), [execution.tasks]);
  const travel = useTimeTravel(execution.tasks, execution.startedAt, execution.endedAt);
  const statuses = travel.statuses ?? liveStatuses;
  // The tab only where it can matter: a workflow with a pull, or a run that already received messages.
  const usesMessages = useMemo(
    () => execution.tasks.some((t) => t.taskType === 'PULL_WORKFLOW_MESSAGES') || JSON.stringify(definition ?? {}).includes('PULL_WORKFLOW_MESSAGES'),
    [execution.tasks, definition]
  );
  const terminal = TERMINAL_WORKFLOW.has(execution.status);

  const failedTask = useMemo(
    () =>
      [...execution.tasks]
        .filter((task) => FAILED_TASK.has(task.status))
        .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0],
    [execution.tasks]
  );

  const selectedPath: Path | undefined =
    definition && selectedRef ? pathOfRef(definition, selectedRef) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="pb-4"
        breadcrumbs={[{ label: 'Executions', href: '/executions' }, { label: execution.defName }]}
        title={execution.defName}
        badge={
          <>
            <Chip size="sm" variant="secondary">
              v{execution.defVersion}
            </Chip>
            <StatusChip status={execution.awaitingAdmission && execution.status === 'RUNNING' ? 'QUEUED' : execution.status} size="md" />
            <LiveUpdates namespace={namespace} workflowId={execution.id} terminal={terminal} />
          </>
        }
        description={
          <span className="flex items-center gap-1 font-mono text-xs">
            {execution.id}
            <CopyButton value={execution.id} label="Copy execution id" />
          </span>
        }
        actions={
          <>
            {failureRun && (
              <Tooltip delay={300}>
                <Tooltip.Trigger>
                  <Button variant="secondary" onPress={() => router.push(`/execution/${failureRun.workflowId}`)}>
                    <ArrowUpRightFromSquare />
                    Failure workflow
                    <StatusChip status={failureRun.status} />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>{failureRun.defName}, started because this run failed</Tooltip.Content>
              </Tooltip>
            )}
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" aria-label="Refresh" onPress={() => router.refresh()}>
                  <ArrowRotateRight />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh</Tooltip.Content>
            </Tooltip>
            <Button
              variant="secondary"
              onPress={() =>
                router.push(`/workflowDef/${encodeURIComponent(execution.defName)}?version=${execution.defVersion}`)
              }
            >
              <ArrowUpRightFromSquare />
              Definition
            </Button>
            {(mayOperate || mayStart) && (
              <ActionsMenu namespace={namespace} execution={execution} mayOperate={mayOperate} mayStart={mayStart} />
            )}
          </>
        }
      />

      <div className="space-y-3 px-4 md:px-8 pb-4">
        <OverviewStrip execution={execution} />

        {execution.awaitingAdmission && execution.status === 'RUNNING' && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Queued behind a rate limit</Alert.Title>
              <Alert.Description>
                Other executions of {execution.defName} with key{' '}
                <span className="font-mono">{execution.rateLimitKey}</span> are using every slot. This one starts
                automatically, in arrival order, as soon as one finishes.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {(execution.reasonForIncompletion || failedTask) && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {failedTask ? `${failedTask.refName} failed` : `Workflow ${execution.status.toLowerCase().replace('_', ' ')}`}
              </Alert.Title>
              <Alert.Description>
                {failedTask?.reasonForIncompletion ?? execution.reasonForIncompletion ?? 'No reason was recorded.'}
              </Alert.Description>
            </Alert.Content>
            {failedTask && (
              <Button size="sm" variant="danger" onPress={() => openTask(failedTask.refName)}>
                Inspect task
              </Button>
            )}
          </Alert>
        )}
      </div>

      <div className="flex min-h-0 flex-1 border-t border-separator">
        <Tabs
          variant="secondary"
          selectedKey={tab}
          onSelectionChange={(key) => setQuery({ tab: key === 'diagram' ? undefined : String(key) })}
          className="flex min-w-0 flex-1 flex-col"
        >
          <Tabs.ListContainer className="px-6">
            <Tabs.List aria-label="Execution views">
              {TABS.filter((t) => t.id !== 'messages' || usesMessages).map((t) => (
                <Tabs.Tab key={t.id} id={t.id} className="w-auto flex-none px-4">
                  {t.label}
                  {t.id === 'tasks' && (
                    <Chip size="sm" variant="secondary" className="ml-1.5">
                      {execution.tasks.length}
                    </Chip>
                  )}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="diagram" className="relative min-h-0 flex-1">
            {definition ? (
              <>
              <WorkflowGraph
                definition={definition}
                statuses={statuses}
                selected={selectedPath}
                onSelect={(path) =>
                  openTask(path ? (getIn(definition, path) as WorkflowTask).taskReferenceName : undefined)
                }
                height="100%"
              />
              <TimeTravelBar tasks={execution.tasks} moments={travel.moments} index={travel.index} setIndex={travel.setIndex} onFocus={openTask} />
              </>
            ) : (
              <EmptyState className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
                The definition this run used can no longer be read, so there is no diagram. Every task is still on
                the Tasks tab.
              </EmptyState>
            )}
          </Tabs.Panel>

          <Tabs.Panel id="tasks" className="min-h-0 flex-1 overflow-y-auto p-6">
            <TasksTab
              tasks={execution.tasks}
              truncated={execution.tasksTruncated}
              selectedRef={selectedRef}
              onOpen={openTask}
            />
          </Tabs.Panel>

          <Tabs.Panel id="timeline" className="min-h-0 flex-1 overflow-y-auto p-6">
            <TimelineTab execution={execution} selectedRef={selectedRef} onOpen={openTask} />
          </Tabs.Panel>

          <Tabs.Panel id="io" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-4 xl:grid-cols-2">
              <JsonViewer title="Input" value={execution.input} filename={`${execution.id}-input`} />
              <JsonViewer
                title="Output"
                value={execution.output}
                filename={`${execution.id}-output`}
                emptyText={terminal ? 'The workflow produced no output.' : 'Produced when the workflow finishes.'}
              />
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="variables" className="min-h-0 flex-1 overflow-y-auto p-6">
            <JsonViewer
              title="Variables"
              value={execution.variables}
              filename={`${execution.id}-variables`}
              emptyText="No variables have been set."
            />
          </Tabs.Panel>

          <Tabs.Panel id="events" className="min-h-0 flex-1 overflow-y-auto p-6">
            <EventsTab namespace={namespace} execution={execution} onOpenTask={openTask} />
          </Tabs.Panel>

          {usesMessages && (
            <Tabs.Panel id="messages" className="min-h-0 flex-1 overflow-y-auto p-6">
              <MessagesTab namespace={namespace} execution={execution} mayOperate={mayOperate} onOpenTask={openTask} />
            </Tabs.Panel>
          )}

          <Tabs.Panel id="json" className="min-h-0 flex-1 overflow-y-auto p-6">
            <JsonViewer title="Execution" value={execution} filename={execution.id} maxHeight="none" />
          </Tabs.Panel>
        </Tabs>

        {selectedRef && (
          <TaskPanel
            key={selectedRef}
            namespace={namespace}
            execution={execution}
            refName={selectedRef}
            definitionTask={selectedPath && definition ? (getIn(definition, selectedPath) as WorkflowTask) : undefined}
            mayOperate={mayOperate}
            onClose={() => openTask(undefined)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- actions

function ActionsMenu({
  namespace,
  execution,
  mayOperate,
  mayStart,
}: {
  namespace: string;
  execution: ExecutionDetail;
  mayOperate: boolean;
  mayStart: boolean;
}) {
  const router = useRouter();
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [terminateReason, setTerminateReason] = useState('');
  const terminal = TERMINAL_WORKFLOW.has(execution.status);

  const act = async (action: string, verb: string, body: unknown = {}) => {
    try {
      await mutate(`/v1/ns/${namespace}/executions/${execution.id}/${action}`, { body });
      toast.success(verb);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  // A fresh run with the same input. Not the same execution: the old one stays
  // as the record of what happened.
  const runAgain = async () => {
    try {
      // Copied on the server: the input this page holds has masked fields
      // replaced, and must not become the next run's input.
      const started = await mutate<{ workflowId: string }>(`/v1/ns/${namespace}/executions/${execution.id}/run-again`);
      toast.success('Started a new run');
      router.push(`/execution/${started.workflowId}`);
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const items = [
    mayOperate && execution.status === 'RUNNING' && { id: 'pause', label: 'Pause', icon: CirclePause, description: 'Stop scheduling new tasks' },
    mayOperate && execution.status === 'PAUSED' && { id: 'resume', label: 'Resume', icon: CirclePlay, description: 'Continue scheduling tasks' },
    mayOperate &&
      ['FAILED', 'TIMED_OUT', 'TERMINATED'].includes(execution.status) && {
        id: 'retry',
        label: 'Retry failed tasks',
        icon: ArrowRotateLeft,
        description: 'Successful tasks keep their results',
      },
    mayStart && { id: 'run-again', label: 'Run again', icon: CirclePlay, description: 'A new execution with the same input' },
    { id: 'replay', label: 'Replay…', icon: ClockArrowRotateLeft, description: 'Run it again in memory, against any version' },
    mayOperate && !terminal && { id: 'terminate', label: 'Terminate', icon: CircleStop, description: 'Stop the workflow now', danger: true },
  ].filter(Boolean) as { id: string; label: string; icon: typeof CirclePlay; description: string; danger?: boolean }[];

  if (items.length === 0) return null;

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger className={triggerClass()}>
          Actions
          <ChevronDown />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="min-w-64">
          <Dropdown.Menu
            aria-label="Execution actions"
            onAction={(key) => {
              if (key === 'terminate') setConfirmTerminate(true);
              else if (key === 'replay') setReplaying(true);
              else if (key === 'run-again') void runAgain();
              else if (key === 'pause') void act('pause', 'Paused');
              else if (key === 'resume') void act('resume', 'Resumed');
              else if (key === 'retry') void act('retry', 'Retrying failed tasks');
            }}
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Dropdown.Item key={item.id} id={item.id} textValue={item.label} variant={item.danger ? 'danger' : undefined}>
                  <Icon />
                  <div className="flex flex-col">
                    <Label>{item.label}</Label>
                    <span className="text-xs text-muted">{item.description}</span>
                  </div>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ReplayDialog
        namespace={namespace}
        workflowId={execution.id}
        defName={execution.defName}
        defVersion={execution.defVersion}
        isOpen={replaying}
        onOpenChange={setReplaying}
      />

      <AlertDialog.Backdrop isOpen={confirmTerminate} onOpenChange={setConfirmTerminate}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Terminate this execution?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                {execution.defName} stops immediately. Tasks already running on workers are not interrupted, but their
                results will be refused.
              </p>
              <TextField className="mt-4" value={terminateReason} onChange={setTerminateReason}>
                <Label>Reason</Label>
                <Input placeholder="Why this is being stopped" />
                <Description>Recorded on the execution and in its history.</Description>
              </TextField>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() =>
                  act('terminate', 'Terminated', { reason: terminateReason.trim() || 'terminated from the dashboard' })
                }>
                Terminate
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
