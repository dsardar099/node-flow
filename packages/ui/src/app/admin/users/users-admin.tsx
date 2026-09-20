'use client';
import { ArrowsRotateRight, Ellipsis, PersonPlus, PersonXmark } from '@gravity-ui/icons';
import {
  AlertDialog,
  Avatar,
  Button,
  Card,
  Chip,
  Description,
  Drawer,
  Dropdown,
  Input,
  Label,
  SearchField,
  Table,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ScopeChips, ScopePicker } from '../../../components/admin/scope-picker';
import { PageHeader } from '../../../components/shell/page-header';
import { CopyButton } from '../../../components/ui/copy-button';
import { formatDateTime } from '../../../components/ui/format';
import { mutate } from '../../../lib/mutate';
import { triggerClass } from '../../../components/ui/dropdown-trigger';
import { Ago } from '../../../components/ui/ago';
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  scopes: string[];
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
/** A password that satisfies the policy, for handing to someone who changes it at first sign-in. */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${body.slice(0, 6)}-${body.slice(6, 12)}-${body.slice(12)}-9`;
}
export function UsersAdmin({ namespace, users, currentUserId }: { namespace: string; users: AdminUser[]; currentUserId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<AdminUser>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(needle)) : users;
  }, [users, query]);
  const disable = async (user: AdminUser) => {
    try {
      await mutate(`/v1/ns/${namespace}/users/${user.id}`, { method: 'DELETE' });
      toast.success(`Disabled ${user.email}; their sessions were revoked`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  const active = users.filter((u) => !u.disabledAt).length;
  return (
    <>
      <PageHeader
        title="Users"
        description="People who sign in to this namespace. Scopes decide what each person can see and do."
        actions={
          <Button onPress={() => setCreating(true)}>
            <PersonPlus />
            Add user
          </Button>
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField aria-label="Search users" value={query} onChange={setQuery} className="max-w-md flex-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search by name or email" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <span className="ml-auto text-sm text-muted">
            {active} active · {users.length - active} disabled
          </span>
        </div>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Users" className="min-w-[760px]">
                <Table.Header>
                  <Table.Column isRowHeader>User</Table.Column>
                  <Table.Column>Scopes</Table.Column>
                  <Table.Column>Last sign-in</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="w-12">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {shown.map((user) => (
                    <Table.Row key={user.id} id={user.id}>
                      <Table.Cell>
                        <div className="flex items-center gap-3">
                          <Avatar size="sm" color={user.disabledAt ? 'default' : 'accent'}>
                            <Avatar.Fallback>{initials(user.name)}</Avatar.Fallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {user.name}
                              {user.id === currentUserId && <span className="ml-2 text-xs text-muted">you</span>}
                            </p>
                            <p className="text-xs text-muted">{user.email}</p>
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeChips scopes={user.scopes} />
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm">
                        {user.lastLoginAt ? <span title={formatDateTime(user.lastLoginAt)}><Ago value={user.lastLoginAt} /></span> : <span className="text-muted">Never</span>}
                      </Table.Cell>
                      <Table.Cell>
                        {user.disabledAt ? (
                          <Chip size="sm" variant="soft">
                            Disabled
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="soft" color="success">
                            Active
                          </Chip>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {!user.disabledAt && user.id !== currentUserId && (
                          <Dropdown>
                            <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`Actions for ${user.email}`}>
                                <Ellipsis />
                            </Dropdown.Trigger>
                            <Dropdown.Popover placement="bottom end">
                              <Dropdown.Menu aria-label="User actions" onAction={() => setDisabling(user)}>
                                <Dropdown.Item id="disable" textValue="Disable" variant="danger">
                                  <PersonXmark />
                                  <Label>Disable and sign out</Label>
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown>
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
      <CreateUserDrawer namespace={namespace} isOpen={creating} onOpenChange={setCreating} />
      <AlertDialog.Backdrop isOpen={disabling !== undefined} onOpenChange={(open) => !open && setDisabling(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Disable {disabling?.email}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">They are signed out everywhere and cannot sign in. Their history stays.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => disabling && disable(disabling)}>
                Disable
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
function CreateUserDrawer({ namespace, isOpen, onOpenChange }: { namespace: string; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [scopes, setScopes] = useState<string[]>(['workflows:read', 'executions:read', 'human-tasks:read', 'human-tasks:write']);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await mutate(`/v1/ns/${namespace}/users`, { body: { email, name, password, scopes } });
      toast.success(`Added ${email}. Share the password securely.`);
      onOpenChange(false);
      setEmail('');
      setName('');
      setPassword(generatePassword());
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
        <Drawer.Dialog className="sm:w-[34rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>Add user</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="space-y-5">
            <TextField value={name} onChange={setName} isRequired>
              <Label>Name</Label>
              <Input placeholder="Grace Hopper" />
            </TextField>
            <TextField value={email} onChange={setEmail} isRequired type="email">
              <Label>Email</Label>
              <Input placeholder="grace@company.com" />
            </TextField>
            <TextField value={password} onChange={setPassword} isRequired>
              <Label>Initial password</Label>
              <div className="flex items-center gap-2">
                <Input className="flex-1 font-mono" />
                <CopyButton value={password} label="Copy password" />
                <Button isIconOnly size="sm" variant="ghost" aria-label="Generate another" onPress={() => setPassword(generatePassword())}>
                  <ArrowsRotateRight />
                </Button>
              </div>
              <Description>Generated to meet the password policy. Hand it over through a secure channel.</Description>
            </TextField>
            <div>
              <p className="mb-3 text-sm font-medium">Scopes</p>
              <ScopePicker value={scopes} onChange={setScopes} />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button onPress={create} isPending={busy} isDisabled={!email || !name || !password || busy}>
              Add user
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
