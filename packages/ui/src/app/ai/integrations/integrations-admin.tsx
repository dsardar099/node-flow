'use client';

import { CircleCheck, CircleExclamation, Plus, Molecule, TrashBin } from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  ComboBox,
  Description,
  Drawer,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { mutate } from '../../../lib/mutate';

export interface Integration {
  name: string;
  kind: 'LLM' | 'MCP' | 'HTTP';
  provider: string;
  description: string | null;
  baseUrl: string | null;
  apiKeySecret: string | null;
  apiKeySecretExists: boolean | null;
  models: string[];
  config: { headers?: Record<string, string>; authHeader?: string; authScheme?: string; openapiUrl?: string };
  enabled: boolean;
  updatedAt: string;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  reason?: string;
  output?: { result?: unknown; model?: string; count?: number };
}

const PROVIDERS: Record<Integration['kind'], { id: string; label: string; baseUrl?: string; hint: string }[]> = {
  LLM: [
    { id: 'openai', label: 'OpenAI', hint: 'Leave the base URL empty for api.openai.com, or point it at Azure or a proxy.' },
    { id: 'anthropic', label: 'Anthropic', hint: 'Claude models. Anthropic offers no embedding models.' },
    { id: 'google', label: 'Google Gemini', hint: 'Gemini models and embeddings.' },
    { id: 'openai_compatible', label: 'OpenAI-compatible', baseUrl: 'http://localhost:11434/v1', hint: 'Ollama, vLLM, LM Studio, Groq, Together, Mistral — anything speaking the OpenAI API.' },
  ],
  MCP: [{ id: 'streamable_http', label: 'Streamable HTTP', baseUrl: 'https://mcp.example.com/mcp', hint: 'The server URL. The key, if any, is sent as a header.' }],
  HTTP: [
    { id: 'openapi', label: 'OpenAPI service', baseUrl: 'https://api.example.com/v2', hint: 'A REST service with an OpenAPI document. Its operations are listed so authors can pick a path instead of remembering one.' },
    { id: 'rest', label: 'Plain REST', baseUrl: 'https://api.example.com', hint: 'A service with no published document. Tasks call it by path.' },
  ],
};

const providerLabel = (id: string) => [...PROVIDERS.LLM, ...PROVIDERS.MCP, ...PROVIDERS.HTTP].find((p) => p.id === id)?.label ?? id;

/**
 * Integrations: what an AI task may reach and with which credentials.
 *
 * Authors see them — a task names one — but only an administrator changes
 * them, because an integration decides where requests go and which secret
 * authorises them. "Test" makes one small real request, so a broken key is
 * found here rather than in a failed run.
 */
