import { describe, expect, it } from 'vitest';
import type { Definition } from './edit';
import { comparable, describeChanges, diffLines, hunks } from './diff';

const def = (tasks: unknown[], extra: Record<string, unknown> = {}) => ({ name: 'wf', version: 1, tasks, ...extra }) as unknown as Definition;
const simple = (ref: string, extra: Record<string, unknown> = {}) => ({ name: ref, taskReferenceName: ref, type: 'SIMPLE', ...extra });

describe('diffLines', () => {
  it('keeps common lines and marks only what changed', () => {
    const lines = diffLines('a\nb\nc\nd', 'a\nc\nx\nd');
    expect(lines.map((l) => `${l.kind[0]}${l.text}`)).toEqual(['sa', 'rb', 'sc', 'ax', 'sd']);
    const added = lines.find((l) => l.text === 'x');
    expect(added?.newLine).toBe(3);
    expect(added?.oldLine).toBeUndefined();
  });

  it('reports identical text as all unchanged, and groups changes into hunks with context', () => {
    expect(hunks(diffLines('a\nb', 'a\nb'))).toEqual([]);
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const changed = [...text];
    changed[2] = 'first change';
    changed[17] = 'second change';
    const grouped = hunks(diffLines(text.join('\n'), changed.join('\n')), 2);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].lines.some((l) => l.text === 'first change')).toBe(true);
  });
});

describe('describeChanges', () => {
  it('names added, removed and changed tasks — including nested ones — and settings', () => {
    const before = def([simple('charge', { inputParameters: { amount: 1 } }), simple('email')], { timeoutSeconds: 60 });
    const after = def(
      [
        simple('charge', { inputParameters: { amount: 2 } }),
        { name: 'route', taskReferenceName: 'route', type: 'SWITCH', decisionCases: { vip: [simple('concierge')] }, defaultCase: [] },
      ],
      { timeoutSeconds: 120, version: 2 }
    );

    const changes = describeChanges(before, after);
    expect(changes.tasks).toEqual(
      expect.arrayContaining([
        { ref: 'charge', kind: 'changed', type: 'SIMPLE', fields: ['inputParameters'] },
        { ref: 'route', kind: 'added', type: 'SWITCH' },
        { ref: 'concierge', kind: 'added', type: 'SIMPLE' },
        { ref: 'email', kind: 'removed', type: 'SIMPLE' },
      ])
    );
    expect(changes.settings).toEqual(['timeoutSeconds']);
  });

  it('treats key order as no change, and a nested task change as that task’s change only', () => {
    const inner = (retries: number) => def([{ name: 'loop', taskReferenceName: 'loop', type: 'DO_WHILE', loopCondition: 'true', loopOver: [simple('body', { retryCount: retries })] }]);
    expect(describeChanges(inner(1), inner(2)).tasks).toEqual([{ ref: 'body', kind: 'changed', type: 'SIMPLE', fields: ['retryCount'] }]);

    const a = def([{ taskReferenceName: 'x', name: 'x', type: 'SIMPLE' }]);
    const b = def([{ type: 'SIMPLE', name: 'x', taskReferenceName: 'x' }]);
    expect(describeChanges(a, b)).toEqual({ tasks: [], settings: [] });
    expect(comparable(a)).toBe(comparable(b));
  });
});
