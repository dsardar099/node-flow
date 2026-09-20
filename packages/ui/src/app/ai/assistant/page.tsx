import { redirect } from 'next/navigation';
import { can } from '../../../lib/access';
import { api, currentUser } from '../../../lib/api';
import { AssistantChat } from './assistant-chat';

/**
 * The assistant.
 *
 * The provider list is fetched here rather than in the client so the page
 * arrives knowing whether it has a model to talk to — an empty chat box that
 * only fails on send is a worse way to learn that no integration is configured.
 */
export default async function AssistantPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/ai/assistant');
  if (!can(user, 'workflows:read')) redirect('/executions');

  const { integrations } = await api<{ integrations: { name: string; kind: string; enabled: boolean }[] }>(
    `/v1/ns/${user.namespace}/integrations?kind=LLM`
  ).catch(() => ({ integrations: [] }));

  return (
    <AssistantChat
      namespace={user.namespace}
      providers={integrations.filter((integration) => integration.enabled).map((integration) => integration.name)}
    />
  );
}
