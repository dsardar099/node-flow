import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { FormList, type FormSummary } from './form-list';

export default async function FormsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/forms');
  const { forms } = await api<{ forms: FormSummary[] }>(`/v1/ns/${user.namespace}/forms`);
  return <FormList forms={forms} mayWrite={can(user, 'workflows:write')} />;
}
