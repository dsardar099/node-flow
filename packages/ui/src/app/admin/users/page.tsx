import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { UsersAdmin, type AdminUser } from './users-admin';

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/users');
  if (!can(user, 'admin')) redirect('/executions');
  const users = await api<AdminUser[]>(`/v1/ns/${user.namespace}/users`);
  return <UsersAdmin namespace={user.namespace} users={users} currentUserId={user.id} />;
}
