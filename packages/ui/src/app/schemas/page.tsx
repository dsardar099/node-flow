import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { SchemaList, type SchemaSummary } from './schema-list';

export default async function SchemasPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/schemas');
  const { schemas } = await api<{ schemas: SchemaSummary[] }>(`/v1/ns/${user.namespace}/schemas`);
  return <SchemaList namespace={user.namespace} schemas={schemas} mayWrite={can(user, 'workflows:write')} />;
}
