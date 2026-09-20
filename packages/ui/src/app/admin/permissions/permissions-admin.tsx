'use client';

import { Plus, ShieldCheck } from '@gravity-ui/icons';
import { Button, Card, EmptyState, SearchField, Spinner, Tabs } from '@heroui/react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { GrantDialog, GrantList, useGrants, type Grant, type ResourceType } from '../../../components/permissions/grants';

/**
 * Every fine-grained grant in the namespace — who can do what to which
 * workflows and task definitions beyond their scopes.
 */
export function PermissionsAdmin({
  namespace,
  resourceNames,
}: {
  namespace: string;
  resourceNames: Record<ResourceType, string[]>;
}) {
  const [type, setType] = useState<'all' | ResourceType>('all');
  const [query, setQuery] = useState('');
  const { grants, reload, remove } = useGrants(namespace, { resourceType: type === 'all' ? undefined : type });
  const [editing, setEditing] = useState<Partial<Grant>>();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (grants ?? []).filter(
      (grant) => !needle || [grant.resource, grant.subjectName ?? '', grant.subjectType].some((field) => field.toLowerCase().includes(needle))
    );
  }, [grants, query]);

  return (
    <>
      <PageHeader
        title="Permissions"
        description="Access to specific workflows and task definitions for users, groups and applications, beyond what their scopes allow across the namespace."
        actions={
          <Button onPress={() => setEditing({})}>
            <Plus />
            Grant access
          </Button>
        }
      />
      <div className="space-y-4 px-4 pb-10 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs selectedKey={type} onSelectionChange={(key) => setType(key as typeof type)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Resource type" className="w-auto">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'WORKFLOW', label: 'Workflows' },
                  { id: 'TASK_DEFINITION', label: 'Task definitions' },
                ].map((tab) => (
                  <Tabs.Tab key={tab.id} id={tab.id} className="w-auto flex-none px-4">
                    {tab.label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <SearchField aria-label="Search grants" value={query} onChange={setQuery} className="min-w-64 max-w-md flex-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search by who or target" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>

        {grants === undefined ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <ShieldCheck className="size-6" />
              </span>
              <span className="text-sm font-medium">{grants.length === 0 ? 'No grants yet' : 'Nothing matches'}</span>
              <span className="max-w-md text-sm text-muted">
                Scopes decide what someone can do across the namespace. A grant gives access to specific workflows or task definitions —
                by name, by prefix like <span className="font-mono">orders_*</span>, or by tag.
              </span>
            </EmptyState>
          </Card>
        ) : (
          <GrantList grants={shown} onEdit={(grant) => setEditing(grant)} onRemove={(grant) => void remove(grant)} />
        )}
      </div>

      <GrantDialog
        namespace={namespace}
        isOpen={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSaved={() => void reload()}
        initial={editing}
        resourceNames={resourceNames}
      />
    </>
  );
}
