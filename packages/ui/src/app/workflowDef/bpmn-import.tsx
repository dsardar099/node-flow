'use client';

import { FileArrowUp, TriangleExclamation } from '@gravity-ui/icons';
import { Button, Card, Description, Input, Label, Modal, TextField, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { mutate } from '../../lib/mutate';

/**
 * Importing a BPMN diagram as a starting point.
 *
 * The framing is the feature. BPMN is a graph and a node-flow definition is a
 * tree, so a faithful conversion is impossible in general — and a converter
 * that hid that would produce workflows which look right in a diagram and take
 * a different path in production.
 *
 * So this never saves anything. It converts, shows **every** warning before the
 * draft, and hands the result to the editor for a person to finish. The
 * warnings are above the fold and not collapsible, because the one that matters
 * — a loop that became a straight line — is exactly the one someone scrolling
 * past would miss.
 */
export function ImportBpmnModal({
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
  const [xml, setXml] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [name, setName] = useState('');
  const [warnings, setWarnings] = useState<string[]>();
  const [draft, setDraft] = useState<Record<string, unknown>>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setXml('');
    setFileName(undefined);
    setName('');
    setWarnings(undefined);
    setDraft(undefined);
  };

  const read = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setXml(text);
    setWarnings(undefined);
    setDraft(undefined);
  };

  const convert = async () => {
    setBusy(true);
    try {
      const result = await mutate<{
        definition: Record<string, unknown>;
        warnings: string[];
        valid: boolean;
        issues?: { message: string }[];
      }>(`/v1/ns/${namespace}/metadata/workflows/import-bpmn`, { body: { xml } });

      setDraft(result.definition);
      setName(String(result.definition['name'] ?? ''));
      setWarnings([
        ...result.warnings,
        // A draft that will not register is worth saying plainly here rather
        // than letting the editor discover it on save.
        ...(result.valid ? [] : (result.issues ?? []).map((issue) => issue.message)),
      ]);
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hands the draft to the editor rather than registering it.
   *
   * Carried in session storage, not the URL: a definition of any size does not
   * fit in a query string, and a draft is not something to put in browser
   * history.
   */
  const openInEditor = () => {
    if (!draft) return;
    try {
      sessionStorage.setItem('nf.draft', JSON.stringify({ ...draft, name: name.trim() || draft['name'] }));
    } catch {
      toast.danger('This browser would not hold the draft; copy the JSON instead.');
      return;
    }
    onOpenChange(false);
    reset();
    router.push('/newWorkflowDef?from=bpmn');
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => { if (!open) reset(); onOpenChange(open); }}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-2xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Import BPMN</Modal.Heading>
            <p className="text-sm text-muted">
              Converts a BPMN 2.0 process into a draft you edit before saving. Nothing is registered here.
            </p>
          </Modal.Header>

          <Modal.Body className="space-y-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void read(file);
              }}
              className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center transition ${
                dragging ? 'border-accent bg-accent-soft/40' : 'border-separator'
              }`}
            >
              <FileArrowUp className="size-7 text-muted" />
              <p className="text-sm">{fileName ? <span className="font-mono">{fileName}</span> : 'Drop a .bpmn file here'}</p>
              <Button size="sm" variant="secondary" onPress={() => input.current?.click()}>
                {fileName ? 'Choose another file' : 'Choose a file'}
              </Button>
              <input
                ref={input}
                type="file"
                accept=".bpmn,.xml,application/xml,text/xml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void read(file);
                  event.target.value = '';
                }}
              />
            </div>

            {warnings !== undefined && warnings.length > 0 && (
              <Card className="gap-2 border-warning/40 bg-warning-soft/30 p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-warning">
                  <TriangleExclamation className="size-4" />
                  {warnings.length === 1 ? 'One thing needs your attention' : `${warnings.length} things need your attention`}
                </span>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Card>
            )}

            {warnings !== undefined && warnings.length === 0 && (
              <p className="text-sm text-success">Everything in the diagram converted cleanly.</p>
            )}

            {draft && (
              <>
                <TextField value={name} onChange={setName}>
                  <Label>Workflow name</Label>
                  <Input className="font-mono" />
                  <Description>Taken from the BPMN process name. Change it before saving if you like.</Description>
                </TextField>
                <pre className="max-h-56 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">
                  {JSON.stringify(draft, null, 2)}
                </pre>
              </>
            )}
          </Modal.Body>

          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
            {draft ? (
              <Button onPress={openInEditor}>Open in editor</Button>
            ) : (
              <Button isDisabled={!xml || busy} isPending={busy} onPress={() => void convert()}>
                Convert
              </Button>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
