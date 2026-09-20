'use client';

import { Key, Plus, TrashBin, TriangleExclamation } from '@gravity-ui/icons';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Description,
  Drawer,
  EmptyState,
  Input,
  Label,
  Modal,
  Table,
  Tabs,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ScopeChips, ScopePicker } from '../../../components/admin/scope-picker';
import { PageHeader } from '../../../components/shell/page-header';
import { CopyButton } from '../../../components/ui/copy-button';
import { formatDateTime, formatRelative } from '../../../components/ui/format';
import { mutate } from '../../../lib/mutate';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ServiceAccount {
  id: string;
  name: string;
  keyId: string;
  scopes: string[];
  disabledAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

type Kind = 'api-key' | 'service-account';

/**
 * Credentials for software rather than people.
 *
 * API keys are long-lived bearer tokens for a CLI or a CI job; service
 * accounts exchange a key and secret for short-lived tokens, which is what a
 * long-running worker fleet should use. Either secret is shown exactly once.
 */
export function ApplicationsAdmin({ apiKeys, serviceAccounts }: { apiKeys: ApiKey[]; serviceAccounts: ServiceAccount[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Kind>('service-account');
  const [creating, setCreating] = useState<Kind>();
  const [issued, setIssued] = useState<{ kind: Kind; name: string; values: [string, string][] }>();
  const [revoking, setRevoking] = useState<{ kind: Kind; id: string; name: string }>();

  const revoke = async () => {
    if (!revoking) return;
    try {
      await mutate(`/v1/auth/${revoking.kind === 'api-key' ? 'api-keys' : 'service-accounts'}/${revoking.id}`, { method: 'DELETE' });
      toast.success(`${revoking.kind === 'api-key' ? 'Revoked' : 'Disabled'} ${revoking.name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Applications"
        description="Credentials for workers, CI and scripts. Give each one only the scopes it needs; a new credential can do nothing until scopes are granted."
        actions={
          <Button onPress={() => setCreating(tab)}>
            <Plus />
            {tab === 'api-key' ? 'New API key' : 'New service account'}
          </Button>
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as Kind)}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Credential type" className="w-auto">
              <Tabs.Tab id="service-account" className="w-auto flex-none px-4">
                Service accounts
                <Chip size="sm" variant="soft" className="ml-2">
                  {serviceAccounts.filter((s) => !s.disabledAt).length}
                </Chip>
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="api-key" className="w-auto flex-none px-4">
                API keys
                <Chip size="sm" variant="soft" className="ml-2">
                  {apiKeys.filter((k) => !k.revokedAt).length}
                </Chip>
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label={tab === 'api-key' ? 'API keys' : 'Service accounts'} className="min-w-[760px]">
                <Table.Header>
                  <Table.Column isRowHeader>Name</Table.Column>
                  <Table.Column>Identifier</Table.Column>
                  <Table.Column>Scopes</Table.Column>
                  <Table.Column>Last used</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="w-12">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Key className="size-6" />
                      </span>
                      <span className="text-sm font-medium">None yet</span>
                    </EmptyState>
                  )}
                >
                  {(tab === 'api-key'
                    ? apiKeys.map((k) => ({
                        id: k.id,
                        name: k.name,
                        identifier: `${k.prefix}…`,
                        scopes: k.scopes,
                        lastUsedAt: k.lastUsedAt,
                        inactive: k.revokedAt ? 'Revoked' : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'Expired' : undefined,
                        note: k.expiresAt ? `expires ${formatDateTime(k.expiresAt)}` : undefined,
                      }))
                    : serviceAccounts.map((s) => ({
                        id: s.id,
                        name: s.name,
                        identifier: s.keyId,
                        scopes: s.scopes,
                        lastUsedAt: s.lastUsedAt,
                        inactive: s.disabledAt ? 'Disabled' : undefined,
                        note: undefined as string | undefined,
                      }))
                  ).map((row) => (
                    <Table.Row key={row.id} id={row.id}>
                      <Table.Cell>
                        <p className="text-sm font-medium">{row.name}</p>
                        {row.note && <p className="text-xs text-muted">{row.note}</p>}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs text-muted">{row.identifier}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeChips scopes={row.scopes} />
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm">
                        {/* Clock-dependent: the server and the browser read it at different instants. */}
                        <span suppressHydrationWarning>
                          {row.lastUsedAt ? formatRelative(row.lastUsedAt) : <span className="text-muted">Never</span>}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        {row.inactive ? (
                          <Chip size="sm" variant="soft">
                            {row.inactive}
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="soft" color="success">
                            Active
                          </Chip>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {!row.inactive && (
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            aria-label={`Revoke ${row.name}`}
                            onPress={() => setRevoking({ kind: tab, id: row.id, name: row.name })}
                          >
                            <TrashBin />
                          </Button>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <CreateCredentialDrawer
        kind={creating}
        onOpenChange={(open) => !open && setCreating(undefined)}
        onIssued={(value) => {
          setCreating(undefined);
          setIssued(value);
          router.refresh();
        }}
      />

      <Modal.Backdrop isOpen={issued !== undefined} onOpenChange={(open) => !open && setIssued(undefined)} isDismissable={false}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.Header>
              <Modal.Heading>{issued?.name} is ready</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
                <TriangleExclamation className="mt-0.5 size-4 shrink-0 text-warning" />
                Copy this now. It is shown once and cannot be recovered — only replaced.
              </div>
              {issued?.values.map(([label, value]) => (
                <div key={label}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
                  <div className="flex items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
                    <CopyButton value={value} label={`Copy ${label}`} />
                  </div>
                </div>
              ))}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close">I have copied it</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={revoking !== undefined} onOpenChange={(open) => !open && setRevoking(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Revoke {revoking?.name}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Anything using it stops authenticating immediately. This cannot be undone.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={revoke}>
                Revoke
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function CreateCredentialDrawer({
  kind,
  onOpenChange,
  onIssued,
}: {
  kind?: Kind;
  onOpenChange: (open: boolean) => void;
  onIssued: (issued: { kind: Kind; name: string; values: [string, string][] }) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['queues:lease:*', 'tasks:report']);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!kind) return;
    setBusy(true);
    try {
      if (kind === 'api-key') {
        const result = await mutate<{ token: string }>('/v1/auth/api-keys', {
          body: { name, scopes, ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}) },
        });
        onIssued({ kind, name, values: [['API key', result.token]] });
      } else {
        const result = await mutate<{ keyId: string; secret: string }>('/v1/auth/service-accounts', { body: { name, scopes } });
        onIssued({ kind, name, values: [['Key id', result.keyId], ['Secret', result.secret]] });
      }
      setName('');
      setExpires('');
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer.Backdrop isOpen={kind !== undefined} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[34rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{kind === 'api-key' ? 'New API key' : 'New service account'}</Drawer.Heading>
            <p className="text-sm text-muted">
              {kind === 'api-key'
                ? 'A single bearer token — right for a CLI or a CI job.'
                : 'A key and secret exchanged for hour-long tokens — right for a worker fleet.'}
            </p>
          </Drawer.Header>
          <Drawer.Body className="space-y-5">
            <TextField value={name} onChange={setName} isRequired>
              <Label>Name</Label>
              <Input placeholder={kind === 'api-key' ? 'ci-deploy' : 'payments-workers'} />
              <Description>Say what uses it, so the audit log reads clearly.</Description>
            </TextField>
            {kind === 'api-key' && (
              <TextField value={expires} onChange={setExpires} type="date">
                <Label>Expires</Label>
                <Input />
                <Description>Optional, and recommended.</Description>
              </TextField>
            )}
            <div>
              <p className="mb-3 text-sm font-medium">Scopes</p>
              <ScopePicker value={scopes} onChange={setScopes} />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button onPress={create} isPending={busy} isDisabled={!name.trim() || busy}>
              Create
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
