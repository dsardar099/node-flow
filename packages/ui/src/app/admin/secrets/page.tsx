import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { SecretsAdmin, type SecretSummary } from './secrets-admin';

export default async function SecretsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/secrets');
  if (!can(user, 'admin')) redirect('/executions');
  const { secrets } = await api<{ secrets: SecretSummary[] }>(`/v1/ns/${user.namespace}/secrets`);
  return <SecretsAdmin namespace={user.namespace} secrets={secrets} />;
}
