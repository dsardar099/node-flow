'use client';

import {
  ArrowRotateRight,
  CirclePlay,
  Funnel,
  Pause,
  Play,
  Plus,
  Xmark,
} from '@gravity-ui/icons';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ComboBox,
  EmptyState,
  Input,
  Label,
  ListBox,
  Popover,
  SearchField,
  Select,
  Spinner,
  Switch,
  Table,
  Tabs,
  TextField,
  Tooltip,
  toast,
  type Selection,
} from '@heroui/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { CopyButton } from '../../components/ui/copy-button';
import { formatDuration, formatRelative } from '../../components/ui/format';
import { LocalTime } from '../../components/ui/local-time';
import { StatusChip } from '../../components/ui/status-chip';
import { useTicker } from '../../components/ui/use-ticker';
import { mutate } from '../../lib/mutate';
import { RunWorkflowModal } from '../workflowDef/run-workflow-modal';
import { ColumnChooser, SavedViews, SearchHelp, isColumnId, quote, useColumns, type ColumnId } from './search-tools';
import { Ago } from '../../components/ui/ago';

interface ExecutionRow {
  workflowId: string;
  defName: string;
  defVersion: number;
  status: string;
  correlationId?: string | null;
  parentWorkflowId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  awaitingAdmission?: boolean;
  idempotencyKey?: string | null;
  reasonForIncompletion?: string | null;
}

/** The quick filters across the top. `all` is no status filter. */
const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'RUNNING', label: 'Running' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'TIMED_OUT', label: 'Timed out' },
  { id: 'TERMINATED', label: 'Terminated' },
];
const STATUSES = STATUS_TABS.slice(1).map((tab) => tab.id);

/** Start-time windows. Relative, so a shared link means "the last hour" whenever it is opened. */
const RANGES: { id: string; label: string; ms?: number }[] = [
  { id: 'any', label: 'Any time' },
  { id: '1h', label: 'Last hour', ms: 3_600_000 },
  { id: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
];

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Filters {
  /** The search box: `status:FAILED input.orderId:A-1 declined`. */
  q: string;
  workflowType: string;
  workflowId: string;
  correlationId: string;
  idempotencyKey: string;
  status: string[];
  range: string;
  excludeSubWorkflows: boolean;
}

function filtersFrom(params: URLSearchParams): Filters {
  return {
    q: params.get('q') ?? '',
    workflowType: params.get('workflowType') ?? '',
    workflowId: params.get('workflowId') ?? '',
    correlationId: params.get('correlationId') ?? '',
    idempotencyKey: params.get('idempotencyKey') ?? '',
    status: (params.get('status') ?? '').split(',').filter((s) => STATUSES.includes(s)),
    range: RANGES.some((r) => r.id === params.get('range')) ? (params.get('range') as string) : 'any',
    excludeSubWorkflows: params.get('excludeSubWorkflows') === 'true',
  };
}

function paramsFrom(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.workflowType) params.set('workflowType', filters.workflowType);
  if (filters.workflowId) params.set('workflowId', filters.workflowId.trim());
  if (filters.correlationId) params.set('correlationId', filters.correlationId);
  if (filters.idempotencyKey) params.set('idempotencyKey', filters.idempotencyKey);
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.range !== 'any') params.set('range', filters.range);
  if (filters.excludeSubWorkflows) params.set('excludeSubWorkflows', 'true');
  return params.toString();
}

/**
 * Every run in the namespace, filtered from the URL.
 *
 * The filters live in the URL, so a search is a link: "every failed `checkout`
 * run with this correlation id" can be pasted into an incident channel and
 * everyone opens the same list. Every control applies the moment it changes —
 * there is no separate Search button to forget.
 */
