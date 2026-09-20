'use client';

import { ArrowDownToLine, FloppyDisk, TrashBin } from '@gravity-ui/icons';
import {
  computeRetryDelaySeconds,
  taskDefinitionSchema,
  type TaskDefinition,
} from '@node-flow-dev/core';
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  Select,
  Tabs,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../shell/page-header';
import { formatMs } from '../ui/format';
import { commitPendingEdits } from '../../lib/commit-pending';
import { mutate } from '../../lib/mutate';
import { CommitJsonField, CommitNumberField, CommitTextField, KeyValueRows } from '../dag/fields';

type Draft = Partial<TaskDefinition> & { name: string };

const RETRY_LOGIC = [
  { id: 'FIXED', label: 'Fixed delay' },
  { id: 'LINEAR_BACKOFF', label: 'Linear backoff' },
  { id: 'EXPONENTIAL_BACKOFF', label: 'Exponential backoff' },
];

const TIMEOUT_POLICIES = [
  { id: 'TIME_OUT_WF', label: 'Fail the workflow', hint: 'The workflow ends as timed out.' },
  { id: 'RETRY', label: 'Retry the task', hint: 'Counts as a failed attempt; retried while attempts remain.' },
  { id: 'ALERT_ONLY', label: 'Alert only', hint: 'Records the timeout and lets the task keep its result.' },
];

/**
 * Create or edit a task definition — the policy every task of this type runs
 * under.
 *
 * The form is a view over one JSON object, and the JSON tab edits the same
 * object, so nothing expressible in the API is unreachable here. The side card
 * turns the numbers back into sentences: "3 retries, 1s → 2s → 4s" is what
 * someone actually needs to check, and it is not obvious from four fields.
 */
