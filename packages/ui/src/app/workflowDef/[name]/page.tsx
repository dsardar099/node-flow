import { notFound, redirect } from 'next/navigation';
import { ApiError, api, currentUser } from '../../../lib/api';
import { can, canUse } from '../../../lib/access';
import type { Definition } from '../../../lib/dag/edit';
import { WorkflowEditor } from '../../../components/dag/workflow-editor';

/**
 * One workflow definition: viewed and edited in the same place. Saving always
 * creates the next version, so there is no separate read-only page to keep in
 * step with the editor.
 */
export default async function WorkflowDefinitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const name = decodeURIComponent((await params).name);
  const { version } = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/workflowDef/${encodeURIComponent(name)}`);

  const base = `/v1/ns/${user.namespace}/metadata/workflows`;
  let definition: Definition & { version: number };
  try {
    definition = await api(
      `${base}/${encodeURIComponent(name)}${version ? `?version=${Number(version)}` : ''}`
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const versions = (await api<{ name: string; version: number }[]>(base))
    .filter((row) => row.name === name)
    .map((row) => row.version);

  return (
    <WorkflowEditor
      // A different version is a different starting point; remount rather than
      // carry one version's undo history into another.
      key={`${name}:${definition.version}`}
      namespace={user.namespace}
      mode="edit"
      initial={definition}
      versions={versions}
      shownVersion={definition.version}
      mayStart={canUse(user, 'executions:start', { type: 'WORKFLOW', access: 'EXECUTE' })}
      readOnly={!can(user, 'workflows:write')}
    />
  );
}
