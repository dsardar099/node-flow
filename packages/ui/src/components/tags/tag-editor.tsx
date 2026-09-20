'use client';

import { Tag, Xmark } from '@gravity-ui/icons';
import { Button, Chip, Description, FieldError, Input, Label, Modal, TextField, toast } from '@heroui/react';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { mutate } from '../../lib/mutate';

/** Mirrors `isValidTag` in core: `key:value`, lower-case key. */
const TAG = /^[a-z][a-z0-9-]*:[A-Za-z0-9_.*-]+$/;

export function isValidTag(tag: string): boolean {
  return TAG.test(tag);
}

/** A tag as a chip, with key and value told apart at a glance. */
export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const [key, ...rest] = tag.split(':');
  return (
    <Chip size="sm" variant="secondary" className="gap-0 font-mono text-[11px]">
      <span className="text-muted">{key}:</span>
      <span>{rest.join(':')}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag}`}
          onClick={onRemove}
          className="ms-1 rounded-full p-0.5 text-muted hover:bg-default hover:text-foreground"
        >
          <Xmark className="size-3" />
        </button>
      )}
    </Chip>
  );
}

/**
 * Chips plus an input. Enter or comma adds; known tags are offered as one-click
 * suggestions, because a second spelling of an existing tag (`team:Payroll`)
 * silently protects nothing the first one does.
 */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  draftRef,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  /**
   * Mirrors the text not yet added, so a save can include a tag typed without
   * pressing Enter. Read at save time rather than added on blur: adding on blur
   * reflows the dialog under the pointer and swallows the very click on Save.
   */
  draftRef?: MutableRefObject<string>;
}) {
  const [draft, setDraftState] = useState('');
  const setDraft = (next: string) => {
    if (draftRef) draftRef.current = next;
    setDraftState(next);
  };
  const [error, setError] = useState<string>();

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '');
    if (!tag) return;
    if (!isValidTag(tag)) {
      setError('Write tags as key:value with a lower-case key, e.g. team:payroll.');
      return;
    }
    setError(undefined);
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };

  const offered = suggestions.filter((tag) => !value.includes(tag) && tag.includes(draft.trim())).slice(0, 8);

  return (
    <div className="space-y-3">
      <TextField
        value={draft}
        isInvalid={Boolean(error)}
        onChange={(next) => {
          if (next.endsWith(',')) add(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add(draft);
          }
          if (event.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
      >
        <Label>Tags</Label>
        <Input placeholder="key:value" className="font-mono" />
        <Description>Press Enter to add. A tagged workflow is visible only to groups granted a matching tag.</Description>
        <FieldError>{error}</FieldError>
      </TextField>

      <div className="flex min-h-8 flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-sm text-muted">No tags — anyone with workflow access can reach it.</span>
        ) : (
          value.map((tag) => <TagChip key={tag} tag={tag} onRemove={() => onChange(value.filter((t) => t !== tag))} />)
        )}
      </div>

      {offered.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">In use:</span>
          {offered.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onChange([...value, tag])}
              className="rounded-full border border-dashed border-separator px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Edits a workflow's tags — every version at once, since tags protect the name. */
export function EditTagsModal({
  namespace,
  workflow,
  initialTags,
  suggestions,
  isOpen,
  onOpenChange,
  onSaved,
}: {
  namespace: string;
  workflow: string | undefined;
  initialTags: string[];
  suggestions: string[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState(initialTags);
  const draftRef = useRef('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    draftRef.current = '';
    setTags(initialTags);
  }, [isOpen, initialTags]);

  const save = async () => {
    if (!workflow) return;
    const pending = draftRef.current.trim();
    if (pending && !isValidTag(pending)) {
      toast.danger(`"${pending}" is not a tag yet — write it as key:value, or clear it.`);
      return;
    }
    const next = pending && !tags.includes(pending) ? [...tags, pending] : tags;
    setBusy(true);
    try {
      const saved = await mutate<{ tags: string[] }>(
        `/v1/ns/${namespace}/metadata/workflows/${encodeURIComponent(workflow)}/tags`,
        { method: 'PUT', body: { tags: next } }
      );
      toast.success(`Updated tags on ${workflow}`);
      onSaved(saved.tags);
      onOpenChange(false);
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <Tag className="size-4 text-muted" />
              Tags on <span className="font-mono">{workflow}</span>
            </Modal.Heading>
            <p className="text-sm text-muted">Applies to every version of this workflow.</p>
          </Modal.Header>
          <Modal.Body>
            <TagEditor value={tags} onChange={setTags} suggestions={suggestions} draftRef={draftRef} />
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button isPending={busy} onPress={save}>
              Save tags
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
