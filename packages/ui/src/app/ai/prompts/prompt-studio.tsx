'use client';
import { ClockArrowRotateLeft, Play } from '@gravity-ui/icons';
import { Button, Card, Chip, Description, Input, Label, ListBox, Select, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { mutate } from '../../../lib/mutate';
import type { Integration } from '../integrations/integrations-admin';
import { Ago } from '../../../components/ui/ago';
export interface PromptVersion {
  name: string;
  version: number;
  description: string | null;
  template: string;
  variables: string[];
  createdAt: string;
  createdBy: string | null;
}
interface RunResult {
  ok: boolean;
  latencyMs: number;
  reason?: string;
  rendered?: string;
  output?: { result?: unknown; model?: string; usage?: { inputTokens: number | null; outputTokens: number | null } };
}
/** The same rule the server applies, so the variable inputs match what will be required. */
function variablesOf(template: string): string[] {
  return [...new Set([...template.matchAll(/\$\{\s*([\w.-]+)\s*\}/g)].map((m) => m[1].split('.')[0]))];
}
/**
 * The prompt studio: write, try, save.
 *
 * Trying sends the draft — saved or not — through the same executor a task
 * uses, with the variables filled in here, so what works in the studio works in
 * a workflow. Saving never overwrites: it adds a version, and older versions
 * stay one click away.
 */
export function PromptStudio({
  namespace,
  name: savedName,
  versions,
  integrations,
  mayWrite,
}: {
  namespace: string;
  name?: string;
  versions: PromptVersion[];
  integrations: Integration[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const latest = versions[0];
  const [name, setName] = useState(savedName ?? '');
  const [template, setTemplate] = useState(latest?.template ?? '');
  const [description, setDescription] = useState(latest?.description ?? '');
  const [viewing, setViewing] = useState<number | undefined>(latest?.version);
  const [values, setValues] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState(integrations[0]?.name ?? '');
  const [model, setModel] = useState(integrations[0]?.models[0] ?? '');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunResult>();
  const variables = useMemo(() => variablesOf(template), [template]);
  const integration = integrations.find((i) => i.name === provider);
  const changed = !latest || template !== latest.template || (description || null) !== (latest.description || null);
  const nameOk = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
  const variableValues = () =>
    Object.fromEntries(
      variables.map((v) => {
        const raw = values[v] ?? '';
        // A value that parses as JSON is sent as JSON, so `${order.id}` can read an object.
        try {
          return [v, raw.trim().startsWith('{') || raw.trim().startsWith('[') ? JSON.parse(raw) : raw];
        } catch {
          return [v, raw];
        }
      })
    );
  const run = async () => {
    setRunning(true);
    setResult(undefined);
    try {
      setResult(
        await mutate<RunResult>(`/v1/ns/${namespace}/prompts/-/test`, {
          body: { template, variables: variableValues(), llmProvider: provider, ...(model ? { model } : {}) },
        })
      );
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const saved = await mutate<PromptVersion>(`/v1/ns/${namespace}/prompts/${encodeURIComponent(name)}`, {
        body: { template, description: description.trim() || null },
      });
      toast.success(`Saved ${saved.name} v${saved.version}`);
      if (!savedName) router.replace(`/ai/prompts/${encodeURIComponent(saved.name)}`);
      else {
        setViewing(saved.version);
        router.refresh();
      }
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const reference = `promptName: "${name || 'my-prompt'}"`;
  return (
    <>
      <PageHeader
        title={savedName ?? 'New prompt'}
        breadcrumbs={[{ label: 'Prompts', href: '/ai/prompts' }, { label: savedName ?? 'New' }]}
        badge={
          latest && (
            <Chip size="sm" variant="soft">
              v{latest.version}
            </Chip>
          )
        }
        description={savedName ? `Used by tasks as ${reference}.` : 'Write a template, try it against a model, then save it.'}
        actions={
          mayWrite && (
            <Button isDisabled={!nameOk || template.trim() === '' || !changed} isPending={saving} onPress={save}>
              {latest ? 'Save as new version' : 'Save prompt'}
            </Button>
          )
        }
      />
      <div className="grid gap-4 px-4 pb-10 md:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-4">
          <Card className="gap-4 p-5">
            {!savedName && (
              <TextField value={name} onChange={(v) => setName(v.toLowerCase())} isRequired isInvalid={name !== '' && !nameOk}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder="support-reply" />
                <Description>Lowercase letters, digits, dots, dashes and underscores.</Description>
              </TextField>
            )}
            <TextField value={template} onChange={setTemplate} isRequired isReadOnly={!mayWrite}>
              <Label>Template</Label>
              <TextArea rows={14} className="font-mono text-sm leading-relaxed" placeholder={'You are a support agent for ${company}.\nReply to this message in under 80 words:\n\n${message}'} />
              <Description>Placeholders like {'${message}'} or {'${order.id}'} are filled from the task&apos;s promptVariables. A missing one fails the task rather than sending a gap.</Description>
            </TextField>
            <TextField value={description} onChange={setDescription} isReadOnly={!mayWrite}>
              <Label>Description</Label>
              <Input placeholder="Drafts a first reply to a support ticket" />
            </TextField>
          </Card>
          {versions.length > 0 && (
            <Card className="gap-3 p-5">
              <div className="flex items-center gap-2">
                <ClockArrowRotateLeft className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">Versions</h2>
              </div>
              <ul className="divide-y divide-separator">
                {versions.map((version) => (
                  <li key={version.version} className="flex items-center gap-3 py-2">
                    <Chip size="sm" variant={viewing === version.version ? 'primary' : 'soft'}>
                      v{version.version}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{version.template.replace(/\s+/g, ' ')}</span>
                    <span className="hidden whitespace-nowrap text-xs text-muted sm:inline">
                      <Ago value={version.createdAt} />
                      {version.createdBy ? ` · ${version.createdBy}` : ''}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setTemplate(version.template);
                        setDescription(version.description ?? '');
                        setViewing(version.version);
                      }}
                    >
                      Load
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="h-fit gap-4 p-5 xl:sticky xl:top-4">
          <h2 className="text-sm font-semibold">Try it</h2>
          {integrations.length === 0 ? (
            <p className="text-sm text-muted">
              No model provider is connected. An administrator can add one under{' '}
              <a className="text-accent" href="/ai/integrations">
                Integrations
              </a>
              .
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <Select
                  value={provider}
                  onChange={(value) => {
                    if (value === null) return;
                    setProvider(String(value));
                    setModel(integrations.find((i) => i.name === value)?.models[0] ?? '');
                    // A result from another integration would read as this one's.
                    setResult(undefined);
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
                  <Select value={model} onChange={(value) => value !== null && setModel(String(value))}>
                    <Label>Model</Label>
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
                  <TextField value={model} onChange={setModel}>
                    <Label>Model</Label>
                    <Input className="font-mono" placeholder="gpt-5-mini" />
                  </TextField>
                )}
              </div>
              {variables.map((variable) => (
                <TextField key={variable} value={values[variable] ?? ''} onChange={(v) => setValues((current) => ({ ...current, [variable]: v }))}>
                  <Label className="font-mono">{variable}</Label>
                  <TextArea rows={2} className="text-sm" />
                </TextField>
              ))}
              <Button isDisabled={template.trim() === '' || !mayWrite} isPending={running} onPress={run}>
                {({ isPending }) =>
                  isPending ? (
                    <Spinner size="sm" color="current" />
                  ) : (
                    <>
                      <Play />
                      Run
                    </>
                  )
                }
              </Button>
              {result && (
                <div className="space-y-3">
                  {result.rendered && (
                    <details className="rounded-xl bg-default/60 px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-muted">Sent prompt</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-mono">{result.rendered}</pre>
                    </details>
                  )}
                  {result.ok ? (
                    <div className="rounded-xl border border-separator p-3">
                      <p className="whitespace-pre-wrap text-sm">{typeof result.output?.result === 'string' ? result.output.result : JSON.stringify(result.output?.result, null, 2)}</p>
                      <p className="mt-2 text-xs text-muted">
                        {result.output?.model} · {result.latencyMs} ms · {result.output?.usage?.inputTokens ?? '?'} in / {result.output?.usage?.outputTokens ?? '?'} out tokens
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{result.reason}</div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
