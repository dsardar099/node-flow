import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { QueueDashboard, type QueueRow, type WorkerSighting } from './queue-dashboard';

/** Queues and the workers polling them. */
export default async function QueuesPage({ searchParams }: { searchParams: Promise<{ queue?: string }> }) {
  const { queue } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/taskQueue');

  const [{ queues }, { workers }, taskDefs] = await Promise.all([
    api<{ queues: QueueRow[] }>(`/v1/ns/${user.namespace}/queues`),
    api<{ workers: WorkerSighting[] }>(`/v1/ns/${user.namespace}/queues/workers`).catch(() => ({ workers: [] })),
    api<{ name: string }[]>(`/v1/ns/${user.namespace}/metadata/task-definitions`).catch(() => []),
  ]);

  return (
    <QueueDashboard
      namespace={user.namespace}
      initialQueues={queues}
      initialWorkers={workers}
      definedTasks={taskDefs.map((def) => def.name)}
      initialQueue={queue}
    />
  );
}
