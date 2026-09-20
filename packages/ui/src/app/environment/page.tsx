import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { EnvironmentList, type EnvironmentVariable } from './environment-list';

export default async function EnvironmentPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/environment');

  const { variables } = await api<{ variables: EnvironmentVariable[] }>(`/v1/ns/${user.namespace}/environment`);
  return <EnvironmentList namespace={user.namespace} variables={variables} mayWrite={can(user, 'workflows:write')} />;
}
