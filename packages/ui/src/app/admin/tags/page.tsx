import { redirect } from 'next/navigation';
import { can } from '../../../lib/access';
import { api, currentUser } from '../../../lib/api';
import { TagsDashboard, type TagOverview } from './tags-dashboard';

export default async function TagsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/tags');
  if (!can(user, 'admin')) redirect('/executions');

  const overview = await api<TagOverview>(`/v1/ns/${user.namespace}/tags`);
  return <TagsDashboard namespace={user.namespace} overview={overview} />;
}