export function ExecutionSearch({
  namespace,
  workflowNames,
  mayStart,
  mayDefine,
  mayOperate,
}: {
  namespace: string;
  workflowNames: string[];
  mayStart: boolean;
  mayDefine: boolean;
  mayOperate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const applied = useMemo(() => filtersFrom(new URLSearchParams(searchParams.toString())), [searchParams]);

  const apply = useCallback(
    (patch: Partial<Filters>) => {
      const query = paramsFrom({ ...applied, ...patch });
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [applied, pathname, router]
  );

  // The one search box. A pasted execution id is looked up as one; anything
  // else is the search syntax — keys like `status:FAILED` and plain words.
  // Links from elsewhere may still carry a bare `correlationId`, shown as its key.
  const shownQuery =
    applied.q || (applied.workflowId ? applied.workflowId : applied.correlationId ? `correlation:${quote(applied.correlationId)}` : '');
  const [query, setQuery] = useState(shownQuery);
  useEffect(() => setQuery(shownQuery), [shownQuery]);
  const submitQuery = (value: string) => {
    const text = value.trim();
    apply(UUID.test(text) ? { workflowId: text, correlationId: '', q: '' } : { workflowId: '', correlationId: '', q: text });
  };

  const [columns, setColumns] = useColumns();
  const shows = (id: ColumnId) => columns.includes(id);

  const [workflowInput, setWorkflowInput] = useState(applied.workflowType);
  useEffect(() => setWorkflowInput(applied.workflowType), [applied.workflowType]);

  const [rows, setRows] = useState<ExecutionRow[]>([]);
  // Cursors of the pages visited, so "previous" is a lookup, not a re-walk.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [runOpen, setRunOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date>();

  const page = cursors.length - 1;

  const load = useCallback(
    async (cursor: string | undefined, { quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError(undefined);
      const range = RANGES.find((r) => r.id === applied.range);
      try {
        const result = await mutate<{ executions: ExecutionRow[]; nextCursor?: string }>(
          `/v1/ns/${namespace}/executions/search`,
          {
            body: {
              ...(applied.q ? { q: applied.q } : {}),
              ...(applied.workflowType ? { defName: applied.workflowType } : {}),
              ...(applied.workflowId ? { workflowId: applied.workflowId } : {}),
              ...(applied.correlationId ? { correlationId: applied.correlationId } : {}),
              ...(applied.idempotencyKey ? { idempotencyKey: applied.idempotencyKey } : {}),
              ...(applied.status.length ? { status: applied.status } : {}),
              ...(range?.ms ? { startedAfter: new Date(Date.now() - range.ms).toISOString() } : {}),
              ...(applied.excludeSubWorkflows ? { excludeSubWorkflows: true } : {}),
              limit: PAGE_SIZE,
              ...(cursor ? { cursor } : {}),
            },
          }
        );
        setRows(result.executions);
        setNextCursor(result.nextCursor);
        setRefreshedAt(new Date());
        if (!quiet) setSelected(new Set());
      } catch (failure) {
        setError((failure as Error).message);
        if (!quiet) setRows([]);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [applied, namespace]
  );

  // A new search starts again from the first page.
  useEffect(() => {
    setCursors([undefined]);
    void load(undefined);
  }, [load]);

  // While anything on screen is still moving, keep the list current — quietly,
  // without a spinner or losing the selection. Only on the first page: paging
  // through history should not reshuffle under the reader.
  const live = page === 0 && rows.some((row) => row.status === 'RUNNING' || row.status === 'PAUSED');
  const pageRef = useRef(cursors[page]);
  pageRef.current = cursors[page];
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(pageRef.current, { quiet: true }), 5000);
    return () => clearInterval(timer);
  }, [live, load]);
  useTicker(live);

  const selectedIds = selected === 'all' ? rows.map((r) => r.workflowId) : [...selected].map(String);

  /**
   * Bulk actions, one request per execution.
   *
   * Reported as counts rather than failing on the first error: in a bulk
   * terminate of forty runs, the three that had already finished are expected,
   * not a reason to abandon the other thirty-seven.
   */
  const bulk = async (action: 'pause' | 'resume' | 'retry' | 'terminate') => {
    let done = 0;
    let failed = 0;
    try {
      const result = await mutate<{ succeeded: string[]; failed: Record<string, string> }>(
        `/v1/ns/${namespace}/executions/bulk/${action}`,
        { body: { workflowIds: selectedIds } }
      );
      done = result.succeeded.length;
      failed = Object.keys(result.failed).length;
    } catch (failure) {
      toast.danger((failure as Error).message);
      return;
    }
    if (failed === 0) toast.success(`${statusVerb(action)} ${done} execution${done === 1 ? '' : 's'}`);
    else toast.warning(`${statusVerb(action)} ${done}; ${failed} could not be — they may already be in a final state`);
    void load(cursors[page]);
  };

  const statusTab = applied.status.length === 1 ? applied.status[0] : applied.status.length === 0 ? 'all' : 'custom';
  const moreFilters = (applied.idempotencyKey ? 1 : 0) + (applied.excludeSubWorkflows ? 1 : 0);
  const filtered =
    Boolean(applied.q || applied.workflowType || applied.workflowId || applied.correlationId || applied.idempotencyKey) ||
    applied.status.length > 0 ||
    applied.range !== 'any' ||
    applied.excludeSubWorkflows;

  return (
    <>
      <PageHeader
        title="Executions"
        description="Every workflow run in this namespace. Filters are kept in the URL, so a search can be shared as a link."
        actions={
          <>
            {mayStart && (
              <Button variant="secondary" onPress={() => setRunOpen(true)}>
                <CirclePlay />
                Run workflow
              </Button>
            )}
            {mayDefine && (
              <Button onPress={() => router.push('/newWorkflowDef')}>
                <Plus />
                New workflow
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4 px-4 md:px-8 pb-10">
        <Tabs
          selectedKey={statusTab}
          onSelectionChange={(key) => apply({ status: key === 'all' ? [] : [String(key)] })}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Status" className="w-auto">
              {STATUS_TABS.map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id} className="w-auto flex-none px-4">
                  {tab.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            aria-label="Search executions"
            className="min-w-72 flex-1"
            value={query}
            onChange={setQuery}
            onSubmit={submitQuery}
            onClear={() => submitQuery('')}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                className="font-mono text-sm"
                placeholder="Search: an id, any text, or status:FAILED input.orderId:A-1 — press Enter"
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <SearchHelp
            onPick={(example) => {
              setQuery(example);
              submitQuery(example);
            }}
          />

          <ComboBox
            aria-label="Workflow"
            className="w-60"
            allowsCustomValue
            inputValue={workflowInput}
            onInputChange={setWorkflowInput}
            onSelectionChange={(key) => key !== null && apply({ workflowType: String(key) })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply({ workflowType: workflowInput.trim() });
            }}
            onBlur={() => workflowInput.trim() !== applied.workflowType && apply({ workflowType: workflowInput.trim() })}
          >
            <ComboBox.InputGroup>
              <Input placeholder="All workflows" />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox>
                {workflowNames.map((name) => (
                  <ListBox.Item key={name} id={name} textValue={name}>
                    {name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>

          <Select
            aria-label="Started"
            className="w-44"
            value={applied.range}
            onChange={(value) => apply({ range: String(value ?? 'any') })}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {RANGES.map((range) => (
                  <ListBox.Item key={range.id} id={range.id} textValue={range.label}>
                    {range.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Popover>
            <Button variant="secondary">
              <Funnel />
              More filters
              {moreFilters > 0 && (
                <Chip size="sm" color="accent" variant="soft">
                  {moreFilters}
                </Chip>
              )}
            </Button>
            <Popover.Content placement="bottom end" className="w-80">
              <Popover.Dialog className="space-y-4 p-4">
                <Popover.Heading className="text-sm font-semibold">More filters</Popover.Heading>
                <MoreFilters applied={applied} apply={apply} />
              </Popover.Dialog>
            </Popover.Content>
          </Popover>

          {filtered && (
            <Button variant="ghost" onPress={() => router.replace(pathname, { scroll: false })}>
              <Xmark />
              Clear
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ColumnChooser columns={columns} onChange={setColumns} />
            <SavedViews
              namespace={namespace}
              current={{ search: paramsFrom(applied), columns }}
              onApply={(state) => {
                if (Array.isArray(state.columns)) setColumns(state.columns.filter(isColumnId));
                const search = typeof state.search === 'string' ? state.search : '';
                router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
              }}
            />
          </div>
        </div>

        <Card className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-separator px-5 py-3">
            <p className="text-sm text-muted">
              {loading ? (
                'Searching…'
              ) : error ? (
                'The search could not run'
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {rows.length}
                    {nextCursor ? '+' : ''}
                  </span>{' '}
                  execution{rows.length === 1 ? '' : 's'}
                  {page > 0 && ` · page ${page + 1}`}
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {live && (
                <Chip size="sm" variant="soft" color="accent">
                  <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-accent" />
                  Auto-refreshing
                </Chip>
              )}
              <Tooltip delay={300}>
                <Tooltip.Trigger>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" onPress={() => load(cursors[page])}>
                    <ArrowRotateRight />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>{refreshedAt ? `Updated ${formatRelative(refreshedAt)}` : 'Refresh'}</Tooltip.Content>
              </Tooltip>
            </div>
          </div>

          {error && <p className="px-5 pt-3 text-sm text-danger">{error}</p>}

          <Table variant="secondary" className="rounded-none">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Workflow executions"
                className="min-w-[860px]"
                selectionMode={mayOperate ? 'multiple' : 'none'}
                selectedKeys={selected}
                onSelectionChange={setSelected}
                onRowAction={(key) => router.push(`/execution/${String(key)}`)}
              >
                <Table.Header>
                  {mayOperate ? (
                    <Table.Column className="w-10 pe-0">
                      <Checkbox aria-label="Select all" slot="selection">
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Column>
                  ) : null}
                  <Table.Column isRowHeader>Workflow</Table.Column>
                  <Table.Column>Status</Table.Column>
                  {shows('id') ? <Table.Column>Execution id</Table.Column> : null}
                  {shows('started') ? <Table.Column>Started</Table.Column> : null}
                  {shows('ended') ? <Table.Column>Ended</Table.Column> : null}
                  {shows('duration') ? <Table.Column>Duration</Table.Column> : null}
                  {shows('correlation') ? <Table.Column>Correlation id</Table.Column> : null}
                  {shows('key') ? <Table.Column>Idempotency key</Table.Column> : null}
                  {shows('reason') ? <Table.Column>Failure reason</Table.Column> : null}
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
                      {loading ? (
                        <Spinner />
                      ) : (
                        <>
                          <span className="text-sm font-medium">
                            {error ? 'Nothing to show yet' : filtered ? 'No executions match these filters' : 'No executions yet'}
                          </span>
                          <span className="text-sm text-muted">
                            {error
                              ? 'Fix the search above — the ? next to the box lists what it understands.'
                              : filtered
                                ? 'Try a wider time range or clear a filter.'
                                : 'Run a workflow and it will show up here.'}
                          </span>
                        </>
                      )}
                    </EmptyState>
                  )}
                >
                  {rows.map((row) => (
                    <Table.Row key={row.workflowId} id={row.workflowId} className="cursor-pointer">
                      {mayOperate ? (
                        <Table.Cell className="pe-0">
                          <Checkbox aria-label={`Select ${row.workflowId}`} slot="selection" variant="secondary">
                            <Checkbox.Content>
                              <Checkbox.Control>
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                            </Checkbox.Content>
                          </Checkbox>
                        </Table.Cell>
                      ) : null}
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{row.defName}</span>
                          <Chip size="sm" variant="secondary" className="tabular">
                            v{row.defVersion}
                          </Chip>
                          {row.parentWorkflowId && (
                            <Chip size="sm" variant="soft" color="default">
                              sub-workflow
                            </Chip>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <StatusChip status={row.awaitingAdmission ? 'QUEUED' : row.status} />
                      </Table.Cell>
                      {shows('id') ? (
                        <Table.Cell>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            {row.workflowId}
                            <CopyButton value={row.workflowId} label="Copy execution id" />
                          </span>
                        </Table.Cell>
                      ) : null}
                      {shows('started') ? (
                        <Table.Cell className="whitespace-nowrap">
                          <span className="block text-sm"><Ago value={row.startedAt} /></span>
                          <LocalTime value={row.startedAt} className="tabular block text-xs text-muted" />
                        </Table.Cell>
                      ) : null}
                      {shows('ended') ? (
                        <Table.Cell className="whitespace-nowrap">
                          {row.endedAt ? (
                            <LocalTime value={row.endedAt} className="tabular text-sm" />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Table.Cell>
                      ) : null}
                      {/* Still-running rows are measured to `Date.now()`. */}
                      {shows('duration') ? (
                        <Table.Cell className="tabular whitespace-nowrap">
                          <span suppressHydrationWarning>
                            {formatDuration(row.startedAt, row.endedAt ?? undefined)}
                          </span>
                        </Table.Cell>
                      ) : null}
                      {shows('correlation') ? (
                        <Table.Cell className="max-w-48 truncate text-sm">
                          {row.correlationId ?? <span className="text-muted">—</span>}
                        </Table.Cell>
                      ) : null}
                      {shows('key') ? (
                        <Table.Cell className="max-w-48 truncate font-mono text-xs">
                          {row.idempotencyKey ?? <span className="text-muted">—</span>}
                        </Table.Cell>
                      ) : null}
                      {shows('reason') ? (
                        <Table.Cell className="max-w-72 truncate text-sm">
                          {row.reasonForIncompletion ? (
                            <span className="text-danger" title={row.reasonForIncompletion}>
                              {row.reasonForIncompletion}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Table.Cell>
                      ) : null}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>

          {(page > 0 || nextCursor) && (
            <div className="flex items-center justify-end gap-2 border-t border-separator px-5 py-3">
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={page === 0 || loading}
                onPress={() => {
                  const previous = cursors.slice(0, -1);
                  setCursors(previous);
                  void load(previous[previous.length - 1]);
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={!nextCursor || loading}
                onPress={() => {
                  setCursors((c) => [...c, nextCursor]);
                  void load(nextCursor);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </Card>

        {/* Bulk actions float over the list rather than shifting it. */}
        {mayOperate && selectedIds.length > 0 && (
          <div className="pointer-events-none sticky bottom-6 z-30 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-separator bg-overlay px-3 py-2 shadow-overlay">
              <span className="px-2 text-sm font-medium">{selectedIds.length} selected</span>
              <Button size="sm" variant="secondary" onPress={() => bulk('pause')}>
                <Pause />
                Pause
              </Button>
              <Button size="sm" variant="secondary" onPress={() => bulk('resume')}>
                <Play />
                Resume
              </Button>
              <Button size="sm" variant="secondary" onPress={() => bulk('retry')}>
                <ArrowRotateRight />
                Retry
              </Button>
              <Button size="sm" variant="danger-soft" onPress={() => bulk('terminate')}>
                Terminate
              </Button>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Clear selection" onPress={() => setSelected(new Set())}>
                <Xmark />
              </Button>
            </div>
          </div>
        )}
      </div>

      {mayStart && (
        <RunWorkflowModal
          namespace={namespace}
          workflowNames={workflowNames}
          isOpen={runOpen}
          onOpenChange={setRunOpen}
        />
      )}
    </>
  );
}

/** The filters most searches never need: kept out of the toolbar, one click away. */
function MoreFilters({ applied, apply }: { applied: Filters; apply: (patch: Partial<Filters>) => void }) {
  const [key, setKey] = useState(applied.idempotencyKey);
  return (
    <>
      <TextField
        value={key}
        onChange={setKey}
        onBlur={() => key !== applied.idempotencyKey && apply({ idempotencyKey: key.trim() })}
        onKeyDown={(event) => event.key === 'Enter' && apply({ idempotencyKey: key.trim() })}
      >
        <Label>Idempotency key</Label>
        <Input placeholder="Exact key" />
      </TextField>
      <Switch
        isSelected={applied.excludeSubWorkflows}
        onChange={(excludeSubWorkflows) => apply({ excludeSubWorkflows })}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>Hide sub-workflows</Label>
        </Switch.Content>
      </Switch>
    </>
  );
}

function statusVerb(action: 'pause' | 'resume' | 'retry' | 'terminate'): string {
  return { pause: 'Paused', resume: 'Resumed', retry: 'Retried', terminate: 'Terminated' }[action];
}
