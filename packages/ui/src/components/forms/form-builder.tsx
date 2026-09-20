'use client';

import { ArrowDown, ArrowUp, FloppyDisk, Plus, TrashBin } from '@gravity-ui/icons';
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Switch,
  Tabs,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { mutate } from '../../lib/mutate';
import { PageHeader } from '../shell/page-header';
import { CopyButton } from '../ui/copy-button';
import { JsonViewer } from '../ui/json-viewer';
import { SchemaForm, defaultsFor, orderedProperties, type ObjectSchema } from './schema-form';

type FieldKind = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'choice' | 'email' | 'date';

interface Field {
  id: number;
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  description: string;
  choices: string;
  min?: number;
  max?: number;
  /** Set once someone types a key; until then the key follows the label. */
  keyEdited?: boolean;
}

const KINDS: { id: FieldKind; label: string }[] = [
  { id: 'text', label: 'Short text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes / no' },
  { id: 'choice', label: 'Choice' },
  { id: 'email', label: 'Email' },
  { id: 'date', label: 'Date' },
];

let nextId = 1;
const blank = (index: number): Field => ({
  id: nextId++,
  key: `field_${index}`,
  label: '',
  kind: 'text',
  required: false,
  description: '',
  choices: '',
});

function toSchema(fields: Field[]): ObjectSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const field of fields) {
    const property: Record<string, unknown> = {};
    if (field.label) property.title = field.label;
    if (field.description) property.description = field.description;
    switch (field.kind) {
      case 'textarea':
        Object.assign(property, { type: 'string', format: 'textarea' });
        break;
      case 'email':
        Object.assign(property, { type: 'string', format: 'email' });
        break;
      case 'date':
        Object.assign(property, { type: 'string', format: 'date' });
        break;
      case 'choice':
        Object.assign(property, {
          type: 'string',
          enum: field.choices.split(',').map((c) => c.trim()).filter(Boolean),
        });
        break;
      case 'number':
      case 'integer':
        Object.assign(property, { type: field.kind });
        if (field.min !== undefined) property.minimum = field.min;
        if (field.max !== undefined) property.maximum = field.max;
        break;
      default:
        property.type = field.kind === 'boolean' ? 'boolean' : 'string';
    }
    properties[field.key] = property;
  }
  return {
    type: 'object',
    'ui:order': fields.map((f) => f.key),
    required: fields.filter((f) => f.required).map((f) => f.key),
    properties: properties as ObjectSchema['properties'],
  };
}

