import { redirect } from 'next/navigation';
import { can } from '../../lib/access';
import { api, currentUser } from '../../lib/api';
import type { EventHandler } from '../eventHandlerDef/handler-list';
import { EventMonitor, type EventExecution, type HandlerActivity } from './event-monitor';

export default async function EventMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ handler?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/eventMonitor');
  const { handler } = await searchParams;

  const ns = `/v1/ns/${user.namespace}/event-handlers`;
  const [{ handlers }, activity, page] = await Promise.all([
    api<{ handlers: EventHandler[] }>(ns),
    api<{ handlers: HandlerActivity[] }>(`${ns}/activity?hours=24`),
    api<{ executions: EventExecution[]; nextCursor?: string }>(
      `${ns}/executions?limit=50${handler ? `&handler=${encodeURIComponent(handler)}` : ''}`
    ),
  ]);

  return (
    <EventMonitor
      namespace={user.namespace}
      handlers={handlers}
      initialActivity={activity.handlers}
      initialPage={page}
      initialHandler={handler}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
