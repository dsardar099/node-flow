'use client';

import { BranchesRight, CircleExclamation, PencilToSquare, Persons, Tag } from '@gravity-ui/icons';
import { Button, Card, Chip, EmptyState, SearchField, Table, Tooltip } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { EditTagsModal, TagChip } from '../../../components/tags/tag-editor';

export interface TagOverview {
  tags: { tag: string; workflows: string[]; reachableBy: { group: string; pattern: string }[] }[];
  grants: { group: string; pattern: string; matches: string[] }[];
}

/**
 * Tags, from both sides.
 *
 * A tag on a workflow closes it; a grant on a group opens it again. Each is
 * edited somewhere else, so the mistakes live in the gap between them: a tag
 * nobody is granted (only admins can see those workflows), or a grant for a
 * tag that no longer exists (usually a typo). This page is where both show up.
 */
export function TagsDashboard({ namespace, overview }: { namespace: string; overview: TagOverview }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();

  const needle = query.trim().toLowerCase();
  const tags = useMemo(
    () =>
      overview.tags.filter(
        (t) =>
          !needle ||
          t.tag.toLowerCase().includes(needle) ||
          t.workflows.some((w) => w.toLowerCase().includes(needle)) ||
          t.reachableBy.some((g) => g.group.toLowerCase().includes(needle))
      ),
    [overview.tags, needle]
  );
  const grants = overview.grants.filter(
    (g) => !needle || g.group.toLowerCase().includes(needle) || g.pattern.toLowerCase().includes(needle)
  );

  const taggedWorkflows = new Set(overview.tags.flatMap((t) => t.workflows));
  const dangling = overview.grants.filter((g) => g.matches.length === 0).length;
  const unreachable = overview.tags.filter((t) => t.reachableBy.length === 0).length;
  const tagsOf = (workflow: string) => overview.tags.filter((t) => t.workflows.includes(workflow)).map((t) => t.tag);
  const allTags = overview.tags.map((t) => t.tag);

  return (
    <>
      <PageHeader
        title="Tags"
        description="Tags on workflows restrict who can reach them; tag grants on groups open them again. Both sides, in one place."
      />

      <div className="space-y-6 px-4 md:px-8 pb-10">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Tags in use" value={overview.tags.length} />
          <Stat label="Tagged workflows" value={taggedWorkflows.size} />
          <Stat
            label="Tags no group can reach"
            value={unreachable}
            tone={unreachable ? 'warning' : undefined}
            hint="Only admins can see workflows carrying these."
          />
          <Stat
            label="Grants that open nothing"
            value={dangling}
            tone={dangling ? 'warning' : undefined}
            hint="A grant matching no tag in use — often a typo, or a tag since removed."
          />
        </div>

        <SearchField aria-label="Search tags" value={query} onChange={setQuery} className="max-w-md">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search tags, workflows or groups" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        {overview.tags.length === 0 ? (
          <Card>
            <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Tag className="size-6" />
              </span>
              <span className="text-sm font-medium">No workflow is tagged</span>
              <span className="max-w-md text-sm text-muted">
                Every workflow is reachable by anyone with workflow access. Tag one from the Workflows list to limit it to
                the groups you grant.
              </span>
              <Link href="/workflowDef" className="button button--secondary">
                Go to workflows
              </Link>
            </EmptyState>
          </Card>
        ) : (
          <section aria-label="Tags" className="grid items-start gap-3 lg:grid-cols-2">
            {tags.map((entry) => (
              <Card key={entry.tag} className="gap-4 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Tag className="size-4" />
                  </span>
                  <span className="font-mono text-base font-medium">{entry.tag}</span>
                  <span className="ms-auto text-sm text-muted">
                    {entry.workflows.length} workflow{entry.workflows.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Workflows</p>
                  <ul className="divide-y divide-separator rounded-xl border border-separator">
                    {entry.workflows.map((workflow) => (
                      <li key={workflow} className="flex items-center gap-2 px-3 py-2">
                        <BranchesRight className="size-4 text-muted" />
                        <Link
                          href={`/workflowDef/${encodeURIComponent(workflow)}`}
                          className="min-w-0 flex-1 truncate text-sm hover:text-accent hover:underline"
                        >
                          {workflow}
                        </Link>
                        <Tooltip delay={300}>
                          <Tooltip.Trigger>
                            <Button isIconOnly size="sm" variant="ghost" aria-label={`Edit tags on ${workflow}`} onPress={() => setEditing(workflow)}>
                              <PencilToSquare />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>Edit tags</Tooltip.Content>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Reachable by</p>
                  {entry.reachableBy.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
                      <CircleExclamation className="size-4 shrink-0" />
                      No group is granted this tag — only admins can reach these workflows.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {entry.reachableBy.map((grant) => (
                        <Chip key={`${grant.group}:${grant.pattern}`} size="sm" variant="soft" color="accent">
                          <Persons className="size-3.5" />
                          {grant.group}
                          {grant.pattern !== entry.tag && (
                            <span className="font-mono text-[11px] opacity-70">via {grant.pattern}</span>
                          )}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </section>
        )}

        <section aria-label="Grants" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Grants</h2>
            <Link href="/admin/groups" className="text-sm text-accent hover:underline">
              Manage groups
            </Link>
          </div>
          <Card className="p-0">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Tag grants" className="min-w-[640px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Group</Table.Column>
                    <Table.Column>Pattern</Table.Column>
                    <Table.Column>Opens</Table.Column>
                  </Table.Header>
                  <Table.Body
                    renderEmptyState={() => (
                      <EmptyState className="py-10 text-center text-sm text-muted">
                        No group has a tag grant. Add one on a group to open tagged workflows to its members.
                      </EmptyState>
                    )}
                  >
                    {grants.map((grant) => (
                      <Table.Row key={`${grant.group}:${grant.pattern}`} id={`${grant.group}:${grant.pattern}`}>
                        <Table.Cell>
                          <span className="flex items-center gap-2 font-medium">
                            <Persons className="size-4 text-muted" />
                            {grant.group}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="font-mono text-sm">{grant.pattern}</span>
                        </Table.Cell>
                        <Table.Cell>
                          {grant.matches.length === 0 ? (
                            <Chip size="sm" variant="soft" color="warning">
                              <CircleExclamation className="size-3.5" />
                              Opens nothing
                            </Chip>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {grant.matches.map((tag) => (
                                <TagChip key={tag} tag={tag} />
                              ))}
                            </div>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
        </section>
      </div>

      <EditTagsModal
        namespace={namespace}
        workflow={editing}
        initialTags={editing ? tagsOf(editing) : NO_TAGS}
        suggestions={allTags}
        isOpen={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

const NO_TAGS: string[] = [];

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: 'warning'; hint?: string }) {
  const card = (
    <Card className="flex-row items-center justify-between px-5 py-4">
      <span className="text-sm text-muted">{label}</span>
      <span className={`tabular text-2xl font-semibold ${tone === 'warning' ? 'text-warning' : ''}`}>{value}</span>
    </Card>
  );
  if (!hint) return card;
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger className="text-start">{card}</Tooltip.Trigger>
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip>
  );
}
