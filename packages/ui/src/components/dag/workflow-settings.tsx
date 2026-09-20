'use client';

import { Accordion, Description, Label, ListBox, Select, Switch } from '@heroui/react';
import type { Definition } from '../../lib/dag/edit';
import { CommitJsonField, CommitNumberField, CommitTextField, KeyValueRows } from './fields';

/**
 * The Workflow tab: Conductor's three sections — details, parameters, and how
 * the workflow executes.
 */
export function WorkflowSettings({
  definition,
  nameLocked,
  onChange,
}: {
  definition: Definition;
  nameLocked: boolean;
  onChange: (next: Definition) => void;
}) {
  const set = (fields: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...definition, ...fields };
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
    onChange(next as Definition);
  };
  const rateLimit = definition.rateLimitConfig as
    | { rateLimitKey: string; concurrentExecLimit: number }
    | undefined;

  return (
    <Accordion allowsMultipleExpanded defaultExpandedKeys={['details', 'parameters', 'execution']} variant="surface">
      <Accordion.Item id="details">
        <Accordion.Heading>
          <Accordion.Trigger className="text-base font-semibold">
            Workflow Details
            <Accordion.Indicator />
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body className="space-y-4">
            <CommitTextField
              label="Name"
              mono
              isRequired
              isDisabled={nameLocked}
              value={definition.name}
              description={
                nameLocked
                  ? 'A new name is a new workflow, not a new version of this one.'
                  : 'Workflow name must be unique.'
              }
              onCommit={(name) => set({ name: name.trim() })}
            />
            <CommitTextField
              label="Description"
              multiline
              value={(definition.description as string) ?? ''}
              onCommit={(description) => set({ description: description || undefined })}
            />
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item id="parameters">
        <Accordion.Heading>
          <Accordion.Trigger className="text-base font-semibold">
            Schema and Parameters
            <Accordion.Indicator />
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body className="space-y-6">
            <KeyValueRows
              label="Input parameters"
              keyOnly
              value={definition.inputParameters as string[] | undefined}
              onCommit={(names) => set({ inputParameters: (names as string[]).length ? names : undefined })}
            />
            <KeyValueRows
              label="Output parameters"
              value={definition.outputParameters as Record<string, unknown> | undefined}
              onCommit={(outputParameters) => set({ outputParameters })}
            />
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item id="execution">
        <Accordion.Heading>
          <Accordion.Trigger className="text-base font-semibold">
            Execution Parameters
            <Accordion.Indicator />
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <CommitNumberField
                label="Timeout seconds"
                value={definition.timeoutSeconds as number | undefined}
                description="0 means no timeout."
                onCommit={(timeoutSeconds) => set({ timeoutSeconds })}
              />
              <Select
                value={(definition.timeoutPolicy as string) ?? 'TIME_OUT_WF'}
                onChange={(value) => set({ timeoutPolicy: String(value) })}
              >
                <Label>Timeout policy</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="TIME_OUT_WF" textValue="Timeout workflow">
                      Timeout workflow
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="ALERT_ONLY" textValue="Alert only">
                      Alert only
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <Switch
              isSelected={(definition.restartable as boolean | undefined) ?? true}
              onChange={(restartable) => set({ restartable })}
            >
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>Allow workflow restarts</Label>
              </Switch.Content>
              <Description>Disable if restarting a completed run could cause side effects.</Description>
            </Switch>

            <CommitTextField
              label="Failure / compensation workflow"
              mono
              value={(definition.failureWorkflow as string) ?? ''}
              description="Started when this workflow fails."
              onCommit={(failureWorkflow) => set({ failureWorkflow: failureWorkflow || undefined })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <CommitNumberField
                label="Concurrent execution limit"
                value={definition.maxConcurrentExecutions as number | undefined}
                description="0 means unlimited."
                onCommit={(maxConcurrentExecutions) => set({ maxConcurrentExecutions })}
              />
              <CommitNumberField
                label="Concurrent task limit"
                value={definition.maxConcurrentTasks as number | undefined}
                description="Per execution. 0 means unlimited."
                onCommit={(maxConcurrentTasks) => set({ maxConcurrentTasks })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <CommitTextField
                label="Rate limit key"
                mono
                placeholder="${workflow.input.customerId}"
                value={rateLimit?.rateLimitKey ?? ''}
                description="Executions sharing a key queue behind each other instead of running at once."
                onCommit={(rateLimitKey) =>
                  set({
                    rateLimitConfig: rateLimitKey
                      ? { rateLimitKey, concurrentExecLimit: rateLimit?.concurrentExecLimit ?? 1 }
                      : undefined,
                  })
                }
              />
              <CommitNumberField
                label="Per-key limit"
                minValue={1}
                value={rateLimit?.concurrentExecLimit ?? 1}
                description={rateLimit ? 'Running at once per key.' : 'Set a key first.'}
                onCommit={(concurrentExecLimit) =>
                  rateLimit &&
                  set({ rateLimitConfig: { ...rateLimit, concurrentExecLimit: Math.max(1, concurrentExecLimit ?? 1) } })
                }
              />
            </div>

            <CommitTextField
              label="Masked fields"
              mono
              placeholder="password, cardNumber"
              value={((definition.maskedFields as string[] | undefined) ?? []).join(', ')}
              description="Values under these keys show as *** wherever an execution is viewed. Workers still receive them."
              onCommit={(text) => {
                const fields = [...new Set(text.split(',').map((f) => f.trim()).filter(Boolean))];
                set({ maskedFields: fields.length ? fields : undefined });
              }}
            />

            <CommitTextField
              label="Owner email"
              value={(definition.ownerEmail as string) ?? ''}
              onCommit={(ownerEmail) => set({ ownerEmail: ownerEmail || undefined })}
            />

            <CommitJsonField
              label="Variables"
              rows={4}
              value={definition.variables ?? {}}
              description="Initial workflow variables, changed at runtime by SET_VARIABLE."
              onCommit={(variables) =>
                set({ variables: variables && Object.keys(variables as object).length ? variables : undefined })
              }
            />
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
