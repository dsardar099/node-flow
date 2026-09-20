'use client';
import { CommentDot, Plus } from '@gravity-ui/icons';
import { Button, Card, Chip, EmptyState, Table } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../../components/shell/page-header';
import { Ago } from '../../../components/ui/ago';
export interface PromptSummary {
  name: string;
  version: number;
  versions: number;
  description: string | null;
  variables: string[];
  createdAt: string;
  createdBy: string | null;
}
/** Prompts, latest version first; a row opens the studio. */
export function PromptList({ prompts, mayWrite }: { prompts: PromptSummary[]; mayWrite: boolean }) {
  const router = useRouter();
  const open = (name: string) => router.push(`/ai/prompts/${encodeURIComponent(name)}`);
  return (
    <>
      <PageHeader
        title="Prompts"
        description="Templates with ${variables} that LLM and agent tasks use by name. Every save is a new version, so a run records exactly what it sent."
        actions={
          mayWrite && (
            <Button onPress={() => router.push('/ai/prompts/new')}>
              <Plus />
              New prompt
            </Button>
          )
        }
      />
      <div className="px-4 pb-10 md:px-8">
        <Card className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Prompts" className="min-w-[640px]" onRowAction={(key) => open(String(key))}>
                <Table.Header>
                  <Table.Column isRowHeader>Prompt</Table.Column>
                  <Table.Column>Variables</Table.Column>
                  <Table.Column>Version</Table.Column>
                  <Table.Column>Saved</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex flex-col items-center gap-3 py-14 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        <CommentDot className="size-6" />
                      </span>
                      <span className="text-sm font-medium">No prompts yet</span>
                      <span className="max-w-sm text-sm text-muted">Keep wording out of definitions, try it against a model, and change it without redeploying workflows.</span>
                    </EmptyState>
                  )}
                >
                  {prompts.map((prompt) => (
                    <Table.Row key={prompt.name} id={prompt.name} className="cursor-pointer">
                      <Table.Cell>
                        <span className="font-mono text-sm font-medium">{prompt.name}</span>
                        {prompt.description && <p className="text-xs text-muted">{prompt.description}</p>}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-wrap gap-1">
                          {prompt.variables.length ? (
                            prompt.variables.map((v) => (
                              <Chip key={v} size="sm" variant="soft" className="font-mono">
                                {v}
                              </Chip>
                            ))
                          ) : (
                            <span className="text-sm text-muted">None</span>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm">
                        v{prompt.version}
                        <span className="text-muted"> of {prompt.versions}</span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm">
                        <Ago value={prompt.createdAt} />
                        {prompt.createdBy && <span className="block text-xs text-muted">{prompt.createdBy}</span>}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>
    </>
  );
}
