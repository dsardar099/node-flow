'use client';

import { Plus, TrashBin } from '@gravity-ui/icons';
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  NumberField,
  TextArea,
  TextField,
  Tooltip,
} from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Form fields for the editor, built from HeroUI.
 *
 * Every field commits on blur rather than per keystroke: each commit is a step
 * in the undo history, and an undo that steps back one character at a time is
 * useless for the thing people actually want to undo.
 *
 * Every field also follows its value whenever it is not being edited. Without
 * that, undo is quietly broken — the definition reverts but the field keeps its
 * stale draft, and the next blur writes the draft straight back over the undo.
 */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  return {
    draft,
    setDraft,
    begin: () => {
      editing.current = true;
    },
    end: () => {
      editing.current = false;
    },
  };
}

export function CommitTextField({
  label,
  value,
  onCommit,
  description,
  mono,
  isRequired,
  isDisabled,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  description?: string;
  mono?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const { draft, setDraft, begin, end } = useDraft(value);
  const commit = () => {
    end();
    if (draft !== value) onCommit(draft);
  };

  return (
    <TextField
      value={draft}
      onChange={setDraft}
      onFocus={begin}
      onBlur={commit}
      isRequired={isRequired}
      isDisabled={isDisabled}
      onKeyDown={(event) => {
        if (!multiline && event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    >
      <Label>{label}</Label>
      {multiline ? (
        <TextArea rows={3} className={mono ? 'font-mono text-sm' : ''} placeholder={placeholder} />
      ) : (
        <Input className={mono ? 'font-mono text-sm' : ''} placeholder={placeholder} />
      )}
      {description && <Description>{description}</Description>}
    </TextField>
  );
}

export function CommitNumberField({
  label,
  value,
  onCommit,
  description,
  minValue = 0,
  maxValue,
  step,
}: {
  label: string;
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  description?: string;
  minValue?: number;
  maxValue?: number;
  step?: number;
}) {
  // React Aria's NumberField already calls onChange only on commit — blur,
  // Enter, or a stepper press — never per keystroke, so it commits directly.
  // Keeping a draft and committing it from onBlur lost every typed number:
  // onChange and onBlur fire in the same event, and the blur handler still saw
  // the draft from before the change.
  return (
    <NumberField
      value={value ?? Number.NaN}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      onChange={(next) => {
        const committed = Number.isNaN(next) ? undefined : next;
        if (committed !== value) onCommit(committed);
      }}
    >
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input />
        <NumberField.IncrementButton />
      </NumberField.Group>
      {description && <Description>{description}</Description>}
    </NumberField>
  );
}

/**
 * A JSON value edited as text. An invalid draft is kept and never committed:
 * losing a half-typed object to a missing comma is the fastest way to send
 * someone back to editing raw JSON.
 */
export function CommitJsonField({
  label,
  value,
  onCommit,
  description,
  rows = 6,
}: {
  label: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  description?: string;
  rows?: number;
}) {
  const text = JSON.stringify(value ?? {}, null, 2);
  const { draft, setDraft, begin, end } = useDraft(text);
  const [error, setError] = useState<string>();

  return (
    <TextField
      value={draft}
      onChange={setDraft}
      onFocus={begin}
      isInvalid={Boolean(error)}
      onBlur={() => {
        end();
        if (draft === text) return;
        try {
          const parsed = JSON.parse(draft || '{}');
          setError(undefined);
          onCommit(parsed);
        } catch {
          setError('Not valid JSON — not saved yet.');
        }
      }}
    >
      <Label>{label}</Label>
      <TextArea rows={rows} spellCheck={false} className="font-mono text-xs" />
      {description && !error && <Description>{description}</Description>}
      <FieldError>{error}</FieldError>
    </TextField>
  );
}

// ---------------------------------------------------------------- key/value rows

interface Row {
  key: string;
  text: string;
  json: boolean;
}

function toRows(value: Record<string, unknown> | undefined): Row[] {
  return Object.entries(value ?? {}).map(([key, entry]) =>
    typeof entry === 'string'
      ? { key, text: entry, json: false }
      : { key, text: JSON.stringify(entry), json: true }
  );
}

/**
 * Conductor's parameter rows: key, value, and a `{}` toggle that makes the value
 * JSON rather than text.
 *
 * The toggle exists because the difference matters and cannot be guessed: `"5"`
 * and `5` are different inputs to a worker, and silently turning typed text
 * into numbers would change what a task receives.
 */
export function KeyValueRows({
  label,
  value,
  onCommit,
  keyOnly,
  addLabel = 'Add parameter',
}: {
  label: string;
  value: Record<string, unknown> | string[] | undefined;
  onCommit: (value: Record<string, unknown> | string[] | undefined) => void;
  /** A list of names with no values — a workflow's declared inputs. */
  keyOnly?: boolean;
  addLabel?: string;
}) {
  const initial: Row[] = keyOnly
    ? ((value as string[] | undefined) ?? []).map((key) => ({ key, text: '', json: false }))
    : toRows(value as Record<string, unknown> | undefined);
  const signature = JSON.stringify(value ?? null);

  const [rows, setRows] = useState<Row[]>(initial);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setRows(initial);
    // Re-synced on a change of the committed value only; `initial` is derived
    // from it, and depending on the array itself would reset on every render.
  }, [signature]);

  const commit = (next: Row[]) => {
    editing.current = false;
    const problems: Record<number, string> = {};

    if (keyOnly) {
      onCommit(next.map((row) => row.key.trim()).filter(Boolean));
      return;
    }

    const out: Record<string, unknown> = {};
    next.forEach((row, index) => {
      const key = row.key.trim();
      if (!key) return;
      if (row.json) {
        try {
          out[key] = JSON.parse(row.text);
        } catch {
          problems[index] = 'Not valid JSON';
          return;
        }
      } else {
        out[key] = row.text;
      }
    });

    setErrors(problems);
    if (Object.keys(problems).length === 0) onCommit(Object.keys(out).length ? out : undefined);
  };

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-2">
          <TextField
            aria-label="Key"
            className={keyOnly ? 'flex-1' : 'w-2/5'}
            value={row.key}
            onChange={(key) => update(index, { key })}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => commit(rows)}
          >
            <Input placeholder="Key" className="font-mono text-sm" />
          </TextField>
          {!keyOnly && (
            <TextField
              aria-label="Value"
              className="flex-1"
              value={row.text}
              isInvalid={Boolean(errors[index])}
              onChange={(text) => update(index, { text })}
              onFocus={() => {
                editing.current = true;
              }}
              onBlur={() => commit(rows)}
            >
              <Input placeholder={row.json ? '{ } JSON' : 'Value or ${expression}'} className="font-mono text-sm" />
              <FieldError>{errors[index]}</FieldError>
            </TextField>
          )}
          {!keyOnly && (
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant={row.json ? 'secondary' : 'ghost'}
                  aria-label={row.json ? 'Treat value as text' : 'Treat value as JSON'}
                  onPress={() => {
                    const next = rows.map((r, i) => (i === index ? { ...r, json: !r.json } : r));
                    setRows(next);
                    commit(next);
                  }}
                >
                  <span className="font-mono text-xs">{'{}'}</span>
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{row.json ? 'Value is JSON' : 'Value is text'}</Tooltip.Content>
            </Tooltip>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={`Remove ${row.key || 'parameter'}`}
            onPress={() => {
              const next = rows.filter((_, i) => i !== index);
              setRows(next);
              commit(next);
            }}
          >
            <TrashBin />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          editing.current = true;
          setRows((current) => [...current, { key: '', text: '', json: false }]);
        }}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}
