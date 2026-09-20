'use client';

import {
  Cube,
  Key,
  Person,
  Persons,
  Plus,
  ShieldCheck,
  BranchesRight,
  TrashBin,
} from '@gravity-ui/icons';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Chip,
  ComboBox,
  Description,
  EmptyState,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  Spinner,
  toast,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../lib/fetch-json';
import { mutate } from '../../lib/mutate';

export type SubjectType = 'USER' | 'GROUP' | 'APPLICATION';
export type ResourceType = 'WORKFLOW' | 'TASK_DEFINITION';
export type Access = 'READ' | 'EXECUTE' | 'UPDATE' | 'DELETE';

export interface Grant {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  subjectName: string | null;
  resourceType: ResourceType;
  resource: string;
  access: Access[];
  updatedAt: string;
}

const ACCESS: {
  id: Access;
  label: string;
  hint: Record<ResourceType, string>;
}[] = [
  {
    id: 'READ',
    label: 'Read',
    hint: {
      WORKFLOW: 'See the definition and its runs',
      TASK_DEFINITION: 'See the definition',
    },
  },
  {
    id: 'EXECUTE',
    label: 'Execute',
    hint: {
      WORKFLOW: 'Start, retry, pause and terminate runs',
      TASK_DEFINITION: 'No effect on task definitions',
    },
  },
  {
    id: 'UPDATE',
    label: 'Update',
    hint: {
      WORKFLOW: 'Save new versions and change tags',
      TASK_DEFINITION: 'Change its settings',
    },
  },
  {
    id: 'DELETE',
    label: 'Delete',
    hint: { WORKFLOW: 'Delete versions', TASK_DEFINITION: 'Delete it' },
  },
];

const SUBJECT_ICON = {
  USER: Person,
  GROUP: Persons,
  APPLICATION: Key,
} as const;
const SUBJECT_LABEL = {
  USER: 'User',
  GROUP: 'Group',
  APPLICATION: 'Application',
} as const;

interface Subject {
  id: string;
  label: string;
  detail?: string;
}

/** The people, groups and applications a grant can be given to, loaded once per dialog. */
function useSubjects(namespace: string, enabled: boolean) {
  const [subjects, setSubjects] = useState<Record<SubjectType, Subject[]>>();
  useEffect(() => {
    if (!enabled || subjects) return;
    void Promise.all([
      fetchJson<
        {
          id: string;
          email: string;
          name: string;
          disabledAt?: string | null;
        }[]
      >(`/v1/ns/${namespace}/users`).catch(() => []),
      fetchJson<{
        groups: { id: string; name: string; description: string | null }[];
      }>(`/v1/ns/${namespace}/groups`)
        .then((r) => r.groups)
        .catch(() => []),
      fetchJson<{ id: string; name: string; revokedAt: string | null }[]>(
        '/v1/auth/api-keys',
      ).catch(() => []),
      fetchJson<{ id: string; name: string; disabledAt: string | null }[]>(
        '/v1/auth/service-accounts',
      ).catch(() => []),
    ]).then(([users, groups, keys, accounts]) =>
      setSubjects({
        USER: users
          .filter((u) => !u.disabledAt)
          .map((u) => ({ id: u.id, label: u.email, detail: u.name })),
        GROUP: groups.map((g) => ({
          id: g.id,
          label: g.name,
          detail: g.description ?? undefined,
        })),
        APPLICATION: [
          ...accounts
            .filter((a) => !a.disabledAt)
            .map((a) => ({
              id: a.id,
              label: a.name,
              detail: 'Service account',
            })),
          ...keys
            .filter((k) => !k.revokedAt)
            .map((k) => ({ id: k.id, label: k.name, detail: 'API key' })),
        ],
      }),
    );
  }, [enabled, namespace, subjects]);
  return subjects;
}

/**
 * Give one subject access to one target — or change what it has.
 *
 * Saving replaces the subject's access to that target; the server is the single
 * place that knows what a target matches.
 */
type GrantInitial = Partial<
  Pick<
    Grant,
    | 'subjectType'
    | 'subjectId'
    | 'subjectName'
    | 'resourceType'
    | 'resource'
    | 'access'
  >
>;

