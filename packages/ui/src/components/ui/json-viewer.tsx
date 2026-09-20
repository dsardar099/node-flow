'use client';

import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  Copy,
  ListUl,
  SquareDashed,
  TextAlignLeft,
} from '@gravity-ui/icons';
import { Button, Modal, Tooltip, toast } from '@heroui/react';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';

/**
 * A JSON value, readable.
 *
 * A tree rather than a `<pre>`: task payloads are routinely hundreds of lines,
 * and the question is usually about one field — so every object and array
 * folds, and "collapse all" gets to the top-level shape in one click. The raw
 * text is one toggle away for copying a fragment.
 *
 * Paths are the expansion state (`$.providers.tts`), so expanding and
 * collapsing survive a live refresh that replaces the value with a new object.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function JsonViewer({
  value,
  title,
  emptyText = 'Empty',
  filename = 'data',
  maxHeight = '60vh',
  toolbar = true,
}: {
  value: unknown;
  title?: ReactNode;
  emptyText?: string;
  filename?: string;
  maxHeight?: string;
  toolbar?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [raw, setRaw] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const json = value as Json | undefined;
  const empty =
    json === undefined ||
    json === null ||
    (typeof json === 'object' && Object.keys(json).length === 0);
  const text = useMemo(() => JSON.stringify(json ?? {}, null, 2), [json]);

  const toggle = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = () => {
    const paths = new Set<string>();
    const walk = (node: Json, path: string, depth: number) => {
      if (node !== null && typeof node === 'object') {
        if (depth > 0) paths.add(path);
        for (const [key, child] of Object.entries(node)) walk(child as Json, `${path}.${key}`, depth + 1);
      }
    };
    if (json !== undefined) walk(json, '$', 0);
    setCollapsed(paths);
  };

  const allCollapsed = collapsed.size > 0;

  const actions = (
    <div className="flex items-center gap-1">
      <ToolbarIcon label={raw ? 'Tree view' : 'Raw text'} onPress={() => setRaw((v) => !v)}>
        {raw ? <ListUl /> : <TextAlignLeft />}
      </ToolbarIcon>
      {!raw && (
        <ToolbarIcon
          label={allCollapsed ? 'Expand all' : 'Collapse all'}
          onPress={() => (allCollapsed ? setCollapsed(new Set()) : collapseAll())}
        >
          {allCollapsed ? <ChevronDown /> : <ChevronRight />}
        </ToolbarIcon>
      )}
      <ToolbarIcon
        label="Copy"
        onPress={async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast.success('Copied');
          } catch {
            toast.danger('The browser refused clipboard access');
          }
        }}
      >
        <Copy />
      </ToolbarIcon>
      <ToolbarIcon
        label="Download"
        onPress={() => {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = `${filename}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <ArrowDownToLine />
      </ToolbarIcon>
      <ToolbarIcon label="Fullscreen" onPress={() => setFullscreen(true)}>
        <SquareDashed />
      </ToolbarIcon>
    </div>
  );

  const body = (height: string) =>
    empty ? (
      <p className="px-4 py-6 text-sm text-muted">{emptyText}</p>
    ) : raw ? (
      <pre className="overflow-auto p-4 font-mono text-xs leading-relaxed" style={{ maxHeight: height }}>
        {text}
      </pre>
    ) : (
      <div className="overflow-auto py-3 font-mono text-xs leading-6" style={{ maxHeight: height }}>
        <Node value={json as Json} path="$" depth={0} collapsed={collapsed} onToggle={toggle} last />
      </div>
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-separator bg-surface">
      {(title || toolbar) && (
        <div className="flex items-center justify-between gap-2 border-b border-separator px-4 py-2">
          <div className="text-sm font-medium">{title}</div>
          {toolbar && !empty && actions}
        </div>
      )}
      {body(maxHeight)}

      <Modal.Backdrop isOpen={fullscreen} onOpenChange={setFullscreen}>
        <Modal.Container size="full">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title ?? 'JSON'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="mb-2 flex justify-end">{actions}</div>
              {body('calc(100vh - 12rem)')}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function ToolbarIcon({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <Button isIconOnly size="sm" variant="ghost" aria-label={label} onPress={onPress}>
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

const Node = memo(function Node({
  value,
  path,
  depth,
  name,
  collapsed,
  onToggle,
  last,
}: {
  value: Json;
  path: string;
  depth: number;
  name?: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  last: boolean;
}) {
  const indent = { paddingLeft: `${depth * 1.1 + 1}rem` };
  const comma = last ? '' : ',';
  const label =
    name !== undefined ? (
      <>
        <span className="text-accent">&quot;{name}&quot;</span>
        <span className="text-muted">: </span>
      </>
    ) : null;

  if (value === null || typeof value !== 'object') {
    return (
      <div style={indent} className="whitespace-pre-wrap break-all pr-4">
        {label}
        <Primitive value={value} />
        <span className="text-muted">{comma}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  const folded = collapsed.has(path);

  if (entries.length === 0) {
    return (
      <div style={indent}>
        {label}
        <span className="text-muted">
          {open}
          {close}
          {comma}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div style={indent} className="group relative flex items-center">
        <button
          type="button"
          onClick={() => onToggle(path)}
          aria-label={folded ? 'Expand' : 'Collapse'}
          aria-expanded={!folded}
          className="absolute -ml-4 grid size-4 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
          style={{ left: `${depth * 1.1 + 1}rem` }}
        >
          {folded ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        <span>
          {label}
          <span className="text-muted">{open}</span>
          {folded && (
            <button type="button" onClick={() => onToggle(path)} className="mx-1 rounded bg-default px-1.5 text-muted">
              {entries.length} {isArray ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}
            </button>
          )}
          {folded && (
            <span className="text-muted">
              {close}
              {comma}
            </span>
          )}
        </span>
      </div>
      {!folded && (
        <>
          {entries.map(([key, child], index) => (
            <Node
              key={key}
              value={child as Json}
              path={`${path}.${key}`}
              depth={depth + 1}
              name={isArray ? undefined : key}
              collapsed={collapsed}
              onToggle={onToggle}
              last={index === entries.length - 1}
            />
          ))}
          <div style={indent} className="text-muted">
            {close}
            {comma}
          </div>
        </>
      )}
    </div>
  );
});

function Primitive({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="text-muted italic">null</span>;
  if (typeof value === 'string') return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-warning">{value}</span>;
  return <span className="text-danger">{String(value)}</span>;
}
