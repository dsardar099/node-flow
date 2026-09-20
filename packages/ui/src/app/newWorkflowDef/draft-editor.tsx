'use client';

import { useEffect, useState } from 'react';
import { WorkflowEditor } from '../../components/dag/workflow-editor';
import type { Definition } from '../../lib/dag/edit';

/** Where the BPMN import leaves a draft for this page to pick up. */
export const DRAFT_KEY = 'nf.draft';

/**
 * Opens the editor on a draft the browser is holding.
 *
 * The draft comes from the BPMN import, which runs on the server and hands back
 * a definition rather than saving one. Session storage carries it because a
 * definition of any size does not fit in a query string, and a draft has no
 * business in browser history — a reload should not silently resurrect one
 * somebody abandoned.
 *
 * Read once and then removed, so "back" lands on a blank editor rather than the
 * same import again. A missing draft falls back to `fallback`, which is what
 * happens when someone bookmarks this URL.
 */
export function DraftEditor({ namespace, fallback }: { namespace: string; fallback: Definition }) {
  const [initial, setInitial] = useState<Definition>();

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
      setInitial(stored ? (JSON.parse(stored) as Definition) : fallback);
    } catch {
      setInitial(fallback);
    }
    // Deliberately once, on mount: re-running would re-read a key that has
    // already been cleared and replace whatever the user has since typed.
  }, []);

  // Nothing is rendered until the draft is read, so the editor never mounts
  // with the blank definition and then swaps under the user's cursor.
  if (!initial) return null;

  return <WorkflowEditor namespace={namespace} mode="new" initial={initial} mayStart={false} />;
}
