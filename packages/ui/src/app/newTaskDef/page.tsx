import { redirect } from 'next/navigation';
import { TaskDefEditor } from '../../components/taskdef/task-def-editor';
import { currentUser } from '../../lib/api';
import { can } from '../../lib/access';

/** Not `/taskDef/new`, for the same reason as `/newWorkflowDef`: `new` is a valid task name. */
export default async function NewTaskDefinitionPage() {
  const user = await currentUser();
  if (!user) redirect('/login?returnTo=/newTaskDef');
  if (!can(user, 'workflows:write')) redirect('/taskDef');

  return (
    <TaskDefEditor
      namespace={user.namespace}
      initial={{
        name: '',
        retryCount: 3,
        retryLogic: 'EXPONENTIAL_BACKOFF',
        retryDelaySeconds: 1,
        backoffScaleFactor: 2,
        timeoutSeconds: 3600,
        responseTimeoutSeconds: 600,
        timeoutPolicy: 'TIME_OUT_WF',
      }}
      isNew
      mayWrite
    />
  );
}
