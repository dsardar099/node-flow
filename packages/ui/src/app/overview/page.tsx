import { redirect } from 'next/navigation';
import { can } from '../../lib/access';
import { api, currentUser } from '../../lib/api';
import type { HumanTask } from '../human/tasks/inbox';
import type { QueueRow, WorkerSighting } from '../taskQueue/queue-dashboard';
import { Overview, type Attention, type ExecutionOverview } from './overview';

export default async function OverviewPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/overview');
  if (!can(user, 'executions:read')) redirect('/workflowDef');

  const ns = `/v1/ns/${user.namespace}`;
  // Everything but the overview itself is optional: a person without access to
  // queues or human tasks still gets the page, just without those signals.
  const [overview, queues, workers, humanTasks, events, workflows] = await Promise.all([
    api<ExecutionOverview>(`${ns}/executions/overview?hours=24`),
    api<{ queues: QueueRow[] }>(`${ns}/queues`).then((r) => r.queues).catch(() => undefined),
    api<{ workers: WorkerSighting[] }>(`${ns}/queues/workers`).then((r) => r.workers).catch(() => []),
    can(user, 'human-tasks:read')
      ? api<{ tasks: HumanTask[] }>(`${ns}/human-tasks?limit=200`).then((r) => r.tasks).catch(() => undefined)
      : undefined,
    can(user, 'workflows:read')
      ? api<{ handlers: { failed: number }[] }>(`${ns}/event-handlers/activity?hours=24`).then((r) => r.handlers).catch(() => undefined)
      : undefined,
    api<{ name: string }[]>(`${ns}/metadata/workflows`)
      .then((rows) => [...new Set(rows.map((r) => r.name))].sort())
      .catch(() => [] as string[]),
  ]);

  const recentPoll = (queue: string) =>
    workers.some((w) => w.queueName === queue && Date.now() - new Date(w.lastPollAt).getTime() < 60_000);

  const attention: Attention = {
    stalledQueues: queues ? queues.filter((q) => q.available > 0 && q.workers === 0 && !recentPoll(q.queueName)).map((q) => q.queueName) : undefined,
    openHumanTasks: humanTasks ? humanTasks.filter((t) => !t.completedAt && !t.skippedReason).length : undefined,
    overdueHumanTasks: humanTasks
      ? humanTasks.filter((t) => !t.completedAt && t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length
      : undefined,
    failedEvents: events ? events.reduce((sum, h) => sum + h.failed, 0) : undefined,
  };

  return (
    <Overview
      namespace={user.namespace}
      userName={user.name}
      initialOverview={overview}
      attention={attention}
      workflowNames={workflows}
      mayStart={can(user, 'executions:start')}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
