import type { TaskDefinition } from '@node-flow-dev/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '../../lib/api';
import { can } from '../../lib/access';
import { TaskDefinitionList } from './task-def-list';

export default async function TaskDefinitionsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/taskDef');

  const definitions = await api<TaskDefinition[]>(`/v1/ns/${user.namespace}/metadata/task-definitions`);

  return (
    <TaskDefinitionList
      namespace={user.namespace}
      definitions={definitions}
      mayWrite={can(user, 'workflows:write')}
    />
  );
}
