'use client';

import {
  ArrowRotateLeft,
  CircleCheckFill,
  CircleInfo,
  CirclePause,
  CirclePlay,
  CircleStop,
  CircleXmarkFill,
  Clock,
  Flag,
  Tag,
  Thunderbolt,
} from '@gravity-ui/icons';
import { Button, Card, Disclosure, Link, Spinner } from '@heroui/react';
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { JsonViewer } from '../../../components/ui/json-viewer';
import { LocalTime } from '../../../components/ui/local-time';
import { fetchJson } from '../../../lib/fetch-json';
import type { ExecutionDetail } from './types';

interface HistoryEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const LOOK: Record<string, { icon: Icon; tone: string; title: (p: Record<string, unknown>) => string }> = {
  'workflow.started': { icon: Flag, tone: 'text-accent', title: () => 'Workflow started' },
  'workflow.completed': { icon: CircleCheckFill, tone: 'text-success', title: () => 'Workflow completed' },
  'workflow.failed': { icon: CircleXmarkFill, tone: 'text-danger', title: () => 'Workflow failed' },
  'workflow.paused': { icon: CirclePause, tone: 'text-warning', title: (p) => `Paused${by(p)}` },
  'workflow.resumed': { icon: CirclePlay, tone: 'text-accent', title: (p) => `Resumed${by(p)}` },
  'workflow.terminated': { icon: CircleStop, tone: 'text-danger', title: (p) => `Terminated${by(p)}` },
  'workflow.retried': { icon: ArrowRotateLeft, tone: 'text-accent', title: (p) => `Retried${by(p)}` },
  'workflow.rerun': { icon: ArrowRotateLeft, tone: 'text-accent', title: (p) => `Re-run from ${String(p.fromTaskRef ?? 'a task')}${by(p)}` },
  'task.scheduled': { icon: Clock, tone: 'text-muted', title: (p) => `Scheduled ${String(p.refName)}` },
  'task.completed': { icon: CircleCheckFill, tone: 'text-success', title: (p) => `${String(p.refName)} completed` },
  'task.failed': { icon: CircleXmarkFill, tone: 'text-danger', title: (p) => `${String(p.refName)} failed` },
  'task.timedOut': { icon: CircleXmarkFill, tone: 'text-danger', title: (p) => `${String(p.refName)} timed out` },
  'task.retried': { icon: ArrowRotateLeft, tone: 'text-warning', title: (p) => `Retrying ${String(p.refName)}` },
  'task.skipped': { icon: CircleInfo, tone: 'text-muted', title: (p) => `Skipped ${String(p.refName)}` },
  'variables.set': { icon: Tag, tone: 'text-accent', title: () => 'Variables set' },
  'event.published': { icon: Thunderbolt, tone: 'text-accent', title: () => 'Event published' },
};

function by(payload: Record<string, unknown>): string {
  return typeof payload.by === 'string' && payload.by ? ` by ${payload.by}` : '';
}

/**
 * What happened, in order — including what people did.
 *
 * The task list answers "what state is each task in"; this answers "how did it
 * get here", which after an incident is the more useful question: who paused
 * it, when the retry happened, what the decider scheduled next.
 */
export function EventsTab({
  namespace,
  execution,
  onOpenTask,
}: {
  namespace: string;
  execution: ExecutionDetail;
  onOpenTask: (ref: string) => void;
}) {
  const [events, setEvents] = useState<HistoryEvent[]>();
  const [error, setError] = useState<string>();

  // Re-read whenever the execution the page shows has moved on.
  const version = `${execution.status}:${execution.tasks.length}:${execution.tasks.map((t) => t.status).join('')}`;
  useEffect(() => {
    let cancelled = false;
    fetchJson<HistoryEvent[]>(`/v1/ns/${namespace}/executions/${execution.id}/history`)
      .then((rows) => !cancelled && setEvents(rows))
      .catch((failure) => !cancelled && setError((failure as Error).message));
    return () => {
      cancelled = true;
    };
  }, [namespace, execution.id, version]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!events) return <Spinner className="mx-auto my-10 block" />;

  return (
    <Card>
      <Card.Header>
        <Card.Title>Events</Card.Title>
        <Card.Description>{events.length} recorded, oldest first</Card.Description>
      </Card.Header>
      <Card.Content>
        <ol className="relative ml-3 border-l border-separator">
          {events.map((event) => {
            const look = LOOK[event.type] ?? { icon: CircleInfo, tone: 'text-muted', title: () => event.type };
            const Icon = look.icon;
            const ref = typeof event.payload.refName === 'string' ? event.payload.refName : undefined;
            const hasDetail = Object.keys(event.payload).length > 0;

            return (
              <li key={event.seq} className="relative pb-4 pl-6 last:pb-0">
                <span className={`absolute -left-[9px] top-0.5 grid size-[18px] place-items-center rounded-full bg-surface ${look.tone}`}>
                  <Icon className="size-4" />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="text-sm font-medium">
                    {look.title(event.payload)}
                    {ref && (
                      <Link className="ml-2 text-xs text-accent" onPress={() => onOpenTask(ref)}>
                        Open task
                      </Link>
                    )}
                  </p>
                  <span className="tabular text-xs text-muted">
                    #{event.seq} · <LocalTime value={event.at} />
                  </span>
                </div>
                {typeof event.payload.reason === 'string' && (
                  <p className="mt-0.5 text-sm text-muted">{event.payload.reason}</p>
                )}
                {hasDetail && (
                  <Disclosure>
                    <Disclosure.Heading>
                      <Disclosure.Trigger>
                        <Button size="sm" variant="ghost" className="mt-1 h-6 px-1.5 text-xs text-muted">
                          Details
                        </Button>
                      </Disclosure.Trigger>
                    </Disclosure.Heading>
                    <Disclosure.Content>
                      <div className="mt-2">
                        <JsonViewer value={event.payload} toolbar={false} maxHeight="16rem" />
                      </div>
                    </Disclosure.Content>
                  </Disclosure>
                )}
              </li>
            );
          })}
        </ol>
      </Card.Content>
    </Card>
  );
}
