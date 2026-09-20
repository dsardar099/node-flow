import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { PermissionsAdmin } from './permissions-admin';

export default async function PermissionsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/permissions');
  if (!can(user, 'admin')) redirect('/executions');
  const [workflows, taskDefinitions] = await Promise.all([
    api<{ name: string }[]>(`/v1/ns/${user.namespace}/metadata/workflows`).catch(() => []),
    api<{ name: string }[]>(`/v1/ns/${user.namespace}/metadata/task-definitions`).catch(() => []),
  ]);
  return (
    <PermissionsAdmin
      namespace={user.namespace}
      resourceNames={{
        WORKFLOW: [...new Set(workflows.map((w) => w.name))].sort(),
        TASK_DEFINITION: taskDefinitions.map((t) => t.name).sort(),
      }}
    />
  );
}