export function GrantDialog({
  namespace,
  isOpen,
  onOpenChange,
  onSaved,
  initial,
  resourceNames,
}: {
  namespace: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initial?: GrantInitial;
  /** Suggestions for the target field. */
  resourceNames?: Partial<Record<ResourceType, string[]>>;
}) {
  const form = useGrantForm({
    namespace,
    isOpen,
    initial,
    resourceNames,
    onCancel: () => onOpenChange(false),
    onSaved: () => {
      onOpenChange(false);
      onSaved();
    },
  });
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{form.title}</Modal.Heading>
            <p className="text-sm text-muted">
              Access to specific workflows or task definitions, on top of what
              someone&apos;s scopes allow everywhere.
            </p>
          </Modal.Header>
          <Modal.Body className="space-y-5">{form.body}</Modal.Body>
          <Modal.Footer>{form.footer}</Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** The grant form's state, fields and buttons — rendered in a dialog of its own, or inside another. */
function useGrantForm({
  namespace,
  isOpen,
  initial,
  resourceNames,
  onCancel,
  onSaved,
}: {
  namespace: string;
  isOpen: boolean;
  initial?: GrantInitial;
  resourceNames?: Partial<Record<ResourceType, string[]>>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const subjects = useSubjects(namespace, isOpen);
  const [subjectType, setSubjectType] = useState<SubjectType>('USER');
  const [subjectId, setSubjectId] = useState<string>();
  const [subjectInput, setSubjectInput] = useState('');
  const [resourceType, setResourceType] = useState<ResourceType>('WORKFLOW');
  const [resource, setResource] = useState('');
  const [access, setAccess] = useState<Access[]>(['READ']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isOpen) return;
    setSubjectType(initial?.subjectType ?? 'USER');
    setSubjectId(initial?.subjectId);
    setSubjectInput(initial?.subjectName ?? '');
    setResourceType(initial?.resourceType ?? 'WORKFLOW');
    setResource(initial?.resource ?? '');
    setAccess(initial?.access ?? ['READ']);
    setError(undefined);
  }, [isOpen, initial]);

  const editing = Boolean(initial?.subjectId);
  const options = subjects?.[subjectType] ?? [];
  const targetOk =
    /^(\*|tag:[a-z][a-z0-9_.-]*:([^\s:*]+|\*)|[A-Za-z0-9_.-]{1,200}\*?)$/.test(
      resource.trim(),
    );

  const save = async () => {
    if (!subjectId) return;
    setSaving(true);
    setError(undefined);
    try {
      await mutate(`/v1/ns/${namespace}/permissions`, {
        method: 'PUT',
        body: {
          subjectType,
          subjectId,
          resourceType,
          resource: resource.trim(),
          access,
        },
      });
      toast.success(
        access.length
          ? `Granted ${access.map((a) => a.toLowerCase()).join(', ')} on ${resource.trim()}`
          : 'Access removed',
      );
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? 'Change access' : 'Grant access';
  const body = (
    <>
      <RadioGroup
        value={subjectType}
        orientation="horizontal"
        isDisabled={editing}
        onChange={(value) => {
          setSubjectType(value as SubjectType);
          setSubjectId(undefined);
          setSubjectInput('');
        }}
      >
        <Label>Who</Label>
        <div className="flex flex-wrap gap-4">
          {(['USER', 'GROUP', 'APPLICATION'] as SubjectType[]).map((type) => (
            <Radio key={type} value={type}>
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                <span className="text-sm">{SUBJECT_LABEL[type]}</span>
              </Radio.Content>
            </Radio>
          ))}
        </div>
      </RadioGroup>

      <ComboBox
        aria-label={SUBJECT_LABEL[subjectType]}
        isDisabled={editing}
        inputValue={subjectInput}
        onInputChange={(value) => {
          setSubjectInput(value);
          if (!options.some((o) => o.label === value)) setSubjectId(undefined);
        }}
        selectedKey={subjectId ?? null}
        onSelectionChange={(key) => {
          if (key === null) return;
          setSubjectId(String(key));
          setSubjectInput(options.find((o) => o.id === key)?.label ?? '');
        }}
      >
        <ComboBox.InputGroup>
          <Input
            placeholder={
              subjects
                ? `Choose a ${SUBJECT_LABEL[subjectType].toLowerCase()}`
                : 'Loading…'
            }
          />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox>
            {options.map((option) => (
              <ListBox.Item
                key={option.id}
                id={option.id}
                textValue={option.label}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.detail && (
                    <span className="truncate text-xs text-muted">
                      {option.detail}
                    </span>
                  )}
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <RadioGroup
          value={resourceType}
          isDisabled={editing}
          onChange={(value) => setResourceType(value as ResourceType)}
        >
          <Label>On</Label>
          {(['WORKFLOW', 'TASK_DEFINITION'] as ResourceType[]).map((type) => (
            <Radio key={type} value={type}>
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                <span className="text-sm">
                  {type === 'WORKFLOW' ? 'Workflows' : 'Task definitions'}
                </span>
              </Radio.Content>
            </Radio>
          ))}
        </RadioGroup>
        <ComboBox
          allowsCustomValue
          isDisabled={editing}
          isInvalid={resource !== '' && !targetOk}
          inputValue={resource}
          onInputChange={setResource}
          onSelectionChange={(key) => key !== null && setResource(String(key))}
        >
          <Label>Target</Label>
          <ComboBox.InputGroup>
            <Input
              className="font-mono"
              placeholder="checkout, orders_*, tag:team:payments or *"
            />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <Description>
            A name, a prefix ending in *, every resource with a tag, or * for
            all.
          </Description>
          <FieldError>Not a name, prefix, tag:key:value or *.</FieldError>
          <ComboBox.Popover>
            <ListBox>
              {(resourceNames?.[resourceType] ?? []).map((name) => (
                <ListBox.Item key={name} id={name} textValue={name}>
                  {name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      </div>

      <CheckboxGroup
        value={access}
        onChange={(value) => setAccess(value as Access[])}
      >
        <Label>Access</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACCESS.map((option) => (
            <Checkbox
              key={option.id}
              value={option.id}
              isDisabled={
                resourceType === 'TASK_DEFINITION' && option.id === 'EXECUTE'
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="text-sm font-medium">{option.label}</span>
              </Checkbox.Content>
              <Description className="pl-6 text-xs">
                {option.hint[resourceType]}
              </Description>
            </Checkbox>
          ))}
        </div>
        <Description>
          Any access includes read.{' '}
          {editing ? 'Clear every box to remove the grant.' : ''}
        </Description>
      </CheckboxGroup>

      {error && (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
  const footer = (
    <>
      <Button variant="tertiary" onPress={onCancel}>
        Cancel
      </Button>
      <Button
        isPending={saving}
        isDisabled={
          !subjectId || !targetOk || (!editing && access.length === 0)
        }
        variant={editing && access.length === 0 ? 'danger' : 'primary'}
        onPress={save}
      >
        <ShieldCheck />
        {editing && access.length === 0
          ? 'Remove access'
          : editing
            ? 'Save access'
            : 'Grant access'}
      </Button>
    </>
  );
  return { title, body, footer };
}

/** Grants as rows: who, on what, with which access — each editable and removable. */
export function GrantList({
  grants,
  onEdit,
  onRemove,
  showTarget = true,
}: {
  grants: Grant[];
  onEdit: (grant: Grant) => void;
  onRemove: (grant: Grant) => void;
  showTarget?: boolean;
}) {
  return (
    <ul className="divide-y divide-separator overflow-hidden rounded-xl border border-separator">
      {grants.map((grant) => {
        const Icon = SUBJECT_ICON[grant.subjectType];
        const TargetIcon =
          grant.resourceType === 'WORKFLOW' ? BranchesRight : Cube;
        return (
          <li
            key={grant.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {grant.subjectName ?? grant.subjectId}
              </p>
              <p className="text-xs text-muted">
                {SUBJECT_LABEL[grant.subjectType]}
              </p>
            </div>
            {showTarget && (
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <TargetIcon className="size-3.5 shrink-0 text-muted" />
                <span className="truncate font-mono">{grant.resource}</span>
              </span>
            )}
            <div className="flex flex-wrap gap-1">
              {grant.access.map((a) => (
                <Chip
                  key={a}
                  size="sm"
                  variant="soft"
                  color={
                    a === 'DELETE'
                      ? 'danger'
                      : a === 'READ'
                        ? 'default'
                        : 'accent'
                  }
                >
                  {a.toLowerCase()}
                </Chip>
              ))}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onPress={() => onEdit(grant)}>
                Change
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={`Remove access for ${grant.subjectName ?? grant.subjectId}`}
                onPress={() => onRemove(grant)}
              >
                <TrashBin />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Loads, edits and removes the grants matching a filter — shared by the admin page and the per-workflow dialog. */
export function useGrants(
  namespace: string,
  filter: { resourceType?: ResourceType; resource?: string },
  enabled = true,
) {
  const [grants, setGrants] = useState<Grant[]>();
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filter.resourceType) params.set('resourceType', filter.resourceType);
    if (filter.resource) params.set('resource', filter.resource);
    return params.toString();
  }, [filter.resourceType, filter.resource]);

  const reload = useCallback(async () => {
    try {
      setGrants(
        (
          await fetchJson<{ grants: Grant[] }>(
            `/v1/ns/${namespace}/permissions${query ? `?${query}` : ''}`,
          )
        ).grants,
      );
    } catch (failure) {
      toast.danger((failure as Error).message);
      setGrants([]);
    }
  }, [namespace, query]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const remove = async (grant: Grant) => {
    try {
      await mutate(`/v1/ns/${namespace}/permissions/${grant.id}`, {
        method: 'DELETE',
      });
      toast.success(
        `Removed ${grant.subjectName ?? 'the'} access to ${grant.resource}`,
      );
      await reload();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return { grants, reload, remove };
}

/** Who has specific access to one workflow, from its row in the list. */
export function WorkflowPermissionsDialog({
  namespace,
  workflow,
  onOpenChange,
}: {
  namespace: string;
  workflow?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { grants, reload, remove } = useGrants(
    namespace,
    { resourceType: 'WORKFLOW', resource: workflow },
    workflow !== undefined,
  );
  const [editing, setEditing] = useState<Partial<Grant>>();
  // One dialog with two views rather than a second modal on top: a picker's
  // popover inside a stacked modal counts as a click outside it and closes it.
  const form = useGrantForm({
    namespace,
    isOpen: editing !== undefined,
    initial: editing,
    onCancel: () => setEditing(undefined),
    onSaved: () => {
      setEditing(undefined);
      void reload();
    },
  });

  useEffect(() => {
    if (workflow === undefined) setEditing(undefined);
  }, [workflow]);

  return (
    <Modal.Backdrop isOpen={workflow !== undefined} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-2xl">
          <Modal.CloseTrigger />
          {editing ? (
            <>
              <Modal.Header>
                <Modal.Heading>
                  {form.title} to <span className="font-mono">{workflow}</span>
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-5">{form.body}</Modal.Body>
              <Modal.Footer>{form.footer}</Modal.Footer>
            </>
          ) : (
            <>
              <Modal.Header>
                <Modal.Heading>
                  Permissions for <span className="font-mono">{workflow}</span>
                </Modal.Heading>
                <p className="text-sm text-muted">
                  Specific access to this workflow. Anyone with namespace-wide
                  scopes already has it; grants by prefix or tag are on the
                  Permissions page.
                </p>
              </Modal.Header>
              <Modal.Body>
                {grants === undefined ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : grants.length === 0 ? (
                  <EmptyState className="flex flex-col items-center gap-2 py-8 text-center">
                    <ShieldCheck className="size-6 text-muted" />
                    <span className="text-sm font-medium">
                      No specific grants
                    </span>
                    <span className="max-w-sm text-sm text-muted">
                      Give a contractor, a team or an application access to just
                      this workflow.
                    </span>
                  </EmptyState>
                ) : (
                  <GrantList
                    grants={grants}
                    showTarget={false}
                    onEdit={(grant) => setEditing(grant)}
                    onRemove={(grant) => void remove(grant)}
                  />
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Close
                </Button>
                <Button
                  onPress={() =>
                    setEditing({
                      resourceType: 'WORKFLOW',
                      resource: workflow,
                      access: ['READ', 'EXECUTE'],
                    })
                  }
                >
                  <Plus />
                  Grant access
                </Button>
              </Modal.Footer>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
