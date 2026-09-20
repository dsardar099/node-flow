'use client';
import { ArrowRotateRight, ShieldCheck } from '@gravity-ui/icons';
import { Button, Card, Chip, Drawer, EmptyState, Input, Label, ListBox, Select, Spinner, Table, TextField } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { LocalTime } from '../../../components/ui/local-time';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { StateDiff } from '../../../components/ui/state-diff';
import { fetchJson } from '../../../lib/fetch-json';
import { Ago } from '../../../components/ui/ago';
interface Entry {
  id: string;
  at: string;
  actor: { type: string; id: string; name: string | null };
  action: string;
  resource: string;
  resourceId: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  outcome: string;
}
const RESOURCES = [
  'any',
  'workflow',
  'task-definition',
  'schedule',
  'event-handler',
  'human-task',
  'form',
  'schema',
  'environment-variable',
  'incoming-webhook',
  'status-listener',
  'secret',
  'user',
  'group',
  'api-key',
  'service-account',
  'workload-identity',
  'quota',
];
/** Who changed what, and whether it worked — newest first, filterable, one click from the full record. */
export function AuditLog({ namespace }: { namespace: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [resource, setResource] = useState('any');
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<Entry>();
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      const params = new URLSearchParams({ limit: '50' });
      if (resource !== 'any') params.set('resource', resource);
      if (action.trim()) params.set('action', action.trim());
      if (after) params.set('cursor', after);
      try {
        const page = await fetchJson<{ entries: Entry[]; nextCursor?: string }>(`/v1/ns/${namespace}/audit?${params}`);
        setEntries((current) => (after ? [...current, ...page.entries] : page.entries));
        setCursor(page.entries.length === 50 ? page.nextCursor : undefined);
      } finally {
        setLoading(false);
      }
    },
    [namespace, resource, action]
  );
  useEffect(() => {
    void load();
  }, [resource]);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to definitions, credentials and access, with who made it and from where. Append-only."
        actions={
          <Button variant="ghost" onPress={() => load()}>
            <ArrowRotateRight />
            Refresh
          </Button>
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="flex flex-wrap items-end gap-3">
          <Select className="w-56" value={resource} onChange={(v) => v !== null && setResource(String(v))}>
            <Label>Resource</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {RESOURCES.map((r) => (
                  <ListBox.Item key={r} id={r} textValue={r}>
                    {r === 'any' ? 'Any resource' : r}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField className="w-56" value={action} onChange={setAction} onKeyDown={(e) => e.key === 'Enter' && load()}>
            <Label>Action</Label>
            <Input placeholder="create, delete, put… Enter" />
          </TextField>
        </div>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Audit log"
                className="min-w-[860px]"
                onRowAction={(key) => setSelected(entries.find((e) => e.id === key))}
              >
                <Table.Header>
                  <Table.Column isRowHeader>When</Table.Column>
                  <Table.Column>Who</Table.Column>
                  <Table.Column>Did</Table.Column>
                  <Table.Column>To</Table.Column>
                  <Table.Column>Outcome</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      {loading ? (
                        <Spinner />
                      ) : (
                        <>
                          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                            <ShieldCheck className="size-6" />
                          </span>
                          <span className="text-sm font-medium">Nothing recorded for these filters</span>
                        </>
                      )}
                    </EmptyState>
                  )}
                >
                  {entries.map((entry) => (
                    <Table.Row key={entry.id} id={entry.id} className="cursor-pointer">
                      <Table.Cell className="whitespace-nowrap">
                        <span className="block text-sm"><Ago value={entry.at} /></span>
                        <LocalTime value={entry.at} className="tabular block text-xs text-muted" />
                      </Table.Cell>
                      <Table.Cell>
                        <span className="block text-sm">{entry.actor.name ?? entry.actor.id}</span>
                        <span className="text-xs text-muted">{entry.actor.type}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="secondary">
                          {entry.action}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="block text-sm">{entry.resource}</span>
                        {entry.resourceId && <span className="font-mono text-xs text-muted">{entry.resourceId}</span>}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" color={entry.outcome === 'ok' ? 'success' : entry.outcome === 'denied' ? 'warning' : 'danger'}>
                          {entry.outcome}
                        </Chip>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          {cursor && (
            <div className="flex justify-center border-t border-separator p-3">
              <Button size="sm" variant="secondary" isPending={loading} onPress={() => load(cursor)}>
                Load older entries
              </Button>
            </div>
          )}
        </Card>
      </div>
      <Drawer.Backdrop isOpen={selected !== undefined} onOpenChange={(o) => !o && setSelected(undefined)}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="sm:w-[34rem]">
            <Drawer.CloseTrigger />
            {selected && (
              <>
                <Drawer.Header>
                  <Drawer.Heading>
                    {selected.action}
                  </Drawer.Heading>
                  <p className="text-sm text-muted"><LocalTime value={selected.at} /></p>
                </Drawer.Header>
                <Drawer.Body className="space-y-4">
                  <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                    <dt className="text-muted">Actor</dt>
                    <dd>
                      {selected.actor.name ?? selected.actor.id} <span className="text-muted">({selected.actor.type})</span>
                    </dd>
                    <dt className="text-muted">Resource id</dt>
                    <dd className="font-mono text-xs">{selected.resourceId ?? '—'}</dd>
                    <dt className="text-muted">Outcome</dt>
                    <dd>{selected.outcome}</dd>
                    <dt className="text-muted">From</dt>
                    <dd className="break-all text-xs">
                      {selected.ip ?? '—'}
                      {selected.userAgent && <span className="block text-muted">{selected.userAgent}</span>}
                    </dd>
                  </dl>
                  <EntryDetail detail={selected.detail} />
                </Drawer.Body>
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}
/** The before-and-after diff when the entry recorded one, then whatever else it holds. */
function EntryDetail({ detail }: { detail: unknown }) {
  const record = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
  const hasStates = 'before' in record || 'after' in record;
  const { before, after, ...rest } = record;
  return (
    <>
      {hasStates && <StateDiff before={before} after={after} />}
      {onlyFields(hasStates ? rest : record) ? (
        <p className="text-sm text-muted">
          Fields sent: <span className="font-mono text-foreground">{(record['fields'] as string[]).join(', ') || 'none'}</span>
        </p>
      ) : (
        Object.keys(hasStates ? rest : record).length > 0 && (
          <JsonViewer title="Detail" value={hasStates ? rest : detail} maxHeight={hasStates ? '12rem' : '50vh'} />
        )
      )}
    </>
  );
}
/** An entry whose only extra context is the list of field names the request sent. */
function onlyFields(detail: Record<string, unknown>): boolean {
  const keys = Object.keys(detail);
  return keys.length === 1 && keys[0] === 'fields' && Array.isArray(detail['fields']);
}
