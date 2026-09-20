'use client';

import { ArrowUpRightFromSquare, CircleExclamation, Ellipsis, Link as LinkIcon, PencilToSquare, Plus, Thunderbolt, TrashBin } from '@gravity-ui/icons';
import { AlertDialog, Button, Card, Chip, Dropdown, EmptyState, Label, SearchField, Tooltip, toast } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { CopyButton } from '../../components/ui/copy-button';
import { formatRelative } from '../../components/ui/format';
import { mutate } from '../../lib/mutate';
import type { EventHandler } from '../eventHandlerDef/handler-list';
import { VERIFIERS, type Verifier } from './verifiers';
import { WebhookDrawer } from './webhook-drawer';
import { triggerClass } from '../../components/ui/dropdown-trigger';

export interface IncomingWebhook {
  id: string;
  name: string;
  description: string | null;
  verifier: Verifier;
  config: { header?: string; algorithm?: 'sha256' | 'sha1' | 'sha512'; encoding?: 'hex' | 'base64'; prefix?: string };
  secretName: string | null;
  enabled: boolean;
  path: string;
  receivedCount: number;
  rejectedCount: number;
  lastReceivedAt: string | null;
  lastError: string | null;
}

/**
 * Inbound webhooks: the verified front door, and what is behind it.
 *
 * Each card answers the three questions of a webhook that "isn't working":
 * is anything arriving, is it being rejected (and why), and is any handler
 * listening. The last is the one most often missed — a verified delivery with
 * no handler does nothing — so a webhook with none says so and offers to add one.
 */
export function WebhookList({
  namespace,
  webhooks,
  handlers,
  secretNames,
  mayWrite,
  mayManageSecrets,
}: {
  namespace: string;
  webhooks: IncomingWebhook[];
  handlers: EventHandler[];
  secretNames: string[];
  mayWrite: boolean;
  mayManageSecrets: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<IncomingWebhook | 'new'>();
  const [deleting, setDeleting] = useState<string>();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? webhooks.filter((w) => [w.name, w.description ?? '', VERIFIERS[w.verifier].label].some((f) => f.toLowerCase().includes(needle)))
      : webhooks;
  }, [webhooks, query]);

  const remove = async (name: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/incoming-webhooks/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Verified endpoints for GitHub, Stripe, Slack and anything that signs its requests. Event handlers decide what each delivery does."
        actions={
          mayWrite && (
            <Button onPress={() => setEditing('new')}>
              <Plus />
              New webhook
            </Button>
          )
        }
      />

      <div className="space-y-4 px-4 pb-10 md:px-8">
        {webhooks.length > 0 && (
          <SearchField aria-label="Search webhooks" value={query} onChange={setQuery} className="max-w-md">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search webhooks" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        )}

        {webhooks.length === 0 ? (
          <Card>
            <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <LinkIcon className="size-6" />
              </span>
              <span className="text-sm font-medium">No webhooks yet</span>
              <span className="max-w-md text-sm text-muted">
                Give GitHub, Stripe or Slack a URL to call. Each delivery is checked against the platform&apos;s signature
                before anything runs.
              </span>
              {mayWrite && (
                <Button onPress={() => setEditing('new')}>
                  <Plus />
                  New webhook
                </Button>
              )}
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            {shown.map((hook) => {
              const preset = VERIFIERS[hook.verifier];
              const listening = handlers.filter((h) => h.topic === hook.name);
              const url = `${origin}${hook.path}`;
              return (
                <Card key={hook.id} className="min-w-0 gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${preset.tone}`}>
                      {preset.mark}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setEditing(hook)} className="truncate text-left font-mono font-medium hover:text-accent">
                          {hook.name}
                        </button>
                        {!hook.enabled && (
                          <Chip size="sm" variant="soft">
                            Disabled
                          </Chip>
                        )}
                        {hook.verifier === 'NONE' && (
                          <Chip size="sm" variant="soft" color="danger">
                            Unverified
                          </Chip>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted">{hook.description || preset.label}</p>
                    </div>
                    {mayWrite && (
                      <Dropdown>
                        <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${hook.name}`}>
                            <Ellipsis />
                        </Dropdown.Trigger>
                        <Dropdown.Popover placement="bottom end" className="min-w-44">
                          <Dropdown.Menu
                            aria-label="Webhook actions"
                            onAction={(key) => (key === 'edit' ? setEditing(hook) : setDeleting(hook.name))}
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
                  </div>

                  <div className="flex items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
                      {url || hook.path}
                    </span>
                    <CopyButton value={url || hook.path} label="Copy webhook URL" />
                  </div>

                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <Figure label="Accepted" value={hook.receivedCount} />
                    <Figure label="Rejected" value={hook.rejectedCount} tone={hook.rejectedCount ? 'danger' : undefined} />
                    <div className="rounded-xl bg-surface-secondary px-2 py-2">
                      <dt className="text-xs text-muted">Last delivery</dt>
                      <dd className="truncate text-sm font-medium" suppressHydrationWarning>
                        {hook.lastReceivedAt ? formatRelative(hook.lastReceivedAt) : 'Never'}
                      </dd>
                    </div>
                  </dl>

                  {hook.lastError && (
                    <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
                      <CircleExclamation className="mt-0.5 size-4 shrink-0" />
                      {hook.lastError}
                    </p>
                  )}

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">Handlers</p>
                      {mayWrite && (
                        <Link
                          href={`/eventHandlerDef?new=1&source=webhook&topic=${encodeURIComponent(hook.name)}`}
                          className="text-xs text-accent hover:underline"
                        >
                          Add handler
                        </Link>
                      )}
                    </div>
                    {listening.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-separator px-3 py-2 text-sm text-muted">
                        Nothing listens yet — verified deliveries are accepted and then do nothing.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {listening.map((h) => (
                          <li key={h.name}>
                            <Tooltip delay={300}>
                              <Tooltip.Trigger>
                                <Link href={`/eventMonitor?handler=${encodeURIComponent(h.name)}`}>
                                  <Chip size="sm" variant="soft" color={h.enabled ? 'accent' : 'default'}>
                                    <Thunderbolt className="size-3.5" />
                                    {h.name}
                                    <ArrowUpRightFromSquare className="size-3" />
                                  </Chip>
                                </Link>
                              </Tooltip.Trigger>
                              <Tooltip.Content>
                                {h.workflow ? `Starts ${h.workflow.name}` : 'Completes a waiting task'} — see its deliveries
                              </Tooltip.Content>
                            </Tooltip>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <WebhookDrawer
        namespace={namespace}
        webhook={editing === 'new' ? undefined : editing}
        isOpen={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        secretNames={secretNames}
        mayManageSecrets={mayManageSecrets}
        origin={origin}
      />

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              Its URL stops working immediately, and senders will see 404s. Handlers listening to it are kept.
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && void remove(deleting)}>
                Delete webhook
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded-xl bg-surface-secondary px-2 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular text-sm font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}
