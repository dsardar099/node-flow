import { redirect } from 'next/navigation';
import { FormBuilder } from '../../components/forms/form-builder';
import { currentUser } from '../../lib/api';
import { can } from '../../lib/access';

export default async function NewFormPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/newForm');
  if (!can(user, 'workflows:write')) redirect('/forms');
  return <FormBuilder namespace={user.namespace} mayWrite />;
}
