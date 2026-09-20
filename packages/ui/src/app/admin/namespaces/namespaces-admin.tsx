'use client';

import { Plus } from '@gravity-ui/icons';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Drawer,
  Input,
  Label,
  Table,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { CopyButton } from '../../../components/ui/copy-button';
import { Ago } from '../../../components/ui/ago';
import { LocalTime } from '../../../components/ui/local-time';
import { mutate } from '../../../lib/mutate';

export interface NamespaceRow {
  id: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

export function NamespacesAdmin({
  namespaces,
  currentNamespace,
}: {
  namespaces: NamespaceRow[];
  currentNamespace: string;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Namespaces"
        description="Tenants on this install. Each one has its own definitions, executions, queues, secrets and users."
        actions={
          <Button onPress={() => setCreating(true)}>
            <Plus className="size-4" />
            New namespace
          </Button>
        }
      />

      {/* The page gutter every other screen uses. Without it the table sits
          flush against the sidebar and the window edge. */}
      <div className="space-y-4 px-4 pb-10 md:px-8">
        <Card className="p-0">
          <Table aria-label="Namespaces">
            <Table.ScrollContainer>
              <Table.Content className="min-w-150">
                <Table.Header>
                  <Table.Column isRowHeader>Slug</Table.Column>
                  <Table.Column>Created</Table.Column>
                  <Table.Column>Settings</Table.Column>
                </Table.Header>
                <Table.Body>
                  {namespaces.map((namespace) => (
                    <Table.Row key={namespace.id} id={namespace.id}>
                      <Table.Cell>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm">
                            {namespace.slug}
                          </span>
                          {namespace.slug === currentNamespace ? (
                            <Chip size="sm" variant="soft" color="accent">
                              You are here
                            </Chip>
                          ) : null}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        <span className="block text-sm">
                          <Ago value={namespace.createdAt} />
                        </span>
                        <LocalTime
                          value={namespace.createdAt}
                          className="tabular block text-xs text-muted"
                        />
                      </Table.Cell>
                      <Table.Cell className="text-sm text-muted">
                        {Object.keys(namespace.settings ?? {}).length === 0
                          ? 'Defaults'
                          : Object.keys(namespace.settings).join(', ')}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <CreateNamespaceDrawer isOpen={creating} onOpenChange={setCreating} />
    </>
  );
}

/**
 * Creating a tenant, and optionally its first credential.
 *
 * The key is off by default and returned exactly once. That mirrors the API,
 * and for the same reason: a caller who did not ask for a credential should not
 * be handed one in a response that may end up in a log. The new key carries
 * `admin` *within* the new namespace and never `platform:admin` — the tenant
 * runs itself and cannot create further tenants.
 */
function CreateNamespaceDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [withKey, setWithKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const close = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setSlug('');
      setWithKey(false);
      setIssued(null);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const created = await mutate<{
        slug: string;
        apiKey?: { token: string };
      }>('/v1/namespaces', {
        body: { slug, createApiKey: withKey },
      });

      router.refresh();

      if (created.apiKey?.token) {
        // Held on screen rather than toasted away: this is the only time it
        // exists anywhere, and a toast that disappears after four seconds is a
        // bad place to put an unrecoverable secret.
        setIssued(created.apiKey.token);
        toast.success(`Created ${created.slug}. Copy the key before closing.`);
      } else {
        toast.success(`Created ${created.slug}.`);
        close(false);
      }
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={close}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[34rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>New namespace</Drawer.Heading>
          </Drawer.Header>

          <Drawer.Body className="space-y-5">
            {issued ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="font-mono">{slug}</span> is ready. Its first
                  API key is below.
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-separator bg-default/40 p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">
                    {issued}
                  </code>
                  <CopyButton value={issued} label="Copy API key" />
                </div>
                <p className="text-sm text-danger">
                  This is shown once and cannot be recovered. Store it before
                  closing.
                </p>
              </div>
            ) : (
              <>
                <TextField value={slug} onChange={setSlug} isRequired>
                  <Label>Slug</Label>
                  <Input placeholder="acme" className="font-mono" />
                  <Description>
                    Three to sixty-four characters. It appears in every API path
                    for this tenant and cannot be changed afterwards.
                  </Description>
                </TextField>

                <Checkbox isSelected={withKey} onChange={setWithKey}>
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="text-sm">Issue its first API key</span>
                  </Checkbox.Content>
                </Checkbox>
                <p className="-mt-3 text-sm text-muted">
                  A new namespace has no credential, so nothing can act in it
                  until one exists. The key is{' '}
                  <span className="font-medium">
                    admin within the new namespace only
                  </span>
                  , and is shown once.
                </p>
              </>
            )}
          </Drawer.Body>

          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              {issued ? 'Done' : 'Cancel'}
            </Button>
            {issued ? null : (
              <Button
                onPress={create}
                isDisabled={busy || slug.trim().length < 3}
              >
                Create
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
