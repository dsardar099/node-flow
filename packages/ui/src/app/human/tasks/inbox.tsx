'use client';

import { ArrowUpRightFromSquare, CircleCheck, Clock, Person, PersonPlus, Persons } from '@gravity-ui/icons';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  Label,
  Link,
  Tabs,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { formatRelative } from '../../../components/ui/format';
import { LocalTime } from '../../../components/ui/local-time';
import {
  SchemaForm,
  defaultsFor,
  isRenderableSchema,
  missingRequired,
} from '../../../components/forms/schema-form';
import { mutate } from '../../../lib/mutate';
import { AllTasks } from './all-tasks';
import { Ago } from '../../../components/ui/ago';

export interface HumanTask {
  id: string;
  workflowId: string;
  taskRef: string;
  title: string;
  description: string | null;
  form: Record<string, unknown> | null;
  assigneeId: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  assignments?: { kind: 'user' | 'group'; id: string; label: string; slaMinutes: number }[] | null;
  assignmentIndex?: number;
  assignedAt?: string;
  completionStrategy?: string;
  skippedReason?: string | null;
  assigneeGroupId?: string | null;
  autoClaim?: boolean;
  triggers?: { on: string; workflow: string; version?: number }[] | null;
}

type View = 'open' | 'mine' | 'done' | 'all';

/**
 * Work waiting on a person, as an inbox: the list on the left, the task on the
 * right, and the answer given through a form rather than hand-written JSON.
 *
 * Claim and respond stay separate actions because they are separate decisions
 * in the engine: claiming says "I am doing this", which is what stops two
 * people working the same approval.
 */
