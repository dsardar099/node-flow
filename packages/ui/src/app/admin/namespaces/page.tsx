import { redirect } from 'next/navigation';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';
import { NamespacesAdmin, type NamespaceRow } from './namespaces-admin';

/**
 * Tenants.
 *
 * Gated on `platform:admin`, not `admin`, and the distinction is the point: a
 * namespace administrator runs their own tenant completely and still cannot
 * create another one. Without that split this screen would be a
 * privilege-escalation ladder — make a namespace, take an admin key in it, and
 * the boundary between tenants means nothing.
 *
 * Creating further namespaces used to require the CLI or SQL, which made
 * multi-tenancy a feature you had to already know about. The seeded first
 * administrator holds `platform:admin` precisely so this screen is reachable on
 * a fresh install.
 */
export default async function NamespacesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/admin/namespaces');
  if (!can(user, 'platform:admin')) redirect('/executions');

  const { namespaces } = await api<{ namespaces: NamespaceRow[] }>('/v1/namespaces');

  return <NamespacesAdmin namespaces={namespaces} currentNamespace={user.namespace} />;
}
