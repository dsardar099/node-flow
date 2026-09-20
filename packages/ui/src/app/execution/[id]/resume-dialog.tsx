'use client';

import { CirclePlay } from '@gravity-ui/icons';
import { Button, Description, FieldError, Label, ListBox, Modal, Select, TextArea, TextField, toast } from '@heroui/react';
import { useEffect, useState } from 'react';
import { mutate } from '../../../lib/mutate';

/**
 * Resumes a WAIT or YIELD task — the UI side of `POST /executions/:id/signal`.
 *
 * The output given here is what the next tasks read as `${ref.output.…}`, so
 * the dialog asks for it as JSON rather than offering a bare "continue": a
 * yield is usually waiting for a *decision*, and a resume without one tends
 * to fail two tasks later on a missing field.
 */
export function ResumeDialog({
  namespace,
  workflowId,
  refName,
  isOpen,
  onOpenChange,
  onResumed,
}: {
  namespace: string;
  workflowId: string;
  refName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onResumed: () => void;
}) {
  const [output, setOutput] = useState('{}');
  const [status, setStatus] = useState<'COMPLETED' | 'FAILED'>('COMPLETED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setOutput('{}');
    setStatus('COMPLETED');
    setReason('');
    setError(undefined);
  }, [isOpen]);

  const resume = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      setError('The output must be a JSON object.');
      return;
    }
    setBusy(true);
    try {
      await mutate(`/v1/ns/${namespace}/executions/${workflowId}/signal`, {
        body: { taskRef: refName, status, output: parsed, ...(status === 'FAILED' && reason ? { reason } : {}) },
      });
      toast.success(status === 'COMPLETED' ? `Resumed ${refName}` : `Failed ${refName}`);
      onOpenChange(false);
      onResumed();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              Resume <span className="font-mono">{refName}</span>
            </Modal.Heading>
            <p className="text-sm text-muted">The workflow continues from here with the output you give.</p>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <Select value={status} onChange={(value) => value && setStatus(value as typeof status)}>
              <Label>Outcome</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="COMPLETED" textValue="Complete">
                    Complete
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="FAILED" textValue="Fail">
                    Fail
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <TextField value={output} onChange={setOutput} isInvalid={Boolean(error)}>
              <Label>Output</Label>
              <TextArea rows={6} spellCheck={false} className="font-mono text-xs" />
              <Description>
                Later tasks read it as <span className="font-mono">{`\${${refName}.output.field}`}</span>.
              </Description>
              <FieldError>{error}</FieldError>
            </TextField>
            {status === 'FAILED' && (
              <TextField value={reason} onChange={setReason}>
                <Label>Reason</Label>
                <TextArea rows={2} />
              </TextField>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button isPending={busy} variant={status === 'FAILED' ? 'danger' : 'primary'} onPress={resume}>
              <CirclePlay />
              {status === 'FAILED' ? 'Fail task' : 'Resume'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
