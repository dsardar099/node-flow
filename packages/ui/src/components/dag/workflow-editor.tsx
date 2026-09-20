'use client';

import {
  ArrowDownToLine,
  ArrowRotateLeft,
  ArrowUturnCcwLeft,
  ArrowUturnCwRight,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleExclamation,
  CirclePlay,
  CodeCompare,
  Flask,
  FloppyDisk,
  TrashBin,
} from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Link,
  ListBox,
  Select,
  Spinner,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Definition, InsertPoint } from '../../lib/dag/edit';
import { getIn, pathKey } from '../../lib/dag/path';
import { commitPendingEdits } from '../../lib/commit-pending';
import { mutate } from '../../lib/mutate';
import { PageHeader } from '../shell/page-header';
import { Palette } from './palette';
import { TaskForm } from './task-form';
import { TestPanel } from './test-panel';
import { CompareVersions } from './compare-versions';
import { useEditor, withoutVersion, type Issue, type Verdict } from './use-editor';
import { WorkflowGraph } from './workflow-graph';
import { WorkflowSettings } from './workflow-settings';
import type { WorkflowTask } from '@node-flow-dev/core';

/**
 * The workflow definition editor, laid out as Conductor's: the diagram on the
 * left, a Workflow / Task / Code / Run panel on the right, and a validation bar
 * along the bottom that says whether this will save.
 */