export function IntegrationsAdmin({
  namespace,
  integrations,
  secretNames,
  mayAdminister,
  mayTest,
}: {
  namespace: string;
  integrations: Integration[];
  secretNames: string[];
  mayAdminister: boolean;
  mayTest: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Integration | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const [testing, setTesting] = useState<string>();
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const test = async (integration: Integration) => {
    setTesting(integration.name);
    try {
      const result = await mutate<TestResult>(`/v1/ns/${namespace}/integrations/${encodeURIComponent(integration.name)}/test`, { body: {} });
      setResults((current) => ({ ...current, [integration.name]: result }));
      if (result.ok) toast.success(`${integration.name} answered in ${result.latencyMs} ms`);
      else toast.danger(result.reason ?? 'The test failed');
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setTesting(undefined);
    }
  };

  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/integrations/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Model providers, MCP servers and REST services that tasks use by name. Keys stay in secrets; a definition never carries one."
        actions={
          mayAdminister && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New integration
            </Button>
          )
        }
      />
      <div className="px-4 pb-10 md:px-8">
        {integrations.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Molecule className="size-6" />
            </span>
            <span className="text-sm font-medium">No integrations yet</span>
            <span className="max-w-md text-sm text-muted">
              Connect a model provider for LLM, embedding and agent tasks, an MCP server to give agents tools, or a REST service that HTTP tasks call by name.
            </span>
            {mayAdminister && (
              <Button size="sm" onPress={() => setEditing('new')}>
                <Plus />
                New integration
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            {integrations.map((integration) => {
              const result = results[integration.name];
              return (
                <Card key={integration.name} className="min-w-0 gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                        integration.kind === 'MCP' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      {integration.kind}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono font-medium">{integration.name}</span>
                        <Chip size="sm" variant="soft">
                          {providerLabel(integration.provider)}
                        </Chip>
                        {!integration.enabled && (
                          <Chip size="sm" variant="soft" color="warning">
                            Disabled
                          </Chip>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted">{integration.baseUrl ?? 'Provider default endpoint'}</p>
                      {integration.description && <p className="mt-1 text-sm text-muted">{integration.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {mayTest && (
                        <Button size="sm" variant="secondary" isPending={testing === integration.name} onPress={() => test(integration)}>
                          {({ isPending }) => (isPending ? <Spinner size="sm" color="current" /> : 'Test')}
                        </Button>
                      )}
                      {mayAdminister && (
                        <>
                          <Button size="sm" variant="ghost" onPress={() => setEditing(integration)}>
                            Edit
                          </Button>
                          <Button isIconOnly size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${integration.name}`} onPress={() => setDeleting(integration.name)}>
                            <TrashBin />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <dl className="grid gap-2 text-sm">
                    {integration.kind === 'LLM' && (
                      <Row label="Models">
                        {integration.models.length ? (
                          integration.models.map((model) => (
                            <Chip key={model} size="sm" variant="soft" className="font-mono">
                              {model}
                            </Chip>
                          ))
                        ) : (
                          <span className="text-muted">Any model</span>
                        )}
                      </Row>
                    )}
                    <Row label="Key">
                      {integration.apiKeySecret ? (
                        <span className={`inline-flex items-center gap-1 font-mono text-xs ${integration.apiKeySecretExists ? '' : 'text-danger'}`}>
                          {integration.apiKeySecretExists ? <CircleCheck className="size-3.5 text-success" /> : <CircleExclamation className="size-3.5" />}
                          {integration.apiKeySecret}
                          {!integration.apiKeySecretExists && <span className="font-sans"> — secret does not exist</span>}
                        </span>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </Row>
                    {(integration.kind === 'MCP' || integration.kind === 'HTTP') && Object.keys(integration.config.headers ?? {}).length > 0 && (
                      <Row label="Headers">
                        {Object.keys(integration.config.headers ?? {}).map((header) => (
                          <Chip key={header} size="sm" variant="soft" className="font-mono">
                            {header}
                          </Chip>
                        ))}
                      </Row>
                    )}
                  </dl>

                  {result && (
                    <div className={`rounded-xl px-3 py-2 text-sm ${result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
                      {result.ok
                        ? integration.kind === 'MCP'
                          ? `Connected in ${result.latencyMs} ms — ${result.output?.count ?? 0} tools`
                          : integration.kind === 'HTTP'
                          ? `Answered in ${result.latencyMs} ms`
                          : `${result.output?.model ?? 'The model'} answered in ${result.latencyMs} ms: “${String(result.output?.result ?? '').slice(0, 80)}”`
                        : result.reason}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <IntegrationDrawer
        namespace={namespace}
        integration={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        secretNames={secretNames}
      />

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Tasks that name this integration will fail until one with the same name exists again.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button
                slot="close"
                variant="danger"
                onPress={() => {
                  if (deleting) void remove(deleting);
                }}
              >
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function IntegrationDrawer({
  namespace,
  integration,
  isOpen,
  onOpenChange,
  secretNames,
}: {
  namespace: string;
  integration?: Integration;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  secretNames: string[];
}) {
  const router = useRouter();
  const isNew = !integration;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Integration['kind']>('LLM');
  const [provider, setProvider] = useState('openai');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [models, setModels] = useState('');
  const [headers, setHeaders] = useState('');
  const [openapiUrl, setOpenapiUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(integration?.name ?? '');
    setKind(integration?.kind ?? 'LLM');
    setProvider(integration?.provider ?? 'openai');
    setDescription(integration?.description ?? '');
    setBaseUrl(integration?.baseUrl ?? '');
    setApiKeySecret(integration?.apiKeySecret ?? '');
    setModels((integration?.models ?? []).join(', '));
    setOpenapiUrl(integration?.config?.openapiUrl ?? '');
    setHeaders(Object.entries(integration?.config.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
    setEnabled(integration?.enabled ?? true);
  }, [isOpen, integration]);

  const chosen = PROVIDERS[kind].find((p) => p.id === provider) ?? PROVIDERS[kind][0];
  const needsUrl = kind === 'MCP' || kind === 'HTTP' || provider === 'openai_compatible';
  const nameOk = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
  const urlOk = baseUrl.trim() === '' ? !needsUrl : /^https?:\/\/\S+$/.test(baseUrl.trim());
  const headerLines = headers.split('\n').map((l) => l.trim()).filter(Boolean);
  const headersOk = headerLines.every((l) => /^[A-Za-z0-9-]+\s*:\s*.+$/.test(l));
  const valid = nameOk && urlOk && headersOk;

  const save = async () => {
    setSaving(true);
    try {
      await mutate(`/v1/ns/${namespace}/integrations/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: {
          kind,
          provider: chosen.id,
          description: description.trim() || null,
          baseUrl: baseUrl.trim() || null,
          apiKeySecret: apiKeySecret.trim() || null,
          models: kind === 'LLM' ? models.split(',').map((m) => m.trim()).filter(Boolean) : [],
          config:
            kind === 'MCP' || kind === 'HTTP'
              ? {
                  ...(kind === 'HTTP' && openapiUrl.trim() ? { openapiUrl: openapiUrl.trim() } : {}),
                  ...integration?.config,
                  headers: Object.fromEntries(
                    headerLines.map((line) => {
                      const at = line.indexOf(':');
                      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                    })
                  ),
                }
              : {},
          enabled,
        },
      });
      toast.success(isNew ? `Created ${name}` : `Saved ${name}`);
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
            <Drawer.Heading>{isNew ? 'New integration' : integration.name}</Drawer.Heading>
            <p className="text-sm text-muted">Tasks refer to it by name, so changing the provider here changes every task that uses it.</p>
          </Drawer.Header>
          <Drawer.Body className="space-y-5">
            <RadioGroup
              value={kind}
              isDisabled={!isNew}
              onChange={(value) => {
                const next = value as Integration['kind'];
                setKind(next);
                setProvider(PROVIDERS[next][0].id);
              }}
            >
              <Label>Kind</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { id: 'LLM', label: 'Model provider', summary: 'Text, chat, embeddings and agents.' },
                    { id: 'MCP', label: 'MCP server', summary: 'Tools an agent or task can call.' },
                    { id: 'HTTP', label: 'HTTP service', summary: 'A REST API that HTTP tasks call by name.' },
                  ] as const
                ).map((option) => (
                  <Radio
                    key={option.id}
                    value={option.id}
                    className={`rounded-xl border p-3 transition ${kind === option.id ? 'border-accent bg-accent-soft/40' : 'border-separator hover:border-accent/50'}`}
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

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={name} onChange={(v) => setName(v.toLowerCase())} isRequired isDisabled={!isNew} isInvalid={name !== '' && !nameOk}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder={kind === 'MCP' ? 'github' : 'openai'} />
                <Description>What tasks put in {kind === 'MCP' ? '"mcpServer"' : kind === 'HTTP' ? '"service"' : '"llmProvider"'}.</Description>
              </TextField>
              <Select value={chosen.id} onChange={(value) => value !== null && setProvider(String(value))}>
                <Label>Provider</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {PROVIDERS[kind].map((p) => (
                      <ListBox.Item key={p.id} id={p.id} textValue={p.label}>
                        {p.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <TextField value={baseUrl} onChange={setBaseUrl} isRequired={needsUrl} isInvalid={baseUrl !== '' && !urlOk}>
              <Label>{kind === 'MCP' ? 'Server URL' : 'Base URL'}</Label>
              <Input className="font-mono" placeholder={chosen.baseUrl ?? 'Provider default'} />
              <Description>{chosen.hint}</Description>
            </TextField>

            <ComboBox allowsCustomValue inputValue={apiKeySecret} onInputChange={setApiKeySecret} onSelectionChange={(key) => key !== null && setApiKeySecret(String(key))}>
              <Label>{kind === 'MCP' ? 'Token secret' : 'API key secret'}</Label>
              <ComboBox.InputGroup>
                <Input className="font-mono" placeholder={kind === 'MCP' ? 'GITHUB_MCP_TOKEN' : kind === 'HTTP' ? 'BILLING_API_KEY' : 'OPENAI_API_KEY'} />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <Description>
                The name of a secret holding the key{kind === 'MCP' || kind === 'HTTP' ? ', sent as Authorization: Bearer' : ''}. Optional for local servers.
              </Description>
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

            {kind === 'LLM' ? (
              <TextField value={models} onChange={setModels}>
                <Label>Models</Label>
                <Input className="font-mono" placeholder="gpt-5-mini, text-embedding-3-small" />
                <Description>Comma-separated. The first is the default; tasks may use only these. Empty allows any.</Description>
              </TextField>
            ) : (
              <TextField value={headers} onChange={setHeaders} isInvalid={!headersOk}>
                <Label>Extra headers</Label>
                <TextArea rows={2} className="font-mono text-xs" placeholder="X-Team: support" />
                <Description>One per line. Values shown as •••• are kept unless you change them.</Description>
              </TextField>
            )}

            {kind === 'HTTP' && provider === 'openapi' && (
              <TextField value={openapiUrl} onChange={setOpenapiUrl}>
                <Label>OpenAPI document</Label>
                <Input className="font-mono" placeholder="https://api.example.com/openapi.json" />
                <Description>
                  Read to list the operations this service offers, so authors pick a path instead of remembering one. JSON, not YAML.
                </Description>
              </TextField>
            )}

            <TextField value={description} onChange={setDescription}>
              <Label>Description</Label>
              <Input placeholder="Production OpenAI account" />
            </TextField>

            <Switch isSelected={enabled} onChange={setEnabled}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>Enabled</Label>
              </Switch.Content>
              <Description>While off, tasks naming it fail at once instead of calling it.</Description>
            </Switch>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="secondary">
              Cancel
            </Button>
            <Button isDisabled={!valid} isPending={saving} onPress={save}>
              {isNew ? 'Create integration' : 'Save'}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
