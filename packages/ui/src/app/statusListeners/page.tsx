import { redirect } from 'next/navigation';
import { can } from '../../lib/access';
import { api, currentUser } from '../../lib/api';
import { ListenerList, type StatusListener } from './listener-list';

/** Status listeners: where execution lifecycle changes are streamed to. */
export default async function StatusListenersPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/statusListeners');

  const ns = `/v1/ns/${user.namespace}`;
  const [{ listeners }, workflows, secretNames, connections] = await Promise.all([
    api<{ listeners: StatusListener[] }>(`${ns}/status-listeners`),
    api<{ name: string }[]>(`${ns}/metadata/workflows`).catch(() => [] as { name: string }[]),
    can(user, 'admin')
      ? api<{ secrets: { name: string }[] }>(`${ns}/secrets`)
          .then((r) => r.secrets.map((s) => s.name))
          .catch(() => [] as string[])
      : Promise.resolve([] as string[]),
    api<{ sources: { id: string; kind: string }[] }>(`${ns}/event-handlers/sources`)
      .then((r) => r.sources.filter((s) => s.kind !== 'webhook').map((s) => s.id))
      .catch(() => [] as string[]),
  ]);

  return (
    <ListenerList
      namespace={user.namespace}
      listeners={listeners}
      workflowNames={[...new Set(workflows.map((w) => w.name))].sort()}
      secretNames={secretNames}
      connections={connections}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
