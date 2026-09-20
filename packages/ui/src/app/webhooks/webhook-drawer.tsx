'use client';

import { CircleInfo } from '@gravity-ui/icons';
import {
  Button,
  ComboBox,
  Description,
  Drawer,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Select,
  Switch,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CopyButton } from '../../components/ui/copy-button';
import { mutate } from '../../lib/mutate';
import { VERIFIERS, type Verifier } from './verifiers';
import type { IncomingWebhook } from './webhook-list';

const ORDER: Verifier[] = ['GITHUB', 'STRIPE', 'SLACK', 'SHOPIFY', 'HMAC', 'HEADER', 'NONE'];

/**
 * Create or edit a webhook.
 *
 * The secret is a *name* in the secret store, never typed into this record —
 * but an admin setting up GitHub should not have to leave for another page to
 * store it first, so the value can be given here and is written to the secret
 * store, sealed, before the webhook is saved.
 */
export function WebhookDrawer({
  namespace,
  webhook,
  isOpen,
  onOpenChange,
  secretNames,
  mayManageSecrets,
  origin,
}: {
  namespace: string;
  webhook?: IncomingWebhook;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  secretNames: string[];
  mayManageSecrets: boolean;
  origin: string;
}) {
  const router = useRouter();
  const isNew = !webhook;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [verifier, setVerifier] = useState<Verifier>('GITHUB');
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [header, setHeader] = useState('');
  const [algorithm, setAlgorithm] = useState<'sha256' | 'sha1' | 'sha512'>('sha256');
  const [encoding, setEncoding] = useState<'hex' | 'base64'>('hex');
  const [prefix, setPrefix] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(webhook?.name ?? '');
    setDescription(webhook?.description ?? '');
    setVerifier(webhook?.verifier ?? 'GITHUB');
    setSecretName(webhook?.secretName ?? '');
    setSecretValue('');
    setHeader(webhook?.config.header ?? '');
    setAlgorithm(webhook?.config.algorithm ?? 'sha256');
    setEncoding(webhook?.config.encoding ?? 'hex');
    setPrefix(webhook?.config.prefix ?? '');
    setEnabled(webhook?.enabled ?? true);
  }, [isOpen, webhook]);

  const preset = VERIFIERS[verifier];
  const nameOk = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
  const secretOk = verifier === 'NONE' || secretName.trim() !== '';
  const headerOk = !preset.needsHeader || header.trim() !== '';
  const valid = nameOk && secretOk && headerOk;

  // Suggest a secret name from the webhook name, so the common case is one field fewer.
  const suggestedSecret = `WEBHOOK_${name.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;

  const save = async () => {
    setSaving(true);
    try {
      if (secretValue && secretName) {
        await mutate(`/v1/ns/${namespace}/secrets/${encodeURIComponent(secretName.trim())}`, {
          method: 'PUT',
          body: { value: secretValue, description: `Signing secret for the ${name} webhook` },
        });
      }
      const body = {
        description: description.trim() || undefined,
        verifier,
        secretName: verifier === 'NONE' ? undefined : secretName.trim(),
        config: preset.needsHeader
          ? { header: header.trim(), ...(preset.hmac ? { algorithm, encoding, ...(prefix ? { prefix } : {}) } : {}) }
          : {},
        enabled,
      };
      if (isNew) await mutate(`/v1/ns/${namespace}/incoming-webhooks`, { body: { name, ...body } });
      else await mutate(`/v1/ns/${namespace}/incoming-webhooks/${encodeURIComponent(webhook.name)}`, { method: 'PUT', body });
      toast.success(isNew ? `Created ${name}` : `Saved ${webhook.name}`);
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
            <Drawer.Heading>{isNew ? 'New webhook' : webhook.name}</Drawer.Heading>
            <p className="text-sm text-muted">
              {isNew ? 'A URL a platform can call, checked against its signature.' : `${webhook.receivedCount} deliveries accepted`}
            </p>
          </Drawer.Header>

          <Drawer.Body className="space-y-6">
            {webhook && (
              <div className="space-y-1">
                <p className="text-sm font-medium">URL</p>
                <div className="flex items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{`${origin}${webhook.path}`}</span>
                  <CopyButton value={`${origin}${webhook.path}`} label="Copy webhook URL" />
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={name} onChange={(v) => setName(v.toLowerCase())} isRequired isDisabled={!isNew} isInvalid={name !== '' && !nameOk}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder="github-deploys" />
                <Description>Handlers listen to it by this name.</Description>
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input placeholder="Pushes to main" />
              </TextField>
            </div>

            <RadioGroup value={verifier} onChange={(value) => setVerifier(value as Verifier)}>
              <Label>Verify deliveries as</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {ORDER.map((id) => {
                  const option = VERIFIERS[id];
                  return (
                    <Radio
                      key={id}
                      value={id}
                      className={`rounded-xl border p-3 transition ${
                        verifier === id ? 'border-accent bg-accent-soft/40' : 'border-separator hover:border-accent/50'
                      }`}
                    >
                      <Radio.Content>
                        <Radio.Control>
                          <Radio.Indicator />
                        </Radio.Control>
                        <span className={`flex size-6 items-center justify-center rounded-md text-[10px] font-bold ${option.tone}`}>
                          {option.mark}
                        </span>
                        <span className="font-medium">{option.label}</span>
                      </Radio.Content>
                      <Description className="text-xs">{option.summary}</Description>
                    </Radio>
                  );
                })}
              </div>
            </RadioGroup>

            <p className={`flex gap-2 rounded-xl px-3 py-2.5 text-sm ${verifier === 'NONE' ? 'bg-danger-soft text-danger' : 'bg-surface-secondary text-muted'}`}>
              <CircleInfo className="mt-0.5 size-4 shrink-0" />
              <span>{preset.setup}</span>
            </p>

            {preset.needsHeader && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField value={header} onChange={setHeader} isRequired>
                  <Label>{preset.hmac ? 'Signature header' : 'Token header'}</Label>
                  <Input className="font-mono" placeholder={preset.hmac ? 'X-Signature' : 'X-Webhook-Token'} />
                </TextField>
                {preset.hmac && (
                  <TextField value={prefix} onChange={setPrefix}>
                    <Label>Prefix</Label>
                    <Input className="font-mono" placeholder="sha256=" />
                    <Description>Text before the digest, if any.</Description>
                  </TextField>
                )}
                {preset.hmac && (
                  <Select value={algorithm} onChange={(v) => v && setAlgorithm(v as typeof algorithm)}>
                    <Label>Hash</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {(['sha256', 'sha512', 'sha1'] as const).map((a) => (
                          <ListBox.Item key={a} id={a} textValue={a.toUpperCase()}>
                            {a.toUpperCase()}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
                {preset.hmac && (
                  <Select value={encoding} onChange={(v) => v && setEncoding(v as typeof encoding)}>
                    <Label>Encoding</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {(['hex', 'base64'] as const).map((e) => (
                          <ListBox.Item key={e} id={e} textValue={e}>
                            {e}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
              </div>
            )}

            {verifier !== 'NONE' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <ComboBox
                  allowsCustomValue
                  isRequired
                  inputValue={secretName}
                  onInputChange={setSecretName}
                  onSelectionChange={(key) => key !== null && setSecretName(String(key))}
                >
                  <Label>Secret</Label>
                  <ComboBox.InputGroup>
                    <Input className="font-mono" placeholder={name ? suggestedSecret : 'WEBHOOK_SECRET'} />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <Description>A name in the secret store.</Description>
                  <ComboBox.Popover>
                    <ListBox>
                      {(secretNames.length ? secretNames : name ? [suggestedSecret] : []).map((s) => (
                        <ListBox.Item key={s} id={s} textValue={s}>
                          {s}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
                {mayManageSecrets && (
                  <TextField value={secretValue} onChange={setSecretValue} type="password">
                    <Label>{secretNames.includes(secretName) ? 'Replace its value' : 'Its value'}</Label>
                    <Input className="font-mono" autoComplete="new-password" placeholder="Paste the signing secret" />
                    <Description>Optional. Stored sealed; never shown again.</Description>
                  </TextField>
                )}
              </div>
            )}

            <Switch isSelected={enabled} onChange={setEnabled}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>Enabled</Label>
              </Switch.Content>
              <Description>A disabled webhook answers 404, as if it did not exist.</Description>
            </Switch>
          </Drawer.Body>

          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button onPress={save} isDisabled={!valid || saving} isPending={saving}>
              {isNew ? 'Create webhook' : 'Save changes'}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
