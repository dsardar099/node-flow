'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Every event the execution stream emits, mirroring the store's `WorkflowEventType`. */
const STREAM_EVENT_TYPES = [
  'workflow.started',
  'workflow.completed',
  'workflow.failed',
  'workflow.paused',
  'workflow.resumed',
  'workflow.terminated',
  'workflow.retried',
  'workflow.rerun',
  'task.scheduled',
  'task.completed',
  'task.failed',
  'task.retried',
  'task.skipped',
  'task.timedOut',
  'variables.set',
  'event.published',
];

/**
 * Keeps an execution page current while it runs.
 *
 * **The stream says *when* to re-read, not *what* changed.** The page is
 * server-rendered and resolves payloads, applies tag access and formats
 * everything; a client that instead applied events to a local copy would be a
 * second implementation of all of that, and the two would drift — usually in
 * the direction of showing an operator something the server would not.
 * Re-fetching is a little more work per event and cannot be wrong.
 *
 * `EventSource` rather than a fetch loop, because it reconnects on its own and
 * replays `Last-Event-ID`, which the server answers from. That is the entire
 * reason the transport is SSE, and hand-rolling it would mean hand-rolling the
 * reconnect logic that is always subtly wrong.
 */
export function LiveUpdates({
  namespace,
  workflowId,
  terminal,
}: {
  namespace: string;
  workflowId: string;
  /** A finished execution never changes again; there is nothing to watch. */
  terminal: boolean;
}) {
  const router = useRouter();

  // Three states, not two. The page is server-rendered, so this component's
  // first HTML is produced before any connection has been attempted — and a
  // two-state flag renders that moment as "Reconnecting", which tells an
  // operator something is wrong at precisely the moment nothing is.
  const [state, setState] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (terminal) return;

    const source = new EventSource(`/v1/ns/${namespace}/executions/${workflowId}/stream`);

    // A burst — a fork scheduling twelve branches at once — is one refresh, not
    // twelve. Coalescing on a short timer keeps the page from stampeding its
    // own API during exactly the moments it is busiest.
    const refresh = () => {
      clearTimeout(pending.current);
      pending.current = setTimeout(() => router.refresh(), 150);
    };

    source.onopen = () => setState('live');

    // The server names every frame (`event: task.scheduled`), and a named frame
    // never reaches `onmessage` — relying on it meant the page refreshed only
    // when a workflow ended, never as its tasks moved. So each type is listened
    // for by name, and a slow poll backs that up: a type added to the server
    // later still shows up here, just less promptly.
    source.onmessage = refresh;
    STREAM_EVENT_TYPES.forEach((type) => source.addEventListener(type, refresh));
    const fallback = setInterval(refresh, 15_000);

    source.onerror = () => {
      // Not closed here. `EventSource` reconnects by itself, and the server
      // resumes from `Last-Event-ID`, so the right move is to let it — closing
      // would turn a momentary blip into a permanently stale page.
      setState('reconnecting');
    };

    return () => {
      clearTimeout(pending.current);
      clearInterval(fallback);
      source.close();
    };
  }, [namespace, workflowId, terminal, router]);

  if (terminal) return null;

  const label = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…' }[state];

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={state === 'live' ? 'Streaming updates as they happen' : label}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          state === 'live'
            ? 'animate-pulse bg-accent'
            : 'bg-muted'
        }`}
      />
      {label}
    </span>
  );
}
