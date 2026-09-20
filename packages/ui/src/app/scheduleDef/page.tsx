import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { ScheduleList, type Schedule } from './schedule-list';

/**
 * Cron schedules.
 *
 * Ordered by next fire time, because the question this page is opened with is
 * almost always "what is about to run" or "why did that not run".
 */
export default async function SchedulesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/scheduleDef');

  const [{ schedules }, workflowNames] = await Promise.all([
    api<{ schedules: Schedule[] }>(`/v1/ns/${user.namespace}/schedules`),
    api<{ name: string }[]>(`/v1/ns/${user.namespace}/metadata/workflows`)
      .then((rows) => [...new Set(rows.map((row) => row.name))].sort())
      .catch(() => [] as string[]),
  ]);

  // Paused schedules sort last explicitly. The server keeps reporting a
  // `nextRunAt` on a paused schedule — when it would fire if resumed — so
  // ordering on that alone would file a paused schedule among the ones about
  // to run, which is the one thing this page must not do.
  const ordered = [...schedules].sort((a, b) => {
    if (a.paused !== b.paused) return a.paused ? 1 : -1;
    if (!a.nextRunAt) return b.nextRunAt ? 1 : 0;
    if (!b.nextRunAt) return -1;
    return a.nextRunAt.localeCompare(b.nextRunAt);
  });

  return (
    <ScheduleList
      namespace={user.namespace}
      schedules={ordered}
      workflowNames={workflowNames}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
