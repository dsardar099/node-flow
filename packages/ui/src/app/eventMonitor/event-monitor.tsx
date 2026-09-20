'use client';
import {
  ArrowRotateRight,
  ArrowUpRightFromSquare,
  CircleCheck,
  CircleExclamation,
  CircleMinus,
  PaperPlane,
  Thunderbolt,
} from '@gravity-ui/icons';
import {
  Button,
  Card,
  Chip,
  Drawer,
  EmptyState,
  ListBox,
  Select,
  Table,
  Tabs,
  Tooltip,
} from '@heroui/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TestMessageDialog } from '../../components/events/test-message-dialog';
import { PageHeader } from '../../components/shell/page-header';
import { CopyButton } from '../../components/ui/copy-button';
import { shortId } from '../../components/ui/format';
import { LocalTime } from '../../components/ui/local-time';
import { JsonViewer } from '../../components/ui/json-viewer';
import { fetchJson } from '../../lib/fetch-json';
import { ACTION_LABEL, type EventHandler } from '../eventHandlerDef/handler-list';
import { Ago } from '../../components/ui/ago';
export type Outcome = 'ACTED' | 'SKIPPED' | 'FAILED';
export interface EventExecution {
  id: string;
  handlerName: string;
  action: string;
  source: string;
  topic: string;
  messageKey: string | null;
  deliveryId: string;
  payload: Record<string, unknown>;
  outcome: Outcome;
  workflowId: string | null;
  detail: string | null;
  at: string;
}
export interface HandlerActivity {
  handlerName: string;
  acted: number;
  skipped: number;
  failed: number;
  lastAt: string;
}
const OUTCOME: Record<
  Outcome,
  { label: string; color: 'success' | 'default' | 'danger'; bar: string; icon: typeof CircleCheck; hint: string }
> = {
  ACTED: { label: 'Acted', color: 'success', bar: 'bg-success', icon: CircleCheck, hint: 'Started a workflow or finished a task.' },
  SKIPPED: {
    label: 'Skipped',
    color: 'default',
    bar: 'bg-default-foreground/30',
    icon: CircleMinus,
    hint: 'Seen, and deliberately not acted on — a condition that did not match, or a task already finished.',
  },
  FAILED: { label: 'Failed', color: 'danger', bar: 'bg-danger', icon: CircleExclamation, hint: 'The handler could not act.' },
};
const WINDOWS = [
  { id: '1', label: 'Last hour' },
  { id: '24', label: 'Last 24 hours' },
  { id: '168', label: 'Last 7 days' },
];
const ALL = '__all__';
/**
 * What event handlers did with the messages they saw.
 *
 * A handler's counter only says messages arrive. The questions that come up are
 * sharper — "why didn't this order start a workflow?", "is my condition
 * skipping everything?" — and they are answered by the individual message, its
 * payload and the outcome side by side. So the page leads with per-handler
 * health, and every row opens onto the exact payload with a way to send it
 * again as a test.
 */
