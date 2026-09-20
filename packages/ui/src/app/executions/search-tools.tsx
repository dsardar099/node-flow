'use client';

import { Bookmark, CircleQuestion, Layers, Persons, TrashBin } from '@gravity-ui/icons';
import { Button, Checkbox, CheckboxGroup, Chip, Input, Label, Popover, Spinner, Switch, TextField, toast } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../../lib/fetch-json';
import { mutate } from '../../lib/mutate';

/** Double-quotes a search value when it contains a space or a quote. */
export function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/(["\\])/g, '\\$1')}"` : value;
}

export const COLUMNS = [
  { id: 'id', label: 'Execution id' },
  { id: 'started', label: 'Started' },
  { id: 'ended', label: 'Ended' },
  { id: 'duration', label: 'Duration' },
  { id: 'correlation', label: 'Correlation id' },
  { id: 'key', label: 'Idempotency key' },
  { id: 'reason', label: 'Failure reason' },
] as const;

export type ColumnId = (typeof COLUMNS)[number]['id'];

const DEFAULT_COLUMNS: ColumnId[] = ['id', 'started', 'duration', 'correlation'];
const STORAGE_KEY = 'nf.executions.columns';

export function isColumnId(value: unknown): value is ColumnId {
  return COLUMNS.some((column) => column.id === value);
}

/**
 * The visible columns, remembered in this browser. A preference, not data:
 * storage that is blocked or cleared just means the defaults.
 */
export function useColumns(): [ColumnId[], (columns: ColumnId[]) => void] {
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (Array.isArray(stored)) setColumns(stored.filter(isColumnId));
    } catch {
      // Defaults stand.
    }
  }, []);

  const update = useCallback((next: ColumnId[]) => {
    // Kept in the table's order, whatever order they were ticked in.
    const ordered = COLUMNS.map((c) => c.id).filter((id) => next.includes(id));
    setColumns(ordered);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
    } catch {
      // Not remembered; still applied.
    }
  }, []);

  return [columns, update];
}

export function ColumnChooser({ columns, onChange }: { columns: ColumnId[]; onChange: (columns: ColumnId[]) => void }) {
  return (
    <Popover>
      <Button variant="secondary">
        <Layers />
        Columns
      </Button>
      <Popover.Content placement="bottom end" className="w-60">
        <Popover.Dialog className="space-y-3 p-4">
          <Popover.Heading className="text-sm font-semibold">Columns</Popover.Heading>
          <CheckboxGroup value={columns} onChange={(value) => onChange((value as string[]).filter(isColumnId))}>
            <Label className="sr-only">Visible columns</Label>
            <div className="space-y-2">
              {COLUMNS.map((column) => (
                <Checkbox key={column.id} value={column.id}>
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="text-sm">{column.label}</span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </CheckboxGroup>
          <p className="text-xs text-muted">Workflow and status are always shown.</p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

const EXAMPLES: { query: string; hint: string }[] = [
  { query: 'status:FAILED,TIMED_OUT', hint: 'any of these statuses' },
  { query: 'workflow:checkout_*', hint: 'a workflow, or names starting with…' },
  { query: 'input.customer.tier:gold', hint: 'a value inside the input' },
  { query: 'output.approved:true', hint: '… or the output' },
  { query: 'reason:"card declined"', hint: 'text in the failure reason' },
  { query: 'correlation:order-4411', hint: 'an exact correlation id' },
  { query: 'key:order-4411', hint: 'an exact idempotency key' },
  { query: 'version:3', hint: 'a definition version' },
  { query: 'is:sub  is:top  is:running', hint: 'sub-workflows, top-level runs, still going' },
  { query: 'timeout 4411', hint: 'plain words match anywhere — all must appear' },
];

/** The search syntax, one click from the box, each example runnable. */
export function SearchHelp({ onPick }: { onPick: (query: string) => void }) {
  return (
    <Popover>
      <Button isIconOnly variant="ghost" aria-label="Search syntax">
        <CircleQuestion />
      </Button>
      <Popover.Content placement="bottom end" className="w-[26rem] max-w-[calc(100vw-2rem)]">
        <Popover.Dialog className="space-y-3 p-4">
          <Popover.Heading className="text-sm font-semibold">Search syntax</Popover.Heading>
          <p className="text-xs text-muted">
            Combine terms with spaces; every term must match. Quote values with spaces. A pasted execution id opens straight to it.
          </p>
          <ul className="space-y-1">
            {EXAMPLES.map((example) => (
              <li key={example.query}>
                <button
                  type="button"
                  onClick={() => !example.query.includes('  ') && onPick(example.query)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-default"
                >
                  <code className="shrink-0 font-mono text-xs text-accent">{example.query}</code>
                  <span className="text-right text-xs text-muted">{example.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Inputs and outputs moved to blob storage because of their size are not searched.</p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

interface SavedView {
  id: string;
  name: string;
  state: { search?: unknown; columns?: unknown };
  shared: boolean;
  mine: boolean;
  ownerName: string | null;
}

/**
 * Saved views: apply one, save the current search and columns, share it with
 * the namespace, or delete your own.
 */
export function SavedViews({
  namespace,
  current,
  onApply,
}: {
  namespace: string;
  current: { search: string; columns: ColumnId[] };
  onApply: (state: SavedView['state']) => void;
}) {
  const base = `/v1/ns/${namespace}/saved-views`;
  const [isOpen, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setViews((await fetchJson<{ views: SavedView[] }>(`${base}?page=executions`)).views);
    } catch (failure) {
      toast.danger((failure as Error).message);
      setViews([]);
    }
  }, [base]);

  useEffect(() => {
    if (isOpen) void load();
    else {
      setSaving(false);
      setName('');
      setShared(false);
    }
  }, [isOpen, load]);

  const save = async () => {
    setBusy(true);
    try {
      await mutate(base, { body: { page: 'executions', name: name.trim(), shared, state: current } });
      toast.success(`Saved “${name.trim()}”`);
      setSaving(false);
      setName('');
      await load();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: SavedView) => {
    try {
      await mutate(`${base}/${view.id}`, { method: 'DELETE' });
      toast.success(`Deleted “${view.name}”`);
      await load();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const mine = views?.filter((v) => v.mine) ?? [];
  const others = views?.filter((v) => !v.mine) ?? [];

  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen}>
      <Button variant="secondary">
        <Bookmark />
        Views
      </Button>
      <Popover.Content placement="bottom end" className="w-80">
        <Popover.Dialog className="space-y-3 p-4">
          <Popover.Heading className="text-sm font-semibold">Saved views</Popover.Heading>
          {views === undefined ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : views.length === 0 ? (
            <p className="text-sm text-muted">None yet. Save this search and its columns to come back to it.</p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {[
                { label: 'Yours', items: mine },
                { label: 'Shared with the namespace', items: others },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{group.label}</p>
                    <ul className="space-y-0.5">
                      {group.items.map((view) => (
                        <li key={view.id} className="group flex items-center gap-1 rounded-lg hover:bg-default">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                            onClick={() => {
                              onApply(view.state);
                              setOpen(false);
                            }}
                          >
                            {view.name}
                            {!view.mine && view.ownerName && <span className="ml-1 text-xs text-muted">· {view.ownerName}</span>}
                          </button>
                          {view.mine && view.shared && (
                            <Chip size="sm" variant="soft" aria-label="Shared">
                              <Persons className="size-3" />
                            </Chip>
                          )}
                          {view.mine && (
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`Delete ${view.name}`}
                              className="opacity-60 group-hover:opacity-100"
                              onPress={() => void remove(view)}
                            >
                              <TrashBin />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}

          <div className="border-t border-separator pt-3">
            {saving ? (
              <div className="space-y-3">
                <TextField value={name} onChange={setName} autoFocus>
                  <Label>Name</Label>
                  <Input placeholder="Failed checkouts this week" onKeyDown={(e) => e.key === 'Enter' && name.trim() && void save()} />
                </TextField>
                <Switch isSelected={shared} onChange={setShared}>
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>Share with the namespace</Label>
                  </Switch.Content>
                </Switch>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="tertiary" onPress={() => setSaving(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" isPending={busy} isDisabled={!name.trim()} onPress={() => void save()}>
                    Save view
                  </Button>
                </div>
              </div>
            ) : (
              <Button fullWidth size="sm" variant="secondary" onPress={() => setSaving(true)}>
                <Bookmark />
                Save current view
              </Button>
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
