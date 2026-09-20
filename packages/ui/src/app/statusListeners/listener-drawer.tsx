'use client';

import { CircleInfo, Xmark } from '@gravity-ui/icons';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Chip,
  ComboBox,
  Description,
  Drawer,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { mutate } from '../../lib/mutate';
import { STATUS_EVENTS, type StatusEventId } from './events';
import type { StatusListener } from './listener-list';

const SINKS = [
  { id: 'WEBHOOK', label: 'Webhook', summary: 'POST to a URL, signed with a secret from the store.' },
  { id: 'KAFKA', label: 'Kafka', summary: 'Publish to a topic on a cluster configured on the server.' },
  { id: 'NATS', label: 'NATS', summary: 'Publish to a subject on a NATS connection.' },
  { id: 'AMQP', label: 'RabbitMQ', summary: 'Send to a queue, or an exchange with a routing key.' },
  { id: 'SQS', label: 'Amazon SQS', summary: 'Send to a queue; FIFO queues keep each run in order.' },
] as const;

type Sink = (typeof SINKS)[number]['id'];

/** How the connection and destination read for each broker sink. */
const BROKER_FIELDS: Record<Exclude<Sink, 'WEBHOOK'>, { connectionLabel: string; destinationLabel: string; placeholder: string; hint: string; env: string }> = {
  KAFKA: { connectionLabel: 'Cluster', destinationLabel: 'Topic', placeholder: 'workflow-status', hint: 'Keyed by execution id, so each run stays in order.', env: 'NODE_FLOW_KAFKA_CLUSTERS' },
  NATS: { connectionLabel: 'Connection', destinationLabel: 'Subject', placeholder: 'workflows.status', hint: 'Each message carries its event id as Nats-Msg-Id.', env: 'NODE_FLOW_NATS_CONNECTIONS' },
  AMQP: { connectionLabel: 'Connection', destinationLabel: 'Queue or exchange/routing key', placeholder: 'workflow-status', hint: 'A queue is declared durable; with a slash, publishes to the exchange.', env: 'NODE_FLOW_AMQP_CONNECTIONS' },
  SQS: { connectionLabel: 'Connection', destinationLabel: 'Queue name', placeholder: 'workflow-status.fifo', hint: 'On a .fifo queue, grouped by execution id.', env: 'NODE_FLOW_SQS_CONNECTIONS' },
};

