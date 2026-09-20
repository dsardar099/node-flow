'use client';
import { CircleCheck, CircleXmark, FileCode, Plus } from '@gravity-ui/icons';
import {
  Button,
  Card,
  Chip,
  Description,
  Drawer,
  EmptyState,
  FieldError,
  Input,
  Label,
  ListBox,
  SearchField,
  Select,
  Table,
  Tabs,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { CopyButton } from '../../components/ui/copy-button';
import { formatDateTime } from '../../components/ui/format';
import { JsonViewer } from '../../components/ui/json-viewer';
import { fetchJson } from '../../lib/fetch-json';
import { mutate } from '../../lib/mutate';
import { Ago } from '../../components/ui/ago';
export interface SchemaSummary {
  name: string;
  version: number;
  versions: number;
  data: Record<string, unknown>;
  description: string | null;
  createdAt: string;
}
const STARTER = JSON.stringify(
  { type: 'object', required: ['id'], properties: { id: { type: 'string' }, amount: { type: 'number', minimum: 0 } } },
  null,
  2
);
/**
 * Contracts written once and referenced by name.
 *
 * Each row shows the snippet to paste into a task or workflow definition — the
 * next thing anyone does with a new schema.
 */
export function SchemaList({ namespace, schemas, mayWrite }: { namespace: string; schemas: SchemaSummary[]; mayWrite: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | 'new'>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? schemas.filter((s) => [s.name, s.description ?? ''].some((f) => f.toLowerCase().includes(needle))) : schemas;
  }, [schemas, query]);
  return (
    <>
      <PageHeader
        title="Schemas"
        description='Versioned JSON Schemas that task and workflow definitions reference as { "name": "order" } — checked on every start and every task.'
        actions={
          mayWrite && (
            <Button onPress={() => setOpen('new')}>
              <Plus />
              New schema
            </Button>
          )
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <SearchField aria-label="Search schemas" value={query} onChange={setQuery} className="max-w-lg">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search schemas" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Schemas" className="min-w-[760px]" onRowAction={(key) => setOpen(String(key))}>
                <Table.Header>
                  <Table.Column isRowHeader>Schema</Table.Column>
                  <Table.Column>Version</Table.Column>
                  <Table.Column>Fields</Table.Column>
                  <Table.Column>Reference</Table.Column>
                  <Table.Column>Updated</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <FileCode className="size-6" />
                      </span>
                      <span className="text-sm font-medium">{schemas.length === 0 ? 'No schemas yet' : 'Nothing matches'}</span>
                      <span className="max-w-sm text-sm text-muted">
                        Define an input or output contract once, and reference it from every definition that shares it.
                      </span>
                      {schemas.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => setOpen('new')}>
                          <Plus />
                          New schema
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((schema) => {
                    const properties = Object.keys((schema.data.properties as Record<string, unknown>) ?? {});
                    const reference = `{ "name": "${schema.name}" }`;
                    return (
                      <Table.Row key={schema.name} id={schema.name} className="cursor-pointer">
                        <Table.Cell>
                          <div className="flex items-start gap-3 py-1">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                              <FileCode className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-mono text-sm font-medium">{schema.name}</p>
                              {schema.description && <p className="line-clamp-1 text-sm text-muted">{schema.description}</p>}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="secondary">
                            v{schema.version}
                          </Chip>
                          {schema.versions > 1 && <span className="ml-2 text-xs text-muted">{schema.versions} versions</span>}
                        </Table.Cell>
                        <Table.Cell className="max-w-64">
                          <span className="block truncate font-mono text-xs text-muted">{properties.join(', ') || '—'}</span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            {reference}
                            <CopyButton value={reference} label="Copy reference" />
                          </span>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm">
                          <span title={formatDateTime(schema.createdAt)}><Ago value={schema.createdAt} /></span>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
      <SchemaDrawer namespace={namespace} name={open === 'new' ? undefined : open} isOpen={open !== undefined} mayWrite={mayWrite} onOpenChange={(o) => !o && setOpen(undefined)} />
    </>
  );
}
interface Version {
  name: string;
  version: number;
  data: Record<string, unknown>;
  description: string | null;
  createdAt: string;
}
function SchemaDrawer({
  namespace,
  name,
  isOpen,
  mayWrite,
  onOpenChange,
}: {
  namespace: string;
  name?: string;
  isOpen: boolean;
  mayWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isNew = !name;
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<number>();
  const [tab, setTab] = useState<'view' | 'edit' | 'test'>('view');
  const [newName, setNewName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState(STARTER);
  const [payload, setPayload] = useState('{\n  "id": "A-1"\n}');
  const [result, setResult] = useState<{ valid: boolean; violations: { path: string; message: string }[] }>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setResult(undefined);
    if (isNew) {
      setVersions([]);
      setNewName('');
      setDescription('');
      setText(STARTER);
      setTab('edit');
      return;
    }
    setTab('view');
    void fetchJson<{ versions: Version[] }>(`/v1/ns/${namespace}/schemas/${encodeURIComponent(name)}`).then((r) => {
      setVersions(r.versions);
      setSelected(r.versions[0]?.version);
      setText(JSON.stringify(r.versions[0]?.data ?? {}, null, 2));
      setDescription(r.versions[0]?.description ?? '');
    });
  }, [isOpen, name, isNew, namespace]);
  const current = versions.find((v) => v.version === selected);
  let parseError: string | undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (failure) {
    parseError = (failure as Error).message;
  }
  const register = async () => {
    setSaving(true);
    try {
      const registered = await mutate<Version>(`/v1/ns/${namespace}/schemas`, {
        body: { name: isNew ? newName.trim() : name, data: parsed, description: description || undefined },
      });
      toast.success(`Registered ${registered.name} v${registered.version}`);
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    try {
      const target = isNew ? undefined : name;
      if (!target) return;
      const body = { payload: JSON.parse(payload) };
      setResult(
        await mutate(`/v1/ns/${namespace}/schemas/${encodeURIComponent(target)}/validate?version=${selected ?? ''}`, { body })
      );
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[40rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading className="font-mono">{isNew ? 'New schema' : name}</Drawer.Heading>
            {!isNew && current && (
              <p className="text-sm text-muted">
                Version {current.version} · registered <Ago value={current.createdAt} />
              </p>
            )}
          </Drawer.Header>
          <Drawer.Body className="space-y-4">
            {!isNew && (
              <div className="flex items-center gap-3">
                <Select
                  aria-label="Version"
                  className="w-40"
                  value={selected === undefined ? null : String(selected)}
                  onChange={(v) => {
                    const version = Number(v);
                    setSelected(version);
                    const match = versions.find((x) => x.version === version);
                    if (match) setText(JSON.stringify(match.data, null, 2));
                    setResult(undefined);
                  }}
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {versions.map((v) => (
                        <ListBox.Item key={v.version} id={String(v.version)} textValue={`v${v.version}`}>
                          v{v.version}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as typeof tab)}>
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Mode" className="w-auto">
                      <Tabs.Tab id="view" className="w-auto flex-none px-3">
                        Schema
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="test" className="w-auto flex-none px-3">
                        Test a payload
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      {mayWrite ? (
                        <Tabs.Tab id="edit" className="w-auto flex-none px-3">
                          New version
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      ) : null}
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              </div>
            )}
            {tab === 'view' && current && <JsonViewer title={`v${current.version}`} value={current.data} maxHeight="60vh" />}
            {tab === 'test' && (
              <div className="space-y-3">
                <TextField value={payload} onChange={setPayload}>
                  <Label>Sample payload</Label>
                  <TextArea rows={8} spellCheck={false} className="font-mono text-xs" />
                  <Description>Checked against v{selected} exactly as a task or workflow start would be.</Description>
                </TextField>
                <Button variant="secondary" onPress={test}>
                  Validate
                </Button>
                {result &&
                  (result.valid ? (
                    <p className="flex items-center gap-2 text-sm text-success">
                      <CircleCheck /> Matches the schema.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                      <p className="mb-1 flex items-center gap-2 text-sm font-medium text-danger">
                        <CircleXmark /> Does not match
                      </p>
                      <ul className="space-y-0.5 font-mono text-xs">
                        {result.violations.map((v, i) => (
                          <li key={i}>
                            {v.path || '(root)'} {v.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
            {tab === 'edit' && (
              <div className="space-y-4">
                {isNew && (
                  <TextField value={newName} onChange={setNewName} isRequired>
                    <Label>Name</Label>
                    <Input className="font-mono" placeholder="order" />
                  </TextField>
                )}
                <TextField value={description} onChange={setDescription}>
                  <Label>Description</Label>
                  <Input />
                </TextField>
                <TextField value={text} onChange={setText} isInvalid={Boolean(parseError)}>
                  <Label>JSON Schema</Label>
                  <TextArea rows={16} spellCheck={false} className="font-mono text-xs" />
                  {!isNew && !parseError && (
                    <Description>Registers version {(versions[0]?.version ?? 0) + 1}. Definitions pinned to older versions are unaffected.</Description>
                  )}
                  <FieldError>{parseError}</FieldError>
                </TextField>
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Close
            </Button>
            {tab === 'edit' && mayWrite && (
              <Button onPress={register} isPending={saving} isDisabled={Boolean(parseError) || (isNew && !newName.trim())}>
                {isNew ? 'Register' : 'Register new version'}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
