'use client';

import { ArrowRotateRight, Cube, Ellipsis, PencilToSquare, Plus, Server, TrashBin } from '@gravity-ui/icons';
import type { TaskDefinition } from '@node-flow-dev/core';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Dropdown,
  EmptyState,
  Label,
  SearchField,
  Table,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { formatMs } from '../../components/ui/format';
import { mutate } from '../../lib/mutate';
import { triggerClass } from '../../components/ui/dropdown-trigger';

const LOGIC_LABEL: Record<string, string> = {
  FIXED: 'fixed',
  LINEAR_BACKOFF: 'linear',
  EXPONENTIAL_BACKOFF: 'exponential',
};

const POLICY_LABEL: Record<string, { label: string; color: 'warning' | 'default' }> = {
  TIME_OUT_WF: { label: 'fails workflow', color: 'default' },
  RETRY: { label: 'retries', color: 'warning' },
  ALERT_ONLY: { label: 'alert only', color: 'default' },
};

/** Every task type's policy at a glance: retries, deadlines and limits in one row each. */
export function TaskDefinitionList({
  namespace,
  definitions,
  mayWrite,
}: {
  namespace: string;
  definitions: TaskDefinition[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string>();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter((d) =>
      [d.name, d.description ?? '', d.ownerEmail ?? ''].some((field) => field.toLowerCase().includes(needle))
    );
  }, [definitions, query]);

  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/metadata/task-definitions/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Task definitions"
        description="Retry, timeout and rate-limit policy for each task type. Workers poll a queue named after the definition."
        actions={
          mayWrite && (
            <Button onPress={() => router.push('/newTaskDef')}>
              <Plus />
              New task definition
            </Button>
          )
        }
      />

      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField aria-label="Search task definitions" value={query} onChange={setQuery} className="min-w-72 max-w-lg flex-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search by name, description or owner" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted">
              {shown.length} of {definitions.length}
            </span>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" onPress={() => router.refresh()}>
                  <ArrowRotateRight />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh</Tooltip.Content>
            </Tooltip>
          </div>
        </div>

        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Task definitions"
                className="min-w-[860px]"
                onRowAction={(key) => router.push(`/taskDef/${encodeURIComponent(String(key))}`)}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Task</Table.Column>
                  <Table.Column>Retries</Table.Column>
                  <Table.Column>Timeout</Table.Column>
                  <Table.Column>Limits</Table.Column>
                  <Table.Column className="w-24">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Cube className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {definitions.length === 0 ? 'No task definitions yet' : 'Nothing matches that search'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {definitions.length === 0
                          ? 'Tasks without a definition still run, under default policy. Define one to control retries and timeouts.'
                          : 'Try a shorter search.'}
                      </span>
                      {definitions.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => router.push('/newTaskDef')}>
                          <Plus />
                          New task definition
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((def) => {
                    const policy = POLICY_LABEL[def.timeoutPolicy] ?? POLICY_LABEL.TIME_OUT_WF;
                    return (
                      <Table.Row key={def.name} id={def.name} className="cursor-pointer">
                        <Table.Cell>
                          <div className="flex items-start gap-3 py-1">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-default">
                              <Cube className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-mono text-sm font-medium">{def.name}</p>
                              {def.description && <p className="line-clamp-2 max-w-lg text-sm text-muted">{def.description}</p>}
                              {def.ownerEmail && <p className="text-xs text-muted">{def.ownerEmail}</p>}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm">
                          {def.retryCount === 0 ? (
                            <span className="text-muted">None</span>
                          ) : (
                            <>
                              <span className="tabular font-medium">{def.retryCount}×</span>{' '}
                              <span className="text-muted">{LOGIC_LABEL[def.retryLogic]}</span>
                            </>
                          )}
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm">
                          {def.timeoutSeconds > 0 ? (
                            <div className="flex items-center gap-2">
                              <span className="tabular">{formatMs(def.timeoutSeconds * 1000)}</span>
                              <Chip size="sm" variant="soft" color={policy.color}>
                                {policy.label}
                              </Chip>
                            </div>
                          ) : (
                            <span className="text-muted">None</span>
                          )}
                        </Table.Cell>
                        <Table.Cell className="text-sm">
                          <div className="flex flex-wrap gap-1">
                            {def.concurrentExecLimit > 0 && (
                              <Chip size="sm" variant="secondary">
                                {def.concurrentExecLimit} concurrent
                              </Chip>
                            )}
                            {def.rateLimitPerFrequency > 0 && (
                              <Chip size="sm" variant="secondary">
                                {def.rateLimitPerFrequency}/{formatMs((def.rateLimitFrequencySeconds || 1) * 1000)}
                              </Chip>
                            )}
                            {def.concurrentExecLimit === 0 && def.rateLimitPerFrequency === 0 && (
                              <span className="text-muted">Unlimited</span>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end">
                            <Dropdown>
                              <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${def.name}`}>
                                  <Ellipsis />
                              </Dropdown.Trigger>
                              <Dropdown.Popover placement="bottom end" className="min-w-52">
                                <Dropdown.Menu
                                  aria-label="Task definition actions"
                                  onAction={(key) => {
                                    const name = encodeURIComponent(def.name);
                                    if (key === 'edit') router.push(`/taskDef/${name}`);
                                    if (key === 'queue') router.push(`/taskQueue?queue=${name}`);
                                    if (key === 'delete') setDeleting(def.name);
                                  }}
                                >
                                  <Dropdown.Item id="edit" textValue="Edit">
                                    <PencilToSquare />
                                    <Label>{mayWrite ? 'Edit' : 'View'}</Label>
                                  </Dropdown.Item>
                                  <Dropdown.Item id="queue" textValue="View queue">
                                    <Server />
                                    <Label>View queue</Label>
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
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                Tasks of this type keep working and fall back to default retry and timeout policy. Refused while any are
                queued or running.
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
