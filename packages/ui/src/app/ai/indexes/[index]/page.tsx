import { redirect } from 'next/navigation';
import { can } from '../../../../lib/access';
import { api, currentUser } from '../../../../lib/api';
import type { Integration } from '../../integrations/integrations-admin';
import type { VectorIndex } from '../index-list';
import { IndexDetail, type Chunk } from '../index-detail';

export default async function IndexPage({ params }: { params: Promise<{ index: string }> }) {
  const { index: raw } = await params;
  const index = decodeURIComponent(raw);
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/ai/indexes/${raw}`);
  if (!can(user, 'workflows:read')) redirect('/executions');
  const ns = `/v1/ns/${user.namespace}`;
  const [{ chunks }, { indexes }, { integrations }] = await Promise.all([
    api<{ chunks: Chunk[] }>(`${ns}/vector-indexes/${encodeURIComponent(index)}/documents`),
    api<{ indexes: VectorIndex[] }>(`${ns}/vector-indexes`),
    api<{ integrations: Integration[] }>(`${ns}/integrations?kind=LLM`).catch(() => ({ integrations: [] as Integration[] })),
  ]);
  return (
    <IndexDetail
      namespace={user.namespace}
      index={index}
      summary={indexes.find((i) => i.indexName === index)}
      chunks={chunks}
      integrations={integrations.filter((i) => i.enabled)}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
