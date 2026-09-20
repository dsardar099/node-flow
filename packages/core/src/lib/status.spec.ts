import { describe, expect, it } from 'vitest';
import {
  isTaskRetryable,
  isTaskSuccessful,
  isTaskTerminal,
  isWorkflowTerminal,
  NON_TERMINAL_TASK_STATUSES,
  TaskStatus,
  WorkflowStatus,
} from './status.js';

describe('task status predicates', () => {
  it('classifies every status as terminal or not, with none left unclassified', () => {
    const all = Object.values(TaskStatus);
    const terminal = all.filter(isTaskTerminal);
    const nonTerminal = all.filter((s) => !isTaskTerminal(s));

    expect(terminal.length + nonTerminal.length).toBe(all.length);
    expect(nonTerminal).toEqual(
      expect.arrayContaining([TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS, TaskStatus.WAITING])
    );
  });

  it('keeps NON_TERMINAL_TASK_STATUSES in sync with isTaskTerminal', () => {
    // These two are used in different places — the constant drives the SQL
    // frontier query, the predicate drives engine branches. If they ever
    // disagree, the decider silently stops seeing some pending tasks.
    for (const status of Object.values(TaskStatus)) {
      expect(NON_TERMINAL_TASK_STATUSES.includes(status)).toBe(!isTaskTerminal(status));
    }
  });

  // SKIPPED must count as successful, or a SWITCH inside a FORK would deadlock
  // the JOIN forever: the untaken branch never completes, so the join never fires.
  it('treats SKIPPED as successful so untaken branches do not block a JOIN', () => {
    expect(isTaskSuccessful(TaskStatus.SKIPPED)).toBe(true);
    expect(isTaskTerminal(TaskStatus.SKIPPED)).toBe(true);
  });

  it('treats an optional task that failed as successful', () => {
    expect(isTaskSuccessful(TaskStatus.COMPLETED_WITH_ERRORS)).toBe(true);
  });

  it('does not treat failures or timeouts as successful', () => {
    expect(isTaskSuccessful(TaskStatus.FAILED)).toBe(false);
    expect(isTaskSuccessful(TaskStatus.TIMED_OUT)).toBe(false);
    expect(isTaskSuccessful(TaskStatus.CANCELED)).toBe(false);
  });

  // A worker returning FAILED_WITH_TERMINAL_ERROR is saying "this input will
  // never succeed" — honouring retryCount anyway would burn attempts for nothing.
  it('never retries a terminal error, however many attempts remain', () => {
    expect(isTaskRetryable(TaskStatus.FAILED_WITH_TERMINAL_ERROR)).toBe(false);
    expect(isTaskRetryable(TaskStatus.FAILED)).toBe(true);
    expect(isTaskRetryable(TaskStatus.TIMED_OUT)).toBe(true);
  });

  it('does not consider in-flight statuses retryable', () => {
    expect(isTaskRetryable(TaskStatus.SCHEDULED)).toBe(false);
    expect(isTaskRetryable(TaskStatus.IN_PROGRESS)).toBe(false);
    expect(isTaskRetryable(TaskStatus.COMPLETED)).toBe(false);
  });
});

describe('workflow status predicates', () => {
  it('treats RUNNING and PAUSED as live, everything else as terminal', () => {
    expect(isWorkflowTerminal(WorkflowStatus.RUNNING)).toBe(false);
    expect(isWorkflowTerminal(WorkflowStatus.PAUSED)).toBe(false);

    for (const s of [
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.TIMED_OUT,
      WorkflowStatus.TERMINATED,
    ]) {
      expect(isWorkflowTerminal(s)).toBe(true);
    }
  });
});
