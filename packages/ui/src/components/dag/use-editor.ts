'use client';

import type { TaskType, WorkflowTask } from '@node-flow-dev/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { blankTasks } from '../../lib/dag/catalog';
import {
  allRefs,
  insertTasks,
  pathOfRef,
  removeTask,
  taskPathOfIssue,
  type Definition,
  type InsertPoint,
} from '../../lib/dag/edit';
import { getIn, pathKey, type Path } from '../../lib/dag/path';
import { mutate } from '../../lib/mutate';

/**
 * The editor's state: the definition and its history, the selection, and the
 * server's verdict on the current definition.
 *
 * Three rules shape it.
 *
 * 1. **The definition is the only state.** The graph is rebuilt from it on
 *    every change and nothing about the picture is stored, so what you see and
 *    what you save cannot disagree.
 * 2. **The server decides what is valid**, using the same function registration
 *    runs. A second validator in the browser would be a second opinion, and the
 *    first time they differed the editor would be lying.
 * 3. **Saving always creates a version.** Definitions are immutable and
 *    executions are pinned to the version they started on, so an edit can never
 *    change what a running workflow does.
 */

interface History {
  past: Definition[];
  present: Definition;
  future: Definition[];
}

type HistoryAction =
  | { type: 'change'; next: Definition }
  | { type: 'reset'; to: Definition }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 200;

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'change':
      if (action.next === state.present) return state;
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.next,
        future: [],
      };
    case 'reset':
      return { past: [], present: action.to, future: [] };
    case 'undo':
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'redo':
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
  }
}

export interface Issue {
  message: string;
  path?: (string | number)[];
  taskReferenceName?: string;
}

export type Verdict =
  | { state: 'checking' }
  | { state: 'valid'; for: Definition; latestVersion?: number; taskCount: number }
  | { state: 'invalid'; for: Definition; latestVersion?: number; issues: Issue[] }
  | { state: 'unavailable'; message: string };

export function withoutVersion(definition: Definition & { version?: number }): Definition {
  const { version: _version, ...rest } = definition;
  return rest as Definition;
}

export function useEditor(namespace: string, initial: Definition, mode: 'new' | 'edit') {
  const [{ past, present, future }, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initial,
    future: [],
  });
  const change = useCallback((next: Definition) => dispatch({ type: 'change', next }), []);

  // Selection by reference, not path: paths shift when something is inserted
  // above; a reference follows the task.
  const [selectedRef, setSelectedRef] = useState<string>();
  const selectedPath = selectedRef ? pathOfRef(present, selectedRef) : undefined;
  const selectedTask = selectedPath ? (getIn(present, selectedPath) as WorkflowTask) : undefined;

  const [verdict, setVerdict] = useState<Verdict>({ state: 'checking' });
  const requestId = useRef(0);

  useEffect(() => {
    setVerdict({ state: 'checking' });
    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      try {
        const result = await mutate<{
          valid: boolean;
          issues: Issue[];
          latestVersion?: number;
          compiled?: { taskCount: number };
        }>(`/v1/ns/${namespace}/metadata/workflows/validate`, { body: present });

        // Only the newest request may set the verdict, or a slow check of an old
        // definition would mark the current one valid.
        if (id !== requestId.current) return;
        setVerdict(
          result.valid
            ? { state: 'valid', for: present, latestVersion: result.latestVersion, taskCount: result.compiled?.taskCount ?? 0 }
            : { state: 'invalid', for: present, latestVersion: result.latestVersion, issues: result.issues }
        );
      } catch (error) {
        if (id === requestId.current) setVerdict({ state: 'unavailable', message: (error as Error).message });
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [present, namespace]);

  const locate = useCallback(
    (issue: Issue): Path | undefined =>
      issue.path
        ? taskPathOfIssue(present, issue.path)
        : issue.taskReferenceName
          ? pathOfRef(present, issue.taskReferenceName)
          : undefined,
    [present]
  );

  const flagged = useMemo(() => {
    const keys = new Set<string>();
    if (verdict.state !== 'invalid') return keys;
    for (const issue of verdict.issues) {
      const path = locate(issue);
      if (path) keys.add(pathKey(path));
    }
    return keys;
  }, [verdict, locate]);

  const insert = useCallback(
    (type: TaskType, at: InsertPoint) => {
      const tasks = blankTasks(type, allRefs(present));
      change(insertTasks(present, at, tasks));
      setSelectedRef(tasks[0].taskReferenceName);
    },
    [present, change]
  );

  const remove = useCallback(
    (path: Path) => {
      change(removeTask(present, path));
      setSelectedRef(undefined);
    },
    [present, change]
  );

  const dirty = past.length > 0;

  // Keyboard: undo/redo, and delete the selected task — never while typing,
  // where the browser's own undo is the right one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPath) {
        event.preventDefault();
        remove(selectedPath);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPath, remove]);

  // Leaving with unsaved edits is almost always an accident.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const current = verdict.state === 'valid' || verdict.state === 'invalid' ? verdict : undefined;
  const nextVersion = current ? (current.latestVersion ?? 0) + 1 : undefined;
  const upToDate = current?.for === present;
  const nameClash = mode === 'new' && current?.latestVersion !== undefined;
  const canSave =
    verdict.state === 'valid' && upToDate && present.name.trim() !== '' && (dirty || mode === 'new');

  return {
    present,
    change,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    reset: (to: Definition) => dispatch({ type: 'reset', to }),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    historyStep: past.length - future.length,
    dirty,
    selectedRef,
    setSelectedRef,
    selectedPath,
    selectedTask,
    insert,
    remove,
    verdict,
    upToDate,
    flagged,
    locate,
    nextVersion,
    nameClash,
    canSave,
  };
}
