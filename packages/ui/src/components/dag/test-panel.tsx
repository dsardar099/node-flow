'use client';

import { CircleCheck, CircleExclamation, Flask, TriangleExclamation } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Chip,
  Description,
  Disclosure,
  FieldError,
  Label,
  ListBox,
  Select,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import type { WorkflowTask } from '@node-flow-dev/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { walkTasks, type Definition } from '../../lib/dag/edit';
import { MutationError, mutate } from '../../lib/mutate';
import { JsonViewer } from '../ui/json-viewer';
import { StatusChip } from '../ui/status-chip';

/** Resolved by the engine itself: nothing to mock. */
const CONTROL_FLOW = new Set([
  'SWITCH', 'DO_WHILE', 'FORK_JOIN', 'FORK_JOIN_DYNAMIC', 'JOIN', 'EXCLUSIVE_JOIN', 'START_WORKFLOW',
  'TERMINATE', 'SET_VARIABLE', 'GET_WORKFLOW', 'NOOP', 'EVENT', 'KAFKA_PUBLISH',
]);
/** Pure computation, run for real unless switched off. */
const PURE = new Set(['INLINE', 'JSON_JQ_TRANSFORM', 'BUSINESS_RULE']);

type MockStatus = 'COMPLETED' | 'FAILED' | 'TIMED_OUT';

interface MockDraft {
  status: MockStatus;
  output: string;
  reason: string;
}

interface TestResult {
  status: string;
  output?: Record<string, unknown>;
  reasonForIncompletion?: string;
  tasks: { refName: string; taskType: string; status: string; attempt: number; iteration: number; input: unknown; output?: unknown; reason?: string; mocked: boolean }[];
  unmocked: string[];
  evaluations: number;
  durationMs: number;
}

/**
 * Test the workflow on the canvas — saved or not — with mocked task outcomes.
 *
 * Mocks default to "succeeds with {}" for every task that would reach outside,
 * so the first run needs no set-up at all and shows the path the workflow
 * takes; from there each mock is edited towards the case being tested. What
 * was entered is kept per workflow in this browser, since a test is usually
 * run many times while the definition is being fixed.
 */
