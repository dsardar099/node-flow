'use client';

import type { TaskType } from '@node-flow-dev/core';
import { Description, Header, Label, ListBox, SearchField } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, type Category } from '../../lib/dag/catalog';

const ORDER: Category[] = ['Workers', 'Flow control', 'Data', 'Integrations', 'AI', 'People and time'];

/**
 * Choosing what to insert.
 *
 * Joins are not offered: a join only means something immediately after a fork,
 * and "Parallel branches" inserts the pair. A bare join is a way to build what
 * the compiler will refuse.
 *
 * Positioned at the "+" that opened it rather than as an anchored popover: the
 * anchor lives inside the canvas's own transformed layer, which moves as the
 * canvas pans and zooms.
 */
export function Palette({
  anchor,
  onPick,
  onClose,
}: {
  anchor: { x: number; y: number };
  onPick: (type: TaskType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focused a tick after opening, not with autoFocus: the palette opens on the
    // mousedown of a "+" button, and the browser then focuses that button as
    // part of the same click, taking focus back from the search box.
    const focus = setTimeout(() => panel.current?.querySelector('input')?.focus(), 0);

    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onDown = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Armed a tick late: the mousedown that opened the palette would otherwise
    // arrive here, land outside the panel and close it at once.
    const armed = setTimeout(() => window.addEventListener('mousedown', onDown), 0);

    return () => {
      clearTimeout(focus);
      clearTimeout(armed);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = (Object.entries(CATALOG) as [TaskType, (typeof CATALOG)[TaskType]][]).filter(
      ([type, entry]) =>
        !entry.companion &&
        (needle === '' ||
          entry.label.toLowerCase().includes(needle) ||
          type.toLowerCase().includes(needle) ||
          entry.summary.toLowerCase().includes(needle))
    );
    return ORDER.map((category) => ({
      category,
      entries: entries.filter(([, entry]) => entry.category === category),
    })).filter((group) => group.entries.length > 0);
  }, [query]);

  const left = Math.min(Math.max(8, anchor.x - 180), window.innerWidth - 368);
  const top = Math.max(8, Math.min(anchor.y + 6, window.innerHeight - 468));

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Add a task"
      className="fixed z-50 flex max-h-[460px] w-[360px] flex-col rounded-xl border border-border bg-surface p-2 shadow-xl"
      style={{ left, top }}
    >
      <SearchField
        aria-label="Search task types"
        value={query}
        onChange={setQuery}
        onSubmit={() => groups[0] && onPick(groups[0].entries[0][0])}
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search task types" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <ListBox
        aria-label="Task types"
        selectionMode="none"
        className="mt-2 overflow-y-auto"
        onAction={(key) => onPick(key as TaskType)}
        renderEmptyState={() => <p className="px-3 py-4 text-sm text-muted">Nothing matches.</p>}
      >
        {groups.map(({ category, entries }) => (
          <ListBox.Section key={category}>
            <Header>{category}</Header>
            {entries.map(([type, entry]) => (
              <ListBox.Item key={type} id={type} textValue={entry.label}>
                <Label>{entry.label}</Label>
                <Description>{entry.summary}</Description>
              </ListBox.Item>
            ))}
          </ListBox.Section>
        ))}
      </ListBox>
    </div>
  );
}