export function TaskDefEditor({
  namespace,
  initial,
  isNew,
  mayWrite,
}: {
  namespace: string;
  initial: Draft;
  isNew: boolean;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mode, setMode] = useState<'form' | 'json'>('form');

  const patch = (next: Partial<TaskDefinition>) => setDraft((current) => ({ ...current, ...next }));
  const dirty = JSON.stringify(draft) !== saved;

  // Validated with the same schema the server uses, so the Save button can say
  // what is wrong before a round trip does.
  const parsed = useMemo(() => taskDefinitionSchema.safeParse(draft), [draft]);
  // An empty name on a new definition is not an error to shout about — it is
  // simply not filled in yet, and the disabled Create button already says so.
  const issues = parsed.success
    ? []
    : parsed.error.issues
        .filter((issue) => !(issue.path[0] === 'name' && draft.name === ''))
        .map((issue) => `${issue.path.join('.') || 'definition'}: ${issue.message}`);

  const latest = useRef(draft);
  latest.current = draft;

  const save = async () => {
    setSaving(true);
    await commitPendingEdits();
    const body = latest.current;
    // Checked after the pending edit landed, not from the render the press
    // happened in — that render may predate the last field's commit.
    const check = taskDefinitionSchema.safeParse(body);
    if (!check.success) {
      toast.danger(
        body.name.trim() === ''
          ? 'Give the task definition a name first'
          : `Not saved — ${check.error.issues[0]?.path.join('.')}: ${check.error.issues[0]?.message}`
      );
      setSaving(false);
      return;
    }
    try {
      await mutate(`/v1/ns/${namespace}/metadata/task-definitions`, { body });
      setSaved(JSON.stringify(body));
      toast.success(isNew ? `Created ${body.name}` : `Saved ${body.name}`);
      if (isNew) router.replace(`/taskDef/${encodeURIComponent(body.name)}`);
      else router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await mutate(`/v1/ns/${namespace}/metadata/task-definitions/${encodeURIComponent(draft.name)}`, {
        method: 'DELETE',
      });
      toast.success(`Deleted ${draft.name}`);
      router.push('/taskDef');
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${draft.name || 'task-definition'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const readOnly = !mayWrite;

  return (
    <>
      <PageHeader
        title={isNew ? 'New task definition' : draft.name}
        breadcrumbs={[{ label: 'Task definitions', href: '/taskDef' }, { label: isNew ? 'New' : draft.name }]}
        badge={
          dirty ? (
            <Chip size="sm" color="warning" variant="soft">
              Unsaved changes
            </Chip>
          ) : undefined
        }
        actions={
          <>
            {!isNew && mayWrite && (
              <Button variant="ghost" className="text-danger" onPress={() => setConfirmDelete(true)}>
                <TrashBin />
                Delete
              </Button>
            )}
            <Button variant="ghost" onPress={download}>
              <ArrowDownToLine />
              Download
            </Button>
            {mayWrite && (
              <Button onPress={save} isDisabled={saving} isPending={saving}>
                <FloppyDisk />
                {isNew ? 'Create' : 'Save'}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 px-4 md:px-8 pb-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(key as 'form' | 'json')}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Editor mode" className="w-auto">
                <Tabs.Tab id="form" className="w-auto flex-none px-4">
                  Form
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="json" className="w-auto flex-none px-4">
                  JSON
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          {issues.length > 0 && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Fix before saving</Alert.Title>
                <Alert.Description>
                  <ul className="list-disc pl-4">
                    {issues.slice(0, 5).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          {mode === 'json' ? (
            <JsonMode draft={draft} onChange={setDraft} readOnly={readOnly} />
          ) : (
            <fieldset disabled={readOnly} className="space-y-5">
              <Section title="General" description="Workers poll a queue with exactly this name.">
                <div className="grid gap-4 md:grid-cols-2">
                  <CommitTextField
                    label="Name"
                    mono
                    isRequired
                    isDisabled={!isNew || readOnly}
                    value={draft.name}
                    onCommit={(name) => patch({ name: name.trim() })}
                    description={isNew ? 'Cannot be changed later.' : 'Renaming would orphan every queue and worker using it.'}
                  />
                  <CommitTextField
                    label="Owner email"
                    value={draft.ownerEmail ?? ''}
                    onCommit={(ownerEmail) => patch({ ownerEmail: ownerEmail.trim() || undefined })}
                  />
                </div>
                <CommitTextField
                  label="Description"
                  multiline
                  value={draft.description ?? ''}
                  onCommit={(description) => patch({ description: description || undefined })}
                />
              </Section>

              <Section title="Retries" description="What happens when an attempt fails.">
                <div className="grid gap-4 md:grid-cols-3">
                  <CommitNumberField
                    label="Retry count"
                    value={draft.retryCount}
                    onCommit={(retryCount) => patch({ retryCount })}
                    description="Attempts after the first."
                  />
                  <ChoiceField
                    label="Strategy"
                    value={draft.retryLogic ?? 'EXPONENTIAL_BACKOFF'}
                    options={RETRY_LOGIC}
                    onChange={(retryLogic) => patch({ retryLogic: retryLogic as TaskDefinition['retryLogic'] })}
                  />
                  <CommitNumberField
                    label="Base delay (s)"
                    value={draft.retryDelaySeconds}
                    onCommit={(retryDelaySeconds) => patch({ retryDelaySeconds })}
                  />
                  <CommitNumberField
                    label="Backoff factor"
                    minValue={1}
                    value={draft.backoffScaleFactor}
                    onCommit={(backoffScaleFactor) => patch({ backoffScaleFactor })}
                  />
                  <CommitNumberField
                    label="Max delay (s)"
                    value={draft.maxRetryDelaySeconds}
                    onCommit={(maxRetryDelaySeconds) => patch({ maxRetryDelaySeconds })}
                  />
                  <CommitNumberField
                    label="Jitter (0–1)"
                    step={0.05}
                    maxValue={1}
                    value={draft.jitter}
                    onCommit={(jitter) => patch({ jitter })}
                    description="±20% at 0.2 — avoids retry stampedes."
                  />
                  <CommitNumberField
                    label="Retry budget (0–1)"
                    step={0.05}
                    maxValue={1}
                    value={draft.retryBudget}
                    onCommit={(retryBudget) => patch({ retryBudget })}
                    description="Max share of recent runs that may be retries."
                  />
                </div>
                <KeyValueRows
                  label="Non-retryable error codes"
                  keyOnly
                  addLabel="Add error code"
                  value={draft.nonRetryableErrors}
                  onCommit={(value) => patch({ nonRetryableErrors: value as string[] })}
                />
              </Section>

              <Section title="Timeouts" description="0 turns a timeout off. Every deadline is a durable timer.">
                <div className="grid gap-4 md:grid-cols-3">
                  <CommitNumberField
                    label="Total timeout (s)"
                    value={draft.timeoutSeconds}
                    onCommit={(timeoutSeconds) => patch({ timeoutSeconds })}
                    description="Scheduled until finished."
                  />
                  <CommitNumberField
                    label="Schedule to start (s)"
                    value={draft.scheduleToStartTimeout}
                    onCommit={(scheduleToStartTimeout) => patch({ scheduleToStartTimeout })}
                    description="Waiting for a worker."
                  />
                  <CommitNumberField
                    label="Start to close (s)"
                    value={draft.startToCloseTimeout}
                    onCommit={(startToCloseTimeout) => patch({ startToCloseTimeout })}
                    description="A worker running it."
                  />
                  <CommitNumberField
                    label="Heartbeat (s)"
                    value={draft.heartbeatTimeout}
                    onCommit={(heartbeatTimeout) => patch({ heartbeatTimeout })}
                    description="Longest gap between heartbeats."
                  />
                  <CommitNumberField
                    label="Response timeout (s)"
                    value={draft.responseTimeoutSeconds}
                    onCommit={(responseTimeoutSeconds) => patch({ responseTimeoutSeconds })}
                    description="Lease length."
                  />
                  <CommitNumberField
                    label="Poll timeout (s)"
                    value={draft.pollTimeoutSeconds}
                    onCommit={(pollTimeoutSeconds) => patch({ pollTimeoutSeconds })}
                    description="Longest a long-poll is held."
                  />
                </div>
                <ChoiceField
                  label="When a timeout fires"
                  value={draft.timeoutPolicy ?? 'TIME_OUT_WF'}
                  options={TIMEOUT_POLICIES}
                  onChange={(timeoutPolicy) => patch({ timeoutPolicy: timeoutPolicy as TaskDefinition['timeoutPolicy'] })}
                  className="md:max-w-sm"
                />
              </Section>

              <Section title="Concurrency and rate limits" description="Enforced when work is handed to workers.">
                <div className="grid gap-4 md:grid-cols-3">
                  <CommitNumberField
                    label="Concurrent limit"
                    value={draft.concurrentExecLimit}
                    onCommit={(concurrentExecLimit) => patch({ concurrentExecLimit })}
                    description="In flight at once, cluster-wide."
                  />
                  <CommitNumberField
                    label="Rate limit"
                    value={draft.rateLimitPerFrequency}
                    onCommit={(rateLimitPerFrequency) => patch({ rateLimitPerFrequency })}
                    description="Dispatches per window."
                  />
                  <CommitNumberField
                    label="Rate window (s)"
                    value={draft.rateLimitFrequencySeconds}
                    onCommit={(rateLimitFrequencySeconds) => patch({ rateLimitFrequencySeconds })}
                  />
                </div>
                <KeyValueRows
                  label="Semaphores"
                  keyOnly
                  addLabel="Add semaphore"
                  value={draft.semaphores}
                  onCommit={(value) => patch({ semaphores: value as string[] })}
                />
              </Section>

              <Section title="Data contract" description="Documented keys, and JSON Schemas checked on every run.">
                <div className="grid gap-4 md:grid-cols-2">
                  <KeyValueRows
                    label="Input keys"
                    keyOnly
                    addLabel="Add input key"
                    value={draft.inputKeys}
                    onCommit={(value) => patch({ inputKeys: value as string[] })}
                  />
                  <KeyValueRows
                    label="Output keys"
                    keyOnly
                    addLabel="Add output key"
                    value={draft.outputKeys}
                    onCommit={(value) => patch({ outputKeys: value as string[] })}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <CommitJsonField
                    label="Input schema"
                    value={draft.inputSchema}
                    onCommit={(inputSchema) => patch({ inputSchema: isEmpty(inputSchema) ? undefined : (inputSchema as TaskDefinition['inputSchema']) })}
                  />
                  <CommitJsonField
                    label="Output schema"
                    value={draft.outputSchema}
                    onCommit={(outputSchema) => patch({ outputSchema: isEmpty(outputSchema) ? undefined : (outputSchema as TaskDefinition['outputSchema']) })}
                  />
                </div>
                <KeyValueRows
                  label="Secret output fields"
                  keyOnly
                  addLabel="Add field path"
                  value={draft.secretOutputFields}
                  onCommit={(value) => patch({ secretOutputFields: value as string[] })}
                />
              </Section>
            </fieldset>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <BehaviourSummary draft={draft} />
        </aside>
      </div>

      <AlertDialog.Backdrop isOpen={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {draft.name}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                Tasks of this type keep working and fall back to default retry and timeout policy. Refused while any are
                queued or running.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={remove}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        {description && <Card.Description>{description}</Card.Description>}
      </Card.Header>
      <Card.Content className="space-y-4">{children}</Card.Content>
    </Card>
  );
}

function ChoiceField({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const hint = options.find((option) => option.id === value)?.hint;
  return (
    <Select className={className} value={value} onChange={(next) => next !== null && onChange(String(next))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {hint && <p className="text-xs text-muted">{hint}</p>}
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

/** The whole definition as text. Applied when it parses; a broken draft is kept, never lost. */
function JsonMode({ draft, onChange, readOnly }: { draft: Draft; onChange: (draft: Draft) => void; readOnly: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [error, setError] = useState<string>();

  return (
    <Card>
      <Card.Content>
        <TextField
          aria-label="Task definition JSON"
          value={text}
          isReadOnly={readOnly}
          isInvalid={Boolean(error)}
          onChange={(next) => {
            setText(next);
            try {
              const value = JSON.parse(next) as Draft;
              setError(undefined);
              onChange(value);
            } catch (failure) {
              setError((failure as Error).message);
            }
          }}
        >
          <TextArea rows={28} spellCheck={false} className="font-mono text-xs" />
        </TextField>
        {error && <p className="mt-2 text-sm text-danger">Not valid JSON yet: {error}</p>}
      </Card.Content>
    </Card>
  );
}

/** The policy read back as sentences, with the retry schedule it produces. */
function BehaviourSummary({ draft }: { draft: Draft }) {
  const policy = taskDefinitionSchema.safeParse({ ...draft, name: draft.name || 'preview' });
  if (!policy.success) {
    return (
      <Card>
        <Card.Header>
          <Card.Title>How it behaves</Card.Title>
          <Card.Description>Shown once the definition is valid.</Card.Description>
        </Card.Header>
      </Card>
    );
  }
  const def = policy.data;

  // Without jitter, so the schedule is the same every time it is shown.
  const delays = Array.from({ length: Math.min(def.retryCount, 6) }, (_, index) =>
    computeRetryDelaySeconds({ ...def, jitter: 0 }, index + 1, () => 0.5)
  );

  const timeouts = [
    def.timeoutSeconds && `finish within ${seconds(def.timeoutSeconds)}`,
    def.scheduleToStartTimeout && `be picked up within ${seconds(def.scheduleToStartTimeout)}`,
    def.startToCloseTimeout && `complete within ${seconds(def.startToCloseTimeout)} of a worker starting`,
    def.heartbeatTimeout && `heartbeat at least every ${seconds(def.heartbeatTimeout)}`,
  ].filter(Boolean) as string[];

  const policyText = TIMEOUT_POLICIES.find((p) => p.id === def.timeoutPolicy)?.label.toLowerCase();

  return (
    <Card>
      <Card.Header>
        <Card.Title>How it behaves</Card.Title>
        <Card.Description>Read back from the settings.</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 text-sm">
        <Fact label="On failure">
          {def.retryCount === 0 ? (
            'Not retried — the first failure is final.'
          ) : (
            <>
              Retried up to {def.retryCount} time{def.retryCount === 1 ? '' : 's'}
              {def.jitter > 0 && `, ±${Math.round(def.jitter * 100)}% jitter`}.
              <span className="mt-2 flex flex-wrap items-center gap-1">
                {delays.map((delay, index) => (
                  <Chip key={index} size="sm" variant="soft" className="tabular">
                    {formatMs(delay * 1000) || '0s'}
                  </Chip>
                ))}
                {def.retryCount > delays.length && <span className="text-muted">…</span>}
              </span>
            </>
          )}
        </Fact>
        <Fact label="Deadlines">
          {timeouts.length === 0 ? 'No deadline — it may run indefinitely.' : `Must ${timeouts.join(', ')}. Otherwise: ${policyText}.`}
        </Fact>
        <Fact label="Throughput">
          {def.concurrentExecLimit === 0 && def.rateLimitPerFrequency === 0
            ? 'Unlimited.'
            : [
                def.concurrentExecLimit > 0 && `at most ${def.concurrentExecLimit} at once`,
                def.rateLimitPerFrequency > 0 &&
                  `${def.rateLimitPerFrequency} per ${seconds(def.rateLimitFrequencySeconds || 1)}`,
              ]
                .filter(Boolean)
                .join('; ')
                .replace(/^./, (c) => c.toUpperCase()) + '.'}
          {def.semaphores.length > 0 && ` Holds ${def.semaphores.join(', ')}.`}
        </Fact>
      </Card.Content>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function seconds(value: number): string {
  return formatMs(value * 1000);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0);
}
