import { notFound, redirect } from 'next/navigation';
import { can } from '../../../../lib/access';
import { api, currentUser } from '../../../../lib/api';
import type { Integration } from '../../integrations/integrations-admin';
import type { PromptVersion } from '../prompt-studio';
import { PromptStudio } from '../prompt-studio';

/** One prompt: edit, try against a model, and save a new version. `new` starts a blank one. */
export default async function PromptPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/ai/prompts/${raw}`);
  if (!can(user, 'workflows:read')) redirect('/executions');

  const ns = `/v1/ns/${user.namespace}`;
  const [versions, { integrations }] = await Promise.all([
    name === 'new'
      ? Promise.resolve([] as PromptVersion[])
      : api<{ versions: PromptVersion[] }>(`${ns}/prompts/${encodeURIComponent(name)}`)
          .then((r) => r.versions)
          .catch(() => null),
    api<{ integrations: Integration[] }>(`${ns}/integrations?kind=LLM`).catch(() => ({ integrations: [] as Integration[] })),
  ]);
  if (versions === null) notFound();

  return (
    <PromptStudio
      namespace={user.namespace}
      name={name === 'new' ? undefined : name}
      versions={versions}
      integrations={integrations.filter((i) => i.enabled)}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
