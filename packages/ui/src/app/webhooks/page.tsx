import { redirect } from 'next/navigation';
import { can } from '../../lib/access';
import { api, currentUser } from '../../lib/api';
import type { EventHandler } from '../eventHandlerDef/handler-list';
import { WebhookList, type IncomingWebhook } from './webhook-list';

export default async function WebhooksPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/webhooks');

  const ns = `/v1/ns/${user.namespace}`;
  const [{ webhooks }, { handlers }, secretNames] = await Promise.all([
    api<{ webhooks: IncomingWebhook[] }>(`${ns}/incoming-webhooks`),
    api<{ handlers: EventHandler[] }>(`${ns}/event-handlers`).catch(() => ({ handlers: [] as EventHandler[] })),
    // Names only, and only for admins — who are the ones able to create secrets anyway.
    can(user, 'admin')
      ? api<{ secrets: { name: string; sealed: boolean }[] }>(`${ns}/secrets`)
          .then((r) => r.secrets.map((s) => s.name))
          .catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  return (
    <WebhookList
      namespace={user.namespace}
      webhooks={webhooks}
      handlers={handlers.filter((h) => h.source === 'webhook')}
      secretNames={secretNames}
      mayWrite={can(user, 'workflows:write')}
      mayManageSecrets={can(user, 'admin')}
    />
  );
}
