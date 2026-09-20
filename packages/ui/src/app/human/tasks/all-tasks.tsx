'use client';

import { ArrowRotateRight, Clock, Persons } from '@gravity-ui/icons';
import { Button, Card, Chip, EmptyState, Input, ListBox, SearchField, Select, Spinner, TextField, Tooltip } from '@heroui/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatRelative } from '../../../components/ui/format';
import { fetchJson } from '../../../lib/fetch-json';
import type { HumanTask } from './inbox';

type State = 'open' | 'unclaimed' | 'claimed' | 'completed' | 'all';

const STATES: { id: State; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'unclaimed', label: 'Unclaimed' },
  { id: 'claimed', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'Everything' },
];

const AGES = [
  { id: '0', label: 'Any age' },
  { id: '60', label: 'Waiting over 1 hour' },
  { id: '1440', label: 'Waiting over 1 day' },
  { id: '10080', label: 'Waiting over 1 week' },
];

const PAGE = 50;

interface SearchPage {
  tasks: HumanTask[];
  hasMore: boolean;
  people: Record<string, string>;
}

/**
 * Every human task in the namespace, for whoever keeps the queue moving.
 *
 * The inbox answers "what should I do"; this answers "what is stuck, with whom,
 * and since when" — so it lists across assignees, and filters by exactly those
 * three things.
 */
export function AllTasks({
  namespace,
  userId,
  renderDetail,
}: {
  namespace: string;
  userId: string;
  renderDetail: (task: HumanTask, people: Record<string, string>, onChanged: () => void) => ReactNode;
}) {
  const [state, setState] = useState<State>('open');
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  const [age, setAge] = useState('0');
  const [tasks, setTasks] = useState<HumanTask[]>();
  const [people, setPeople] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ state, limit: String(PAGE), offset: String(offset) });
      if (text.trim()) params.set('q', text.trim());
      if (assignee.trim()) params.set('assignee', assignee.trim());
      if (age !== '0') params.set('olderThanMinutes', age);
      return `/v1/ns/${namespace}/human-tasks/search?${params}`;
    },
    [namespace, state, text, assignee, age]
  );

  const reload = useCallback(async () => {
    try {
      const page = await fetchJson<SearchPage>(query(0));
      setTasks(page.tasks);
      setPeople(page.people);
      setHasMore(page.hasMore);
      setError(undefined);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [query]);

  // Typing is debounced; a request per keystroke would race and show stale rows.
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 250);
    return () => clearTimeout(timer);
  }, [reload]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchJson<SearchPage>(query(tasks?.length ?? 0));
      setTasks((current) => [...(current ?? []), ...page.tasks]);
      setPeople((current) => ({ ...current, ...page.people }));
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const selected = tasks?.find((t) => t.id === selectedId) ?? tasks?.[0];
  const name = (id: string | null | undefined) => (id ? (id === userId ? 'you' : (people[id] ?? 'someone')) : undefined);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField aria-label="Search tasks" value={text} onChange={setText} className="min-w-56 flex-1">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Title or task reference" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <TextField aria-label="Assignee" value={assignee} onChange={setAssignee} className="w-56">
          <Input placeholder="Assignee email" />
        </TextField>
        <FilterSelect label="State" value={state} options={STATES} onChange={(v) => setState(v as State)} className="w-40" />
        <FilterSelect label="Age" value={age} options={AGES} onChange={setAge} className="w-52" />
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button isIconOnly variant="ghost" aria-label="Refresh" onPress={() => void reload()}>
              <ArrowRotateRight />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Refresh now</Tooltip.Content>
        </Tooltip>
      </div>

      {error ? (
        <Card>
          <EmptyState className="py-12 text-center text-sm text-danger">{error}</EmptyState>
        </Card>
      ) : tasks === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Persons className="size-6" />
            </span>
            <span className="text-sm font-medium">No tasks match</span>
            <span className="max-w-sm text-sm text-muted">Try another state, or clear the search and assignee.</span>
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
          <Card className="p-2">
            <ul className="space-y-1" aria-label="All tasks">
              {tasks.map((task) => {
                const owner = task.assigneeId ?? task.assigneeGroupId;
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(task.id)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                        task.id === selected?.id ? 'bg-accent-soft' : 'hover:bg-default'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                        <StateChip task={task} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <Clock className="size-3" />
                        {task.completedAt
                          ? `done ${formatRelative(task.completedAt)}${task.completedBy ? ` by ${name(task.completedBy)}` : ''}`
                          : `waiting ${formatRelative(task.createdAt).replace(' ago', '')}`}
                        {!task.completedAt && (
                          <span className="truncate">
                            · {task.claimedBy ? `with ${name(task.claimedBy)}` : owner ? `for ${name(owner)}` : 'unassigned'}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <div className="p-2">
                <Button fullWidth size="sm" variant="secondary" isPending={loadingMore} onPress={loadMore}>
                  Load more
                </Button>
              </div>
            )}
          </Card>
          {selected && renderDetail(selected, people, () => void reload())}
        </div>
      )}
    </div>
  );
}

function StateChip({ task }: { task: HumanTask }) {
  if (task.completedAt) {
    return (
      <Chip size="sm" variant="soft" color={task.skippedReason ? 'warning' : 'success'}>
        {task.skippedReason ? 'Skipped' : 'Done'}
      </Chip>
    );
  }
  if (task.claimedBy) return <Chip size="sm" variant="soft" color="accent">In progress</Chip>;
  if (task.dueAt && new Date(task.dueAt) < new Date()) return <Chip size="sm" variant="soft" color="danger">Overdue</Chip>;
  return <Chip size="sm" variant="secondary">Unclaimed</Chip>;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select aria-label={label} className={className} value={value} onChange={(next) => next !== null && onChange(String(next))}>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