export function TestPanel({ namespace, definition }: { namespace: string; definition: Definition }) {
  const storageKey = `nf.test.${definition.name || 'untitled'}`;
  const mockable = useMemo(() => {
    const tasks: WorkflowTask[] = [];
    walkTasks(definition, (task) => {
      if (!CONTROL_FLOW.has(task.type)) tasks.push(task);
    });
    return tasks;
  }, [definition]);

  const [input, setInput] = useState('{}');
  const [mocks, setMocks] = useState<Record<string, MockDraft>>({});
  const [runPure, setRunPure] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult>();
  const [problem, setProblem] = useState<string>();
  const [inputError, setInputError] = useState<string>();
  const resultsRef = useRef<HTMLDivElement>(null);
  // Results land below a long list of mocks; bring them into view rather than leave the run looking like it did nothing.
  useEffect(() => {
    if (result || problem) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result, problem]);

  useEffect(() => {
    let restored: { input?: string; mocks?: Record<string, MockDraft> } = {};
    try {
      restored = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      /* storage unavailable or corrupt — start fresh */
    }
    const params = definition.inputParameters as string[] | undefined;
    setInput(restored.input ?? JSON.stringify(Object.fromEntries((params ?? []).map((p) => [p, ''])), null, 2));
    setMocks(restored.mocks ?? {});
  }, [storageKey, definition.inputParameters]);

  const mockFor = (ref: string): MockDraft => mocks[ref] ?? { status: 'COMPLETED', output: '{}', reason: '' };
  const updateMock = (ref: string, change: Partial<MockDraft>) => setMocks((all) => ({ ...all, [ref]: { ...mockFor(ref), ...change } }));

  const run = async () => {
    setProblem(undefined);
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(input || '{}');
      if (parsedInput === null || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) throw new Error();
    } catch {
      setInputError('Input must be a JSON object.');
      return;
    }
    setInputError(undefined);

    const body: Record<string, unknown> = {};
    for (const task of mockable) {
      if (runPure && PURE.has(task.type)) continue;
      const draft = mocks[task.taskReferenceName];
      if (!draft) continue;
      let output: unknown = {};
      try {
        output = JSON.parse(draft.output || '{}');
      } catch {
        setProblem(`The output mocked for ${task.taskReferenceName} is not valid JSON.`);
        return;
      }
      body[task.taskReferenceName] =
        draft.status === 'COMPLETED' ? { status: 'COMPLETED', output } : { status: draft.status, reason: draft.reason || undefined, output };
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify({ input, mocks }));
    } catch {
      /* storage unavailable — the test still runs */
    }

    setRunning(true);
    try {
      setResult(
        await mutate<TestResult>(`/v1/ns/${namespace}/metadata/workflows/test`, {
          body: { definition, input: parsedInput, mocks: body, runPureTasks: runPure },
        })
      );
    } catch (failure) {
      setResult(undefined);
      setProblem(failure instanceof MutationError ? failure.message : String(failure));
      if (!(failure instanceof MutationError)) toast.danger(String(failure));
    } finally {
      setRunning(false);
    }
  };

  const verdict =
    result?.status === 'COMPLETED'
      ? { status: 'success' as const, icon: CircleCheck, title: 'Completed' }
      : result?.status === 'STUCK'
        ? { status: 'warning' as const, icon: TriangleExclamation, title: 'Would not finish' }
        : { status: 'danger' as const, icon: CircleExclamation, title: result ? `Ended ${result.status.toLowerCase().replace('_', ' ')}` : '' };

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-xl bg-surface-secondary px-3 py-2.5 text-sm text-muted">
        <Flask className="mt-0.5 size-4 shrink-0" />
        Runs this definition — saved or not — through the real engine. Tasks that reach outside use the outcomes below;
        nothing is started, sent or stored.
      </p>

      <TextField value={input} onChange={setInput} isInvalid={Boolean(inputError)}>
        <Label>Workflow input</Label>
        <TextArea rows={5} spellCheck={false} className="font-mono text-xs" />
        <FieldError>{inputError}</FieldError>
      </TextField>

      <Switch isSelected={runPure} onChange={setRunPure}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>Run scripts and transforms for real</Label>
        </Switch.Content>
        <Description>INLINE, JQ and business rules compute rather than being mocked.</Description>
      </Switch>

      <div className="space-y-2">
        <p className="text-sm font-medium">Task outcomes</p>
        {mockable.filter((t) => !(runPure && PURE.has(t.type))).length === 0 && (
          <p className="text-sm text-muted">Nothing here reaches outside the engine; there is nothing to mock.</p>
        )}
        {mockable
          .filter((t) => !(runPure && PURE.has(t.type)))
          .map((task) => {
            const mock = mockFor(task.taskReferenceName);
            return (
              <Disclosure key={task.taskReferenceName} className="rounded-xl border border-separator">
                <Disclosure.Heading>
                  <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{task.taskReferenceName}</span>
                    <Chip size="sm" variant="secondary" className="font-mono text-[10px]">
                      {task.type}
                    </Chip>
                    <StatusChip status={mock.status} />
                    <Disclosure.Indicator />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                <Disclosure.Content>
                  <Disclosure.Body className="space-y-3 px-3 pb-3">
                    <Select value={mock.status} onChange={(value) => value && updateMock(task.taskReferenceName, { status: value as MockStatus })}>
                      <Label>Outcome</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {(['COMPLETED', 'FAILED', 'TIMED_OUT'] as const).map((s) => (
                            <ListBox.Item key={s} id={s} textValue={s}>
                              {s === 'COMPLETED' ? 'Succeeds' : s === 'FAILED' ? 'Fails' : 'Times out'}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {mock.status !== 'COMPLETED' && (
                      <TextField value={mock.reason} onChange={(reason) => updateMock(task.taskReferenceName, { reason })}>
                        <Label>Reason</Label>
                        <TextArea rows={1} />
                      </TextField>
                    )}
                    <TextField value={mock.output} onChange={(output) => updateMock(task.taskReferenceName, { output })}>
                      <Label>Output</Label>
                      <TextArea rows={3} spellCheck={false} className="font-mono text-xs" />
                    </TextField>
                  </Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>
            );
          })}
      </div>

      <Button fullWidth isPending={running} onPress={run}>
        <Flask />
        Run test
      </Button>

      <div ref={resultsRef} className="scroll-mt-4" />

      {problem && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not run the test</Alert.Title>
            <Alert.Description>{problem}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {result && (
        <div className="space-y-4">
          <Alert status={verdict.status}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{verdict.title}</Alert.Title>
              <Alert.Description>
                {result.reasonForIncompletion ?? `${result.tasks.length} tasks in ${result.durationMs} ms`}
              </Alert.Description>
            </Alert.Content>
          </Alert>

          {result.unmocked.length > 0 && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              Defaulted to success with an empty output: <span className="font-mono">{result.unmocked.join(', ')}</span>
            </p>
          )}

          {result.output && <JsonViewer title="Workflow output" value={result.output} filename="test-output" maxHeight="16rem" />}

          <div>
            <p className="mb-2 text-sm font-medium">Path taken</p>
            <ol className="space-y-1.5">
              {result.tasks.map((task, index) => (
                <li key={`${task.refName}-${task.iteration}-${task.attempt}-${index}`}>
                  <Disclosure className="rounded-xl border border-separator">
                    <Disclosure.Heading>
                      <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
                        <span className="tabular w-5 text-xs text-muted">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">
                          {task.refName}
                          {task.iteration > 0 && <span className="text-muted"> · pass {task.iteration}</span>}
                          {task.attempt > 0 && <span className="text-muted"> · retry {task.attempt}</span>}
                        </span>
                        {task.status !== 'SKIPPED' && !CONTROL_FLOW.has(task.taskType) && (
                          <Chip size="sm" variant="soft" color={task.mocked ? 'default' : result.unmocked.includes(task.refName) ? 'warning' : 'accent'}>
                            {task.mocked ? 'mocked' : result.unmocked.includes(task.refName) ? 'default' : 'real'}
                          </Chip>
                        )}
                        <StatusChip status={task.status} />
                        <Disclosure.Indicator />
                      </Disclosure.Trigger>
                    </Disclosure.Heading>
                    <Disclosure.Content>
                      <Disclosure.Body className="grid gap-2 px-3 pb-3">
                        {task.reason && <p className="text-sm text-danger">{task.reason}</p>}
                        <JsonViewer title="Input" value={task.input} filename={`${task.refName}-input`} maxHeight="12rem" toolbar={false} />
                        <JsonViewer title="Output" value={task.output} filename={`${task.refName}-output`} maxHeight="12rem" toolbar={false} />
                      </Disclosure.Body>
                    </Disclosure.Content>
                  </Disclosure>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
