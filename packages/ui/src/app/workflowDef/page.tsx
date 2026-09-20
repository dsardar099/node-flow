import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can, canUse } from '../../lib/access';
import { WorkflowDefinitionList, type WorkflowListing } from './definition-list';

/** Workflow definitions: the newest version of each name. */
export default async function WorkflowDefinitionsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/workflowDef');

  const rows = await api<WorkflowListing[]>(`/v1/ns/${user.namespace}/metadata/workflows`);

  // The API returns every version, newest first within each name. One row per
  // name answers "what will run?"; history is on the definition's own page.
  const latest = new Map<string, WorkflowListing>();
  const versions = new Map<string, number>();
  for (const row of rows) {
    versions.set(row.name, (versions.get(row.name) ?? 0) + 1);
    const seen = latest.get(row.name);
    if (!seen || row.version > seen.version) latest.set(row.name, row);
  }

  return (
    <WorkflowDefinitionList
      namespace={user.namespace}
      definitions={[...latest.values()]
        .map((row) => ({ ...row, versionCount: versions.get(row.name) ?? 1 }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      mayWrite={can(user, 'workflows:write')}
      mayStart={canUse(user, 'executions:start', { type: 'WORKFLOW', access: 'EXECUTE' })}
      mayAdminister={can(user, 'admin')}
    />
  );
}
