'use client';

import { Button, Description, Drawer, Input, Label, ListBox, Select, TextArea, TextField, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mutate } from '../../../lib/mutate';
import type { Integration } from '../integrations/integrations-admin';

/** An integration's embedding model, guessed from its name, or its first model. */
export function defaultEmbeddingModel(integration?: Integration): string {
  return integration?.models.find((m) => /embed/i.test(m)) ?? integration?.models[0] ?? '';
}

/** Which integration and embedding model to use; searches must use the model the index was built with. */
export function EmbeddingPicker({
  integrations,
  provider,
  model,
  onChange,
}: {
  integrations: Integration[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
}) {
  const integration = integrations.find((i) => i.name === provider);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        value={provider}
        onChange={(value) => {
          if (value === null) return;
          onChange(String(value), defaultEmbeddingModel(integrations.find((i) => i.name === value)));
        }}
      >
        <Label>Integration</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {integrations.map((i) => (
              <ListBox.Item key={i.name} id={i.name} textValue={i.name}>
                {i.name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {integration && integration.models.length > 0 ? (
        <Select value={model} onChange={(value) => value !== null && onChange(provider, String(value))}>
          <Label>Embedding model</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {integration.models.map((m) => (
                <ListBox.Item key={m} id={m} textValue={m}>
                  {m}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : (
        <TextField value={model} onChange={(v) => onChange(provider, v)}>
          <Label>Embedding model</Label>
          <Input className="font-mono" placeholder="text-embedding-3-small" />
        </TextField>
      )}
    </div>
  );
}

/** Chunks, embeds and stores a document; with no index given, names a new one. */
export function DocumentDrawer({
  namespace,
  index: fixedIndex,
  integrations,
  preferredModel,
  isOpen,
  onOpenChange,
}: {
  namespace: string;
  index?: string;
  integrations: Integration[];
  /** The model an existing index was built with. */
  preferredModel?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [index, setIndex] = useState('');
  const [docId, setDocId] = useState('');
  const [text, setText] = useState('');
  const [metadata, setMetadata] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIndex(fixedIndex ?? '');
    setDocId('');
    setText('');
    setMetadata('');
    const first =
      integrations.find((i) => (preferredModel ? i.models.includes(preferredModel) : i.models.some((m) => /embed/i.test(m)))) ?? integrations[0];
    setProvider(first?.name ?? '');
    setModel(preferredModel ?? defaultEmbeddingModel(first));
  }, [isOpen, fixedIndex, integrations, preferredModel]);

  const indexOk = /^[\w.-]{1,100}$/.test(index);
  let metadataValue: Record<string, unknown> | undefined;
  let metadataOk = true;
  if (metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata);
      metadataOk = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
      metadataValue = metadataOk ? parsed : undefined;
    } catch {
      metadataOk = false;
    }
  }
  const valid = indexOk && docId.trim() !== '' && text.trim() !== '' && provider !== '' && metadataOk;

  const save = async () => {
    setSaving(true);
    try {
      const result = await mutate<{ ok: boolean; reason?: string; output?: { chunks: number; dimensions: number } }>(
        `/v1/ns/${namespace}/vector-indexes/${encodeURIComponent(index)}/documents`,
        { body: { llmProvider: provider, ...(model ? { embeddingModel: model } : {}), docId: docId.trim(), text, ...(metadataValue ? { metadata: metadataValue } : {}) } }
      );
      if (!result.ok) {
        toast.danger(result.reason ?? 'Indexing failed');
        return;
      }
      toast.success(`Indexed ${docId} as ${result.output?.chunks} chunk${result.output?.chunks === 1 ? '' : 's'}`);
      onOpenChange(false);
      if (fixedIndex) router.refresh();
      else router.push(`/ai/indexes/${encodeURIComponent(index)}`);
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
            <Drawer.Heading>{fixedIndex ? `Add to ${fixedIndex}` : 'New index'}</Drawer.Heading>
            <p className="text-sm text-muted">Split into overlapping chunks and embedded. Adding a document id that exists replaces it.</p>
          </Drawer.Header>
          <Drawer.Body className="space-y-4">
            {!fixedIndex && (
              <TextField value={index} onChange={setIndex} isRequired isInvalid={index !== '' && !indexOk}>
                <Label>Index name</Label>
                <Input className="font-mono" placeholder="handbook" />
                <Description>What search and agent tasks put in &quot;index&quot;.</Description>
              </TextField>
            )}
            {integrations.length === 0 ? (
              <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">Connect a model provider under Integrations to embed documents.</p>
            ) : (
              <EmbeddingPicker integrations={integrations} provider={provider} model={model} onChange={(p, m) => { setProvider(p); setModel(m); }} />
            )}
            <TextField value={docId} onChange={setDocId} isRequired>
              <Label>Document id</Label>
              <Input className="font-mono" placeholder="refund-policy" />
            </TextField>
            <TextField value={text} onChange={setText} isRequired>
              <Label>Text</Label>
              <TextArea rows={10} className="text-sm" placeholder="Paste the document…" />
            </TextField>
            <TextField value={metadata} onChange={setMetadata} isInvalid={!metadataOk}>
              <Label>Metadata</Label>
              <TextArea rows={2} className="font-mono text-xs" placeholder='{ "team": "billing" }' />
              <Description>Optional JSON object, returned with every match.</Description>
            </TextField>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="secondary">
              Cancel
            </Button>
            <Button isDisabled={!valid} isPending={saving} onPress={save}>
              Index document
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