export function Inbox({
  namespace,
  userId,
  tasks,
  mayOperate,
  mayOversee,
}: {
  namespace: string;
  userId: string;
  tasks: HumanTask[];
  mayOperate: boolean;
  /** May see every task in the namespace, not only their own. */
  mayOversee: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const lists = useMemo(
    () => ({
      // Held work first — it is what this person already committed to.
      open: [
        ...tasks.filter((t) => !t.completedAt && t.claimedBy === userId),
        ...tasks.filter((t) => !t.completedAt && !t.claimedBy),
      ],
      mine: tasks.filter((t) => !t.completedAt && (t.claimedBy === userId || t.assigneeId === userId)),
      done: tasks.filter((t) => t.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
      all: [] as HumanTask[],
    }),
    [tasks, userId]
  );

  const requested = params.get('view') ?? '';
  const view = (['open', 'mine', 'done', ...(mayOversee ? ['all'] : [])].includes(requested) ? requested : 'open') as View;
  const shown = lists[view];
  const selectedId = params.get('task') ?? shown[0]?.id;
  const selected = tasks.find((t) => t.id === selectedId);

  const navigate = (next: { view?: View; task?: string }) => {
    const query = new URLSearchParams(params.toString());
    if (next.view) {
      query.set('view', next.view);
      query.delete('task');
    }
    if (next.task) query.set('task', next.task);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const overdue = lists.open.filter((t) => t.dueAt && new Date(t.dueAt) < new Date()).length;

  return (
    <>
      <PageHeader
        title="Human tasks"
        description="Approvals and decisions a workflow is waiting on. Claim one to work on it; the workflow continues when you respond."
        badge={
          overdue > 0 ? (
            <Chip color="danger" variant="soft" size="sm">
              {overdue} overdue
            </Chip>
          ) : undefined
        }
      />

      <div className="px-4 md:px-8 pb-10">
        <Tabs selectedKey={view} onSelectionChange={(key) => navigate({ view: key as View })}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Inbox" className="w-auto">
              {(
                [
                  { id: 'open', label: 'Open' },
                  { id: 'mine', label: 'Mine' },
                  { id: 'done', label: 'Completed' },
                ] as const
              ).map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id} className="w-auto flex-none px-4">
                  {tab.label}
                  <Chip size="sm" variant="soft" className="ml-2">
                    {lists[tab.id].length}
                  </Chip>
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
              {mayOversee && (
                <Tabs.Tab id="all" className="w-auto flex-none px-4">
                  <Persons className="mr-1.5 size-3.5" />
                  All tasks
                  <Tabs.Indicator />
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        {view === 'all' ? (
          <AllTasks
            namespace={namespace}
            userId={userId}
            renderDetail={(task, people, onChanged) => (
              <TaskDetail
                key={task.id}
                namespace={namespace}
                task={task}
                userId={userId}
                mayOperate={mayOperate}
                people={people}
                onChanged={onChanged}
              />
            )}
          />
        ) : shown.length === 0 ? (
          <Card className="mt-4">
            <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <CircleCheck className="size-6" />
              </span>
              <span className="text-sm font-medium">
                {view === 'done' ? 'Nothing completed yet' : 'All clear'}
              </span>
              <span className="max-w-sm text-sm text-muted">
                {view === 'done'
                  ? 'Tasks you and your teams finish show up here.'
                  : 'Nothing is waiting on you. A HUMAN task in a workflow lands here when it is reached.'}
              </span>
            </EmptyState>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <Card className="p-2">
              <ul className="space-y-1" aria-label="Tasks">
                {shown.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ task: task.id })}
                      className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                        task.id === selected?.id ? 'bg-accent-soft' : 'hover:bg-default'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                        <TaskState task={task} userId={userId} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <Clock className="size-3" />
                        {/* Clock-dependent, like <Ago>, but phrased into a sentence. */}
                        <span suppressHydrationWarning>
                          {task.completedAt
                            ? `done ${formatRelative(task.completedAt)}`
                            : `waiting ${formatRelative(task.createdAt).replace(' ago', '')}`}
                        </span>
                        {task.dueAt && !task.completedAt && (
                          <span className={new Date(task.dueAt) < new Date() ? 'text-danger' : ''}>
                            · due <LocalTime value={task.dueAt} />
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {selected && (
              <TaskDetail key={selected.id} namespace={namespace} task={selected} userId={userId} mayOperate={mayOperate} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function TaskState({ task, userId }: { task: HumanTask; userId: string }) {
  if (task.completedAt) return <Chip size="sm" variant="soft" color="success">Done</Chip>;
  if (task.claimedBy === userId) return <Chip size="sm" variant="soft" color="accent">Yours</Chip>;
  if (task.claimedBy) return <Chip size="sm" variant="soft">Claimed</Chip>;
  return <Chip size="sm" variant="secondary">Open</Chip>;
}

function TaskDetail({
  namespace,
  task,
  userId,
  mayOperate,
  people,
  onChanged,
}: {
  namespace: string;
  task: HumanTask;
  userId: string;
  mayOperate: boolean;
  /** Emails and group names by id, when the list knows them. */
  people?: Record<string, string>;
  /** Called after an action, for lists that are not server-rendered. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const nameOf = (id: string | null) => (id && people?.[id]) || undefined;
  const schema = isRenderableSchema(task.form) ? task.form : undefined;
  const [values, setValues] = useState<Record<string, unknown>>(() => (schema ? defaultsFor(schema) : {}));
  const [raw, setRaw] = useState('{\n  "approved": true\n}');
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (schema) setValues(defaultsFor(schema));
    // Reset only when the task changes; the component is keyed on it anyway.
  }, [task.id]);

  const held = task.claimedBy === userId;
  const done = Boolean(task.completedAt);
  const overdue = !done && task.dueAt && new Date(task.dueAt) < new Date();

  const act = async (action: 'claim' | 'release' | 'complete', body?: unknown) => {
    setBusy(action);
    try {
      await mutate(`/v1/ns/${namespace}/human-tasks/${task.id}/${action}`, { body });
      toast.success(
        action === 'claim' ? 'Claimed — it is yours to work on' : action === 'release' ? 'Released back to the pool' : 'Response sent; the workflow continues'
      );
      onChanged?.();
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const respond = () => {
    if (schema) {
      const missing = missingRequired(schema, values);
      if (missing.length > 0) {
        toast.danger(`Fill in: ${missing.join(', ')}`);
        return;
      }
      void act('complete', { output: values });
      return;
    }
    try {
      void act('complete', { output: JSON.parse(raw) });
    } catch {
      toast.danger('The response is not valid JSON');
    }
  };

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title className="text-lg">{task.title}</Card.Title>
          {task.description && <Card.Description className="mt-1 whitespace-pre-wrap">{task.description}</Card.Description>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>Waiting since <LocalTime value={task.createdAt} /></span>
            {task.dueAt && <span className={overdue ? 'text-danger' : ''}>Due <LocalTime value={task.dueAt} /></span>}
            <Link href={`/execution/${task.workflowId}?task=${encodeURIComponent(task.taskRef)}`} className="text-xs">
              Open execution
              <ArrowUpRightFromSquare className="ml-1 inline size-3" />
            </Link>
          </div>
        </div>
        {!done && (
          <div className="flex gap-2">
            {/* Not offered on work assigned to someone else: the server refuses it. */}
            {!task.claimedBy && (!task.assigneeId || task.assigneeId === userId) && (
              <Button onPress={() => act('claim')} isPending={busy === 'claim'}>
                <PersonPlus />
                Claim
              </Button>
            )}
            {held && (
              <Button variant="secondary" onPress={() => act('release')} isPending={busy === 'release'}>
                Release
              </Button>
            )}
          </div>
        )}
      </Card.Header>

      <Card.Content className="space-y-5">
        {task.assignments && task.assignments.length > 0 && <AssignmentChain task={task} />}
        {(task.autoClaim || (task.triggers?.length ?? 0) > 0) && <Automation task={task} />}
        {mayOperate && !done && <OperatorActions namespace={namespace} task={task} onChanged={onChanged} />}
        {done ? (
          <Alert status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {task.skippedReason ? 'Skipped' : 'Completed'} <Ago value={task.completedAt} />
              </Alert.Title>
              <Alert.Description>
                {task.skippedReason
                  ? `Skipped by an operator: ${task.skippedReason}`
                  : task.completedBy === userId
                    ? 'You responded to this task.'
                    : nameOf(task.completedBy)
                      ? `${nameOf(task.completedBy)} responded.`
                      : 'Someone on your team responded.'}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : task.claimedBy && !held ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{nameOf(task.claimedBy) ? `${nameOf(task.claimedBy)} is working on this` : 'Someone else is working on this'}</Alert.Title>
              <Alert.Description>Claimed <Ago value={task.claimedAt} />. It returns to the pool if they release it.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : !held ? (
          <div className="flex items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3 text-sm text-muted">
            <Avatar size="sm">
              <Avatar.Fallback>
                <Person className="size-4" />
              </Avatar.Fallback>
            </Avatar>
            Claim this task to respond. Claiming tells everyone else you have it.
          </div>
        ) : null}

        {!done && (
          <section>
            <p className="mb-3 text-sm font-medium">Your response</p>
            {schema ? (
              <SchemaForm schema={schema} values={values} onChange={setValues} isDisabled={!held} />
            ) : (
              <>
                {task.form && (
                  <div className="mb-3">
                    <JsonViewer title="Expected shape" value={task.form} maxHeight="12rem" />
                  </div>
                )}
                <TextField value={raw} onChange={setRaw} isDisabled={!held}>
                  <Label>Response JSON</Label>
                  <TextArea rows={6} spellCheck={false} className="font-mono text-xs" />
                </TextField>
              </>
            )}
            {held && (
              <div className="mt-5 flex justify-end">
                <Button onPress={respond} isPending={busy === 'complete'}>
                  <CircleCheck />
                  Submit response
                </Button>
              </div>
            )}
          </section>
        )}
      </Card.Content>
    </Card>
  );
}

/** Who owns the task now, who is next, and when it moves on. */
function AssignmentChain({ task }: { task: HumanTask }) {
  const chain = task.assignments ?? [];
  const index = task.assignmentIndex ?? 0;
  const current = chain[index];
  const deadline =
    current && current.slaMinutes > 0 && task.assignedAt && !task.claimedBy
      ? new Date(new Date(task.assignedAt).getTime() + current.slaMinutes * 60_000)
      : undefined;
  const minutesLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 60_000) : undefined;

  return (
    <div className="rounded-xl border border-separator p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">Assignment chain</p>
        {minutesLeft !== undefined && (
          <Chip size="sm" variant="soft" color={minutesLeft <= 5 ? 'warning' : 'default'}>
            {index + 1 < chain.length
              ? `Moves to ${chain[index + 1].label} ${minutesLeft <= 0 ? 'now' : `in ${minutesLeft}m`}`
              : task.completionStrategy === 'TERMINATE'
                ? `Times out ${minutesLeft <= 0 ? 'now' : `in ${minutesLeft}m`}`
                : 'Last assignee'}
          </Chip>
        )}
      </div>
      <ol className="flex flex-wrap items-center gap-2">
        {chain.map((link, i) => (
          <li key={`${link.id}-${i}`} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">→</span>}
            <Chip size="sm" variant={i === index ? 'soft' : 'secondary'} color={i === index ? 'accent' : 'default'}>
              {link.kind === 'group' && <Persons className="mr-1 inline size-3" />}
              {link.label}
              {link.slaMinutes > 0 && <span className="ml-1 text-muted">· {link.slaMinutes}m</span>}
            </Chip>
          </li>
        ))}
      </ol>
    </div>
  );
}

const TRIGGER_EVENTS: Record<string, string> = {
  ASSIGNED: 'assigned',
  CLAIMED: 'claimed',
  RELEASED: 'released',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  TIMED_OUT: 'timed out',
};

/** What happens on its own: the auto-claim, and the workflows each state change starts. */
function Automation({ task }: { task: HumanTask }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      {task.autoClaim && (
        <Chip size="sm" variant="soft">
          Auto-claimed for the assignee
        </Chip>
      )}
      {task.triggers?.map((trigger, i) => (
        <Chip key={`${trigger.on}-${trigger.workflow}-${i}`} size="sm" variant="secondary">
          When {TRIGGER_EVENTS[trigger.on] ?? trigger.on} → <span className="ml-1 font-mono">{trigger.workflow}</span>
          {trigger.version && <span className="ml-1 text-muted">v{trigger.version}</span>}
        </Chip>
      ))}
    </div>
  );
}

/** Reassign or skip — for operators, not for whoever holds the task. */
function OperatorActions({ namespace, task, onChanged }: { namespace: string; task: HumanTask; onChanged?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'reassign' | 'skip'>();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'skip') {
        await mutate(`/v1/ns/${namespace}/human-tasks/${task.id}/skip`, { body: { reason: value } });
        toast.success('Skipped; the workflow continues');
      } else {
        // "ada@example.com, @payments" — people by email, teams with a leading @.
        const assignments = value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => (part.startsWith('@') ? { group: part.slice(1) } : { user: part }));
        await mutate(`/v1/ns/${namespace}/human-tasks/${task.id}/reassign`, { body: { assignments } });
        toast.success('Reassigned');
      }
      setMode(undefined);
      setValue('');
      onChanged?.();
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onPress={() => setMode('reassign')}>
          Reassign
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setMode('skip')}>
          Skip task
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-separator p-4">
      <TextField value={value} onChange={setValue} autoFocus>
        <Label>{mode === 'skip' ? 'Why is this being skipped?' : 'Assign to'}</Label>
        {mode === 'skip' ? (
          <TextArea rows={2} placeholder="Recorded in the task output" />
        ) : (
          <TextArea rows={2} placeholder="ada@example.com, @payments" />
        )}
      </TextField>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="tertiary" onPress={() => setMode(undefined)}>
          Cancel
        </Button>
        <Button size="sm" variant={mode === 'skip' ? 'danger' : 'primary'} isPending={busy} isDisabled={!value.trim()} onPress={submit}>
          {mode === 'skip' ? 'Skip task' : 'Reassign'}
        </Button>
      </div>
    </div>
  );
}
