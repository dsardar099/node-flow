'use client';
import {
  ArrowDownToLine,
  ArrowRotateRight,
  ArrowUpFromLine,
  BranchesRight,
  CirclePlay,
  Copy,
  Ellipsis,
  PencilToSquare,
  Plus,
  Pulse,
  ShieldCheck,
  Tag,
  TrashBin,
} from '@gravity-ui/icons';
import {
  AlertDialog,
  Avatar,
  Button,
  Card,
  Chip,
  Dropdown,
  EmptyState,
  Label,
  SearchField,
  Table,
  Tooltip,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/shell/page-header';
import { LocalTime } from '../../components/ui/local-time';
import { mutate } from '../../lib/mutate';
import { RunWorkflowModal } from './run-workflow-modal';
import { ImportBpmnModal } from './bpmn-import';
import { TemplateGallery } from './template-gallery';
import { ImportDefinitionsModal, downloadBundle } from './bundle-tools';
import { WorkflowPermissionsDialog } from '../../components/permissions/grants';
import { EditTagsModal, TagChip } from '../../components/tags/tag-editor';
import { triggerClass } from '../../components/ui/dropdown-trigger';
import { Ago } from '../../components/ui/ago';
export interface WorkflowListing {
  name: string;
  version: number;
  tags: string[];
  description: string | null;
  ownerEmail: string | null;
  createdAt: string;
  createdBy: string | null;
}
type Row = WorkflowListing & { versionCount: number };
/**
 * One row per workflow name, at its newest version.
 *
 * A row opens the editor; running it is one click; everything else — its
 * executions, cloning, deleting — is in the row's menu, so the list reads as a
 * list rather than a wall of icons.
 */
export function WorkflowDefinitionList({
  namespace,
  definitions,
  mayWrite,
  mayStart,
  mayAdminister = false,
}: {
  namespace: string;
  definitions: Row[];
  mayWrite: boolean;
  mayStart: boolean;
  mayAdminister?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [runName, setRunName] = useState<string>();
  const [runOpen, setRunOpen] = useState(false);
  const [deleting, setDeleting] = useState<Row>();
  const [tagging, setTagging] = useState<Row>();
  const [importing, setImporting] = useState(false);
  const [importingBpmn, setImportingBpmn] = useState(false);
  const [browsingTemplates, setBrowsingTemplates] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<string>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter((d) =>
      [d.name, d.description ?? '', d.ownerEmail ?? '', ...d.tags].some((field) =>
        field.toLowerCase().includes(needle)
      )
    );
  }, [definitions, query]);
  const names = useMemo(() => definitions.map((d) => d.name).sort(), [definitions]);
  const remove = async (definition: Row) => {
    try {
      await mutate(
        `/v1/ns/${namespace}/metadata/workflows/${encodeURIComponent(definition.name)}?version=${definition.version}`,
        { method: 'DELETE' }
      );
      toast.success(`Deleted ${definition.name} v${definition.version}`);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };
  const run = (name?: string) => {
    setRunName(name);
    setRunOpen(true);
  };
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Definitions in this namespace, at their newest version. Every save creates a version; running executions keep the one they started on."
        actions={
          <>
            {definitions.length > 0 && (
              <Button variant="ghost" onPress={() => void downloadBundle(namespace)}>
                <ArrowDownToLine />
                Export all
              </Button>
            )}
            {mayWrite && (
              <>
                <Button variant="ghost" onPress={() => setImporting(true)}>
                  <ArrowUpFromLine />
                  Import
                </Button>
                <Button variant="ghost" onPress={() => setImportingBpmn(true)}>
                  <ArrowUpFromLine />
                  Import BPMN
                </Button>
                <Button variant="ghost" onPress={() => setBrowsingTemplates(true)}>
                  <Plus />
                  Templates
                </Button>
              </>
            )}
            {mayStart && definitions.length > 0 && (
              <Button variant="secondary" onPress={() => run()}>
                <CirclePlay />
                Run workflow
              </Button>
            )}
            {mayWrite && (
              <Button onPress={() => router.push('/newWorkflowDef')}>
                <Plus />
                New workflow
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4 px-4 md:px-8 pb-10">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField aria-label="Search workflows" value={query} onChange={setQuery} className="min-w-72 max-w-lg flex-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search by name, description, owner or tag" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted">
              {shown.length} of {definitions.length}
            </span>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" onPress={() => router.refresh()}>
                  <ArrowRotateRight />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Workflow definitions"
                className="min-w-[860px]"
                onRowAction={(key) => router.push(`/workflowDef/${encodeURIComponent(String(key))}`)}
              >
                <Table.Header>
                  <Table.Column isRowHeader>Workflow</Table.Column>
                  <Table.Column>Version</Table.Column>
                  <Table.Column>Owner</Table.Column>
                  <Table.Column>Updated</Table.Column>
                  <Table.Column className="w-40">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <BranchesRight className="size-6" />
                      </span>
                      <span className="text-sm font-medium">
                        {definitions.length === 0 ? 'No workflows yet' : 'Nothing matches that search'}
                      </span>
                      <span className="max-w-sm text-sm text-muted">
                        {definitions.length === 0
                          ? 'Draw one in the visual editor, or register a JSON definition through the API or CLI.'
                          : 'Try a shorter search, or search by owner or tag.'}
                      </span>
                      {definitions.length === 0 && mayWrite && (
                        <Button className="mt-1" onPress={() => router.push('/newWorkflowDef')}>
                          <Plus />
                          New workflow
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {shown.map((definition) => {
                    const owner = definition.ownerEmail ?? definition.createdBy;
                    return (
                      <Table.Row key={definition.name} id={definition.name} className="cursor-pointer">
                        <Table.Cell>
                          <div className="flex items-start gap-3 py-1">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                              <BranchesRight className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium">{definition.name}</p>
                              {definition.description && (
                                <p className="line-clamp-2 max-w-xl text-sm text-muted">{definition.description}</p>
                              )}
                              {definition.tags.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {definition.tags.map((tag) => (
                                    <TagChip key={tag} tag={tag} />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <Chip size="sm" variant="secondary" className="tabular">
                              v{definition.version}
                            </Chip>
                            {definition.versionCount > 1 && (
                              <span className="text-xs text-muted">{definition.versionCount} versions</span>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          {owner ? (
                            <div className="flex items-center gap-2">
                              <Avatar size="sm" color="default">
                                <Avatar.Fallback>{owner.slice(0, 2).toUpperCase()}</Avatar.Fallback>
                              </Avatar>
                              <span className="truncate text-sm">{owner}</span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          <span className="block text-sm"><Ago value={definition.createdAt} /></span>
                          <LocalTime value={definition.createdAt} className="tabular block text-xs text-muted" />
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center justify-end gap-1">
                            {mayStart && (
                              <Button size="sm" variant="secondary" onPress={() => run(definition.name)}>
                                <CirclePlay />
                                Run
                              </Button>
                            )}
                            <RowMenu
                              definition={definition}
                              mayWrite={mayWrite}
                              mayAdminister={mayAdminister}
                              onAction={(action) => {
                                const name = encodeURIComponent(definition.name);
                                if (action === 'edit') router.push(`/workflowDef/${name}`);
                                if (action === 'executions') router.push(`/executions?workflowType=${name}`);
                                if (action === 'clone') router.push(`/newWorkflowDef?from=${name}`);
                                if (action === 'delete') setDeleting(definition);
                                if (action === 'tags') setTagging(definition);
                                if (action === 'export') void downloadBundle(namespace, [definition.name]);
                                if (action === 'permissions') setPermissionsFor(definition.name);
                              }}
                            />
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
      {mayWrite && <ImportDefinitionsModal namespace={namespace} isOpen={importing} onOpenChange={setImporting} />}
      {mayWrite && <ImportBpmnModal namespace={namespace} isOpen={importingBpmn} onOpenChange={setImportingBpmn} />}
      {mayWrite && <TemplateGallery isOpen={browsingTemplates} onOpenChange={setBrowsingTemplates} />}
      {mayAdminister && (
        <WorkflowPermissionsDialog namespace={namespace} workflow={permissionsFor} onOpenChange={(open) => !open && setPermissionsFor(undefined)} />
      )}
      {mayStart && (
        <RunWorkflowModal
          namespace={namespace}
          workflowNames={names}
          isOpen={runOpen}
          onOpenChange={setRunOpen}
          initialName={runName}
        />
      )}
      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                Delete {deleting?.name} v{deleting?.version}?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                Only this version is deleted; earlier versions stay. Finished executions keep their history. It is
                refused while any execution of this version is still running.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && remove(deleting)}>
                Delete version
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
      <EditTagsModal
        namespace={namespace}
        workflow={tagging?.name}
        initialTags={tagging?.tags ?? NO_TAGS}
        suggestions={[...new Set(definitions.flatMap((d) => d.tags))].sort()}
        isOpen={tagging !== undefined}
        onOpenChange={(open) => !open && setTagging(undefined)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
const NO_TAGS: string[] = [];
function RowMenu({
  definition,
  mayWrite,
  mayAdminister,
  onAction,
}: {
  definition: Row;
  mayWrite: boolean;
  onAction: (action: 'edit' | 'executions' | 'clone' | 'tags' | 'export' | 'permissions' | 'delete') => void;
  mayAdminister?: boolean;
}) {
  const items = [
    { id: 'edit', label: mayWrite ? 'Open in editor' : 'View definition', icon: PencilToSquare },
    { id: 'executions', label: 'View executions', icon: Pulse },
    { id: 'export', label: 'Export with dependencies', icon: ArrowDownToLine },
    ...(mayWrite ? [{ id: 'clone', label: 'Clone', icon: Copy }] : []),
    ...(mayWrite ? [{ id: 'tags', label: 'Edit tags', icon: Tag }] : []),
    ...(mayAdminister ? [{ id: 'permissions', label: 'Permissions', icon: ShieldCheck }] : []),
    ...(mayWrite ? [{ id: 'delete', label: `Delete v${definition.version}`, icon: TrashBin, danger: true }] : []),
  ] as const;
  return (
    <Dropdown>
      <Dropdown.Trigger className={triggerClass({ isIconOnly: true, size: 'sm', variant: 'ghost' })} aria-label={`More actions for ${definition.name}`}>
          <Ellipsis />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end" className="min-w-52">
        <Dropdown.Menu aria-label="Workflow actions" onAction={(key) => onAction(key as 'edit')}>
          {items.map((item) => (
            <Dropdown.Item
              key={item.id}
              id={item.id}
              textValue={item.label}
              variant={'danger' in item && item.danger ? 'danger' : undefined}
            >
              <item.icon />
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
