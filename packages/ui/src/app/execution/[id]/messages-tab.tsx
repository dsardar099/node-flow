'use client';
import { Comments, PaperPlane } from '@gravity-ui/icons';
import { Button, Card, Chip, Description, FieldError, Label, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../../../components/ui/format';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { fetchJson } from '../../../lib/fetch-json';
import { mutate } from '../../../lib/mutate';
import { TERMINAL_WORKFLOW, type ExecutionDetail } from './types';
import { Ago } from '../../../components/ui/ago';
interface WorkflowMessage {
  id: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  consumedByTaskId: string | null;
  consumedAt: string | null;
}
/**
 * The execution's message queue: what was pushed in, and which pull took it.
 *
 * The composer sits above the list, because on a running execution the thing
 * to do here is usually to send the next message — and seeing it land in the
 * list, then marked as taken, is the confirmation that the workflow read it.
 */
export function MessagesTab({
  namespace,
  execution,
  mayOperate,
  onOpenTask,
}: {
  namespace: string;
  execution: ExecutionDetail;
  mayOperate: boolean;
  onOpenTask: (ref: string) => void;
}) {
  const [messages, setMessages] = useState<WorkflowMessage[]>();
  const [draft, setDraft] = useState('{\n  \n}');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const running = !TERMINAL_WORKFLOW.has(execution.status);
  const load = useCallback(async () => {
    const result = await fetchJson<{ messages: WorkflowMessage[] }>(`/v1/ns/${namespace}/executions/${execution.id}/messages`);
    setMessages(result.messages);
  }, [namespace, execution.id]);
  const version = `${execution.status}:${execution.tasks.map((t) => t.status).join('')}`;
  useEffect(() => {
    void load().catch(() => setMessages([]));
  }, [load, version]);
  const send = async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(draft);
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    } catch {
      setError('A message is a JSON object.');
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      const result = await mutate<{ delivered: boolean }>(`/v1/ns/${namespace}/executions/${execution.id}/messages`, {
        body: { payload },
      });
      toast.success(result.delivered ? 'Delivered to the waiting task' : 'Queued until the workflow pulls it');
      await load();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSending(false);
    }
  };
  const consumer = (taskId: string | null) => execution.tasks.find((t) => t.id === taskId);
  const pending = messages?.filter((m) => !m.consumedAt).length ?? 0;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {running && mayOperate && (
        <Card className="gap-3 p-5">
          <TextField value={draft} onChange={setDraft} isInvalid={Boolean(error)}>
            <Label>Send a message</Label>
            <TextArea rows={5} spellCheck={false} className="font-mono text-sm" />
            <Description>
              A <span className="font-mono">PULL_WORKFLOW_MESSAGES</span> task receives it as{' '}
              <span className="font-mono">output.messages[].payload</span>, oldest first.
            </Description>
            <FieldError>{error}</FieldError>
          </TextField>
          <div className="flex justify-end">
            <Button onPress={send} isPending={sending}>
              <PaperPlane />
              Send message
            </Button>
          </div>
        </Card>
      )}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-separator px-5 py-3">
          <h3 className="font-semibold">Messages</h3>
          {messages && (
            <span className="text-sm text-muted">
              {messages.length} received{pending ? ` · ${pending} waiting to be pulled` : ''}
            </span>
          )}
        </div>
        {!messages ? (
          <Spinner className="mx-auto my-10 block" />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Comments className="size-6 text-muted" />
            <p className="text-sm text-muted">No messages have been pushed into this execution.</p>
          </div>
        ) : (
          <ol className="divide-y divide-separator">
            {[...messages].reverse().map((message) => {
              const task = consumer(message.consumedByTaskId);
              return (
                <li key={message.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted">#{message.id}</span>
                    <span title={formatDateTime(message.receivedAt)}><Ago value={message.receivedAt} /></span>
                    {message.consumedAt ? (
                      <Chip size="sm" variant="soft" color="success">
                        Taken{task ? ' by' : ''}
                        {task && (
                          <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => onOpenTask(task.refName)}>
                            {task.refName}
                          </button>
                        )}
                      </Chip>
                    ) : (
                      <Chip size="sm" variant="soft" color="warning">
                        Waiting
                      </Chip>
                    )}
                  </div>
                  <JsonViewer value={message.payload} filename={`message-${message.id}`} maxHeight="16rem" toolbar={false} />
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
