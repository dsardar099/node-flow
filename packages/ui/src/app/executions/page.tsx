import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can, canUse } from '../../lib/access';
import { ExecutionSearch } from './execution-search';

/**
 * Workflow executions — Conductor's search screen.
 *
 * The filters live in the URL, so a search is a link: an operator can paste
 * "every failed `checkout` run with this correlation id" into an incident
 * channel and everyone opens the same list.
 */
export default async function ExecutionsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/executions');

  // Names only, for the workflow name picker. A failure here costs the
  // suggestions, not the page: the field still takes a typed name.
  const workflowNames = await api<{ name: string }[]>(
    `/v1/ns/${user.namespace}/metadata/workflows`
  )
    .then((rows) => [...new Set(rows.map((row) => row.name))].sort())
    .catch(() => []);

  return (
    <ExecutionSearch
      namespace={user.namespace}
      workflowNames={workflowNames}
      mayStart={canUse(user, 'executions:start', { type: 'WORKFLOW', access: 'EXECUTE' })}
      mayDefine={can(user, 'workflows:write')}
      mayOperate={can(user, 'executions:write')}
    />
  );
}
