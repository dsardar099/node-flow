import { notFound, redirect } from 'next/navigation';
import { ApiError, api, currentUser } from '../../../lib/api';
import { can, canUse } from '../../../lib/access';
import type { Definition } from '../../../lib/dag/edit';
import { ExecutionView } from './execution-view';
import type { ExecutionDetail } from './types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Execution ${(await params).id.slice(0, 8)}` };
}

/**
 * One workflow execution.
 *
 * Loaded on the server and kept current by the live stream, which asks the
 * page to re-render rather than patching a client copy.
 */
export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/execution/${id}`);

  let execution: ExecutionDetail;
  try {
    execution = await api<ExecutionDetail>(`/v1/ns/${user.namespace}/executions/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // The version this run is pinned to, never the latest: drawing a run over a
  // newer definition shows tasks it never had and hides ones it did.
  const definition = await api<Definition>(
    `/v1/ns/${user.namespace}/metadata/workflows/${encodeURIComponent(execution.defName)}?version=${execution.defVersion}`
  ).catch(() => undefined);

  // The failure workflow this run started, found by the key the engine starts it
  // with — so a failed run links forward to its handler, as the handler links back.
  const failureRun =
    execution.status === 'FAILED' || execution.status === 'TIMED_OUT'
      ? await api<{ executions: { workflowId: string; defName: string; status: string }[] }>(
          `/v1/ns/${user.namespace}/executions/search`,
          { method: 'POST', body: JSON.stringify({ idempotencyKey: `failure-workflow:${execution.id}`, limit: 1 }) }
        )
          .then((result) => result.executions[0])
          .catch(() => undefined)
      : undefined;

  return (
    <ExecutionView
      namespace={user.namespace}
      execution={execution}
      definition={definition}
      failureRun={failureRun}
      mayOperate={can(user, 'executions:write')}
      mayStart={canUse(user, 'executions:start', { type: 'WORKFLOW', access: 'EXECUTE' })}
    />
  );
}