export function WorkflowEditor({
  namespace,
  initial,
  mode,
  versions = [],
  shownVersion,
  mayStart,
  readOnly = false,
}: {
  namespace: string;
  initial: Definition & { version?: number };
  mode: 'new' | 'edit';
  versions?: number[];
  shownVersion?: number;
  mayStart: boolean;
  /** Without `workflows:write`: the same page, with nothing that would fail to save. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const saved = withoutVersion(initial);
  const editor = useEditor(namespace, saved, mode);
  const { present, change, selectedTask, selectedPath, verdict } = editor;

  const [panelTab, setPanelTab] = useState<'workflow' | 'task' | 'code' | 'test' | 'run'>('workflow');
  const [panelOpen, setPanelOpen] = useState(true);
  const [palette, setPalette] = useState<{ at: InsertPoint; anchor: { x: number; y: number } }>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<number>();

  // Selecting a task on the canvas opens the Task tab, as in Conductor.
  const select = useCallback(
    (ref: string | undefined) => {
      editor.setSelectedRef(ref);
      if (ref) {
        setPanelTab('task');
        setPanelOpen(true);
      }
    },
    [editor]
  );

  const openPalette = useCallback(
    (at: InsertPoint, anchor: { x: number; y: number }) => setPalette({ at, anchor }),
    []
  );

  const latest = useRef(editor);
  latest.current = editor;

  const save = async () => {
    await commitPendingEdits();
    // Not `canSave`: the live validation is debounced, so right after the
    // commit it still describes the previous draft and would refuse a save the
    // server — which validates every registration — will judge for itself.
    const { present: body, nextVersion } = latest.current;
    if (nextVersion === undefined || body.name.trim() === '') return;
    setSaving(true);
    try {
      await mutate(`/v1/ns/${namespace}/metadata/workflows`, {
        body: { ...body, version: nextVersion },
      });
      toast.success(`Saved ${body.name} v${nextVersion}`);
      router.replace(`/workflowDef/${encodeURIComponent(body.name)}?version=${nextVersion}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
      setSaving(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...present, version: shownVersion ?? 1 }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${present.name || 'workflow'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteVersion = async () => {
    if (shownVersion === undefined) return;
    try {
      await mutate(
        `/v1/ns/${namespace}/metadata/workflows/${encodeURIComponent(saved.name)}?version=${shownVersion}`,
        { method: 'DELETE' }
      );
      toast.success(`Deleted ${saved.name} v${shownVersion}`);
      const remaining = versions.filter((v) => v !== shownVersion);
      router.replace(
        remaining.length
          ? `/workflowDef/${encodeURIComponent(saved.name)}?version=${Math.max(...remaining)}`
          : '/workflowDef'
      );
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const goToVersion = (version: number) => {
    router.push(`/workflowDef/${encodeURIComponent(saved.name)}?version=${version}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Workflows', href: '/workflowDef' },
          { label: mode === 'new' ? 'New' : saved.name },
        ]}
        title={mode === 'new' ? present.name || 'New workflow' : saved.name}
        badge={
          editor.dirty ? (
            <span className="text-sm text-muted">Unsaved changes</span>
          ) : undefined
        }
        actions={
          <>
            {mode === 'edit' && versions.length > 0 && (
              <Select
                aria-label="Version"
                className="w-44"
                value={String(shownVersion)}
                onChange={(value) => {
                  const version = Number(value);
                  if (version === shownVersion) return;
                  if (editor.dirty) setPendingVersion(version);
                  else goToVersion(version);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {[...versions].sort((a, b) => b - a).map((v, i) => (
                      <ListBox.Item key={v} id={String(v)} textValue={`Version ${v}`}>
                        {i === 0 ? `Latest version (v${v})` : `Version ${v}`}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
            {mode === 'edit' && (versions.length > 1 || editor.dirty) && (
              <IconButton label="Compare versions" onPress={() => setComparing(true)}>
                <CodeCompare />
              </IconButton>
            )}
            <IconButton label="Undo (⌘Z)" isDisabled={!editor.canUndo} onPress={editor.undo}>
              <ArrowUturnCcwLeft />
            </IconButton>
            <IconButton label="Redo (⇧⌘Z)" isDisabled={!editor.canRedo} onPress={editor.redo}>
              <ArrowUturnCwRight />
            </IconButton>
            {mode === 'edit' && (
              <Button variant="ghost" className="text-danger" onPress={() => setConfirmDelete(true)}>
                <TrashBin />
                Delete
              </Button>
            )}
            <Button
              variant="ghost"
              isDisabled={!editor.dirty}
              onPress={() => {
                editor.reset(saved);
                editor.setSelectedRef(undefined);
              }}
            >
              <ArrowRotateLeft />
              Reset
            </Button>
            <Button variant="ghost" onPress={download}>
              <ArrowDownToLine />
              Download
            </Button>
            {mode === 'edit' && mayStart && (
              <Button
                variant="secondary"
                onPress={() => {
                  setPanelTab('run');
                  setPanelOpen(true);
                }}
              >
                <CirclePlay />
                Execute
              </Button>
            )}
            <Button
              variant="secondary"
              onPress={() => {
                setPanelTab('test');
                setPanelOpen(true);
              }}
            >
              <Flask />
              Test
            </Button>
            <Button isDisabled={!editor.canSave} isPending={saving} onPress={save}>
              <FloppyDisk />
              {editor.nextVersion !== undefined && editor.dirty ? `Save as v${editor.nextVersion}` : 'Save'}
            </Button>
          </>
        }
      />

      {editor.nameClash && (
        <p className="mx-6 mb-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          A workflow named “{present.name}” already exists. Saving adds v{editor.nextVersion} to it.
        </p>
      )}

      <div className="flex min-h-0 flex-1 border-t border-border">
        <div className="relative min-w-0 flex-1">
          <WorkflowGraph
            definition={present}
            selected={selectedPath}
            flagged={editor.flagged}
            onSelect={(path) => select(path ? (getIn(present, path) as WorkflowTask).taskReferenceName : undefined)}
            onInsert={openPalette}
            onDelete={editor.remove}
            height="100%"
          />
          {!panelOpen && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute right-3 top-3"
              onPress={() => setPanelOpen(true)}
            >
              Open panel
            </Button>
          )}
        </div>

        {panelOpen && (
          <aside className="flex w-[44%] min-w-[440px] max-w-[760px] flex-col border-l border-border bg-surface">
            <Tabs
              variant="secondary"
              selectedKey={panelTab}
              onSelectionChange={(key) => setPanelTab(key as typeof panelTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center border-b border-border pl-2">
                <IconButton label="Collapse panel" onPress={() => setPanelOpen(false)}>
                  <ChevronsRight />
                </IconButton>
                <Tabs.ListContainer className="flex-1">
                  <Tabs.List aria-label="Editor panel">
                    {(['workflow', 'task', 'code', 'test', 'run'] as const).map((id) => (
                      <Tabs.Tab key={id} id={id} className="w-auto flex-none px-5 capitalize">
                        {id}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>
              </div>

              <Tabs.Panel id="workflow" className="min-h-0 flex-1 overflow-y-auto p-4">
                <WorkflowSettings definition={present} nameLocked={mode === 'edit'} onChange={change} />
              </Tabs.Panel>

              <Tabs.Panel id="task" className="min-h-0 flex-1 overflow-y-auto p-4">
                {selectedTask && selectedPath ? (
                  <TaskForm
                    key={`${pathKey(selectedPath)}:${selectedTask.taskReferenceName}`}
                    definition={present}
                    path={selectedPath}
                    task={selectedTask}
                    onChange={change}
                    onRenamed={(ref) => editor.setSelectedRef(ref)}
                    onDelete={() => editor.remove(selectedPath)}
                  />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">
                    Select a task on the diagram to edit it, or use + on a connection to add one.
                  </p>
                )}
              </Tabs.Panel>

              <Tabs.Panel id="code" className="min-h-0 flex-1 overflow-y-auto p-4">
                <CodePanel key={editor.historyStep} definition={present} onApply={change} />
              </Tabs.Panel>

              <Tabs.Panel id="test" className="min-h-0 flex-1 overflow-y-auto p-4">
                <TestPanel namespace={namespace} definition={present} />
              </Tabs.Panel>

              <Tabs.Panel id="run" className="min-h-0 flex-1 overflow-y-auto p-4">
                {mode === 'new' ? (
                  <p className="py-10 text-center text-sm text-muted">Save the workflow before running it.</p>
                ) : (
                  <RunPanel namespace={namespace} name={saved.name} version={shownVersion} dirty={editor.dirty} definition={saved} />
                )}
              </Tabs.Panel>
            </Tabs>

            <ValidationBar
              verdict={verdict}
              upToDate={editor.upToDate}
              onLocate={(issue) => {
                const path = editor.locate(issue);
                if (path) select((getIn(present, path) as WorkflowTask).taskReferenceName);
              }}
            />
          </aside>
        )}
      </div>

      {palette && (
        <Palette
          anchor={palette.anchor}
          onPick={(type) => {
            editor.insert(type, palette.at);
            setPalette(undefined);
            setPanelTab('task');
            setPanelOpen(true);
          }}
          onClose={() => setPalette(undefined)}
        />
      )}

      {mode === 'edit' && (
        <CompareVersions
          namespace={namespace}
          name={saved.name}
          versions={versions}
          draft={present}
          dirty={editor.dirty}
          isOpen={comparing}
          onOpenChange={setComparing}
        />
      )}

      <AlertDialog.Backdrop isOpen={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {saved.name} v{shownVersion}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm">
                Only this version is deleted. It is refused while an execution of this version is still running.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={deleteVersion}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop
        isOpen={pendingVersion !== undefined}
        onOpenChange={(open) => !open && setPendingVersion(undefined)}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>Discard unsaved changes?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm">Switching to version {pendingVersion} loses the edits you have not saved.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Keep editing
              </Button>
              <Button slot="close" variant="danger" onPress={() => pendingVersion && goToVersion(pendingVersion)}>
                Discard and switch
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

function IconButton({
  label,
  isDisabled,
  onPress,
  children,
}: {
  label: string;
  isDisabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <Button isIconOnly variant="ghost" aria-label={label} isDisabled={isDisabled} onPress={onPress}>
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Conductor's bottom bar: green when this will save, red with the reasons when it will not. */
function ValidationBar({
  verdict,
  upToDate,
  onLocate,
}: {
  verdict: Verdict;
  upToDate: boolean;
  onLocate: (issue: Issue) => void;
}) {
  const [open, setOpen] = useState(false);
  const checking = verdict.state === 'checking' || ((verdict.state === 'valid' || verdict.state === 'invalid') && !upToDate);

  if (checking) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-surface-secondary px-4 py-2.5 text-sm">
        <Spinner size="sm" />
        Checking…
      </div>
    );
  }

  if (verdict.state === 'valid') {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-success/15 px-4 py-2.5 text-sm font-medium">
        <CircleCheck className="text-success" />
        No issues found · {verdict.taskCount} task{verdict.taskCount === 1 ? '' : 's'}
      </div>
    );
  }

  if (verdict.state === 'unavailable') {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-warning/15 px-4 py-2.5 text-sm">
        <CircleExclamation className="text-warning" />
        Could not validate: {verdict.message}
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-danger/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        <CircleExclamation className="text-danger" />
        <span className="flex-1">
          {verdict.issues.length} issue{verdict.issues.length === 1 ? '' : 's'} found
        </span>
        {open ? <ChevronDown /> : <ChevronUp />}
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-4 pb-3">
          {verdict.issues.map((issue, index) => (
            <li key={index}>
              <Link className="text-left text-sm text-danger" onPress={() => onLocate(issue)}>
                {issue.path?.length ? <span className="mr-2 font-mono text-xs">{issue.path.join('.')}</span> : null}
                {issue.message}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Code tab: the whole definition as JSON, applied explicitly as one undo step. */
function CodePanel({ definition, onApply }: { definition: Definition; onApply: (d: Definition) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(definition, null, 2));
  const [error, setError] = useState<string>();

  return (
    <div className="flex h-full flex-col gap-3">
      <TextField value={draft} onChange={setDraft} isInvalid={Boolean(error)} className="flex min-h-0 flex-1 flex-col">
        <Label>Definition JSON</Label>
        <TextArea spellCheck={false} className="min-h-[60vh] flex-1 font-mono text-xs" />
        <FieldError>{error}</FieldError>
      </TextField>
      <div className="flex justify-end gap-2">
        <Button variant="tertiary" onPress={() => setDraft(JSON.stringify(definition, null, 2))}>
          Revert
        </Button>
        <Button
          onPress={() => {
            try {
              const parsed = JSON.parse(draft);
              if (typeof parsed?.name !== 'string' || !Array.isArray(parsed?.tasks)) {
                setError('Needs a string "name" and a "tasks" array.');
                return;
              }
              setError(undefined);
              onApply(withoutVersion(parsed));
              toast.success('Applied');
            } catch (failure) {
              setError(`Not valid JSON: ${(failure as Error).message}`);
            }
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * The Run tab. Runs the *saved* version shown, never unsaved edits — an
 * execution is pinned to a registered version, and pretending otherwise would
 * run something other than what is on screen.
 */
function RunPanel({
  namespace,
  name,
  version,
  dirty,
  definition,
}: {
  namespace: string;
  name: string;
  version?: number;
  dirty: boolean;
  definition: Definition;
}) {
  const router = useRouter();
  const template = () =>
    JSON.stringify(
      Object.fromEntries(((definition.inputParameters as string[] | undefined) ?? []).map((key) => [key, ''])),
      null,
      2
    );
  const [input, setInput] = useState(template);
  const [correlationId, setCorrelationId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ id: string; at: string }[]>([]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(sessionStorage.getItem(`nf.runs.${name}`) ?? '[]'));
    } catch {
      /* storage unavailable */
    }
  }, [name]);

  const run = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      setError('Input must be a JSON object.');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const started = await mutate<{ workflowId: string }>(`/v1/ns/${namespace}/executions/${encodeURIComponent(name)}`, {
        body: {
          input: parsed,
          ...(version ? { version } : {}),
          ...(correlationId ? { correlationId } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      });
      const next = [{ id: started.workflowId, at: new Date().toISOString() }, ...history].slice(0, 10);
      setHistory(next);
      try {
        sessionStorage.setItem(`nf.runs.${name}`, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      toast.success('Execution started', {
        actionProps: { children: 'Open', onPress: () => router.push(`/execution/${started.workflowId}`) },
      });
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {dirty && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          Runs saved version {version}, not your unsaved changes.
        </p>
      )}
      <TextField value={input} onChange={setInput} isInvalid={Boolean(error)}>
        <Label>Input params</Label>
        <TextArea rows={8} spellCheck={false} className="font-mono text-sm" />
        <Description>Pre-filled from the workflow&apos;s declared input parameters.</Description>
        <FieldError>{error}</FieldError>
      </TextField>
      <TextField value={idempotencyKey} onChange={setIdempotencyKey}>
        <Label>Idempotency key</Label>
        <Input />
      </TextField>
      <TextField value={correlationId} onChange={setCorrelationId}>
        <Label>Correlation id</Label>
        <Input />
      </TextField>
      <div className="flex justify-end gap-2">
        <Button variant="tertiary" onPress={() => setInput(template())}>
          <ArrowRotateLeft />
          Reset
        </Button>
        <Button isPending={busy} onPress={run}>
          <CirclePlay />
          Execute v{version}
        </Button>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="mb-2 text-sm font-medium">Workflow run history</p>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No runs from here yet.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((entry) => (
              <li key={entry.id} className="flex justify-between text-sm">
                <Link href={`/execution/${entry.id}`} className="text-accent">
                  {entry.id}
                </Link>
                <span className="tabular text-muted">{new Date(entry.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

