import { redirect } from 'next/navigation';
import { can } from '../../../lib/access';
import { api, currentUser } from '../../../lib/api';
import { PromptList, type PromptSummary } from './prompt-list';

/** Versioned prompt templates that LLM and agent tasks use by name. */
export default async function PromptsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/ai/prompts');
  if (!can(user, 'workflows:read')) redirect('/executions');
  const { prompts } = await api<{ prompts: PromptSummary[] }>(`/v1/ns/${user.namespace}/prompts`);
  return <PromptList prompts={prompts} mayWrite={can(user, 'workflows:write')} />;
}