export function EventMonitor({
  namespace,
  handlers,
  initialActivity,
  initialPage,
  initialHandler,
  mayWrite,
}: {
  namespace: string;
  handlers: EventHandler[];
  initialActivity: HandlerActivity[];
  initialPage: { executions: EventExecution[]; nextCursor?: string };
  initialHandler?: string;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [activity, setActivity] = useState(initialActivity);
  const [windowHours, setWindowHours] = useState('24');
  const [rows, setRows] = useState(initialPage.executions);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [handler, setHandler] = useState(initialHandler ?? ALL);
  const [outcome, setOutcome] = useState<Outcome | 'all'>('all');
  const [openId, setOpenId] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [testing, setTesting] = useState<{ handler: string; payload?: Record<string, unknown>; key?: string | null }>();
  const base = `/v1/ns/${namespace}/event-handlers`;
  const pageQuery = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ limit: '50' });
      if (handler !== ALL) params.set('handler', handler);
      if (outcome !== 'all') params.set('outcome', outcome);
      if (before) params.set('before', before);
      return `${base}/executions?${params}`;
    },
    [base, handler, outcome]
  );
  // A filter change is a new list, from the top.
  const reload = useCallback(async () => {
    const page = await fetchJson<{ executions: EventExecution[]; nextCursor?: string }>(pageQuery());
    setRows(page.executions);
    setCursor(page.nextCursor);
  }, [pageQuery]);
  const refreshActivity = useCallback(async () => {
    const result = await fetchJson<{ handlers: HandlerActivity[] }>(`${base}/activity?hours=${windowHours}`);
    setActivity(result.handlers);
  }, [base, windowHours]);
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);
  useEffect(() => {
    void refreshActivity().catch(() => undefined);
  }, [refreshActivity]);
  // Live: new messages are prepended, so someone paging back through history is
  // not thrown to the top every few seconds.
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshActivity().catch(() => undefined);
      void fetchJson<{ executions: EventExecution[] }>(pageQuery())
        .then((page) =>
          setRows((current) => {
            const newest = current[0]?.id ?? '';
            const fresh = page.executions.filter((row) => row.id > newest);
            return fresh.length ? [...fresh, ...current] : current;
          })
        )
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [pageQuery, refreshActivity]);
  const chooseHandler = (name: string) => {
    setHandler(name);
    const params = new URLSearchParams();
    if (name !== ALL) params.set('handler', name);
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  };
  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchJson<{ executions: EventExecution[]; nextCursor?: string }>(pageQuery(cursor));
      setRows((current) => [...current, ...page.executions]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };
  const cards = useMemo(() => {
    const byName = new Map(activity.map((a) => [a.handlerName, a]));
    const names = new Set([...handlers.map((h) => h.name), ...activity.map((a) => a.handlerName)]);
    return [...names]
      .map((name) => ({
        name,
        handler: handlers.find((h) => h.name === name),
        activity: byName.get(name),
      }))
      .sort(
        (a, b) =>
          (b.activity?.failed ?? 0) - (a.activity?.failed ?? 0) ||
          (b.activity?.lastAt ?? '').localeCompare(a.activity?.lastAt ?? '') ||
          a.name.localeCompare(b.name)
      );
  }, [activity, handlers]);
  const totals = activity.reduce(
    (sum, a) => ({ acted: sum.acted + a.acted, skipped: sum.skipped + a.skipped, failed: sum.failed + a.failed }),
    { acted: 0, skipped: 0, failed: 0 }
  );
  const seen = totals.acted + totals.skipped + totals.failed;
  const windowLabel = WINDOWS.find((w) => w.id === windowHours)?.label.toLowerCase();
  const open = rows.find((row) => row.id === openId);
  const openHandler = open ? handlers.find((h) => h.name === open.handlerName) : undefined;
  return (
    <>
      <PageHeader
        title="Event monitor"
        description="Every message your event handlers received, and what each one did with it. Updates live."
        actions={
          <>
            <Select
              aria-label="Activity window"
              className="w-44"
              value={windowHours}
              onChange={(value) => value !== null && setWindowHours(String(value))}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {WINDOWS.map((w) => (
                    <ListBox.Item key={w.id} id={w.id} textValue={w.label}>
                      {w.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  variant="ghost"
                  aria-label="Refresh"
                  onPress={() => void Promise.all([reload(), refreshActivity()])}
                >
                  <ArrowRotateRight />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh now</Tooltip.Content>
            </Tooltip>
          </>
        }
      />
      <div className="space-y-5 px-4 md:px-8 pb-10">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={`Messages, ${windowLabel}`} value={seen} />
          <Stat label="Acted" value={totals.acted} share={seen ? totals.acted / seen : undefined} tone="success" />
          <Stat label="Skipped" value={totals.skipped} share={seen ? totals.skipped / seen : undefined} />
          <Stat label="Failed" value={totals.failed} share={seen ? totals.failed / seen : undefined} tone={totals.failed ? 'danger' : undefined} />
        </div>
        {cards.length > 0 && (
          <section aria-label="Handlers" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {cards.map(({ name, handler: h, activity: a }) => {
              const total = (a?.acted ?? 0) + (a?.skipped ?? 0) + (a?.failed ?? 0);
              const selected = handler === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => chooseHandler(selected ? ALL : name)}
                  aria-pressed={selected}
                  className={`group rounded-2xl border bg-surface p-4 text-start transition hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-accent ${
                    selected ? 'border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_20%,transparent)]' : 'border-separator'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                        a?.failed ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      <Thunderbolt className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{name}</span>
                        {h && !h.enabled && (
                          <Chip size="sm" variant="soft">
                            Disabled
                          </Chip>
                        )}
                        {!h && (
                          <Chip size="sm" variant="soft" color="warning">
                            Deleted
                          </Chip>
                        )}
                      </div>
                      <p className="truncate font-mono text-xs text-muted">
                        {h ? `${h.source} · ${h.topic}` : 'no longer defined'}
                      </p>
                    </div>
                    <span className="tabular text-xl font-semibold">{total}</span>
                  </div>
                  <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-secondary" aria-hidden>
                    {total > 0 &&
                      (['ACTED', 'SKIPPED', 'FAILED'] as Outcome[]).map((kind) => {
                        const count = kind === 'ACTED' ? a!.acted : kind === 'SKIPPED' ? a!.skipped : a!.failed;
                        return count ? (
                          <span key={kind} className={OUTCOME[kind].bar} style={{ width: `${(count / total) * 100}%` }} />
                        ) : null;
                      })}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                    {total === 0 ? (
                      <span>No messages {windowLabel}</span>
                    ) : (
                      <>
                        <span className="text-success">{a!.acted} acted</span>
                        <span>{a!.skipped} skipped</span>
                        <span className={a!.failed ? 'text-danger' : ''}>{a!.failed} failed</span>
                        <span className="ms-auto"><Ago value={a!.lastAt} /></span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </section>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs selectedKey={outcome} onSelectionChange={(key) => setOutcome(key as typeof outcome)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Outcome" className="w-auto">
                {[{ id: 'all', label: 'All' }, ...(['ACTED', 'SKIPPED', 'FAILED'] as Outcome[]).map((o) => ({ id: o, label: OUTCOME[o].label }))].map(
                  (tab) => (
                    <Tabs.Tab key={tab.id} id={tab.id} className="w-auto flex-none px-4">
                      {tab.label}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  )
                )}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <Select
            aria-label="Handler"
            className="w-64"
            value={handler}
            onChange={(value) => value !== null && chooseHandler(String(value))}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={ALL} textValue="All handlers">
                  All handlers
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {cards.map(({ name }) => (
                  <ListBox.Item key={name} id={name} textValue={name}>
                    {name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {mayWrite && handler !== ALL && handlers.some((h) => h.name === handler) && (
            <Button variant="secondary" className="ms-auto" onPress={() => setTesting({ handler })}>
              <PaperPlane />
              Send test message
            </Button>
          )}
        </div>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Event executions" className="min-w-[880px]" onRowAction={(key) => setOpenId(String(key))}>
                <Table.Header>
                  <Table.Column isRowHeader>Received</Table.Column>
                  <Table.Column>Handler</Table.Column>
                  <Table.Column>Topic</Table.Column>
                  <Table.Column>Outcome</Table.Column>
                  <Table.Column>Result</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Thunderbolt className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {handler === ALL && outcome === 'all' ? 'No messages yet' : 'No messages match these filters'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {handlers.length === 0
                          ? 'Create an event handler, then messages on its topic show up here.'
                          : 'Messages appear as handlers receive them. Send a test message to see one now.'}
                      </span>
                    </EmptyState>
                  )}
                >
                  {rows.map((row) => {
                    const o = OUTCOME[row.outcome];
                    return (
                      <Table.Row key={row.id} id={row.id} className="cursor-pointer">
                        <Table.Cell className="whitespace-nowrap">
                          <span className="block text-sm"><Ago value={row.at} /></span>
                          <LocalTime value={row.at} className="block text-xs text-muted" />
                        </Table.Cell>
                        <Table.Cell>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{row.handlerName}</span>
                            {row.deliveryId.startsWith('test:') && (
                              <Chip size="sm" variant="soft" color="accent">
                                Test
                              </Chip>
                            )}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="block font-mono text-sm">{row.topic}</span>
                          <span className="block font-mono text-xs text-muted">
                            {row.source}
                            {row.messageKey ? ` · key ${row.messageKey}` : ''}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={o.color}>
                            <o.icon className="size-3.5" />
                            {o.label}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="max-w-[26rem]">
                          {row.workflowId ? (
                            <span className="font-mono text-sm text-accent">{shortId(row.workflowId)}</span>
                          ) : null}
                          {row.detail && (
                            <span className={`block truncate text-sm ${row.outcome === 'FAILED' ? 'text-danger' : 'text-muted'}`}>
                              {row.detail}
                            </span>
                          )}
                          {!row.workflowId && !row.detail && <span className="text-muted">—</span>}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
        {cursor && (
          <div className="flex justify-center">
            <Button variant="secondary" isPending={loadingMore} onPress={loadMore}>
              Load older messages
            </Button>
          </div>
        )}
      </div>
      <Drawer.Backdrop isOpen={open !== undefined} onOpenChange={(isOpen) => !isOpen && setOpenId(undefined)}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="sm:w-[38rem]">
            <Drawer.CloseTrigger />
            {open && (
              <>
                <Drawer.Header>
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="soft" color={OUTCOME[open.outcome].color}>
                      {OUTCOME[open.outcome].label}
                    </Chip>
                    {open.deliveryId.startsWith('test:') && (
                      <Chip size="sm" variant="soft" color="accent">
                        Test message
                      </Chip>
                    )}
                  </div>
                  <Drawer.Heading>{open.handlerName}</Drawer.Heading>
                  <p className="text-sm text-muted">{OUTCOME[open.outcome].hint}</p>
                </Drawer.Header>
                <Drawer.Body className="space-y-5">
                  {open.detail && (
                    <div
                      className={`rounded-xl px-4 py-3 text-sm ${
                        open.outcome === 'FAILED' ? 'bg-danger-soft text-danger' : 'bg-surface-secondary'
                      }`}
                    >
                      {open.detail}
                    </div>
                  )}
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted">Received</dt>
                    <dd><LocalTime value={open.at} /></dd>
                    <dt className="text-muted">Action</dt>
                    <dd>{ACTION_LABEL[open.action as EventHandler['action']] ?? open.action}</dd>
                    <dt className="text-muted">Source</dt>
                    <dd className="font-mono">{open.source}</dd>
                    <dt className="text-muted">Topic</dt>
                    <dd className="font-mono">{open.topic}</dd>
                    <dt className="text-muted">Key</dt>
                    <dd className="font-mono">{open.messageKey ?? '—'}</dd>
                    <dt className="text-muted">Delivery</dt>
                    <dd className="flex items-center gap-1 font-mono text-xs">
                      <span className="truncate">{open.deliveryId}</span>
                      <CopyButton value={open.deliveryId} label="Copy delivery id" />
                    </dd>
                    {open.workflowId && (
                      <>
                        <dt className="text-muted">Execution</dt>
                        <dd className="flex items-center gap-1 font-mono text-xs">
                          <Link href={`/execution/${open.workflowId}`} className="text-accent hover:underline">
                            {open.workflowId}
                          </Link>
                          <CopyButton value={open.workflowId} label="Copy execution id" />
                        </dd>
                      </>
                    )}
                  </dl>
                  <JsonViewer
                    title="Payload"
                    value={open.payload}
                    filename={`event-${open.id}`}
                    maxHeight="45vh"
                    emptyText="The message had no body"
                  />
                </Drawer.Body>
                <Drawer.Footer className="flex justify-end gap-2">
                  {open.workflowId && (
                    <Link href={`/execution/${open.workflowId}`} className="button button--secondary">
                      <ArrowUpRightFromSquare />
                      Open execution
                    </Link>
                  )}
                  {mayWrite && openHandler && !open.payload['_truncated'] && (
                    <Button
                      onPress={() => setTesting({ handler: open.handlerName, payload: open.payload, key: open.messageKey })}
                    >
                      <PaperPlane />
                      Send again as test
                    </Button>
                  )}
                </Drawer.Footer>
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
      <TestMessageDialog
        namespace={namespace}
        handlerName={testing?.handler}
        isOpen={testing !== undefined}
        onOpenChange={(isOpen) => !isOpen && setTesting(undefined)}
        initialPayload={testing?.payload}
        initialKey={testing?.key}
        onSent={() => void Promise.all([reload(), refreshActivity()])}
      />
    </>
  );
}
function Stat({ label, value, share, tone }: { label: string; value: number; share?: number; tone?: 'success' | 'danger' }) {
  return (
    <Card className="gap-1 px-5 py-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={`tabular text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</span>
        {share !== undefined && (
          <span className={`tabular text-xs ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-muted'}`}>
            {Math.round(share * 100)}%
          </span>
        )}
      </span>
    </Card>
  );
}
