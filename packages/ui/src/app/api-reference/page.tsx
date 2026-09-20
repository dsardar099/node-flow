import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { ApiReference } from './api-reference';

/**
 * The API, readable.
 *
 * The sidebar has always offered an "API reference"; it pointed at `/v1/docs`,
 * which was never built and answered 404. The server deliberately serves no
 * Swagger UI — that would pull `@fastify/static` back into a JSON API — and the
 * document at `/v1/openapi.json` is the contract, so the viewer belongs here.
 *
 * This is the reference for *this* server: the document is fetched from the
 * running instance, so it reflects the build you are talking to. The public one
 * on the docs site is generated from `clients/openapi.json` at release time and
 * describes the published version instead. Both exist on purpose.
 *
 * Read on the server because the document is a few hundred kilobytes, static
 * between deploys, and behind the session — fetching it from the browser would
 * mean a second authenticated round trip for every visitor.
 */
export default async function ApiReferencePage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/api-reference');

  const document = await api<object>('/v1/openapi.json');

  return <ApiReference document={document} />;
}
