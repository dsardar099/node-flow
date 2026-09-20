'use client';
import { BroadcastSignal, CircleExclamation, Ellipsis, PaperPlane, PencilToSquare, Plus, Thunderbolt, TrashBin } from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Dropdown,
  EmptyState,
  Label,
  SearchField,
  Switch,
  Table,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { formatDateTime } from '../../components/ui/format';
import { mutate } from '../../lib/mutate';
import { TestMessageDialog } from '../../components/events/test-message-dialog';
import { HandlerDrawer } from './handler-drawer';
import { triggerClass } from '../../components/ui/dropdown-trigger';
import { Ago } from '../../components/ui/ago';
export interface EventHandler {
  name: string;
  description: string | null;
  source: string;
  topic: string;
  condition: string | null;
  action: 'START_WORKFLOW' | 'COMPLETE_TASK' | 'FAIL_TASK';
  workflow: { name: string; version: number | null } | null;
  inputTemplate: Record<string, unknown>;
  correlationId: string | null;
  workflowIdExpr: string | null;
  taskRefExpr: string | null;
  enabled: boolean;
  eventCount: number;
  lastEventAt: string | null;
  lastError: string | null;
}
export interface EventSourceInfo {
  id: string;
  kind: string;
  name: string;
  /** Known topics, where the source can list them — webhook names, for instance. */
  topics?: string[];
}
export const ACTION_LABEL: Record<EventHandler['action'], string> = {
  START_WORKFLOW: 'Start workflow',
  COMPLETE_TASK: 'Complete task',
  FAIL_TASK: 'Fail task',
};
/** Messages from outside, turned into workflow starts and task completions. */
export function HandlerList({
  namespace,
  handlers,
  sources,
  workflowNames,
  mayWrite,
  prefill,
}: {
  namespace: string;
  handlers: EventHandler[];
  sources: EventSourceInfo[];
  workflowNames: string[];
  mayWrite: boolean;
  /** Opens a new handler already pointed at a source and topic — from a webhook's "Add handler". */
  prefill?: { source: string; topic: string };
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EventHandler | 'new' | undefined>(prefill && mayWrite ? 'new' : undefined);
  const [deleting, setDeleting] = useState<string>();
  const [toggling, setToggling] = useState<string>();
  const [testing, setTesting] = useState<string>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return handlers;
    return handlers.filter((h) =>
      [h.name, h.description ?? '', h.topic, h.source, h.workflow?.name ?? ''].some((f) => f.toLowerCase().includes(needle))
    );
  }, [handlers, query]);
  const configured = new Set(sources.map((s) => s.id));
  const toggle = async (handler: EventHandler, enabled: boolean) => {
    setToggling(handler.name);
    try {
      await mutate(`/v1/ns/${namespace}/event-handlers/${encodeURIComponent(handler.name)}/${enabled ? 'enable' : 'disable'}`);
      toast.success(enabled ? `Enabled ${handler.name}` : `Disabled ${handler.name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setToggling(undefined);
    }
  };
  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/event-handlers/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title="Event handlers"
        description="React to messages from Kafka, NATS, RabbitMQ, SQS and webhooks: start a workflow, or complete a task that is waiting for one."
        actions={
          mayWrite && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New handler
            </Button>
          )
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        {sources.length === 0 && (
          <Card className="flex-row items-center gap-3 border border-warning/30 bg-warning/5 px-5 py-4">
            <CircleExclamation className="size-5 shrink-0 text-warning" />
            <p className="text-sm">
              No event source is configured on this server, so handlers can be defined but will not receive messages. Set{' '}
              <code className="font-mono text-xs">NODE_FLOW_KAFKA_CLUSTERS</code>, <code className="font-mono text-xs">NODE_FLOW_NATS_CONNECTIONS</code>,{' '}
              <code className="font-mono text-xs">NODE_FLOW_AMQP_CONNECTIONS</code> or <code className="font-mono text-xs">NODE_FLOW_SQS_CONNECTIONS</code> to connect one.
            </p>
          </Card>
        )}
        <SearchField aria-label="Search handlers" value={query} onChange={setQuery} className="max-w-lg">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search by name, topic or workflow" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Event handlers"
                className="min-w-[900px]"
                onRowAction={(key) => {
                  const handler = handlers.find((h) => h.name === key);
                  if (handler) setEditing(handler);
                }}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Handler</Table.Column>
                  <Table.Column>Listens to</Table.Column>
                  <Table.Column>Does</Table.Column>
                  <Table.Column>Activity</Table.Column>
                  <Table.Column className="w-28">Enabled</Table.Column>
                  <Table.Column className="w-12">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Thunderbolt className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {handlers.length === 0 ? 'No event handlers yet' : 'Nothing matches that search'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {handlers.length === 0
                          ? 'Start a workflow for every order placed, or resume one when a payment is confirmed.'
                          : 'Try a shorter search.'}
                      </span>
                      {handlers.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => setEditing('new')}>
                          <Plus />
                          New handler
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((handler) => (
                    <Table.Row key={handler.name} id={handler.name} className="cursor-pointer">
                      <Table.Cell>
                        <div className="flex items-start gap-3 py-1">
                          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                            <Thunderbolt className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium">{handler.name}</p>
                            {handler.description && <p className="line-clamp-1 max-w-xs text-sm text-muted">{handler.description}</p>}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-sm">{handler.topic}</span>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          {handler.source}
                          {!configured.has(handler.source) && (
                            <Tooltip delay={200}>
                              <Tooltip.Trigger>
                                <CircleExclamation className="size-3 text-warning" aria-label="Source not configured" />
                              </Tooltip.Trigger>
                              <Tooltip.Content>This source is not configured on the server; nothing will arrive.</Tooltip.Content>
                            </Tooltip>
                          )}
                        </span>
                        {handler.condition && (
                          <Chip size="sm" variant="soft" className="mt-1">
                            filtered
                          </Chip>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="block text-sm">{ACTION_LABEL[handler.action]}</span>
                        {handler.workflow && (
                          <span className="text-xs text-muted">
                            {handler.workflow.name} {handler.workflow.version ? `v${handler.workflow.version}` : '(latest)'}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {handler.lastError ? (
                          <Tooltip delay={200}>
                            <Tooltip.Trigger>
                              <Chip size="sm" color="danger" variant="soft">
                                <CircleExclamation className="size-3" />
                                Last message failed
                              </Chip>
                            </Tooltip.Trigger>
                            <Tooltip.Content className="max-w-sm font-mono text-xs">{handler.lastError}</Tooltip.Content>
                          </Tooltip>
                        ) : handler.lastEventAt ? (
                          <>
                            <span className="block text-sm" title={formatDateTime(handler.lastEventAt)}>
                              <Ago value={handler.lastEventAt} />
                            </span>
                            <span className="text-xs text-muted">{handler.eventCount} {handler.eventCount === 1 ? 'message' : 'messages'}</span>
                          </>
                        ) : (
                          <span className="text-sm text-muted">No messages yet</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Switch
                          aria-label={handler.enabled ? `Disable ${handler.name}` : `Enable ${handler.name}`}
                          isSelected={handler.enabled}
                          isDisabled={!mayWrite || toggling === handler.name}
                          onChange={(enabled) => toggle(handler, enabled)}
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
                          <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${handler.name}`}>
                              <Ellipsis />
                          </Dropdown.Trigger>
                          <Dropdown.Popover placement="bottom end" className="min-w-44">
                            <Dropdown.Menu
                              aria-label="Handler actions"
                              onAction={(key) => {
                                if (key === 'edit') setEditing(handler);
                                if (key === 'test') setTesting(handler.name);
                                if (key === 'monitor') router.push(`/eventMonitor?handler=${encodeURIComponent(handler.name)}`);
                                if (key === 'delete') setDeleting(handler.name);
                              }}
                            >
                              <Dropdown.Item id="edit" textValue="Edit">
                                <PencilToSquare />
                                <Label>{mayWrite ? 'Edit' : 'View'}</Label>
                              </Dropdown.Item>
                              {mayWrite ? (
                                <Dropdown.Item id="test" textValue="Send test message">
                                  <PaperPlane />
                                  <Label>Send test message</Label>
                                </Dropdown.Item>
                              ) : null}
                              <Dropdown.Item id="monitor" textValue="View activity">
                                <BroadcastSignal />
                                <Label>View activity</Label>
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
      <TestMessageDialog
        namespace={namespace}
        handlerName={testing}
        isOpen={testing !== undefined}
        onOpenChange={(isOpen) => !isOpen && setTesting(undefined)}
        onSent={() => router.refresh()}
      />
      <HandlerDrawer
        namespace={namespace}
        handler={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        readOnly={!mayWrite}
        sources={sources}
        workflowNames={workflowNames}
        prefill={prefill}
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
                Messages on its topic stop being handled. To stop it for now, disable it instead.
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
