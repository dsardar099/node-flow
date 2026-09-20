import { redirect } from 'next/navigation';
import { can } from '../../../lib/access';
import { api, currentUser } from '../../../lib/api';
import { IntegrationsAdmin, type Integration } from './integrations-admin';

/** Where AI tasks send requests: LLM providers and MCP servers, by name. */
export default async function IntegrationsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/ai/integrations');
  if (!can(user, 'workflows:read')) redirect('/executions');

  const ns = `/v1/ns/${user.namespace}`;
  const isAdmin = can(user, 'admin');
  const [{ integrations }, secretNames] = await Promise.all([
    api<{ integrations: Integration[] }>(`${ns}/integrations`),
    isAdmin
      ? api<{ secrets: { name: string }[] }>(`${ns}/secrets`)
          .then((r) => r.secrets.map((s) => s.name))
          .catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  return (
    <IntegrationsAdmin
      namespace={user.namespace}
      integrations={integrations}
      secretNames={secretNames}
      mayAdminister={isAdmin}
      mayTest={can(user, 'workflows:write')}
    />
  );
}
