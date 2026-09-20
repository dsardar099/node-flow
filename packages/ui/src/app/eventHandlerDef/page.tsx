import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { HandlerList, type EventHandler, type EventSourceInfo } from './handler-list';

export default async function EventHandlersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; source?: string; topic?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/eventHandlerDef');

  const [{ handlers }, { sources }, workflowNames] = await Promise.all([
    api<{ handlers: EventHandler[] }>(`/v1/ns/${user.namespace}/event-handlers`),
    api<{ sources: EventSourceInfo[] }>(`/v1/ns/${user.namespace}/event-handlers/sources`).catch(() => ({ sources: [] })),
    api<{ name: string }[]>(`/v1/ns/${user.namespace}/metadata/workflows`)
      .then((rows) => [...new Set(rows.map((row) => row.name))].sort())
      .catch(() => [] as string[]),
  ]);

  return (
    <HandlerList
      namespace={user.namespace}
      handlers={handlers}
      sources={sources}
      workflowNames={workflowNames}
      mayWrite={can(user, 'workflows:write')}
      prefill={params.new && params.source && params.topic ? { source: params.source, topic: params.topic } : undefined}
    />
  );
}
