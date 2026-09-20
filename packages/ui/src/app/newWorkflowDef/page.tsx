import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import type { Definition } from '../../lib/dag/edit';
import { WorkflowEditor } from '../../components/dag/workflow-editor';
import { DraftEditor } from './draft-editor';

/**
 * A new workflow, blank or cloned (`?from=name`).
 *
 * Not `/workflowDef/new`: `new` is a valid workflow name, and a static route
 * there would make a workflow called `new` unreachable.
 */
export default async function NewWorkflowDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/newWorkflowDef');
  if (!can(user, 'workflows:write')) redirect('/workflowDef');

  let initial: Definition = {
    name: '',
    description: '',
    tasks: [{ name: 'first_task', taskReferenceName: 'first_task', type: 'SIMPLE' }],
  };

  // A BPMN import and a template both leave their draft in the browser rather
  // than the URL, so the page hands over to a client component that picks it up.
  if (from === 'bpmn' || from === 'template') {
    return <DraftEditor namespace={user.namespace} fallback={initial} />;
  }

  if (from) {
    const source = await api<Definition & { version?: number }>(
      `/v1/ns/${user.namespace}/metadata/workflows/${encodeURIComponent(from)}`
    ).catch(() => undefined);
    if (source) {
      const { version: _version, ...rest } = source;
      // A clone is a new workflow, so it needs a new name; suffixing makes the
      // clash obvious rather than silently saving v2 of the original.
      initial = { ...rest, name: `${source.name}_copy` } as Definition;
    }
  }

  return <WorkflowEditor namespace={user.namespace} mode="new" initial={initial} mayStart={false} />;
}
