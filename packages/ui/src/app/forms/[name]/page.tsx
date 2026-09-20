import { notFound, redirect } from 'next/navigation';
import { FormBuilder } from '../../../components/forms/form-builder';
import type { ObjectSchema } from '../../../components/forms/schema-form';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';

export default async function FormPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/forms/${name}`);
  const result = await api<{ versions: { version: number; schema: ObjectSchema; description: string | null }[] }>(
    `/v1/ns/${user.namespace}/forms/${encodeURIComponent(decoded)}`
  ).catch(() => undefined);
  const latest = result?.versions[0];
  if (!latest) notFound();
  return (
    <FormBuilder
      key={latest.version}
      namespace={user.namespace}
      name={decoded}
      version={latest.version}
      initialSchema={latest.schema}
      initialDescription={latest.description ?? ''}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
