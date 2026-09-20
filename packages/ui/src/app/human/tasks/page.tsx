import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { Inbox, type HumanTask } from './inbox';

/**
 * The human-task inbox.
 *
 * The screen that makes `HUMAN` usable at all: without it, approving a refund
 * means composing an authenticated POST by hand.
 */
export default async function InboxPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/human/tasks');

  const { tasks } = await api<{ tasks: HumanTask[] }>(
    `/v1/ns/${user.namespace}/human-tasks?includeCompleted=true&limit=200`
  );

  return (
    <Inbox
      namespace={user.namespace}
      userId={user.id}
      tasks={tasks}
      mayOperate={can(user, 'executions:write')}
      mayOversee={can(user, 'executions:read')}
    />
  );
}
