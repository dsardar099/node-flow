'use client';

import { Checkbox, CheckboxGroup, Chip, Description, Input, Label, TextField } from '@heroui/react';
import { useState } from 'react';

/** The scopes a person or credential can be given, grouped by what they unlock. */
export const SCOPE_GROUPS: { label: string; scopes: { id: string; hint: string }[] }[] = [
  {
    label: 'Workflows',
    scopes: [
      { id: 'workflows:read', hint: 'See definitions, schedules, forms' },
      { id: 'workflows:write', hint: 'Create and change them' },
    ],
  },
  {
    label: 'Executions',
    scopes: [
      { id: 'executions:read', hint: 'See runs and queues' },
      { id: 'executions:start', hint: 'Start workflows' },
      { id: 'executions:write', hint: 'Pause, retry, terminate, reassign' },
    ],
  },
  {
    label: 'Human tasks',
    scopes: [
      { id: 'human-tasks:read', hint: 'See the inbox' },
      { id: 'human-tasks:write', hint: 'Claim and respond' },
    ],
  },
  {
    label: 'Workers',
    scopes: [
      { id: 'queues:lease:*', hint: 'Poll any queue (narrow with queues:lease:<name>)' },
      { id: 'tasks:report', hint: 'Report results' },
      { id: 'metrics:read', hint: 'Scrape metrics' },
    ],
  },
  { label: 'Administration', scopes: [{ id: 'admin', hint: 'Everything, including credentials' }] },
];

const KNOWN = new Set(SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.id)));
const VALID = /^[a-z]+(-[a-z]+)*:([a-z]+(-[a-z]+)*|\*)(:[A-Za-z0-9_.:*-]+)?$/;

/**
 * Choosing scopes by what they do, with anything more specific — a single
 * queue, say — typed in. Least privilege is easiest when the list says what
 * each grant means.
 */
export function ScopePicker({ value, onChange }: { value: string[]; onChange: (scopes: string[]) => void }) {
  const [custom, setCustom] = useState('');
  const extra = value.filter((scope) => !KNOWN.has(scope));
  const add = () => {
    const scope = custom.trim();
    if (scope && (scope === 'admin' || VALID.test(scope)) && !value.includes(scope)) onChange([...value, scope]);
    setCustom('');
  };

  return (
    <div className="space-y-4">
      {SCOPE_GROUPS.map((group) => (
        <CheckboxGroup
          key={group.label}
          value={value.filter((scope) => group.scopes.some((s) => s.id === scope))}
          onChange={(selected) =>
            onChange([...value.filter((scope) => !group.scopes.some((s) => s.id === scope)), ...(selected as string[])])
          }
        >
          <Label className="text-xs font-medium uppercase tracking-wide text-muted">{group.label}</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.scopes.map((scope) => (
              <Checkbox key={scope.id} value={scope.id}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="font-mono text-xs">{scope.id}</span>
                </Checkbox.Content>
                <Description className="pl-6 text-xs">{scope.hint}</Description>
              </Checkbox>
            ))}
          </div>
        </CheckboxGroup>
      ))}
      <div>
        <TextField value={custom} onChange={setCustom} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}>
          <Label>More specific scope</Label>
          <Input className="font-mono" placeholder="queues:lease:charge_card — press Enter" />
        </TextField>
        {extra.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {extra.map((scope) => (
              <Chip key={scope} size="sm" variant="soft">
                <span className="font-mono">{scope}</span>
                <button
                  type="button"
                  className="ml-1 text-muted hover:text-danger"
                  aria-label={`Remove ${scope}`}
                  onClick={() => onChange(value.filter((s) => s !== scope))}
                >
                  ×
                </button>
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScopeChips({ scopes, max = 3 }: { scopes: string[]; max?: number }) {
  if (scopes.length === 0) return <span className="text-sm text-muted">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.slice(0, max).map((scope) => (
        <Chip key={scope} size="sm" variant={scope === 'admin' ? 'soft' : 'secondary'} color={scope === 'admin' ? 'warning' : 'default'}>
          <span className="font-mono text-[11px]">{scope}</span>
        </Chip>
      ))}
      {scopes.length > max && <span className="text-xs text-muted">+{scopes.length - max}</span>}
    </div>
  );
}
