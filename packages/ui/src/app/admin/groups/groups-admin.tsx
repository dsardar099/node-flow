'use client';

import { Persons, Plus, TrashBin, Xmark } from '@gravity-ui/icons';
import {
  AlertDialog,
  Avatar,
  Button,
  Card,
  ComboBox,
  Description,
  Drawer,
  EmptyState,
  Input,
  Label,
  ListBox,
  Table,
  Tabs,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ScopeChips, ScopePicker } from '../../../components/admin/scope-picker';
import { PageHeader } from '../../../components/shell/page-header';
import { fetchJson } from '../../../lib/fetch-json';
import { mutate } from '../../../lib/mutate';
import type { AdminUser } from '../users/users-admin';

export interface AdminGroup {
  name: string;
  description: string | null;
  scopes: string[];
  tagGrants: string[];
}

interface Member {
  userId: string;
  email: string;
  name: string;
}

/**
 * Teams: scopes and tag grants given to everyone in them, and a place a human
 * task can be routed to.
 */
export function GroupsAdmin({ namespace, groups, users }: { namespace: string; groups: AdminGroup[]; users: AdminUser[] }) {
  const [open, setOpen] = useState<string | 'new'>();
  return (
    <>
      <PageHeader
        title="Groups"
        description="Teams. Members receive the group's scopes and tag grants, and human tasks can be assigned to a group."
        actions={
          <Button onPress={() => setOpen('new')}>
            <Plus />
            New group
          </Button>
        }
      />
      <div className="px-4 md:px-8 pb-10">
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Groups" className="min-w-[640px]" onRowAction={(key) => setOpen(String(key))}>
                <Table.Header>
                  <Table.Column isRowHeader>Group</Table.Column>
                  <Table.Column>Scopes</Table.Column>
                  <Table.Column>Tag grants</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Persons className="size-6" />
                      </span>
                      <span className="text-sm font-medium">No groups yet</span>
                      <span className="max-w-sm text-sm text-muted">Grant a team access once instead of person by person.</span>
                    </EmptyState>
                  )}
                >
                  {groups.map((group) => (
                    <Table.Row key={group.name} id={group.name} className="cursor-pointer">
                      <Table.Cell>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                            <Persons className="size-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium">{group.name}</p>
                            {group.description && <p className="text-xs text-muted">{group.description}</p>}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeChips scopes={group.scopes} />
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeChips scopes={group.tagGrants} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
      <GroupDrawer
        namespace={namespace}
        group={open === 'new' ? undefined : groups.find((g) => g.name === open)}
        isOpen={open !== undefined}
        users={users}
        onOpenChange={(o) => !o && setOpen(undefined)}
      />
    </>
  );
}

function GroupDrawer({
  namespace,
  group,
  isOpen,
  users,
  onOpenChange,
}: {
  namespace: string;
  group?: AdminGroup;
  isOpen: boolean;
  users: AdminUser[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isNew = !group;
  const [tab, setTab] = useState<'members' | 'access'>('members');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [tagGrants, setTagGrants] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const base = group ? `/v1/ns/${namespace}/groups/${encodeURIComponent(group.name)}` : '';

  const loadMembers = async () => {
    if (!group) return;
    const detail = await fetchJson<{ members: Member[] }>(base);
    setMembers(detail.members);
  };

  useEffect(() => {
    if (!isOpen) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setScopes(group?.scopes ?? []);
    setTagGrants((group?.tagGrants ?? []).join(', '));
    setTab(isNew ? 'access' : 'members');
    setMembers([]);
    void loadMembers();
  }, [isOpen, group]);

  const grants = tagGrants.split(',').map((t) => t.trim()).filter(Boolean);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      router.refresh();
      return true;
    } catch (failure) {
      toast.danger((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (isNew) {
      if (await run(() => mutate(`/v1/ns/${namespace}/groups`, { body: { name, description: description || undefined, scopes, tagGrants: grants } }), `Created ${name}`)) {
        onOpenChange(false);
      }
      return;
    }
    await run(async () => {
      await mutate(`${base}/scopes`, { method: 'PUT', body: { scopes } });
      await mutate(`${base}/tag-grants`, { method: 'PUT', body: { tagGrants: grants } });
    }, 'Access saved');
  };

  const nonMembers = users.filter((u) => !members.some((m) => m.userId === u.id));

  return (
    <>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="sm:w-[36rem]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{isNew ? 'New group' : group.name}</Drawer.Heading>
              {!isNew && group.description && <p className="text-sm text-muted">{group.description}</p>}
            </Drawer.Header>
            <Drawer.Body className="space-y-5">
              {!isNew && (
                <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as typeof tab)}>
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Group" className="w-auto">
                      <Tabs.Tab id="members" className="w-auto flex-none px-4">
                        Members · {members.length}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="access" className="w-auto flex-none px-4">
                        Access
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              )}

              {tab === 'members' && !isNew && (
                <div className="space-y-3">
                  <ComboBox
                    aria-label="Add a member"
                    inputValue={adding}
                    onInputChange={setAdding}
                    onSelectionChange={(key) => {
                      if (key === null) return;
                      void run(() => mutate(`${base}/members`, { body: { userId: String(key) } }), 'Member added').then(() => {
                        setAdding('');
                        void loadMembers();
                      });
                    }}
                  >
                    <ComboBox.InputGroup>
                      <Input placeholder="Add a person by name or email" />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover>
                      <ListBox>
                        {nonMembers.map((u) => (
                          <ListBox.Item key={u.id} id={u.id} textValue={`${u.name} ${u.email}`}>
                            {u.name} <span className="text-muted">{u.email}</span>
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                  <ul className="divide-y divide-separator rounded-xl border border-separator">
                    {members.length === 0 && <li className="p-4 text-sm text-muted">No members yet.</li>}
                    {members.map((m) => (
                      <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar size="sm">
                          <Avatar.Fallback>{m.name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{m.name}</p>
                          <p className="text-xs text-muted">{m.email}</p>
                        </div>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${m.email}`}
                          onPress={() =>
                            void run(() => mutate(`${base}/members/${m.userId}`, { method: 'DELETE' }), 'Member removed').then(loadMembers)
                          }
                        >
                          <Xmark />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(tab === 'access' || isNew) && (
                <div className="space-y-5">
                  {isNew && (
                    <>
                      <TextField value={name} onChange={setName} isRequired>
                        <Label>Name</Label>
                        <Input placeholder="payments" />
                        <Description>Human tasks are routed to it by this name.</Description>
                      </TextField>
                      <TextField value={description} onChange={setDescription}>
                        <Label>Description</Label>
                        <Input />
                      </TextField>
                    </>
                  )}
                  <div>
                    <p className="mb-3 text-sm font-medium">Scopes for every member</p>
                    <ScopePicker value={scopes} onChange={setScopes} />
                  </div>
                  <TextField value={tagGrants} onChange={setTagGrants}>
                    <Label>Tag grants</Label>
                    <Input className="font-mono" placeholder="team:payments, env:*" />
                    <Description>Tagged workflows members may reach. Untagged ones are open to everyone with the scope.</Description>
                  </TextField>
                </div>
              )}
            </Drawer.Body>
            <Drawer.Footer>
              {!isNew && (
                <Button variant="ghost" className="mr-auto text-danger" onPress={() => setConfirmDelete(true)}>
                  <TrashBin />
                  Delete group
                </Button>
              )}
              <Button slot="close" variant="tertiary">
                Close
              </Button>
              {(tab === 'access' || isNew) && (
                <Button onPress={save} isPending={busy} isDisabled={(isNew && !name.trim()) || busy}>
                  {isNew ? 'Create group' : 'Save access'}
                </Button>
              )}
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
      <AlertDialog.Backdrop isOpen={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {group?.name}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Members lose what the group granted. Tasks routed to it will fail to open.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button
                slot="close"
                variant="danger"
                onPress={() => void run(() => mutate(base, { method: 'DELETE' }), `Deleted ${group?.name}`).then((ok) => ok && onOpenChange(false))}
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
