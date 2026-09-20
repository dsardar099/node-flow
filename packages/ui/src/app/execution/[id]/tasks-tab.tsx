'use client';

import { Card, Chip, EmptyState, Label, ListBox, SearchField, Select, Table } from '@heroui/react';
import { useMemo, useState } from 'react';
import { formatMs, msBetween } from '../../../components/ui/format';
import { LocalTime } from '../../../components/ui/local-time';
import { StatusChip, statusLabel } from '../../../components/ui/status-chip';
import type { TaskRun } from './types';

/**
 * Every task row, in the order it was scheduled — retries and loop iterations
 * included, since "what happened to attempt 2" is a question this answers.
 *
 * Queue wait is its own column: a task that sat for four minutes before a
 * worker picked it up and a task that ran for four minutes are different
 * problems, with different people to call.
 */
export function TasksTab({
  tasks,
  truncated,
  selectedRef,
  onOpen,
}: {
  tasks: TaskRun[];
  truncated: boolean;
  selectedRef?: string;
  onOpen: (ref: string) => void;
}) {
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');

  const statuses = useMemo(() => [...new Set(tasks.map((t) => t.status))].sort(), [tasks]);
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [tasks]
  );
  const shown = ordered.filter((task) => {
    if (status !== 'ALL' && task.status !== status) return false;
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      [task.refName, task.taskDefName, task.taskType, task.id, task.workerId ?? ''].some((f) =>
        f.toLowerCase().includes(needle)
      )
    );
  });

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <Card.Title>Tasks</Card.Title>
          <Card.Description>
            {shown.length} of {tasks.length} task runs{truncated ? ' — list truncated' : ''}
          </Card.Description>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField aria-label="Filter tasks" value={query} onChange={setQuery} className="w-64">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Filter by name, id or worker" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Select aria-label="Status" className="w-44" value={status} onChange={(v) => setStatus(String(v ?? 'ALL'))}>
            <Label className="sr-only">Status</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="ALL" textValue="All statuses">
                  All statuses
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {statuses.map((s) => (
                  <ListBox.Item key={s} id={s} textValue={statusLabel(s)}>
                    {statusLabel(s)}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </Card.Header>
      <Card.Content>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Task runs"
              className="min-w-[960px]"
              onRowAction={(key) => {
                const task = tasks.find((t) => t.id === key);
                if (task) onOpen(task.refName);
              }}
            >
              <Table.Header>
                <Table.Column className="w-12">#</Table.Column>
                <Table.Column isRowHeader>Task</Table.Column>
                <Table.Column>Type</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Scheduled</Table.Column>
                <Table.Column>Queue wait</Table.Column>
                <Table.Column>Duration</Table.Column>
                <Table.Column>Worker</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <EmptyState className="py-10 text-center text-sm text-muted">No task runs match.</EmptyState>
                )}
              >
                {shown.map((task) => (
                  <Table.Row
                    key={task.id}
                    id={task.id}
                    className={`cursor-pointer ${task.refName === selectedRef ? 'bg-accent-soft' : ''}`}
                  >
                    <Table.Cell className="tabular text-muted">{ordered.indexOf(task) + 1}</Table.Cell>
                    <Table.Cell>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {task.refName}
                          {task.attempt > 0 && <span className="ml-1.5 text-xs text-muted">attempt {task.attempt + 1}</span>}
                          {task.iteration > 0 && <span className="ml-1.5 text-xs text-muted">iteration {task.iteration}</span>}
                        </p>
                        <p className="truncate text-xs text-muted">{task.taskDefName}</p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="secondary" className="font-mono text-[11px]">
                        {task.taskType}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusChip status={task.status} />
                    </Table.Cell>
                    <Table.Cell className="tabular whitespace-nowrap text-muted">
                      <LocalTime value={task.scheduledAt} timeOnly />
                    </Table.Cell>
                    <Table.Cell className="tabular">
                      {task.startedAt ? formatMs(msBetween(task.scheduledAt, task.startedAt)) : ''}
                    </Table.Cell>
                    {/* A task still running is measured to `Date.now()`, which
                        the server and the browser do not agree on. */}
                    <Table.Cell className="tabular">
                      <span suppressHydrationWarning>
                        {task.startedAt ? formatMs(msBetween(task.startedAt, task.endedAt)) : ''}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="max-w-40 truncate font-mono text-xs text-muted">{task.workerId}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  );
}