function fromSchema(schema: ObjectSchema): Field[] {
  const required = new Set(schema.required ?? []);
  return orderedProperties(schema).map(([key, property]) => {
    const p = property as Record<string, unknown>;
    const kind: FieldKind = p.enum
      ? 'choice'
      : p.format === 'textarea'
        ? 'textarea'
        : p.format === 'email'
          ? 'email'
          : p.format === 'date'
            ? 'date'
            : p.type === 'boolean'
              ? 'boolean'
              : p.type === 'integer'
                ? 'integer'
                : p.type === 'number'
                  ? 'number'
                  : 'text';
    return {
      id: nextId++,
      key,
      label: (p.title as string) ?? '',
      kind,
      required: required.has(key),
      description: (p.description as string) ?? '',
      choices: Array.isArray(p.enum) ? p.enum.join(', ') : '',
      min: typeof p.minimum === 'number' ? p.minimum : undefined,
      max: typeof p.maximum === 'number' ? p.maximum : undefined,
      keyEdited: true,
    };
  });
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "Refund amount (USD)" → "refund_amount_usd": a key an expression can read. */
function slug(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

/**
 * Builds a user form field by field, with the form a person will see beside it.
 *
 * What is saved is a JSON Schema — the same contract the server checks every
 * response against — so the preview and the enforcement cannot disagree.
 */
export function FormBuilder({
  namespace,
  name: initialName,
  version,
  initialSchema,
  initialDescription,
  mayWrite,
}: {
  namespace: string;
  name?: string;
  version?: number;
  initialSchema?: ObjectSchema;
  initialDescription?: string;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const isNew = !initialName;
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [fields, setFields] = useState<Field[]>(() =>
    initialSchema ? fromSchema(initialSchema) : [{ ...blank(1), key: 'decision', label: 'Decision', kind: 'choice', choices: 'approve, reject', required: true }]
  );
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState<'preview' | 'schema'>('preview');
  const [saving, setSaving] = useState(false);

  const schema = useMemo(() => toSchema(fields), [fields]);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push('Give the form a name');
    const keys = new Set<string>();
    for (const field of fields) {
      if (!KEY.test(field.key)) out.push(`"${field.key}" is not a valid key`);
      if (keys.has(field.key)) out.push(`"${field.key}" is used twice`);
      keys.add(field.key);
      if (field.kind === 'choice' && !field.choices.trim()) out.push(`"${field.key}" needs at least one choice`);
    }
    if (fields.length === 0) out.push('Add at least one field');
    return out;
  }, [fields, name]);

  const update = (id: number, patch: Partial<Field>) => setFields((all) => all.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const move = (index: number, by: -1 | 1) =>
    setFields((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await mutate<{ name: string; version: number }>(`/v1/ns/${namespace}/forms`, {
        body: { name: name.trim(), schema, description: description || undefined },
      });
      toast.success(`Saved ${saved.name} v${saved.version}`);
      router.replace(`/forms/${encodeURIComponent(saved.name)}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const usage = `"form": { "template": "${name || 'form_name'}" }`;

  return (
    <>
      <PageHeader
        title={isNew ? 'New user form' : name}
        breadcrumbs={[{ label: 'User forms', href: '/forms' }, { label: isNew ? 'New' : name }]}
        badge={version ? <Chip size="sm" variant="secondary">v{version}</Chip> : undefined}
        actions={
          mayWrite && (
            <Button onPress={save} isPending={saving} isDisabled={problems.length > 0 || saving}>
              <FloppyDisk />
              {isNew ? 'Save form' : `Save as v${(version ?? 0) + 1}`}
            </Button>
          )
        }
      />
      <div className="grid gap-6 px-4 md:px-8 pb-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="space-y-4">
          <Card>
            <Card.Content className="grid gap-4 md:grid-cols-2">
              <TextField value={name} onChange={setName} isRequired isDisabled={!isNew}>
                <Label>Form name</Label>
                <Input className="font-mono" placeholder="refund_review" />
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input placeholder="What this form decides" />
              </TextField>
              <div className="md:col-span-2 flex items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2 font-mono text-xs text-muted">
                Use in a HUMAN task: {usage}
                <CopyButton value={usage} label="Copy usage" />
              </div>
            </Card.Content>
          </Card>

          {fields.map((field, index) => (
            <Card key={field.id}>
              <Card.Content className="space-y-3">
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="soft">
                    {index + 1}
                  </Chip>
                  <span className="flex-1 truncate text-sm font-medium">{field.label || field.key}</span>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Move up" isDisabled={index === 0} onPress={() => move(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Move down" isDisabled={index === fields.length - 1} onPress={() => move(index, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Remove field" className="text-danger" onPress={() => setFields((all) => all.filter((f) => f.id !== field.id))}>
                    <TrashBin />
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <TextField
                    value={field.label}
                    onChange={(label) =>
                      update(field.id, field.keyEdited ? { label } : { label, key: slug(label) || field.key })
                    }
                  >
                    <Label>Label</Label>
                    <Input placeholder="Refund amount" />
                  </TextField>
                  <TextField value={field.key} onChange={(key) => update(field.id, { key, keyEdited: true })} isInvalid={!KEY.test(field.key)}>
                    <Label>Key</Label>
                    <Input className="font-mono" />
                    <Description>In the task output.</Description>
                  </TextField>
                  <Select value={field.kind} onChange={(kind) => kind !== null && update(field.id, { kind: kind as FieldKind })}>
                    <Label>Type</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {KINDS.map((k) => (
                          <ListBox.Item key={k.id} id={k.id} textValue={k.label}>
                            {k.label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
                {field.kind === 'choice' && (
                  <TextField value={field.choices} onChange={(choices) => update(field.id, { choices })}>
                    <Label>Choices</Label>
                    <Input placeholder="approve, partial, reject" />
                    <Description>Separated by commas.</Description>
                  </TextField>
                )}
                {(field.kind === 'number' || field.kind === 'integer') && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <NumberField value={field.min ?? Number.NaN} onChange={(v) => update(field.id, { min: Number.isNaN(v) ? undefined : v })}>
                      <Label>Minimum</Label>
                      <NumberField.Group>
                        <NumberField.Input />
                      </NumberField.Group>
                    </NumberField>
                    <NumberField value={field.max ?? Number.NaN} onChange={(v) => update(field.id, { max: Number.isNaN(v) ? undefined : v })}>
                      <Label>Maximum</Label>
                      <NumberField.Group>
                        <NumberField.Input />
                      </NumberField.Group>
                    </NumberField>
                  </div>
                )}
                <div className="grid items-end gap-3 md:grid-cols-[1fr_auto]">
                  <TextField value={field.description} onChange={(d) => update(field.id, { description: d })}>
                    <Label>Help text</Label>
                    <Input placeholder="Shown under the field" />
                  </TextField>
                  <Switch isSelected={field.required} onChange={(required) => update(field.id, { required })}>
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>Required</Label>
                    </Switch.Content>
                  </Switch>
                </div>
              </Card.Content>
            </Card>
          ))}

          <Button variant="secondary" className="w-full" onPress={() => setFields((all) => [...all, blank(all.length + 1)])}>
            <Plus />
            Add field
          </Button>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as typeof tab)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Preview" className="w-auto">
                <Tabs.Tab id="preview" className="w-auto flex-none px-4">
                  Preview
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="schema" className="w-auto flex-none px-4">
                  JSON Schema
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          {tab === 'preview' ? (
            <Card>
              <Card.Header>
                <Card.Title>What a person sees</Card.Title>
                <Card.Description>Try it — this is the inbox form, not a mock-up.</Card.Description>
              </Card.Header>
              <Card.Content>
                <SchemaForm key={JSON.stringify(schema)} schema={schema} values={{ ...defaultsFor(schema), ...preview }} onChange={setPreview} />
              </Card.Content>
            </Card>
          ) : (
            <JsonViewer title="Saved as" value={schema} maxHeight="70vh" />
          )}
          {problems.length > 0 && (
            <Card className="border border-warning/30 bg-warning/5">
              <Card.Content>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Card.Content>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
