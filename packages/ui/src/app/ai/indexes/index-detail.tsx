'use client';

import { Magnifier, Plus, TrashBin } from '@gravity-ui/icons';
import { AlertDialog, Button, Card, Chip, Input, Label, Spinner, TextField, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shell/page-header';
import { mutate } from '../../../lib/mutate';
import type { Integration } from '../integrations/integrations-admin';
import { DocumentDrawer, EmbeddingPicker, defaultEmbeddingModel } from './document-drawer';
import type { VectorIndex } from './index-list';

export interface Chunk {
  docId: string;
  chunk: number;
  text: string;
  metadata: Record<string, unknown>;
  model: string | null;
  createdAt: string;
}

interface Match {
  docId: string;
  chunk: number;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * One index: try a search, add documents, remove them.
 *
 * Searching here runs the same executor as a Search index task, with the model
 * the index was built with preselected — a different model would be refused
 * for its dimensions, which is the right outcome but a poor first experience.
 */
export function IndexDetail({
  namespace,
  index,
  summary,
  chunks,
  integrations,
  mayWrite,
}: {
  namespace: string;
  index: string;
  summary?: VectorIndex;
  chunks: Chunk[];
  integrations: Integration[];
  mayWrite: boolean;
}) {
  const router = useRouter();
  const builtWith = summary?.models[0];
  const initial =
    integrations.find((i) => (builtWith ? i.models.includes(builtWith) : i.models.some((m) => /embed/i.test(m)))) ?? integrations[0];
  const [provider, setProvider] = useState(initial?.name ?? '');
  const [model, setModel] = useState(builtWith ?? defaultEmbeddingModel(initial));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Match[]>();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string>();

  const documents = useMemo(() => {
    const byDoc = new Map<string, Chunk[]>();
    for (const chunk of chunks) byDoc.set(chunk.docId, [...(byDoc.get(chunk.docId) ?? []), chunk]);
    return [...byDoc.entries()];
  }, [chunks]);

  const search = async () => {
    setSearching(true);
    try {
      const result = await mutate<{ ok: boolean; reason?: string; output?: { result: Match[] } }>(`/v1/ns/${namespace}/vector-indexes/${encodeURIComponent(index)}/search`, {
        body: { llmProvider: provider, ...(model ? { embeddingModel: model } : {}), query, topK: 5 },
      });
      if (!result.ok) {
        toast.danger(result.reason ?? 'Search failed');
        setMatches(undefined);
      } else setMatches(result.output?.result ?? []);
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const removeDocument = async (docId: string) => {
    try {
      await mutate(`/v1/ns/${namespace}/vector-indexes/${encodeURIComponent(index)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
      toast.success(`Removed ${docId}`);
      if (documents.length <= 1) router.push('/ai/indexes');
      else router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title={index}
        breadcrumbs={[{ label: 'Vector indexes', href: '/ai/indexes' }, { label: index }]}
        description={summary ? `${summary.documents} document${summary.documents === 1 ? '' : 's'} in ${summary.chunks} chunk${summary.chunks === 1 ? '' : 's'} · ${summary.dimensions}-dimension ${summary.models.join(', ')} embeddings` : 'This index is empty.'}
        actions={
          mayWrite && (
            <Button onPress={() => setAdding(true)}>
              <Plus />
              Add document
            </Button>
          )
        }
      />
      <div className="grid gap-4 px-4 pb-10 md:px-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card className="h-fit gap-4 p-5">
          <h2 className="text-sm font-semibold">Search</h2>
          {integrations.length === 0 ? (
            <p className="text-sm text-muted">Connect a model provider under Integrations to search.</p>
          ) : (
            <>
              <EmbeddingPicker integrations={integrations} provider={provider} model={model} onChange={(p, m) => { setProvider(p); setModel(m); }} />
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (query.trim()) void search();
                }}
              >
                <TextField value={query} onChange={setQuery} className="flex-1">
                  <Label>Query</Label>
                  <Input placeholder="How long do refunds take?" />
                </TextField>
                <Button type="submit" isIconOnly aria-label="Search" isDisabled={!query.trim()} isPending={searching}>
                  {({ isPending }) => (isPending ? <Spinner size="sm" color="current" /> : <Magnifier />)}
                </Button>
              </form>
              {matches && (
                <ol className="space-y-2">
                  {matches.length === 0 && <li className="text-sm text-muted">Nothing matched.</li>}
                  {matches.map((match) => (
                    <li key={`${match.docId}:${match.chunk}`} className="rounded-xl border border-separator p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">{match.docId}</span>
                        <span className="text-xs text-muted">#{match.chunk}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted">{match.score.toFixed(3)}</span>
                      </div>
                      <div className="mb-2 h-1 overflow-hidden rounded-full bg-default">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, match.score)) * 100}%` }} />
                      </div>
                      <p className="line-clamp-4 text-sm">{match.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Card>

        <div className="space-y-3">
          {documents.map(([docId, docChunks]) => (
            <Card key={docId} className="gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{docId}</span>
                <Chip size="sm" variant="soft">
                  {docChunks.length} chunk{docChunks.length === 1 ? '' : 's'}
                </Chip>
                {Object.keys(docChunks[0].metadata ?? {}).length > 0 && <span className="truncate font-mono text-xs text-muted">{JSON.stringify(docChunks[0].metadata)}</span>}
                {mayWrite && (
                  <Button isIconOnly size="sm" variant="ghost" className="ml-auto text-danger" aria-label={`Remove ${docId}`} onPress={() => setDeleting(docId)}>
                    <TrashBin />
                  </Button>
                )}
              </div>
              <p className="line-clamp-3 text-sm text-muted">{docChunks.map((c) => c.text).join(' … ')}</p>
            </Card>
          ))}
        </div>
      </div>

      <DocumentDrawer namespace={namespace} index={index} integrations={integrations} preferredModel={builtWith} isOpen={adding} onOpenChange={setAdding} />

      <AlertDialog.Backdrop isOpen={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Remove {deleting}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Its chunks are deleted from the index; searches stop returning them at once.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button
                slot="close"
                variant="danger"
                onPress={() => {
                  if (deleting) void removeDocument(deleting);
                }}
              >
                Remove
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
