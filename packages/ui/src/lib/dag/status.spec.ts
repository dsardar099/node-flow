import { describe, expect, it } from 'vitest';
import { momentsOf, statusesAt } from './status';

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const t = (s: number) => Date.parse(at(s));

describe('time travel', () => {
  // charge failed once, was retried and succeeded; ship ran after it.
  const tasks = [
    { refName: 'charge', status: 'FAILED', iteration: 0, attempt: 0, scheduledAt: at(0), startedAt: at(1), endedAt: at(2) },
    { refName: 'charge', status: 'COMPLETED', iteration: 0, attempt: 1, scheduledAt: at(3), startedAt: at(4), endedAt: at(5) },
    { refName: 'ship', status: 'COMPLETED', iteration: 0, attempt: 0, scheduledAt: at(5), startedAt: null, endedAt: at(8) },
  ];

  it('shows each task as it stood at that instant', () => {
    expect(statusesAt(tasks, t(0))).toEqual({ charge: 'SCHEDULED' });
    expect(statusesAt(tasks, t(1))).toEqual({ charge: 'IN_PROGRESS' });
    expect(statusesAt(tasks, t(2))).toEqual({ charge: 'FAILED' });
    // The retry exists but has not started: the node shows the newest attempt, waiting.
    expect(statusesAt(tasks, t(3))).toEqual({ charge: 'SCHEDULED' });
    // A task that never recorded a start is waiting until it ends.
    expect(statusesAt(tasks, t(6))).toEqual({ charge: 'COMPLETED', ship: 'SCHEDULED' });
    expect(statusesAt(tasks, t(9))).toEqual({ charge: 'COMPLETED', ship: 'COMPLETED' });
  });

  it('nothing has happened before the run started', () => {
    expect(statusesAt(tasks, t(0) - 1)).toEqual({});
  });

  it('steps through every distinct change once, in order', () => {
    expect(momentsOf(tasks, at(0), at(9)).map((m) => (m - t(0)) / 1000)).toEqual([0, 1, 2, 3, 4, 5, 8, 9]);
  });
});
