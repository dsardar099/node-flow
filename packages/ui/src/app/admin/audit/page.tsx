import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { AuditLog } from './audit-log';

export default async function AuditPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/audit');
  if (!can(user, 'admin')) redirect('/executions');
  return <AuditLog namespace={user.namespace} />;
}
