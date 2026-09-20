import { redirect } from 'next/navigation';
import { can } from '../../../lib/access';
import { api, currentUser } from '../../../lib/api';
import type { Integration } from '../integrations/integrations-admin';
import { IndexList, type VectorIndex } from './index-list';

/** Vector indexes: embedded documents that search and agent tasks retrieve from. */
export default async function IndexesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/ai/indexes');
  if (!can(user, 'workflows:read')) redirect('/executions');
  const ns = `/v1/ns/${user.namespace}`;
  const [{ indexes, pgvector }, { integrations }] = await Promise.all([
    api<{ indexes: VectorIndex[]; pgvector: boolean }>(`${ns}/vector-indexes`),
    api<{ integrations: Integration[] }>(`${ns}/integrations?kind=LLM`).catch(() => ({ integrations: [] as Integration[] })),
  ]);
  return <IndexList namespace={user.namespace} indexes={indexes} pgvector={pgvector} integrations={integrations.filter((i) => i.enabled)} mayWrite={can(user, 'workflows:write')} />;
}
