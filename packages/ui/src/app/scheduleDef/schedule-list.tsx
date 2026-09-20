'use client';

import { Calendar, CircleExclamation, ClockArrowRotateLeft, Ellipsis, PencilToSquare, Plus, Pulse, TrashBin } from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Dropdown,
  EmptyState,
  Label,
  Link,
  SearchField,
  Switch,
  Table,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { LocalTime } from '../../components/ui/local-time';
import { mutate } from '../../lib/mutate';
import { ScheduleDrawer } from './schedule-drawer';
import { ScheduleHistory } from './schedule-history';
import { triggerClass } from '../../components/ui/dropdown-trigger';

export interface Schedule {
  name: string;
  description?: string | null;
  cron: string;
  timezone: string;
  workflow: { name: string; version: number | null };
  input?: Record<string, unknown>;
  priority?: number;
  paused: boolean;
  startAt?: string | null;
  endAt?: string | null;
  overlapPolicy?: 'ALLOW' | 'SKIP';
  catchupPolicy?: 'SKIP' | 'FIRE_ONE' | 'FIRE_ALL';
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastWorkflowId: string | null;
  runCount: number;
  lastError: string | null;
}

/** Relative time in either direction: "in 3h", "5m ago". */
function relative(at: string | null): string {
  if (!at) return '';
  const ms = new Date(at).getTime() - Date.now();
  const abs = Math.abs(ms);
  const unit =
    abs < 60_000
      ? `${Math.max(1, Math.round(abs / 1000))}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function ScheduleList({
  namespace,
  schedules,
  workflowNames,
  mayWrite,
}: {
  namespace: string;
  schedules: Schedule[];
  workflowNames: string[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Schedule | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const [history, setHistory] = useState<Schedule>();
  const [toggling, setToggling] = useState<string>();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return schedules;
    return schedules.filter((s) =>
      [s.name, s.description ?? '', s.workflow.name, s.cron].some((field) => field.toLowerCase().includes(needle))
    );
  }, [schedules, query]);

  const failing = schedules.filter((s) => s.lastError).length;
  const paused = schedules.filter((s) => s.paused).length;

  const togglePaused = async (schedule: Schedule, active: boolean) => {
    setToggling(schedule.name);
    try {
      await mutate(`/v1/ns/${namespace}/schedules/${encodeURIComponent(schedule.name)}/${active ? 'resume' : 'pause'}`);
      toast.success(active ? `Resumed ${schedule.name}` : `Paused ${schedule.name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setToggling(undefined);
    }
  };

  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/schedules/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Start workflows on a cron timetable. Leased in the database, so any number of replicas fire each run exactly once."
        actions={
          mayWrite && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New schedule
            </Button>
          )
        }
      />

      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Active" value={schedules.length - paused} />
          <Stat label="Paused" value={paused} />
          <Stat label="Failing" value={failing} tone={failing > 0 ? 'danger' : undefined} />
        </div>

        <SearchField aria-label="Search schedules" value={query} onChange={setQuery} className="max-w-lg">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search by name, workflow or cron" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Schedules"
                className="min-w-[960px]"
                onRowAction={(key) => {
                  const schedule = schedules.find((s) => s.name === key);
                  if (schedule) setEditing(schedule);
                }}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Schedule</Table.Column>
                  <Table.Column>Workflow</Table.Column>
                  <Table.Column>Timetable</Table.Column>
                  <Table.Column>Next run</Table.Column>
                  <Table.Column>Last run</Table.Column>
                  <Table.Column className="w-32">Active</Table.Column>
                  <Table.Column className="w-12">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Calendar className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {schedules.length === 0 ? 'No schedules yet' : 'Nothing matches that search'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {schedules.length === 0
                          ? 'Run a workflow every hour, every weekday at 9, or on any cron expression — in any timezone.'
                          : 'Try a shorter search.'}
                      </span>
                      {schedules.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => setEditing('new')}>
                          <Plus />
                          New schedule
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((schedule) => (
                    <Table.Row key={schedule.name} id={schedule.name} className="cursor-pointer">
                      <Table.Cell>
                        <div className="flex items-start gap-3 py-1">
                          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                            <Calendar className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium">{schedule.name}</p>
                            {schedule.description && (
                              <p className="line-clamp-1 max-w-xs text-sm text-muted">{schedule.description}</p>
                            )}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-sm">{schedule.workflow.name}</span>{' '}
                        <Chip size="sm" variant="secondary">
                          {schedule.workflow.version ? `v${schedule.workflow.version}` : 'latest'}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <code className="rounded-md bg-default px-1.5 py-0.5 font-mono text-xs">{schedule.cron}</code>
                        <span className="block text-xs text-muted">{schedule.timezone}</span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {schedule.paused ? (
                          <span className="text-sm text-muted">Paused</span>
                        ) : schedule.nextRunAt ? (
                          <>
                            {/* Which side of "now" the next run falls on is
                                itself clock-dependent, so the whole phrase is. */}
                            <span className="block text-sm" suppressHydrationWarning>
                              {new Date(schedule.nextRunAt).getTime() <= Date.now() ? 'Due now' : relative(schedule.nextRunAt)}
                            </span>
                            <LocalTime value={schedule.nextRunAt} className="tabular block text-xs text-muted" />
                          </>
                        ) : (
                          <span className="text-sm text-muted">Never again</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {schedule.lastError ? (
                          <>
                          <Tooltip delay={200}>
                            <Tooltip.Trigger>
                              <Chip size="sm" color="danger" variant="soft">
                                <CircleExclamation className="size-3" />
                                Failed to start
                              </Chip>
                            </Tooltip.Trigger>
                            <Tooltip.Content className="max-w-sm font-mono text-xs">{schedule.lastError}</Tooltip.Content>
                          </Tooltip>
                          <HistoryLink onPress={() => setHistory(schedule)}>history</HistoryLink>
                          </>
                        ) : schedule.lastRunAt ? (
                          <>
                            {/* `relative` measures against `Date.now()`, so the
                                server and the browser disagree. */}
                            {schedule.lastWorkflowId ? (
                              <Link href={`/execution/${schedule.lastWorkflowId}`} className="block text-sm">
                                <span suppressHydrationWarning>{relative(schedule.lastRunAt)}</span>
                              </Link>
                            ) : (
                              <span className="block text-sm" suppressHydrationWarning>
                                {relative(schedule.lastRunAt)}
                              </span>
                            )}
                            <HistoryLink onPress={() => setHistory(schedule)}>
                              {schedule.runCount} run{schedule.runCount === 1 ? '' : 's'} · history
                            </HistoryLink>
                          </>
                        ) : (
                          <span className="text-sm text-muted">Not yet</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Switch
                          aria-label={schedule.paused ? `Resume ${schedule.name}` : `Pause ${schedule.name}`}
                          isSelected={!schedule.paused}
                          isDisabled={!mayWrite || toggling === schedule.name}
                          onChange={(active) => togglePaused(schedule, active)}
                        >
                          <Switch.Content>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                          </Switch.Content>
                        </Switch>
                      </Table.Cell>
                      <Table.Cell>
                        <Dropdown>
                          <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${schedule.name}`}>
                              <Ellipsis />
                          </Dropdown.Trigger>
                          <Dropdown.Popover placement="bottom end" className="min-w-52">
                            <Dropdown.Menu
                              aria-label="Schedule actions"
                              onAction={(key) => {
                                if (key === 'edit') setEditing(schedule);
                                if (key === 'history') setHistory(schedule);
                                if (key === 'executions')
                                  router.push(`/executions?workflowType=${encodeURIComponent(schedule.workflow.name)}`);
                                if (key === 'delete') setDeleting(schedule.name);
                              }}
                            >
                              <Dropdown.Item id="edit" textValue="Edit">
                                <PencilToSquare />
                                <Label>{mayWrite ? 'Edit' : 'View'}</Label>
                              </Dropdown.Item>
                              <Dropdown.Item id="history" textValue="Run history">
                                <ClockArrowRotateLeft />
                                <Label>Run history</Label>
                              </Dropdown.Item>
                              <Dropdown.Item id="executions" textValue="View executions">
                                <Pulse />
                                <Label>View executions</Label>
                              </Dropdown.Item>
                              {mayWrite ? (
                                <Dropdown.Item id="delete" textValue="Delete" variant="danger">
                                  <TrashBin />
                                  <Label>Delete</Label>
                                </Dropdown.Item>
                              ) : null}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <ScheduleHistory namespace={namespace} schedule={history} onOpenChange={(open) => !open && setHistory(undefined)} />

      <ScheduleDrawer
        namespace={namespace}
        workflowNames={workflowNames}
        schedule={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        readOnly={!mayWrite}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                It stops firing immediately. Executions it already started are unaffected. To stop it for now, pause it
                instead — that keeps its settings and history.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && remove(deleting)}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
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

/**
 * A text-sized press target inside a table row. A plain `<button>` let the press
 * reach the row too, which opened the edit drawer on top of the history.
 */
function HistoryLink({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onPress={onPress}
      className="block h-auto min-h-0 rounded-none bg-transparent p-0 text-xs font-normal text-muted hover:bg-transparent hover:text-accent hover:underline"
    >
      {children}
    </Button>
  );
}
