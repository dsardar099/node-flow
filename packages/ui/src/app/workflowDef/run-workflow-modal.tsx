'use client';

import { CirclePlay } from '@gravity-ui/icons';
import {
  Button,
  ComboBox,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchJson } from '../../lib/fetch-json';
import { mutate } from '../../lib/mutate';

const STRATEGIES = [
  { id: 'RETURN_EXISTING', label: 'Return the existing run', hint: 'Nothing new starts; you are taken to the run that used the key.' },
  { id: 'FAIL_ON_RUNNING', label: 'Refuse only while it is running', hint: 'Starts a new run once the earlier one has finished.' },
  { id: 'FAIL', label: 'Always refuse', hint: 'A key can start exactly one run, ever.' },
];

/**
 * Run workflow — Conductor's dialog.
 *
 * Choosing a workflow pre-fills the input with the parameters its definition
 * declares, each set to `""`. That is the difference between a form that says
 * what the workflow needs and a blank `{}` that says nothing, which is how runs
 * start with missing input and fail three tasks later.
 */
export function RunWorkflowModal({
  namespace,
  workflowNames,
  isOpen,
  onOpenChange,
  initialName,
  initialVersion,
}: {
  namespace: string;
  workflowNames: string[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initialVersion?: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? '');
  const [versions, setVersions] = useState<number[]>([]);
  const [version, setVersion] = useState<string>('latest');
  const [input, setInput] = useState('{}');
  const [correlationId, setCorrelationId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [strategy, setStrategy] = useState('RETURN_EXISTING');
  const [domains, setDomains] = useState('');
  const [domainsError, setDomainsError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string>();

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName ?? '');
    setVersion(initialVersion ? String(initialVersion) : 'latest');
  }, [isOpen, initialName, initialVersion]);

  // Versions and declared inputs for the chosen workflow.
  useEffect(() => {
    if (!isOpen || !workflowNames.includes(name)) {
      setVersions([]);
      return;
    }
    let cancelled = false;

    void Promise.all([
      fetchJson<{ name: string; version: number }[]>(`/v1/ns/${namespace}/metadata/workflows`),
      fetchJson<{ inputParameters?: string[] }>(
        `/v1/ns/${namespace}/metadata/workflows/${encodeURIComponent(name)}`
      ),
    ])
      .then(([all, definition]) => {
        if (cancelled) return;
        setVersions(all.filter((row) => row.name === name).map((row) => row.version));
        setInput(
          JSON.stringify(
            Object.fromEntries((definition.inputParameters ?? []).map((key) => [key, ''])),
            null,
            2
          )
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isOpen, name, namespace, workflowNames]);

  const run = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      setInputError('Input must be a JSON object.');
      return;
    }
    setInputError(undefined);
    const taskToDomain = parseDomains(domains);
    if (typeof taskToDomain === 'string') {
      setDomainsError(taskToDomain);
      return;
    }
    setDomainsError(undefined);
    setBusy(true);

    try {
      const started = await mutate<{ workflowId: string }>(
        `/v1/ns/${namespace}/executions/${encodeURIComponent(name)}`,
        {
          body: {
            input: parsed,
            ...(version !== 'latest' ? { version: Number(version) } : {}),
            ...(correlationId ? { correlationId } : {}),
            ...(idempotencyKey ? { idempotencyKey, idempotencyStrategy: strategy } : {}),
            ...(Object.keys(taskToDomain).length ? { taskToDomain } : {}),
          },
        }
      );
      toast.success(`Started ${name}`);
      onOpenChange(false);
      router.push(`/execution/${started.workflowId}`);
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-2xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Run workflow</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <ComboBox
                allowsCustomValue
                isRequired
                inputValue={name}
                onInputChange={setName}
                onSelectionChange={(key) => key !== null && setName(String(key))}
              >
                <Label>Workflow name</Label>
                <ComboBox.InputGroup>
                  <Input placeholder="Choose a workflow" />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {workflowNames.map((workflow) => (
                      <ListBox.Item key={workflow} id={workflow} textValue={workflow}>
                        {workflow}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>

              <Select value={version} onChange={(value) => setVersion(String(value ?? 'latest'))}>
                <Label>Version</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="latest" textValue="Latest">
                      Latest
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {versions.map((v) => (
                      <ListBox.Item key={v} id={String(v)} textValue={`Version ${v}`}>
                        Version {v}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <TextField isInvalid={Boolean(inputError)} value={input} onChange={setInput}>
              <Label>Input params</Label>
              <TextArea rows={8} spellCheck={false} className="font-mono text-sm" />
              <Description>Pre-filled from the parameters the workflow declares.</Description>
              <FieldError>{inputError}</FieldError>
            </TextField>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={correlationId} onChange={setCorrelationId}>
                <Label>Correlation id</Label>
                <Input />
              </TextField>
              <TextField value={idempotencyKey} onChange={setIdempotencyKey}>
                <Label>Idempotency key</Label>
                <Input />
              </TextField>
            </div>
            <TextField value={domains} onChange={setDomains} isInvalid={Boolean(domainsError)}>
              <Label>Task domains</Label>
              <TextArea rows={2} spellCheck={false} className="font-mono text-sm" placeholder={'charge = eu-west\n* = canary'} />
              <Description>
                Optional. Send this run’s worker tasks to a domain’s workers — one <span className="font-mono">task = domain</span> per line,{' '}
                <span className="font-mono">*</span> for every worker task. Sub-workflows follow.
              </Description>
              <FieldError>{domainsError}</FieldError>
            </TextField>

            {idempotencyKey && (
              <Select value={strategy} onChange={(value) => value !== null && setStrategy(String(value))}>
                <Label>If this key was used before</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Description>{STRATEGIES.find((s) => s.id === strategy)?.hint}</Description>
                <Select.Popover>
                  <ListBox>
                    {STRATEGIES.map((option) => (
                      <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button isPending={busy} isDisabled={!name} onPress={run}>
              <CirclePlay />
              Run workflow
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** `charge = eu-west` lines into a routing map, or the first problem as a sentence. */
function parseDomains(text: string): Record<string, string> | string {
  const routes: Record<string, string> = {};
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\*|[A-Za-z0-9_.-]+)\s*[=:]\s*([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match) return `Line ${index + 1}: write it as "task = domain" — names are letters, digits, ".", "_" or "-".`;
    routes[match[1]] = match[2];
  }
  return routes;
}
