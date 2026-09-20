'use client';

import { Chip } from '@heroui/react';

interface Step {
  step: number;
  text: string;
  toolCalls: { toolName: string; input: unknown }[];
  toolResults?: { toolName: string; isError: boolean }[];
}

/**
 * An agent's run, step by step: what the model said, which tools it called with
 * what, and whether each call worked. The raw transcript is in Output; this is
 * the view that answers "why did it do that?".
 */
export function AgentSteps({ output }: { output: Record<string, unknown> | undefined }) {
  const steps = (Array.isArray(output?.['steps']) ? output['steps'] : []) as Step[];
  const usage = output?.['usage'] as { inputTokens?: number; outputTokens?: number } | undefined;
  const answer = output?.['result'];

  if (steps.length === 0) return <p className="text-sm text-muted">The agent has not taken a step yet.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {steps.length} step{steps.length === 1 ? '' : 's'}
        {usage ? ` · ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out tokens` : ''}
      </p>
      <ol className="space-y-3 border-l border-separator pl-4">
        {steps.map((step) => (
          <li key={step.step} className="relative">
            <span className="absolute -left-[1.4rem] top-1 flex size-3 items-center justify-center rounded-full border-2 border-accent bg-background" />
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Step {step.step}</p>
            {step.text && step.text !== answer && <p className="mt-1 whitespace-pre-wrap text-sm">{step.text}</p>}
            {step.toolCalls.map((call, i) => {
              const result = step.toolResults?.[i];
              return (
                <div key={i} className="mt-2 rounded-xl border border-separator p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{call.toolName}</span>
                    {result ? (
                      <Chip size="sm" variant="soft" color={result.isError ? 'danger' : 'success'}>
                        {result.isError ? 'error' : 'ok'}
                      </Chip>
                    ) : (
                      <Chip size="sm" variant="soft" color="warning">
                        running
                      </Chip>
                    )}
                  </div>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">{JSON.stringify(call.input, null, 2)}</pre>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      {typeof answer === 'string' && answer && (
        <div className="rounded-xl bg-success-soft/60 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-success">Answer</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{answer}</p>
        </div>
      )}
    </div>
  );
}
