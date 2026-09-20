'use client';
import { Lock, LockOpen, Plus, TrashBin } from '@gravity-ui/icons';
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
  Table,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { CopyButton } from '../../../components/ui/copy-button';
import { mutate } from '../../../lib/mutate';
import { Ago } from '../../../components/ui/ago';
export interface SecretSummary {
  name: string;
  description: string | null;
  sealed: boolean;
  value?: string;
  updatedAt: string;
}
/**
 * Credentials workflows use without anyone reading them back.
 *
 * A sealed value is write-only: it can be replaced, never displayed. Anyone who
 * genuinely needs it already has it; anyone who does not needs a rotation.
 */
export function SecretsAdmin({ namespace, secrets }: { namespace: string; secrets: SecretSummary[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SecretSummary | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title="Secrets"
        description="Credentials workflows reference as ${secrets.NAME}. Resolved only into the copy a worker receives — never stored in an execution, never shown again."
        actions={
          <Button onPress={() => setEditing('new')}>
            <Plus />
            New secret
          </Button>
        }
      />
      <div className="px-4 md:px-8 pb-10">
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Secrets" className="min-w-[640px]">
                <Table.Header>
                  <Table.Column isRowHeader>Secret</Table.Column>
                  <Table.Column>Reference</Table.Column>
                  <Table.Column>Updated</Table.Column>
                  <Table.Column className="w-28">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Lock className="size-6" />
                      </span>
                      <span className="text-sm font-medium">No secrets yet</span>
                      <span className="max-w-sm text-sm text-muted">Keep API keys and passwords out of definitions and task inputs.</span>
                    </EmptyState>
                  )}
                >
                  {secrets.map((secret) => {
                    const reference = `\${secrets.${secret.name}}`;
                    return (
                      <Table.Row key={secret.name} id={secret.name}>
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            {secret.sealed ? <Lock className="size-4 text-success" /> : <LockOpen className="size-4 text-muted" />}
                            <span className="font-mono text-sm font-medium">{secret.name}</span>
                            {!secret.sealed && (
                              <Chip size="sm" variant="soft">
                                plain
                              </Chip>
                            )}
                          </div>
                          {secret.description && <p className="pl-6 text-xs text-muted">{secret.description}</p>}
                        </Table.Cell>
                        <Table.Cell>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            {reference}
                            <CopyButton value={reference} label="Copy reference" />
                          </span>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm"><Ago value={secret.updatedAt} /></Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onPress={() => setEditing(secret)}>
                              Rotate
                            </Button>
                            <Button isIconOnly size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${secret.name}`} onPress={() => setDeleting(secret.name)}>
                              <TrashBin />
                            </Button>
                          </div>
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
      <SecretDrawer namespace={namespace} secret={editing === 'new' ? undefined : editing} isOpen={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Tasks that reference it will fail to dispatch until it is created again.</p>
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
function SecretDrawer({ namespace, secret, isOpen, onOpenChange }: { namespace: string; secret?: SecretSummary; isOpen: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setName(secret?.name ?? '');
    setValue('');
    setDescription(secret?.description ?? '');
  }, [isOpen, secret]);
  const save = async () => {
    setBusy(true);
    try {
      await mutate(`/v1/ns/${namespace}/secrets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { value, description: description || undefined },
      });
      toast.success(secret ? `Rotated ${name}` : `Created ${name}`);
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[30rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{secret ? `Rotate ${secret.name}` : 'New secret'}</Drawer.Heading>
            {secret && <p className="text-sm text-muted">The current value is not shown and cannot be. Enter the new one.</p>}
          </Drawer.Header>
          <Drawer.Body className="space-y-5">
            <TextField value={name} onChange={setName} isRequired isDisabled={Boolean(secret)}>
              <Label>Name</Label>
              <Input className="font-mono" placeholder="STRIPE_API_KEY" />
            </TextField>
            <TextField value={value} onChange={setValue} isRequired>
              <Label>Value</Label>
              <TextArea rows={3} spellCheck={false} className="font-mono text-sm" autoComplete="off" />
              <Description>Encrypted with the namespace key. After saving, only its name is visible.</Description>
            </TextField>
            <TextField value={description} onChange={setDescription}>
              <Label>Description</Label>
              <Input placeholder="What it unlocks" />
            </TextField>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button onPress={save} isPending={busy} isDisabled={!name || !value || busy}>
              {secret ? 'Rotate' : 'Create'}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
