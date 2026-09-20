import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { ApplicationsAdmin, type ApiKey, type ServiceAccount } from './applications-admin';

export default async function ApplicationsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/applications');
  if (!can(user, 'admin')) redirect('/executions');
  const [apiKeys, serviceAccounts] = await Promise.all([
    api<ApiKey[]>('/v1/auth/api-keys'),
    api<ServiceAccount[]>('/v1/auth/service-accounts'),
  ]);
  return <ApplicationsAdmin apiKeys={apiKeys} serviceAccounts={serviceAccounts} />;
}
