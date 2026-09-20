import { notFound, redirect } from 'next/navigation';
import type { TaskDefinition } from '@node-flow-dev/core';
import { TaskDefEditor } from '../../../components/taskdef/task-def-editor';
import { api, currentUser } from '../../../lib/api';
import { can } from '../../../lib/access';

export default async function TaskDefinitionPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=/taskDef/${name}`);

  const definition = await api<TaskDefinition>(
    `/v1/ns/${user.namespace}/metadata/task-definitions/${encodeURIComponent(decoded)}`
  ).catch(() => undefined);
  if (!definition) notFound();

  return (
    <TaskDefEditor
      namespace={user.namespace}
      initial={definition}
      isNew={false}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
