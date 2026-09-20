'use client';

import { ArrowUpRightFromSquare, PaperPlane } from '@gravity-ui/icons';
import { Alert, Button, Description, FieldError, Input, Label, Modal, TextArea, TextField } from '@heroui/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mutate } from '../../lib/mutate';

export interface TestOutcome {
  outcome: 'ACTED' | 'SKIPPED' | 'FAILED';
  workflowId?: string;
  detail?: string;
}

const OUTCOME: Record<TestOutcome['outcome'], { status: 'success' | 'warning' | 'danger'; title: string }> = {
  ACTED: { status: 'success', title: 'The handler acted on the message' },
  SKIPPED: { status: 'warning', title: 'The handler saw the message and did nothing' },
  FAILED: { status: 'danger', title: 'The handler failed' },
};

/**
 * Sends one message to one handler, through the same path a real delivery takes.
 *
 * The result stays in the dialog rather than a toast: "skipped — condition did
 * not match" is the answer someone tuning a condition needs next to the payload
 * they are editing, so they can change one and send again.
 */
export function TestMessageDialog({
  namespace,
  handlerName,
  isOpen,
  onOpenChange,
  initialPayload,
  initialKey,
  onSent,
}: {
  namespace: string;
  handlerName: string | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialPayload?: Record<string, unknown>;
  initialKey?: string | null;
  onSent?: (outcome: TestOutcome) => void;
}) {
  const [payload, setPayload] = useState('{}');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestOutcome>();

  useEffect(() => {
    if (!isOpen) return;
    setPayload(JSON.stringify(initialPayload ?? {}, null, 2));
    setKey(initialKey ?? '');
    setError(undefined);
    setResult(undefined);
  }, [isOpen, initialPayload, initialKey]);

  const send = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      setError('The payload must be a JSON object.');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const outcome = await mutate<TestOutcome>(
        `/v1/ns/${namespace}/event-handlers/${encodeURIComponent(handlerName ?? '')}/test`,
        { body: { payload: parsed, ...(key ? { key } : {}) } }
      );
      setResult(outcome);
      onSent?.(outcome);
    } catch (failure) {
      setResult({ outcome: 'FAILED', detail: (failure as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Send a test message</Modal.Heading>
            <p className="text-sm text-muted">
              Delivered to <span className="font-mono text-foreground">{handlerName}</span> exactly as a real message
              would be — it really starts or completes what the handler says.
            </p>
          </Modal.Header>

          <Modal.Body className="space-y-4">
            <TextField isInvalid={Boolean(error)} value={payload} onChange={setPayload}>
              <Label>Payload</Label>
              <TextArea rows={9} spellCheck={false} className="font-mono text-sm" />
              <Description>
                Read in templates as <span className="font-mono">{'${event.output.field}'}</span> and in conditions as{' '}
                <span className="font-mono">$.field</span>.
              </Description>
              <FieldError>{error}</FieldError>
            </TextField>
            <TextField value={key} onChange={setKey}>
              <Label>Message key</Label>
              <Input placeholder="Optional" className="font-mono" />
            </TextField>

            {result && (
              <Alert status={OUTCOME[result.outcome].status}>
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{OUTCOME[result.outcome].title}</Alert.Title>
                  {result.detail && <Alert.Description>{result.detail}</Alert.Description>}
                </Alert.Content>
                {result.workflowId && (
                  <Link href={`/execution/${result.workflowId}`} className="button button--secondary button--sm shrink-0">
                    <ArrowUpRightFromSquare />
                    Open execution
                  </Link>
                )}
              </Alert>
            )}
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Close
            </Button>
            <Button isPending={busy} isDisabled={!handlerName} onPress={send}>
              <PaperPlane />
              {result ? 'Send again' : 'Send message'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
