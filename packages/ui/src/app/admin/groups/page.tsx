import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import type { AdminUser } from '../users/users-admin';
import { GroupsAdmin, type AdminGroup } from './groups-admin';

export default async function GroupsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/groups');
  if (!can(user, 'admin')) redirect('/executions');
  const [{ groups }, users] = await Promise.all([
    api<{ groups: AdminGroup[] }>(`/v1/ns/${user.namespace}/groups`),
    api<AdminUser[]>(`/v1/ns/${user.namespace}/users`),
  ]);
  return <GroupsAdmin namespace={user.namespace} groups={groups} users={users.filter((u) => !u.disabledAt)} />;
}
