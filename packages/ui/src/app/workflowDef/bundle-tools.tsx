'use client';

import { ArrowUpFromLine, CircleExclamation, FileArrowUp } from '@gravity-ui/icons';
import { Button, Chip, Description, Label, Modal, Radio, RadioGroup, Spinner, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { mutate } from '../../lib/mutate';

/** Downloads workflows (all reachable, or the named ones with what they need) as one JSON file. */
export async function downloadBundle(namespace: string, workflows?: string[]): Promise<void> {
  try {
    const bundle = await mutate<{ workflows: unknown[]; taskDefinitions: unknown[] }>(`/v1/ns/${namespace}/metadata/export`, {
      body: workflows ? { workflows } : {},
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.download = workflows?.length === 1 ? `${workflows[0]}-${stamp}.nodeflow.json` : `${namespace}-definitions-${stamp}.nodeflow.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast.success(
      `Exported ${bundle.workflows.length} workflow${bundle.workflows.length === 1 ? '' : 's'} and ${bundle.taskDefinitions.length} task definition${
        bundle.taskDefinitions.length === 1 ? '' : 's'
      }`
    );
  } catch (failure) {
    toast.danger((failure as Error).message);
  }
}

type Action = 'created' | 'updated' | 'unchanged' | 'skipped' | 'new-version' | 'invalid';

interface Report {
  dryRun: boolean;
  applied: boolean;
  items: { kind: 'workflow' | 'taskDefinition'; name: string; version?: number; importedAs?: number; action: Action; message?: string }[];
  summary: Record<Action, number>;
}

const ACTION: Record<Action, { label: string; color: 'success' | 'accent' | 'default' | 'warning' | 'danger' }> = {
  created: { label: 'New', color: 'success' },
  updated: { label: 'Overwrite', color: 'accent' },
  'new-version': { label: 'New version', color: 'accent' },
  unchanged: { label: 'Unchanged', color: 'default' },
  skipped: { label: 'Skipped', color: 'warning' },
  invalid: { label: 'Invalid', color: 'danger' },
};

/**
 * A bundle into the namespace, previewed first.
 *
 * Every change of file or option re-runs the import as a dry run, so what the
 * table shows is exactly what "Import" will do — computed by the server with
 * the same code, not guessed in the browser.
 */
export function ImportDefinitionsModal({
  namespace,
  isOpen,
  onOpenChange,
}: {
  namespace: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>();
  const [bundle, setBundle] = useState<Record<string, unknown>>();
  const [readError, setReadError] = useState<string>();
  const [workflowConflicts, setWorkflowConflicts] = useState<'skip' | 'new-version'>('skip');
  const [taskDefinitionConflicts, setTaskDefinitionConflicts] = useState<'skip' | 'overwrite'>('skip');
  const [preview, setPreview] = useState<Report>();
  const [previewError, setPreviewError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (isOpen) return;
    setFileName(undefined);
    setBundle(undefined);
    setReadError(undefined);
    setPreview(undefined);
    setPreviewError(undefined);
  }, [isOpen]);

  useEffect(() => {
    if (!bundle) return;
    let cancelled = false;
    setChecking(true);
    mutate<Report>(`/v1/ns/${namespace}/metadata/import`, { body: { bundle, workflowConflicts, taskDefinitionConflicts, dryRun: true } })
      .then((report) => {
        if (cancelled) return;
        setPreview(report);
        setPreviewError(undefined);
      })
      .catch((failure) => {
        if (cancelled) return;
        setPreview(undefined);
        setPreviewError((failure as Error).message);
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [bundle, workflowConflicts, taskDefinitionConflicts, namespace]);

  const read = async (file: File) => {
    setFileName(file.name);
    setPreview(undefined);
    setPreviewError(undefined);
    try {
      if (file.size > 1_000_000) throw new Error('The file is over 1 MB. Export fewer workflows at a time.');
      setBundle(asBundle(JSON.parse(await file.text())));
      setReadError(undefined);
    } catch (failure) {
      setBundle(undefined);
      setReadError(failure instanceof SyntaxError ? 'This file is not valid JSON.' : (failure as Error).message);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  };

  const apply = async () => {
    if (!bundle) return;
    setImporting(true);
    try {
      const report = await mutate<Report>(`/v1/ns/${namespace}/metadata/import`, {
        body: { bundle, workflowConflicts, taskDefinitionConflicts },
      });
      const written = report.items.filter((item) => item.action === 'created' || item.action === 'new-version' || item.action === 'updated');
      const workflows = written.filter((item) => item.kind === 'workflow').length;
      const tasks = written.length - workflows;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      toast.success(
        `Imported ${[workflows && plural(workflows, 'workflow version'), tasks && plural(tasks, 'task definition')].filter(Boolean).join(' and ')}`
      );
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const changes = preview ? preview.summary.created + preview.summary.updated + preview.summary['new-version'] : 0;
  const invalid = preview ? preview.summary.invalid : 0;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-2xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Import definitions</Modal.Heading>
            <p className="text-sm text-muted">A bundle exported from node-flow, or a single workflow’s JSON. Nothing is written until you import.</p>
          </Modal.Header>

          <Modal.Body className="space-y-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
                dragging ? 'border-accent bg-accent-soft/40' : 'border-separator'
              }`}
            >
              <FileArrowUp className="size-7 text-muted" />
              <p className="text-sm">{fileName ? <span className="font-mono">{fileName}</span> : 'Drop a .json file here'}</p>
              <Button size="sm" variant="secondary" onPress={() => input.current?.click()}>
                {fileName ? 'Choose another file' : 'Choose a file'}
              </Button>
              <input
                ref={input}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void read(file);
                  event.target.value = '';
                }}
              />
              {readError && <p className="text-sm text-danger">{readError}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <RadioGroup value={workflowConflicts} onChange={(value) => setWorkflowConflicts(value as typeof workflowConflicts)}>
                <Label>A workflow version that exists but differs</Label>
                <Option value="skip" label="Keep what is here" />
                <Option value="new-version" label="Import it as the next version" />
                <Description>Versions never change once registered.</Description>
              </RadioGroup>
              <RadioGroup
                value={taskDefinitionConflicts}
                onChange={(value) => setTaskDefinitionConflicts(value as typeof taskDefinitionConflicts)}
              >
                <Label>A task definition that exists but differs</Label>
                <Option value="skip" label="Keep what is here" />
                <Option value="overwrite" label="Overwrite it" />
              </RadioGroup>
            </div>

            {checking && !preview ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : previewError ? (
              <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
                <CircleExclamation className="mt-0.5 size-4 shrink-0" />
                {previewError}
              </p>
            ) : preview ? (
              <section className="space-y-3" aria-label="Import preview">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(Object.keys(ACTION) as Action[])
                    .filter((action) => preview.summary[action] > 0)
                    .map((action) => (
                      <Chip key={action} size="sm" variant="soft" color={ACTION[action].color}>
                        {preview.summary[action]} {ACTION[action].label.toLowerCase()}
                      </Chip>
                    ))}
                  {checking && <Spinner size="sm" />}
                </div>
                {invalid > 0 && (
                  <p className="text-sm text-danger">Fix the invalid definitions first — nothing is imported while any are invalid.</p>
                )}
                <ul className="max-h-64 divide-y divide-separator overflow-y-auto rounded-xl border border-separator">
                  {preview.items.map((item, index) => (
                    <li key={`${item.kind}-${item.name}-${item.version ?? ''}-${index}`} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-mono">{item.name}</span>
                          {item.version !== undefined && <span className="ml-1 text-xs text-muted">v{item.version}</span>}
                          {item.importedAs !== undefined && <span className="ml-1 text-xs text-accent">→ v{item.importedAs}</span>}
                        </p>
                        <p className="text-xs text-muted">
                          {item.kind === 'workflow' ? 'Workflow' : 'Task definition'}
                          {item.message && <span className={item.action === 'invalid' ? 'text-danger' : ''}> · {item.message}</span>}
                        </p>
                      </div>
                      <Chip size="sm" variant="soft" color={ACTION[item.action].color}>
                        {ACTION[item.action].label}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button isPending={importing} isDisabled={!preview || invalid > 0 || changes === 0 || checking} onPress={apply}>
              <ArrowUpFromLine />
              {preview && changes === 0 && invalid === 0 ? 'Nothing to import' : `Import${changes ? ` ${changes}` : ''}`}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function Option({ value, label }: { value: string; label: string }) {
  return (
    <Radio value={value}>
      <Radio.Content>
        <Radio.Control>
          <Radio.Indicator />
        </Radio.Control>
        <span className="text-sm">{label}</span>
      </Radio.Content>
    </Radio>
  );
}

/**
 * What a file most likely is: a bundle, one workflow definition (the editor's
 * download), or a plain list of definitions.
 */
function asBundle(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { workflows: value };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('workflows' in record || 'taskDefinitions' in record) return record;
    if (Array.isArray(record['tasks']) && typeof record['name'] === 'string') return { workflows: [record] };
  }
  throw new Error('This file is not a definitions bundle or a workflow definition.');
}
