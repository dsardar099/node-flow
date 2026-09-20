'use client';

import { Plus, TrashBin } from '@gravity-ui/icons';
import type { WorkflowTask } from '@node-flow-dev/core';
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
} from '@heroui/react';
import { useState } from 'react';
import { CATALOG, uniqueRef } from '../../lib/dag/catalog';
import {
  addForkBranch,
  addSwitchCase,
  allRefs,
  removeForkBranch,
  removeSwitchCase,
  updateTask,
  type Definition,
} from '../../lib/dag/edit';
import type { Path } from '../../lib/dag/path';
import { CommitNumberField, CommitTextField, KeyValueRows } from './fields';

/**
 * The Task tab: the selected task's properties, laid out as Conductor does —
 * type and docs on top, definition and reference name, type-specific settings,
 * input parameters as rows, then execution options.
 *
 * Renaming a reference does not rewrite the `${ref.output…}` expressions that
 * point at it: doing that by text replacement corrupts any expression that
 * contains the old name as a substring. Validation reports the dangling
 * references on the tasks that hold them instead.
 */
export function TaskForm({
  definition,
  path,
  task,
  onChange,
  onRenamed,
  onDelete,
}: {
  definition: Definition;
  path: Path;
  task: WorkflowTask;
  onChange: (next: Definition) => void;
  onRenamed: (ref: string) => void;
  onDelete: () => void;
}) {
  const patch = (fields: Partial<WorkflowTask>) => onChange(updateTask(definition, path, fields));
  const entry = CATALOG[task.type];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Chip variant="soft" color="accent">
            {task.type}
          </Chip>
          <span className="text-sm text-muted">{entry?.summary}</span>
        </div>
        <Button size="sm" variant="danger" onPress={onDelete}>
          <TrashBin />
          {task.type === 'FORK_JOIN' ? 'Delete block' : 'Delete'}
        </Button>
      </div>

      <Card>
        <Card.Content className="grid gap-4 sm:grid-cols-2">
          <CommitTextField
            label={task.type === 'SIMPLE' ? 'Task definition' : 'Task name'}
            mono
            isRequired
            value={task.name}
            description={task.type === 'SIMPLE' ? 'Workers poll the queue with this name.' : undefined}
            onCommit={(name) => patch({ name })}
          />
          <CommitTextField
            label="Reference name"
            mono
            isRequired
            value={task.taskReferenceName}
            description="Unique in the workflow; expressions use it."
            onCommit={(ref) => {
              if (ref === task.taskReferenceName) return;
              patch({ taskReferenceName: ref });
              onRenamed(ref);
            }}
          />
          <div className="sm:col-span-2">
            <CommitTextField
              label="Description"
              value={task.description ?? ''}
              onCommit={(description) => patch({ description: description || undefined })}
            />
          </div>
        </Card.Content>
      </Card>

      <TypeSpecific definition={definition} path={path} task={task} onChange={onChange} patch={patch} />

      <Card>
        <Card.Content>
          <KeyValueRows
            label="Input parameters"
            value={task.inputParameters}
            onCommit={(inputParameters) =>
              patch({ inputParameters: inputParameters as WorkflowTask['inputParameters'] })
            }
          />
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="space-y-4">
          <Switch isSelected={Boolean(task.optional)} onChange={(optional) => patch({ optional: optional || undefined })}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Make task optional</Label>
            </Switch.Content>
            <Description>The workflow continues even if this task fails.</Description>
          </Switch>

          <div className="grid gap-4 sm:grid-cols-2">
            <CommitNumberField label="Retry count" value={task.retryCount} onCommit={(retryCount) => patch({ retryCount })} />
            <CommitNumberField
              label="Start delay (seconds)"
              value={task.startDelaySeconds}
              onCommit={(startDelaySeconds) => patch({ startDelaySeconds })}
            />
          </div>

          {!['SWITCH', 'FORK_JOIN', 'FORK_JOIN_DYNAMIC', 'JOIN', 'DO_WHILE', 'SUB_WORKFLOW', 'WAIT', 'WAIT_FOR_WEBHOOK', 'PULL_WORKFLOW_MESSAGES', 'HUMAN', 'TERMINATE', 'SET_VARIABLE'].includes(task.type) && (
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <CommitTextField
                label="Cache output by"
                mono
                value={task.cacheConfig?.key ?? ''}
                placeholder="${workflow.input.customerId}"
                description="Reuse a recent success for the same key instead of running again."
                onCommit={(key) =>
                  patch({ cacheConfig: key ? { key, ttlInSecond: task.cacheConfig?.ttlInSecond ?? 3600 } : undefined })
                }
              />
              <CommitNumberField
                label="For (seconds)"
                minValue={1}
                value={task.cacheConfig?.ttlInSecond}
                onCommit={(ttlInSecond) =>
                  task.cacheConfig && ttlInSecond ? patch({ cacheConfig: { ...task.cacheConfig, ttlInSecond } }) : undefined
                }
              />
            </div>
          )}

          {!['SWITCH', 'FORK_JOIN', 'FORK_JOIN_DYNAMIC', 'JOIN', 'EXCLUSIVE_JOIN', 'DO_WHILE', 'TERMINATE', 'SET_VARIABLE', 'NOOP', 'YIELD'].includes(task.type) &&
            (typeof task.compensateWith === 'object' ? (
              <p className="rounded-xl bg-surface-secondary px-3 py-2 text-sm text-muted">
                Compensated by <span className="font-mono text-foreground">{task.compensateWith.taskReferenceName}</span> ({task.compensateWith.type}) —
                edit it in the Code tab.
              </p>
            ) : (
              <CommitTextField
                label="Compensate with"
                mono
                value={task.compensateWith ?? ''}
                placeholder="refund_payment"
                description="A task definition that undoes this task if the workflow later fails. It receives this task's input and output; compensations run newest first."
                onCommit={(name) => patch({ compensateWith: name || undefined })}
              />
            ))}

          {task.type === 'SIMPLE' && (
            <CommitTextField
              label="Domain"
              mono
              value={task.domain ?? ''}
              description="Routes this task to a named worker pool."
              onCommit={(domain) => patch({ domain: domain || undefined })}
            />
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function TypeSpecific({
  definition,
  path,
  task,
  onChange,
  patch,
}: {
  definition: Definition;
  path: Path;
  task: WorkflowTask;
  onChange: (next: Definition) => void;
  patch: (fields: Partial<WorkflowTask>) => void;
}) {
  const [newCase, setNewCase] = useState('');

  switch (task.type) {
    case 'SWITCH': {
      const cases = Object.keys(task.decisionCases ?? {});
      return (
        <Card>
          <Card.Header>
            <Card.Title className="text-sm">Decision</Card.Title>
          </Card.Header>
          <Card.Content className="space-y-4">
            <Select
              value={task.evaluatorType ?? 'value-param'}
              onChange={(value) => patch({ evaluatorType: String(value) as WorkflowTask['evaluatorType'] })}
            >
              <Label>Evaluator</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="value-param" textValue="Value param">
                    Value param
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="javascript" textValue="JavaScript">
                    JavaScript
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="jsonpath" textValue="JSONPath">
                    JSONPath
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <CommitTextField
              label="Expression"
              mono
              value={task.expression ?? ''}
              description={
                (task.evaluatorType ?? 'value-param') === 'value-param'
                  ? 'The input parameter whose value picks the case.'
                  : undefined
              }
              onCommit={(expression) => patch({ expression: expression || undefined })}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">Cases</p>
              {cases.map((name) => (
                <div key={name} className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-1.5">
                  <span className="font-mono text-sm">{name}</span>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove case ${name}`}
                    onPress={() => onChange(removeSwitchCase(definition, path, name))}
                  >
                    <TrashBin />
                  </Button>
                </div>
              ))}
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newCase.trim();
                  if (!name || cases.includes(name)) return;
                  onChange(addSwitchCase(definition, path, name));
                  setNewCase('');
                }}
              >
                <TextField aria-label="New case value" className="flex-1" value={newCase} onChange={setNewCase}>
                  <Input placeholder="New case value" className="font-mono text-sm" />
                </TextField>
                <Button type="submit" size="sm" variant="secondary">
                  <Plus />
                  Add case
                </Button>
              </form>
            </div>
          </Card.Content>
        </Card>
      );
    }

    case 'FORK_JOIN': {
      const branches = task.forkTasks ?? [];
      return (
        <Card>
          <Card.Header>
            <Card.Title className="text-sm">Branches</Card.Title>
            <Card.Description>The join waits on the last task of each branch and follows it as you edit.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2">
            {branches.map((branch, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-1.5">
                <span className="text-sm">
                  Branch {i + 1}
                  <span className="ml-2 text-muted">
                    {branch.length} task{branch.length === 1 ? '' : 's'}
                  </span>
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove branch ${i + 1}`}
                  isDisabled={branches.length <= 1}
                  onPress={() => onChange(removeForkBranch(definition, path, i))}
                >
                  <TrashBin />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                const ref = uniqueRef('branch', allRefs(definition));
                onChange(addForkBranch(definition, path, { name: ref, taskReferenceName: ref, type: 'NOOP' }));
              }}
            >
              <Plus />
              Add branch
            </Button>
          </Card.Content>
        </Card>
      );
    }

    case 'DO_WHILE':
      return (
        <Card>
          <Card.Content>
            <CommitTextField
              label="Loop condition"
              mono
              value={task.loopCondition ?? ''}
              description="Repeats while true, e.g. ${loop.output.iteration} < 3"
              onCommit={(loopCondition) => patch({ loopCondition: loopCondition || undefined })}
            />
          </Card.Content>
        </Card>
      );

    case 'JOIN':
    case 'EXCLUSIVE_JOIN':
      return (
        <Card>
          <Card.Content>
            <CommitTextField
              label="Join on"
              mono
              value={(task.joinOn ?? []).join(', ')}
              description="Task references to wait for, comma separated."
              onCommit={(value) =>
                patch({ joinOn: value.split(',').map((ref) => ref.trim()).filter(Boolean) })
              }
            />
          </Card.Content>
        </Card>
      );

    case 'SUB_WORKFLOW':
    case 'START_WORKFLOW':
      return (
        <Card>
          <Card.Content className="grid gap-4 sm:grid-cols-2">
            <CommitTextField
              label="Workflow name"
              mono
              isRequired
              value={task.subWorkflowParam?.name ?? ''}
              onCommit={(name) =>
                patch({ subWorkflowParam: name ? { ...(task.subWorkflowParam ?? {}), name } : undefined })
              }
            />
            <CommitNumberField
              label="Version"
              minValue={1}
              value={task.subWorkflowParam?.version}
              description="Blank for latest."
              onCommit={(version) => {
                if (task.subWorkflowParam?.name) patch({ subWorkflowParam: { ...task.subWorkflowParam, version } });
              }}
            />
          </Card.Content>
        </Card>
      );

    default:
      return null;
  }
}
