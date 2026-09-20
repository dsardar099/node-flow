'use client';

import { CodeCompare } from '@gravity-ui/icons';
import { Chip, Label, ListBox, Modal, Select, Spinner } from '@heroui/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { comparable, describeChanges, diffLines, hunks, type DiffLine } from '../../lib/dag/diff';
import type { Definition } from '../../lib/dag/edit';
import { fetchJson } from '../../lib/fetch-json';

const DRAFT = 'draft';

/**
 * Compare two versions of a workflow — or a version against unsaved edits.
 *
 * Opens on the question usually being asked: "what did the last change do?",
 * so the defaults are the previous version against the newest (or against the
 * draft, when there is one). The summary names tasks and settings first; the
 * diff below shows exactly how, with only the changed regions expanded.
 */
export function CompareVersions({
  namespace,
  name,
  versions,
  draft,
  dirty,
  isOpen,
  onOpenChange,
}: {
  namespace: string;
  name: string;
  versions: number[];
  draft: Definition;
  dirty: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b - a), [versions]);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [loaded, setLoaded] = useState<Record<string, Definition>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isOpen) return;
    setTo(dirty ? DRAFT : String(sorted[0] ?? ''));
    setFrom(String(dirty ? (sorted[0] ?? '') : (sorted[1] ?? sorted[0] ?? '')));
  }, [isOpen, dirty, sorted]);

  useEffect(() => {
    if (!isOpen) return;
    for (const version of [from, to]) {
      if (!version || version === DRAFT || loaded[version]) continue;
      fetchJson<Definition>(`/v1/ns/${namespace}/metadata/workflows/${encodeURIComponent(name)}?version=${version}`)
        .then((definition) => setLoaded((all) => ({ ...all, [version]: definition })))
        .catch((failure) => setError((failure as Error).message));
    }
  }, [isOpen, from, to, namespace, name, loaded]);

  const resolve = (version: string) => (version === DRAFT ? draft : loaded[version]);
  const before = resolve(from);
  const after = resolve(to);

  const result = useMemo(() => {
    if (!before || !after) return undefined;
    return {
      changes: describeChanges(before, after),
      hunks: hunks(diffLines(comparable(before), comparable(after)), 3),
    };
  }, [before, after]);

  const options = [...(dirty ? [{ id: DRAFT, label: 'Unsaved changes' }] : []), ...sorted.map((v, i) => ({ id: String(v), label: `Version ${v}${i === 0 ? ' (latest)' : ''}` }))];

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container scroll="outside">
        <Modal.Dialog className="sm:max-w-5xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <CodeCompare className="size-5 text-muted" />
              Compare versions of <span className="font-mono">{name}</span>
            </Modal.Heading>
          </Modal.Header>

          <Modal.Body className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <VersionSelect label="From" value={from} options={options} onChange={setFrom} />
              <VersionSelect label="To" value={to} options={options} onChange={setTo} />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            {!result ? (
              <Spinner className="mx-auto my-10 block" />
            ) : result.hunks.length === 0 ? (
              <p className="rounded-xl bg-surface-secondary px-4 py-8 text-center text-sm text-muted">These are identical.</p>
            ) : (
              <>
                <section className="flex flex-wrap items-center gap-1.5" aria-label="Summary">
                  {result.changes.tasks.map((change) => (
                    <Chip
                      key={`${change.kind}-${change.ref}`}
                      size="sm"
                      variant="soft"
                      color={change.kind === 'added' ? 'success' : change.kind === 'removed' ? 'danger' : 'warning'}
                    >
                      <span className="font-mono">
                        {change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~'} {change.ref}
                      </span>
                      {change.fields && <span className="opacity-70">{change.fields.join(', ')}</span>}
                    </Chip>
                  ))}
                  {result.changes.settings.map((setting) => (
                    <Chip key={setting} size="sm" variant="soft" color="accent">
                      <span className="font-mono">{setting}</span>
                    </Chip>
                  ))}
                  {result.changes.tasks.length === 0 && result.changes.settings.length === 0 && (
                    <span className="text-sm text-muted">Formatting only.</span>
                  )}
                </section>

                <div className="overflow-hidden rounded-xl border border-separator font-mono text-xs">
                  {result.hunks.map((hunk, index) => (
                    <Fragment key={index}>
                      {index > 0 && <div className="border-y border-separator bg-surface-secondary px-3 py-1 text-muted">⋯</div>}
                      {hunk.lines.map((line, i) => (
                        <DiffLineRow key={i} line={line} />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function VersionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || null} onChange={(next) => next !== null && onChange(String(next))}>
      <Label>{label}</Label>
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

export function DiffLineRow({ line }: { line: DiffLine }) {
  const tone =
    line.kind === 'added' ? 'bg-success-soft text-success' : line.kind === 'removed' ? 'bg-danger-soft text-danger' : 'text-foreground/80';
  return (
    <div className={`grid grid-cols-[3rem_3rem_1.25rem_1fr] ${tone}`}>
      <span className="select-none px-2 text-right text-muted/70">{line.oldLine ?? ''}</span>
      <span className="select-none px-2 text-right text-muted/70">{line.newLine ?? ''}</span>
      <span className="select-none text-center">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
      <span className="whitespace-pre-wrap break-all pr-3">{line.text}</span>
    </div>
  );
}