/** Create or edit a status listener. */
export function ListenerDrawer({
  namespace,
  listener,
  isOpen,
  onOpenChange,
  workflowNames,
  secretNames,
  connections,
}: {
  namespace: string;
  listener?: StatusListener;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  workflowNames: string[];
  secretNames: string[];
  connections: string[];
}) {
  const router = useRouter();
  const isNew = !listener;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sink, setSink] = useState<Sink>('WEBHOOK');
  const [url, setUrl] = useState('');
  const [secretName, setSecretName] = useState('');
  const [headers, setHeaders] = useState('');
  const [cluster, setCluster] = useState('');
  const [topic, setTopic] = useState('');
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [workflowDraft, setWorkflowDraft] = useState('');
  const draftRef = useRef('');
  const [events, setEvents] = useState<StatusEventId[]>([]);
  const [includeOutput, setIncludeOutput] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(listener?.name ?? '');
    setDescription(listener?.description ?? '');
    setSink(listener?.sink ?? 'WEBHOOK');
    setUrl(listener?.config.url ?? '');
    setSecretName(listener?.config.secretName ?? '');
    setHeaders(Object.entries(listener?.config.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
    setCluster(listener?.config.cluster ?? listener?.config.connection ?? '');
    setTopic(listener?.config.topic ?? listener?.config.destination ?? '');
    setWorkflows(listener?.workflowNames ?? []);
    setWorkflowDraft('');
    draftRef.current = '';
    setEvents(listener?.events ?? ['COMPLETED', 'FAILED', 'TIMED_OUT', 'TERMINATED']);
    setIncludeOutput(listener?.includeOutput ?? false);
    setEnabled(listener?.enabled ?? true);
  }, [isOpen, listener]);

  const nameOk = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
  const urlOk = sink !== 'WEBHOOK' || /^https?:\/\/\S+$/.test(url.trim());
  const kafkaOk = sink === 'WEBHOOK' || (cluster.trim() !== '' && topic.trim() !== '');
  const broker = BROKER_FIELDS[sink === 'WEBHOOK' ? 'KAFKA' : sink];
  const connectionNames = connections.filter((id) => id.startsWith(`${sink.toLowerCase()}:`)).map((id) => id.slice(id.indexOf(':') + 1));
  const headerLines = headers.split('\n').map((line) => line.trim()).filter(Boolean);
  const headersOk = headerLines.every((line) => /^[A-Za-z0-9-]+\s*:\s*.+$/.test(line));
  const valid = nameOk && urlOk && kafkaOk && headersOk;

  const addWorkflow = (value: string) => {
    const next = value.trim();
    if (next && !workflows.includes(next)) setWorkflows((current) => [...current, next]);
    setWorkflowDraft('');
    draftRef.current = '';
  };

  const save = async () => {
    setSaving(true);
    try {
      // A name typed but not yet added is what the person meant.
      const names = draftRef.current.trim() && !workflows.includes(draftRef.current.trim()) ? [...workflows, draftRef.current.trim()] : workflows;
      const body = {
        description: description.trim() || undefined,
        enabled,
        workflowNames: names,
        events,
        sink,
        includeOutput,
        config:
          sink === 'WEBHOOK'
            ? {
                url: url.trim(),
                ...(secretName.trim() ? { secretName: secretName.trim() } : {}),
                ...(headerLines.length
                  ? {
                      headers: Object.fromEntries(
                        headerLines.map((line) => {
                          const at = line.indexOf(':');
                          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                        })
                      ),
                    }
                  : {}),
              }
            : sink === 'KAFKA'
              ? { cluster: cluster.trim(), topic: topic.trim() }
              : { connection: cluster.trim(), destination: topic.trim() },
      };
      const base = `/v1/ns/${namespace}/status-listeners`;
      if (isNew) await mutate(base, { body: { name, ...body } });
      else await mutate(`${base}/${encodeURIComponent(listener.name)}`, { method: 'PUT', body });
      toast.success(isNew ? `Created ${name}` : `Saved ${listener.name}`);
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[38rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{isNew ? 'New status listener' : listener.name}</Drawer.Heading>
            <p className="text-sm text-muted">
              {isNew ? 'Where execution changes are sent, and which ones.' : `${listener.deliveredCount} ${listener.deliveredCount === 1 ? 'event' : 'events'} delivered`}
            </p>
          </Drawer.Header>

          <Drawer.Body className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={name} onChange={(v) => setName(v.toLowerCase())} isRequired isDisabled={!isNew} isInvalid={name !== '' && !nameOk}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder="orders-to-warehouse" />
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input placeholder="Tell fulfilment when orders finish" />
              </TextField>
            </div>

            <RadioGroup value={sink} onChange={(value) => setSink(value as typeof sink)}>
              <Label>Send to</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {SINKS.map((option) => (
                  <Radio
                    key={option.id}
                    value={option.id}
                    className={`rounded-xl border p-3 transition ${
                      sink === option.id ? 'border-accent bg-accent-soft/40' : 'border-separator hover:border-accent/50'
                    }`}
                  >
                    <Radio.Content>
                      <Radio.Control>
                        <Radio.Indicator />
                      </Radio.Control>
                      <span className="font-medium">{option.label}</span>
                    </Radio.Content>
                    <Description className="text-xs">{option.summary}</Description>
                  </Radio>
                ))}
              </div>
            </RadioGroup>

            {sink === 'WEBHOOK' ? (
              <div className="space-y-4">
                <TextField value={url} onChange={setUrl} isRequired isInvalid={url !== '' && !urlOk}>
                  <Label>URL</Label>
                  <Input className="font-mono" placeholder="https://fulfilment.example.com/node-flow/events" />
                  <Description>Private and internal addresses are refused unless the server allows them.</Description>
                </TextField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ComboBox
                    allowsCustomValue
                    inputValue={secretName}
                    onInputChange={setSecretName}
                    onSelectionChange={(key) => key !== null && setSecretName(String(key))}
                  >
                    <Label>Signing secret</Label>
                    <ComboBox.InputGroup>
                      <Input className="font-mono" placeholder="CDC_SIGNING_KEY" />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <Description>Optional. Signs each delivery as x-nodeflow-signature.</Description>
                    <ComboBox.Popover>
                      <ListBox>
                        {secretNames.map((s) => (
                          <ListBox.Item key={s} id={s} textValue={s}>
                            {s}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                  <TextField value={headers} onChange={setHeaders} isInvalid={!headersOk}>
                    <Label>Extra headers</Label>
                    <TextArea rows={2} className="font-mono text-xs" placeholder="X-Team: fulfilment" />
                    <Description>One per line. Prefer the signing secret for credentials.</Description>
                  </TextField>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <ComboBox
                  allowsCustomValue
                  isRequired
                  inputValue={cluster}
                  onInputChange={setCluster}
                  onSelectionChange={(key) => key !== null && setCluster(String(key))}
                >
                  <Label>{broker.connectionLabel}</Label>
                  <ComboBox.InputGroup>
                    <Input className="font-mono" placeholder="default" />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <Description>
                    {connectionNames.length ? `Configured: ${connectionNames.join(', ')}.` : `None configured — set ${broker.env} on the server.`}
                  </Description>
                  <ComboBox.Popover>
                    <ListBox>
                      {connectionNames.map((c) => (
                        <ListBox.Item key={c} id={c} textValue={c}>
                          {c}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
                <TextField value={topic} onChange={setTopic} isRequired>
                  <Label>{broker.destinationLabel}</Label>
                  <Input className="font-mono" placeholder={broker.placeholder} />
                  <Description>{broker.hint}</Description>
                </TextField>
              </div>
            )}

            <div className="space-y-2">
              <ComboBox
                allowsCustomValue
                // Never holds a selection: picking a name adds a chip, and the input is
                // free for the next one. Holding it wrote the name back into the input.
                selectedKey={null}
                inputValue={workflowDraft}
                onInputChange={(value) => {
                  setWorkflowDraft(value);
                  draftRef.current = value;
                }}
                onSelectionChange={(key) => {
                  if (key === null) return;
                  addWorkflow(String(key));
                  setTimeout(() => setWorkflowDraft(''));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addWorkflow(workflowDraft);
                  }
                }}
              >
                <Label>Workflows</Label>
                <ComboBox.InputGroup>
                  <Input className="font-mono" placeholder="Every workflow — or pick names, or type a prefix like orders_*" />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {workflowNames
                      .filter((w) => !workflows.includes(w))
                      .map((w) => (
                        <ListBox.Item key={w} id={w} textValue={w}>
                          {w}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>
              {workflows.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {workflows.map((w) => (
                    <Chip key={w} size="sm" variant="soft" color="accent">
                      <span className="font-mono">{w}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${w}`}
                        className="ml-1 rounded-full hover:text-danger"
                        onClick={() => setWorkflows((current) => current.filter((x) => x !== w))}
                      >
                        <Xmark className="size-3" />
                      </button>
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            <CheckboxGroup value={events} onChange={(value) => setEvents(value as StatusEventId[])}>
              <Label>Events</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STATUS_EVENTS.map((event) => (
                  <Checkbox key={event.id} value={event.id}>
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <span className="text-sm">{event.label}</span>
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>
              <Description>None selected sends every change.</Description>
            </CheckboxGroup>

            <p className="flex gap-2 rounded-xl bg-surface-secondary px-3 py-2.5 text-sm text-muted">
              <CircleInfo className="mt-0.5 size-4 shrink-0" />
              <span>
                Each event carries <span className="font-mono">id</span>, <span className="font-mono">event</span>,{' '}
                <span className="font-mono">status</span>, <span className="font-mono">workflowId</span>,{' '}
                <span className="font-mono">workflowName</span>, <span className="font-mono">correlationId</span> and{' '}
                <span className="font-mono">reason</span>. Delivery is at least once — deduplicate on the id.
              </span>
            </p>

            <div className="space-y-3">
              <Switch isSelected={includeOutput} onChange={setIncludeOutput}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>Include workflow output</Label>
                </Switch.Content>
                <Description>On completion. Masked fields stay masked; output over 256 KB is left out.</Description>
              </Switch>
              <Switch isSelected={enabled} onChange={setEnabled}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>Enabled</Label>
                </Switch.Content>
                <Description>While off, changes are not recorded for this listener.</Description>
              </Switch>
            </div>
          </Drawer.Body>

          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button onPress={save} isDisabled={!valid || saving} isPending={saving}>
              {isNew ? 'Create listener' : 'Save changes'}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
