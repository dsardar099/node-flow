'use client';

import { Magnifier, PaperPlane, Sparkles } from '@gravity-ui/icons';
import { Button, Card, Chip, Label, ListBox, Select, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { mutate } from '../../../lib/mutate';
import { DRAFT_KEY } from '../../newWorkflowDef/draft-editor';

/**
 * The assistant, and what it deliberately cannot do.
 *
 * It reads: workflows, executions, and a validation verdict on a draft. It
 * cannot start, retry, terminate or register anything, and the UI says so
 * rather than leaving people to discover the boundary by asking. An assistant
 * that could act would be one misread away from terminating a production run,
 * and "the prompt told it not to" is not a control.
 *
 * Every answer shows **what it looked at**. That trace is the difference
 * between an answer someone can check and one they have to believe, and for a
 * tool whose failure mode is confident invention it is not optional.
 */

interface Step {
  tool: string;
  input: unknown;
  summary: string;
}

interface Answer {
  text: string;
  steps: Step[];
  proposal?: { definition: Record<string, unknown>; valid: boolean; issues?: unknown };
  usage: { inputTokens: number; outputTokens: number };
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  steps?: Step[];
  proposal?: Answer['proposal'];
}

const SUGGESTIONS = [
  'Which workflows have failed recently, and why?',
  'What does the refund workflow do?',
  'Draft a workflow that calls an API and emails the result.',
];

export function AssistantChat({ namespace, providers }: { namespace: string; providers: string[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState(providers[0] ?? '');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  const ask = async (text: string) => {
    if (!text.trim() || !provider) return;
    const history: Turn[] = [...turns, { role: 'user', content: text.trim() }];
    setTurns(history);
    setQuestion('');
    setBusy(true);

    try {
      const answer = await mutate<Answer>(`/v1/ns/${namespace}/assistant`, {
        body: {
          llmProvider: provider,
          // Only the text goes back — the traces are for the reader, and
          // resending them would spend the model's context on its own notes.
          messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
        },
      });
      setTurns([...history, { role: 'assistant', content: answer.text, steps: answer.steps, proposal: answer.proposal }]);
    } catch (failure) {
      toast.danger((failure as Error).message);
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  const openProposal = (definition: Record<string, unknown>) => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(definition));
    } catch {
      toast.danger('This browser would not hold the draft; copy the JSON instead.');
      return;
    }
    router.push('/newWorkflowDef?from=template');
  };

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Asks your own workflows and runs. It can read and draft; it cannot start, retry, terminate or save anything."
      />

      <div className="space-y-4 px-4 pb-10 md:px-8">
        {providers.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Sparkles className="size-6" />
            </span>
            <span className="text-sm font-medium">No model provider yet</span>
            <span className="max-w-md text-sm text-muted">
              The assistant uses an LLM integration from this namespace. Add one under AI → Integrations and it appears here.
            </span>
            <Button size="sm" variant="secondary" onPress={() => router.push('/ai/integrations')}>
              Go to integrations
            </Button>
          </Card>
        ) : (
          <>
            {turns.length === 0 && (
              <Card className="gap-3 p-5">
                <span className="text-sm font-medium">Ask about this namespace</span>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <Button key={suggestion} size="sm" variant="secondary" onPress={() => void ask(suggestion)}>
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            {turns.map((turn, index) => (
              <Card
                key={`${turn.role}-${index}`}
                className={`gap-3 p-4 ${turn.role === 'user' ? 'bg-surface-2' : ''}`}
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {turn.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <p className="whitespace-pre-wrap text-sm">{turn.content}</p>

                {turn.steps && turn.steps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-separator pt-3">
                    <Magnifier className="size-3.5 text-muted" />
                    <span className="text-xs text-muted">Looked at</span>
                    {turn.steps.map((step, position) => (
                      <Chip key={`${step.tool}-${position}`} size="sm" variant="soft" className="font-mono">
                        {step.tool}
                        <span className="ml-1 font-sans text-muted">— {step.summary}</span>
                      </Chip>
                    ))}
                  </div>
                )}

                {turn.proposal && (
                  <div className="space-y-2 border-t border-separator pt-3">
                    <div className="flex items-center gap-2">
                      <Chip size="sm" variant="soft" color={turn.proposal.valid ? 'success' : 'warning'}>
                        {turn.proposal.valid ? 'Draft is valid' : 'Draft has problems'}
                      </Chip>
                      <Button size="sm" variant="secondary" onPress={() => openProposal(turn.proposal?.definition ?? {})}>
                        Open in editor
                      </Button>
                    </div>
                    <pre className="max-h-56 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">
                      {JSON.stringify(turn.proposal.definition, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            ))}

            {busy && (
              <Card className="flex flex-row items-center gap-3 p-4">
                <Spinner size="sm" />
                <span className="text-sm text-muted">Looking…</span>
              </Card>
            )}

            <Card className="gap-3 p-4">
              <TextField value={question} onChange={setQuestion}>
                <Label className="sr-only">Your question</Label>
                <TextArea
                  rows={3}
                  placeholder="Ask about a workflow, a failed run, or describe one you want to build…"
                  onKeyDown={(event) => {
                    // Enter sends, Shift+Enter adds a line: the convention every
                    // chat input has, and getting it wrong is immediately felt.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void ask(question);
                    }
                  }}
                />
              </TextField>

              <div className="flex items-center justify-between gap-3">
                {providers.length > 1 ? (
                  <Select selectedKey={provider} onSelectionChange={(key) => setProvider(String(key))} className="max-w-56">
                    <Label className="sr-only">Model provider</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {providers.map((name) => (
                          <ListBox.Item key={name} id={name} textValue={name}>
                            {name}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : (
                  <span className="font-mono text-xs text-muted">{provider}</span>
                )}

                <Button isDisabled={!question.trim() || busy} isPending={busy} onPress={() => void ask(question)}>
                  <PaperPlane />
                  Ask
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
