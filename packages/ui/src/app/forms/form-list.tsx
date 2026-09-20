'use client';
import { ListUl, Plus } from '@gravity-ui/icons';
import { Button, Card, Chip, EmptyState, Table } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/shell/page-header';
import { Ago } from '../../components/ui/ago';
export interface FormSummary {
  name: string;
  version: number;
  versions: number;
  schema: { properties?: Record<string, unknown>; required?: string[] };
  description: string | null;
  createdAt: string;
}
export function FormList({ forms, mayWrite }: { forms: FormSummary[]; mayWrite: boolean }) {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="User forms"
        description="Forms people fill in to complete human tasks. Versioned; a task keeps the version it opened with, and every response is checked against it."
        actions={
          mayWrite && (
            <Button onPress={() => router.push('/newForm')}>
              <Plus />
              New form
            </Button>
          )
        }
      />
      <div className="px-4 md:px-8 pb-10">
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="User forms" className="min-w-[640px]" onRowAction={(key) => router.push(`/forms/${encodeURIComponent(String(key))}`)}>
                <Table.Header>
                  <Table.Column isRowHeader>Form</Table.Column>
                  <Table.Column>Fields</Table.Column>
                  <Table.Column>Version</Table.Column>
                  <Table.Column>Updated</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-16 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <ListUl className="size-6" />
                      </span>
                      <span className="text-sm font-medium">No forms yet</span>
                      <span className="max-w-sm text-sm text-muted">
                        Build an approval or review form once and use it from any human task.
                      </span>
                      {mayWrite && (
                        <Button className="mt-1" onPress={() => router.push('/newForm')}>
                          <Plus />
                          New form
                        </Button>
                      )}
                    </EmptyState>
                  )}
                >
                  {forms.map((form) => {
                    const fields = Object.keys(form.schema.properties ?? {});
                    return (
                      <Table.Row key={form.name} id={form.name} className="cursor-pointer">
                        <Table.Cell>
                          <div className="flex items-start gap-3 py-1">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                              <ListUl className="size-4" />
                            </span>
                            <div>
                              <p className="font-mono text-sm font-medium">{form.name}</p>
                              {form.description && <p className="text-sm text-muted">{form.description}</p>}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-sm">{fields.length}</span>{' '}
                          <span className="text-xs text-muted">({(form.schema.required ?? []).length} required)</span>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="secondary">
                            v{form.version}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm"><Ago value={form.createdAt} /></Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
    </>
  );
}
