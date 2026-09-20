'use client';

import {
  Button,
  ComboBox,
  Description,
  Drawer,
  FieldError,
  Input,
  Label,
  ListBox,
  NumberField,
  Radio,
  RadioGroup,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mutate } from '../../lib/mutate';
import { ACTION_LABEL, type EventHandler, type EventSourceInfo } from './handler-list';

const ACTION_HINT: Record<EventHandler['action'], string> = {
  START_WORKFLOW: 'Every matching message starts a new execution.',
  COMPLETE_TASK: 'The message says which waiting task it completes, and its payload becomes the task output.',
  FAIL_TASK: 'The message says which waiting task failed.',
};

/**
 * Create or edit an event handler.
 *
 * Expressions use the same `${event.output.field}` syntax as task inputs, so
 * mapping a message into a workflow needs nothing new learned.
 */
export function HandlerDrawer({
  namespace,
  handler,
  isOpen,
  readOnly,
  sources,
  workflowNames,
  prefill,
  onOpenChange,
}: {
  namespace: string;
  handler?: EventHandler;
  isOpen: boolean;
  readOnly: boolean;
  sources: EventSourceInfo[];
  workflowNames: string[];
  prefill?: { source: string; topic: string };
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isNew = !handler;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [topic, setTopic] = useState('');
  const [condition, setCondition] = useState('');
  const [action, setAction] = useState<EventHandler['action']>('START_WORKFLOW');
  const [workflow, setWorkflow] = useState('');
  const [version, setVersion] = useState<number>();
  const [template, setTemplate] = useState('{}');
  const [correlationId, setCorrelationId] = useState('');
  const [workflowIdExpr, setWorkflowIdExpr] = useState('');
  const [taskRefExpr, setTaskRefExpr] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(handler?.name ?? '');
    setDescription(handler?.description ?? '');
    setSource(handler?.source ?? prefill?.source ?? sources[0]?.id ?? 'kafka:default');
    setTopic(handler?.topic ?? prefill?.topic ?? '');
    setCondition(handler?.condition ?? '');
    setAction(handler?.action ?? 'START_WORKFLOW');
    setWorkflow(handler?.workflow?.name ?? '');
    setVersion(handler?.workflow?.version ?? undefined);
    setTemplate(JSON.stringify(handler?.inputTemplate ?? { orderId: '${event.output.orderId}' }, null, 2));
    setCorrelationId(handler?.correlationId ?? '');
    setWorkflowIdExpr(handler?.workflowIdExpr ?? '${event.output.workflowId}');
    setTaskRefExpr(handler?.taskRefExpr ?? '${event.output.taskRef}');
    setEnabled(handler?.enabled ?? true);
  }, [isOpen, handler, sources, prefill]);

  let templateError: string | undefined;
  let parsedTemplate: Record<string, unknown> = {};
  try {
    const value = JSON.parse(template || '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) templateError = 'Must be a JSON object';
    else parsedTemplate = value;
  } catch (failure) {
    templateError = (failure as Error).message;
  }

  const knownTopics = sources.find((s) => s.id === source)?.topics ?? [];
  const destination = DESTINATION[source === 'webhook' ? 'webhook' : source.split(':')[0]] ?? DESTINATION['kafka'];
  const startsWorkflow = action === 'START_WORKFLOW';
  const valid =
    name.trim() !== '' &&
    source.trim() !== '' &&
    topic.trim() !== '' &&
    (startsWorkflow ? workflow.trim() !== '' && !templateError : workflowIdExpr.trim() !== '' && taskRefExpr.trim() !== '');

  const save = async () => {
    setSaving(true);
    const body = {
      description: description || undefined,
      source: source.trim(),
      topic: topic.trim(),
      condition: condition.trim() || undefined,
      action,
      ...(startsWorkflow
        ? {
            workflow: { name: workflow.trim(), ...(version ? { version } : {}) },
            inputTemplate: parsedTemplate,
            correlationId: correlationId.trim() || undefined,
          }
        : { workflowIdExpr: workflowIdExpr.trim(), taskRefExpr: taskRefExpr.trim() }),
      enabled,
    };
    try {
      if (isNew) await mutate(`/v1/ns/${namespace}/event-handlers`, { body: { name: name.trim(), ...body } });
      else await mutate(`/v1/ns/${namespace}/event-handlers/${encodeURIComponent(handler.name)}`, { method: 'PUT', body });
      toast.success(isNew ? `Created ${name.trim()}` : `Saved ${handler.name}`);
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
        <Drawer.Dialog className="sm:w-[36rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{isNew ? 'New event handler' : handler.name}</Drawer.Heading>
            <p className="text-sm text-muted">
              {isNew ? 'Turn incoming messages into workflow activity.' : `${handler.eventCount} ${handler.eventCount === 1 ? 'message' : 'messages'} handled`}
            </p>
          </Drawer.Header>

          <Drawer.Body>
            <fieldset disabled={readOnly} className="space-y-5">
              <TextField value={name} onChange={setName} isRequired isDisabled={!isNew || readOnly}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder="orders-placed" />
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input />
              </TextField>

              <div className="grid grid-cols-2 gap-3">
                <ComboBox
                  allowsCustomValue
                  isRequired
                  inputValue={source}
                  onInputChange={setSource}
                  onSelectionChange={(key) => key !== null && setSource(String(key))}
                >
                  <Label>Source</Label>
                  <ComboBox.InputGroup>
                    <Input className="font-mono" />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <ComboBox.Popover>
                    <ListBox>
                      {sources.map((s) => (
                        <ListBox.Item key={s.id} id={s.id} textValue={s.id}>
                          {s.id}
                          <span className="ml-2 text-xs text-muted">{KIND_LABEL[s.kind] ?? s.kind}</span>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
                {knownTopics.length > 0 ? (
                  <ComboBox
                    allowsCustomValue
                    isRequired
                    inputValue={topic}
                    onInputChange={setTopic}
                    onSelectionChange={(key) => key !== null && setTopic(String(key))}
                  >
                    <Label>{destination.label}</Label>
                    <ComboBox.InputGroup>
                      <Input className="font-mono" />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover>
                      <ListBox>
                        {knownTopics.map((t) => (
                          <ListBox.Item key={t} id={t} textValue={t}>
                            {t}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                ) : (
                  <TextField value={topic} onChange={setTopic} isRequired>
                    <Label>{destination.label}</Label>
                    <Input className="font-mono" placeholder={destination.placeholder} />
                  </TextField>
                )}
              </div>

              <TextField value={condition} onChange={setCondition}>
                <Label>Condition</Label>
                <TextArea rows={2} spellCheck={false} className="font-mono text-xs" placeholder={'return $.status === "PAID"'} />
                <Description>
                  Optional JavaScript over the payload as <code>$</code>, run in a sandbox. Only messages where it returns
                  true are handled.
                </Description>
              </TextField>

              <RadioGroup value={action} onChange={(value) => setAction(value as EventHandler['action'])}>
                <Label>When a message matches</Label>
                {(Object.keys(ACTION_LABEL) as EventHandler['action'][]).map((id) => (
                  <Radio key={id} value={id}>
                    <Radio.Content>
                      <Radio.Control>
                        <Radio.Indicator />
                      </Radio.Control>
                      {ACTION_LABEL[id]}
                    </Radio.Content>
                    <Description>{ACTION_HINT[id]}</Description>
                  </Radio>
                ))}
              </RadioGroup>

              {startsWorkflow ? (
                <>
                  <div className="grid grid-cols-[1fr_8rem] gap-3">
                    <ComboBox
                      allowsCustomValue
                      isRequired
                      inputValue={workflow}
                      onInputChange={setWorkflow}
                      onSelectionChange={(key) => key !== null && setWorkflow(String(key))}
                    >
                      <Label>Workflow</Label>
                      <ComboBox.InputGroup>
                        <Input placeholder="Choose a workflow" />
                        <ComboBox.Trigger />
                      </ComboBox.InputGroup>
                      <ComboBox.Popover>
                        <ListBox>
                          {workflowNames.map((n) => (
                            <ListBox.Item key={n} id={n} textValue={n}>
                              {n}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </ComboBox.Popover>
                    </ComboBox>
                    <NumberField value={version ?? Number.NaN} minValue={1} onChange={(n) => setVersion(Number.isNaN(n) ? undefined : n)}>
                      <Label>Version</Label>
                      <NumberField.Group>
                        <NumberField.Input placeholder="Latest" />
                      </NumberField.Group>
                    </NumberField>
                  </div>
                  <TextField value={template} onChange={setTemplate} isInvalid={Boolean(templateError)}>
                    <Label>Workflow input</Label>
                    <TextArea rows={6} spellCheck={false} className="font-mono text-xs" />
                    <Description>
                      Map fields with <code>{'${event.output.field}'}</code>. The raw message is always passed along too.
                    </Description>
                    <FieldError>{templateError}</FieldError>
                  </TextField>
                  <TextField value={correlationId} onChange={setCorrelationId}>
                    <Label>Correlation id</Label>
                    <Input className="font-mono" placeholder="${event.output.orderId}" />
                  </TextField>
                </>
              ) : (
                <div className="grid gap-3">
                  <TextField value={workflowIdExpr} onChange={setWorkflowIdExpr} isRequired>
                    <Label>Execution id</Label>
                    <Input className="font-mono" />
                    <Description>Where in the message the execution id is.</Description>
                  </TextField>
                  <TextField value={taskRefExpr} onChange={setTaskRefExpr} isRequired>
                    <Label>Task reference</Label>
                    <Input className="font-mono" />
                    <Description>Which waiting task in that execution the message is about.</Description>
                  </TextField>
                </div>
              )}

              <Switch isSelected={enabled} onChange={setEnabled}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>Enabled</Label>
                </Switch.Content>
                <Description>A new topic is subscribed to within about 15 seconds.</Description>
              </Switch>
            </fieldset>
          </Drawer.Body>

          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button onPress={save} isDisabled={!valid || saving} isPending={saving}>
                {isNew ? 'Create handler' : 'Save changes'}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

const KIND_LABEL: Record<string, string> = { kafka: 'Kafka', nats: 'NATS', amqp: 'RabbitMQ', sqs: 'SQS', webhook: 'Webhook' };

/** What a handler's topic means for each kind of source. */
const DESTINATION: Record<string, { label: string; placeholder: string }> = {
  kafka: { label: 'Topic', placeholder: 'orders' },
  nats: { label: 'Subject', placeholder: 'orders.created' },
  amqp: { label: 'Queue', placeholder: 'orders' },
  sqs: { label: 'Queue name', placeholder: 'orders' },
  webhook: { label: 'Webhook', placeholder: 'stripe' },
};
