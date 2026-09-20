import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { WorkerFleet, type WorkerSighting } from './worker-fleet';

/**
 * The worker fleet.
 *
 * The same sightings the Queues screen shows, grouped the other way round.
 * That screen answers "is this queue being served?", which requires already
 * suspecting a queue; this one answers "what is out there, and is it alive?",
 * which is the question someone actually arrives with — and it was previously
 * only answerable by opening each queue's drawer in turn.
 *
 * The server records a sighting whenever a worker polls, so a worker is known
 * by having asked for work rather than by registering. That is the honest model
 * for a fleet that scales on its own: there is nothing to deregister, and a
 * worker that stops polling simply ages out of the last-24-hours window.
 */
export default async function WorkersPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/workers');

  const { workers } = await api<{ workers: WorkerSighting[] }>(
    `/v1/ns/${user.namespace}/queues/workers`
  ).catch(() => ({ workers: [] as WorkerSighting[] }));

  return <WorkerFleet namespace={user.namespace} initialWorkers={workers} />;
}
