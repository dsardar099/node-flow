'use client';
import { CurlyBrackets, Ellipsis, PencilToSquare, Plus, TrashBin } from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Description,
  Drawer,
  Dropdown,
  EmptyState,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  SearchField,
  Table,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { CopyButton } from '../../components/ui/copy-button';
import { mutate } from '../../lib/mutate';
import { triggerClass } from '../../components/ui/dropdown-trigger';
import { Ago } from '../../components/ui/ago';
export interface EnvironmentVariable {
  name: string;
  type: 'TEXT' | 'JSON';
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Configuration that differs between environments and is not secret.
 *
 * Each row shows the exact expression to paste into a definition, because the
 * first thing anyone does after creating a variable is go and reference it.
 */
export function EnvironmentList({
  namespace,
  variables,
  mayWrite,
}: {
  namespace: string;
  variables: EnvironmentVariable[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EnvironmentVariable | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return variables;
    return variables.filter((v) =>
      [v.name, v.description ?? '', JSON.stringify(v.value)].some((f) => f.toLowerCase().includes(needle))
    );
  }, [variables, query]);
  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/environment/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title="Environment"
        description="Non-secret configuration your workflows read as ${workflow.env.NAME} — base URLs, bucket names, feature flags. Use secrets for credentials."
        actions={
          mayWrite && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New variable
            </Button>
          )
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <SearchField aria-label="Search variables" value={query} onChange={setQuery} className="max-w-lg">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search by name, description or value" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Environment variables"
                className="min-w-[760px]"
                onRowAction={(key) => {
                  const variable = variables.find((v) => v.name === key);
                  if (variable) setEditing(variable);
                }}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Variable</Table.Column>
                  <Table.Column>Value</Table.Column>
                  <Table.Column>Reference</Table.Column>
                  <Table.Column>Updated</Table.Column>
                  <Table.Column className="w-12">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <CurlyBrackets className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {variables.length === 0 ? 'No variables yet' : 'Nothing matches that search'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {variables.length === 0
                          ? 'Keep environment-specific values out of your definitions, so the same workflow runs everywhere.'
                          : 'Try a shorter search.'}
                      </span>
                      {variables.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => setEditing('new')}>
                          <Plus />
                          New variable
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((variable) => {
                    const reference = `\${workflow.env.${variable.name}}`;
                    const text = variable.type === 'TEXT' ? String(variable.value) : JSON.stringify(variable.value);
                    return (
                      <Table.Row key={variable.name} id={variable.name} className="cursor-pointer">
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">{variable.name}</span>
                            {variable.type === 'JSON' && (
                              <Chip size="sm" variant="soft" color="accent">
                                JSON
                              </Chip>
                            )}
                          </div>
                          {variable.description && <p className="text-xs text-muted">{variable.description}</p>}
                        </Table.Cell>
                        <Table.Cell className="max-w-72">
                          <span className="block truncate font-mono text-xs" title={text}>
                            {text}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            {reference}
                            <CopyButton value={reference} label="Copy expression" />
                          </span>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm">
                          <Ago value={variable.updatedAt} />
                        </Table.Cell>
                        <Table.Cell>
                          {mayWrite && (
                            <Dropdown>
                              <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${variable.name}`}>
                                  <Ellipsis />
                              </Dropdown.Trigger>
                              <Dropdown.Popover placement="bottom end" className="min-w-40">
                                <Dropdown.Menu
                                  aria-label="Variable actions"
                                  onAction={(key) => {
                                    if (key === 'edit') setEditing(variable);
                                    if (key === 'delete') setDeleting(variable.name);
                                  }}
                                >
                                  <Dropdown.Item id="edit" textValue="Edit">
                                    <PencilToSquare />
                                    <Label>Edit</Label>
                                  </Dropdown.Item>
                                  <Dropdown.Item id="delete" textValue="Delete" variant="danger">
                                    <TrashBin />
                                    <Label>Delete</Label>
                                  </Dropdown.Item>
                                </Dropdown.Menu>
                              </Dropdown.Popover>
                            </Dropdown>
                          )}
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
      <VariableDrawer
        namespace={namespace}
        variable={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        readOnly={!mayWrite}
        existing={variables.map((v) => v.name)}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                Tasks scheduled afterwards read it as empty. Tasks already scheduled keep the value they were given.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && remove(deleting)}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
function VariableDrawer({
  namespace,
  variable,
  isOpen,
  readOnly,
  existing,
  onOpenChange,
}: {
  namespace: string;
  variable?: EnvironmentVariable;
  isOpen: boolean;
  readOnly: boolean;
  existing: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isNew = !variable;
  const [name, setName] = useState('');
  const [type, setType] = useState<'TEXT' | 'JSON'>('TEXT');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setName(variable?.name ?? '');
    setType(variable?.type ?? 'TEXT');
    setValue(variable ? (variable.type === 'TEXT' ? String(variable.value) : JSON.stringify(variable.value, null, 2)) : '');
    setDescription(variable?.description ?? '');
  }, [isOpen, variable]);
  const nameError =
    name && !NAME.test(name)
      ? 'Letters, digits and underscores, not starting with a digit'
      : isNew && existing.includes(name)
        ? 'A variable with this name exists — edit it instead'
        : undefined;
  let jsonError: string | undefined;
  let parsed: unknown = value;
  if (type === 'JSON') {
    try {
      parsed = JSON.parse(value);
    } catch (failure) {
      jsonError = value ? (failure as Error).message : 'Enter a JSON value';
    }
  }
  const save = async () => {
    setSaving(true);
    try {
      await mutate(`/v1/ns/${namespace}/environment/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { type, value: parsed, description: description || undefined },
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
        <Drawer.Dialog className="sm:w-[32rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{isNew ? 'New variable' : variable.name}</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body>
            <fieldset disabled={readOnly} className="space-y-5">
              <TextField value={name} onChange={setName} isRequired isDisabled={!isNew || readOnly} isInvalid={Boolean(nameError)}>
                <Label>Name</Label>
                <Input className="font-mono" placeholder="PAYMENTS_BASE_URL" />
                {name && !nameError && (
                  <Description>
                    Referenced as <code>{`\${workflow.env.${name}}`}</code>
                  </Description>
                )}
                <FieldError>{nameError}</FieldError>
              </TextField>
              <RadioGroup value={type} onChange={(v) => setType(v as 'TEXT' | 'JSON')} orientation="horizontal">
                <Label>Type</Label>
                <Radio value="TEXT">
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    Text
                  </Radio.Content>
                </Radio>
                <Radio value="JSON">
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    JSON
                  </Radio.Content>
                </Radio>
              </RadioGroup>
              <TextField value={value} onChange={setValue} isInvalid={Boolean(jsonError)}>
                <Label>Value</Label>
                <TextArea rows={type === 'JSON' ? 8 : 3} spellCheck={false} className="font-mono text-sm" />
                {type === 'JSON' && !jsonError && (
                  <Description>Read nested fields as {'${workflow.env.NAME.field}'}.</Description>
                )}
                <FieldError>{jsonError}</FieldError>
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input placeholder="What it configures" />
              </TextField>
            </fieldset>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button onPress={save} isPending={saving} isDisabled={!name || Boolean(nameError) || Boolean(jsonError) || saving}>
                {isNew ? 'Create' : 'Save'}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
