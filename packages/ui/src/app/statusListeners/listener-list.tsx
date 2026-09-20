'use client';

import { CircleExclamation, Ellipsis, PaperPlane, PencilToSquare, Plus, Signal, TrashBin } from '@gravity-ui/icons';
import { AlertDialog, Button, Card, Chip, Dropdown, EmptyState, Label, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { formatRelative } from '../../components/ui/format';
import { mutate } from '../../lib/mutate';
import { STATUS_EVENTS, type StatusEventId } from './events';
import { ListenerDrawer } from './listener-drawer';
import { triggerClass } from '../../components/ui/dropdown-trigger';
import { Ago } from '../../components/ui/ago';

export interface StatusListener {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  workflowNames: string[];
  events: StatusEventId[];
  sink: 'WEBHOOK' | 'KAFKA' | 'NATS' | 'AMQP' | 'SQS';
  config: {
    url?: string;
    secretName?: string;
    headers?: Record<string, string>;
    cluster?: string;
    topic?: string;
    connection?: string;
    destination?: string;
  };
  includeOutput: boolean;
  deliveredCount: number;
  failedCount: number;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
}

/**
 * Status listeners, as cards that answer "is it working": where events go,
 * which ones, how many arrived, and the last thing that went wrong — with a
 * button that sends a sample event right now rather than waiting for a run.
 */
export function ListenerList({
  namespace,
  listeners,
  workflowNames,
  secretNames,
  connections,
  mayWrite,
}: {
  namespace: string;
  listeners: StatusListener[];
  workflowNames: string[];
  /** Broker connections configured on the server, as `kind:name` source ids. */
  connections: string[];
  secretNames: string[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<StatusListener | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const [testing, setTesting] = useState<string>();

  const base = `/v1/ns/${namespace}/status-listeners`;

  const remove = async (name: string) => {
    try {
      await mutate(`${base}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const test = async (name: string) => {
    setTesting(name);
    try {
      const result = await mutate<{ delivered: boolean; durationMs: number; error?: string }>(`${base}/${encodeURIComponent(name)}/test`);
      if (result.delivered) toast.success(`Test event delivered in ${result.durationMs}ms`);
      else toast.danger(`Not delivered: ${result.error}`);
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setTesting(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="Status listeners"
        description="Stream workflow lifecycle changes — started, completed, failed and more — to a signed webhook, Kafka, NATS, RabbitMQ or SQS as they happen."
        actions={
          mayWrite && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New listener
            </Button>
          )
        }
      />

      <div className="space-y-4 px-4 pb-10 md:px-8">
        {listeners.length === 0 ? (
          <Card>
            <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Signal className="size-6" />
              </span>
              <span className="text-sm font-medium">No status listeners yet</span>
              <span className="max-w-md text-sm text-muted">
                Tell another system when a workflow finishes, fails or is paused. Each change is sent at least once, with an id to
                deduplicate on, from the same transaction that made it.
              </span>
              {mayWrite && (
                <Button onPress={() => setEditing('new')}>
                  <Plus />
                  New listener
                </Button>
              )}
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            {listeners.map((listener) => (
              <Card key={listener.id} className="min-w-0 gap-4 p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                      SINK_BADGE[listener.sink].className
                    }`}
                  >
                    {SINK_BADGE[listener.sink].label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => mayWrite && setEditing(listener)}
                        className="truncate text-left font-mono font-medium hover:text-accent"
                      >
                        {listener.name}
                      </button>
                      {!listener.enabled && (
                        <Chip size="sm" variant="soft">
                          Paused
                        </Chip>
                      )}
                      {listener.includeOutput && (
                        <Chip size="sm" variant="secondary">
                          With output
                        </Chip>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted" title={destination(listener)}>
                      {destination(listener)}
                    </p>
                  </div>
                  {mayWrite && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="secondary" isPending={testing === listener.name} onPress={() => void test(listener.name)}>
                        <PaperPlane />
                        Send test
                      </Button>
                      <Dropdown>
                        <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${listener.name}`}>
                            <Ellipsis />
                        </Dropdown.Trigger>
                        <Dropdown.Popover placement="bottom end" className="min-w-44">
                          <Dropdown.Menu
                            aria-label="Listener actions"
                            onAction={(key) => (key === 'edit' ? setEditing(listener) : setDeleting(listener.name))}
                          >
                            <Dropdown.Item id="edit" textValue="Edit">
                              <PencilToSquare />
                              <Label>Edit</Label>
                            </Dropdown.Item>
                            <Dropdown.Item id="delete" textValue="Delete" variant="danger">
                              <TrashBin />
                              <Label>Delete</Label>
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </div>
                  )}
                </div>

                {listener.description && <p className="text-sm text-muted">{listener.description}</p>}

                <div className="space-y-2 text-sm">
                  <Row label="Workflows">
                    {listener.workflowNames.length === 0 ? (
                      <span className="text-muted">Every workflow</span>
                    ) : (
                      listener.workflowNames.map((name) => (
                        <Chip key={name} size="sm" variant="secondary">
                          <span className="font-mono">{name}</span>
                        </Chip>
                      ))
                    )}
                  </Row>
                  <Row label="Events">
                    {listener.events.length === 0 ? (
                      <span className="text-muted">Every change</span>
                    ) : (
                      STATUS_EVENTS.filter((e) => listener.events.includes(e.id)).map((e) => (
                        <Chip key={e.id} size="sm" variant="soft" color={e.tone}>
                          {e.label}
                        </Chip>
                      ))
                    )}
                  </Row>
                </div>

                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Figure label="Delivered" value={String(listener.deliveredCount)} />
                  <Figure label="Failed attempts" value={String(listener.failedCount)} tone={listener.failedCount ? 'danger' : undefined} />
                  <Figure label="Last delivery" value={listener.lastDeliveredAt ? formatRelative(listener.lastDeliveredAt) : 'Never'} />
                </dl>

                {listener.lastError && (
                  <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
                    <CircleExclamation className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 break-words">
                      {listener.lastError}
                      {listener.lastFailedAt && <span className="text-danger/70"> · <Ago value={listener.lastFailedAt} /></span>}
                    </span>
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <ListenerDrawer
        namespace={namespace}
        listener={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        workflowNames={workflowNames}
        secretNames={secretNames}
        connections={connections}
      />

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>Changes stop being sent immediately, including any still waiting to be retried.</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && void remove(deleting)}>
                Delete listener
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function destination(listener: StatusListener): string {
  if (listener.sink === 'WEBHOOK') return listener.config.url ?? '';
  if (listener.sink === 'KAFKA') return `kafka://${listener.config.cluster}/${listener.config.topic}`;
  return `${listener.sink.toLowerCase()}://${listener.config.connection}/${listener.config.destination}`;
}

const SINK_BADGE: Record<StatusListener['sink'], { label: string; className: string }> = {
  WEBHOOK: { label: 'WH', className: 'bg-accent-soft text-accent' },
  KAFKA: { label: 'KF', className: 'bg-warning-soft text-warning' },
  NATS: { label: 'NA', className: 'bg-success-soft text-success' },
  AMQP: { label: 'MQ', className: 'bg-danger-soft text-danger' },
  SQS: { label: 'SQ', className: 'bg-default text-foreground' },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl bg-surface-secondary px-2 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular truncate text-sm font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}
