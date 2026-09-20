'use client';

import { CircleCheck, CircleExclamation } from '@gravity-ui/icons';
import { Button, Chip, Label, ListBox, Modal, Select, Spinner, toast } from '@heroui/react';
import { useEffect, useState } from 'react';
import { mutate } from '../../../lib/mutate';

interface Divergence {
  kind: 'missing' | 'extra' | 'status' | 'input' | 'workflow-status' | 'workflow-output';
  refName?: string;
  message: string;
  recorded?: unknown;
  replayed?: unknown;
}

interface ReplayResult {
  matches: boolean;
  complete: boolean;
  recordedVersion: number;
  replayedVersion: number;
  divergences: Divergence[];
  replay: { status: string; tasks: { refName: string }[] };
}

const KIND_LABEL: Record<Divergence['kind'], string> = {
  missing: 'Not reached',
  extra: 'Would also run',
  status: 'Different result',
  input: 'Different input',
  'workflow-status': 'Different ending',
  'workflow-output': 'Different output',
};

/**
 * Replays a run through the engine with every task's recorded outcome, against
 * the version it used or another. The same version should match exactly; a
 * newer one shows what that change would have done to this run.
 */
export function ReplayDialog({
  namespace,
  workflowId,
  defName,
  defVersion,
  isOpen,
  onOpenChange,
}: {
  namespace: string;
  workflowId: string;
  defName: string;
  defVersion: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [versions, setVersions] = useState<number[]>([defVersion]);
  const [version, setVersion] = useState(defVersion);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplayResult>();

  useEffect(() => {
    if (!isOpen) return;
    setResult(undefined);
    setVersion(defVersion);
    fetch(`/v1/ns/${namespace}/metadata/workflows`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { name: string; version: number }[]) => {
        const found = rows.filter((r) => r.name === defName).map((r) => r.version);
        setVersions([...new Set([defVersion, ...found])].sort((a, b) => b - a));
      })
      .catch(() => undefined);
  }, [isOpen, namespace, defName, defVersion]);

  const run = async () => {
    setRunning(true);
    try {
      setResult(await mutate<ReplayResult>(`/v1/ns/${namespace}/executions/${workflowId}/replay`, { body: { version } }));
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-2xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Replay this run</Modal.Heading>
            <p className="text-sm text-muted">
              The engine runs it again in memory with every task&apos;s recorded outcome. Nothing is called, stored or published.
            </p>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <div className="flex items-end gap-3">
              <Select
                className="w-64"
                value={String(version)}
                onChange={(value) => {
                  if (value === null) return;
                  setVersion(Number(value));
                  setResult(undefined);
                }}
              >
                <Label>Against version</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {versions.map((v) => (
                      <ListBox.Item key={v} id={String(v)} textValue={`v${v}`}>
                        v{v}
                        {v === defVersion ? ' — this run' : ''}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button isPending={running} onPress={run}>
                {({ isPending }) => (isPending ? <Spinner size="sm" color="current" /> : 'Replay')}
              </Button>
            </div>

            {result &&
              (result.matches ? (
                <div className="flex items-start gap-3 rounded-xl bg-success-soft p-3 text-success">
                  <CircleCheck className="mt-0.5 size-5 shrink-0" />
                  <p className="text-sm">
                    {result.replayedVersion === result.recordedVersion
                      ? `Replayed exactly: all ${result.replay.tasks.length} task runs, their inputs and the ending match.`
                      : `v${result.replayedVersion} would have treated this run exactly as v${result.recordedVersion} did.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-xl bg-warning-soft p-3 text-warning">
                    <CircleExclamation className="mt-0.5 size-5 shrink-0" />
                    <p className="text-sm">
                      {result.divergences.length} difference{result.divergences.length === 1 ? '' : 's'}
                      {result.replayedVersion !== result.recordedVersion ? ` if this run had used v${result.replayedVersion}` : ''}.
                      {!result.complete && ' The run has not finished, so tasks it has not reached yet also show here.'}
                    </p>
                  </div>
                  <ul className="max-h-96 space-y-2 overflow-y-auto">
                    {result.divergences.map((d, i) => (
                      <li key={i} className="rounded-xl border border-separator p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip size="sm" variant="soft">
                            {KIND_LABEL[d.kind]}
                          </Chip>
                          {d.refName && <span className="font-mono text-xs font-medium">{d.refName}</span>}
                        </div>
                        <p className="mt-1 text-sm">{d.message}</p>
                        {(d.kind === 'input' || d.kind === 'workflow-output') && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <pre className="max-h-40 overflow-auto rounded-lg bg-default/60 p-2 font-mono text-[11px]">
                              <span className="text-muted">recorded </span>
                              {JSON.stringify(d.recorded, null, 2)}
                            </pre>
                            <pre className="max-h-40 overflow-auto rounded-lg bg-default/60 p-2 font-mono text-[11px]">
                              <span className="text-muted">replayed </span>
                              {JSON.stringify(d.replayed, null, 2)}
                            </pre>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
