'use client';
import { Database, Plus } from '@gravity-ui/icons';
import { Button, Card, Chip, EmptyState, Table } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import type { Integration } from '../integrations/integrations-admin';
import { DocumentDrawer } from './document-drawer';
import { Ago } from '../../../components/ui/ago';
export interface VectorIndex {
  indexName: string;
  documents: number;
  chunks: number;
  dimensions: number;
  models: string[];
  updatedAt: string;
}
export function IndexList({
  namespace,
  indexes,
  pgvector,
  integrations,
  mayWrite,
}: {
  namespace: string;
  indexes: VectorIndex[];
  pgvector: boolean;
  integrations: Integration[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Vector indexes"
        description="Embedded documents that search and agent tasks retrieve from, stored in Postgres."
        badge={
          <Chip size="sm" variant="soft" color={pgvector ? 'success' : 'default'}>
            {pgvector ? 'pgvector' : 'SQL similarity'}
          </Chip>
        }
        actions={
          mayWrite && (
            <Button onPress={() => setCreating(true)}>
              <Plus />
              New index
            </Button>
          )
        }
      />
      <div className="px-4 pb-10 md:px-8">
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Vector indexes" className="min-w-[640px]" onRowAction={(key) => router.push(`/ai/indexes/${encodeURIComponent(String(key))}`)}>
                <Table.Header>
                  <Table.Column isRowHeader>Index</Table.Column>
                  <Table.Column>Documents</Table.Column>
                  <Table.Column>Chunks</Table.Column>
                  <Table.Column>Embedding</Table.Column>
                  <Table.Column>Updated</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <Database className="size-6" />
                      </span>
                      <span className="text-sm font-medium">No indexes yet</span>
                      <span className="max-w-sm text-sm text-muted">
                        Add documents here, or from a workflow with an Index text task, then search them with Search index or give them to an agent.
                      </span>
                    </EmptyState>
                  )}
                >
                  {indexes.map((index) => (
                    <Table.Row key={index.indexName} id={index.indexName} className="cursor-pointer">
                      <Table.Cell>
                        <span className="font-mono text-sm font-medium">{index.indexName}</span>
                      </Table.Cell>
                      <Table.Cell className="text-sm">{index.documents}</Table.Cell>
                      <Table.Cell className="text-sm">{index.chunks}</Table.Cell>
                      <Table.Cell className="text-sm">
                        <span className="font-mono text-xs">{index.models.join(', ') || '—'}</span>
                        <span className="block text-xs text-muted">{index.dimensions} dimensions</span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm"><Ago value={index.updatedAt} /></Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
      <DocumentDrawer namespace={namespace} integrations={integrations} isOpen={creating} onOpenChange={setCreating} />
    </>
  );
}
