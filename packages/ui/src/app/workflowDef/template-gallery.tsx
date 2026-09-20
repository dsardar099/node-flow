'use client';

import { WORKFLOW_TEMPLATES } from '@node-flow-dev/core';
import { Button, Card, Chip, Modal } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { DRAFT_KEY } from '../newWorkflowDef/draft-editor';

/**
 * Starting from something instead of nothing.
 *
 * A blank editor is where people give up: the DSL is capable and the
 * expression syntax is unfamiliar, so the first workflow is mostly spent
 * guessing at `${ref.output.field}`. Each template is one working example of
 * one idea, and the card says which idea — "teaches" rather than a feature
 * list, because a template that demonstrates six things at once is admired and
 * never edited.
 *
 * Choosing one opens the editor on a draft. Nothing is registered until the
 * person saves, so a template is a starting point rather than a commitment.
 */
export function TemplateGallery({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();

  const start = (id: string) => {
    const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === id);
    if (!template) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(template.definition));
    } catch {
      // A browser refusing session storage is rare and recoverable: the editor
      // opens blank rather than the page failing.
    }
    onOpenChange(false);
    router.push('/newWorkflowDef?from=template');
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-3xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Start from a template</Modal.Heading>
            <p className="text-sm text-muted">Each one is a working example of a single idea. Edit it into your own.</p>
          </Modal.Header>

          <Modal.Body>
            <div className="grid gap-3 sm:grid-cols-2">
              {WORKFLOW_TEMPLATES.map((template) => (
                <Card key={template.id} className="min-w-0 gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{template.title}</span>
                    <Chip size="sm" variant="soft">
                      {template.category}
                    </Chip>
                  </div>
                  <p className="text-sm text-muted">{template.summary}</p>
                  <p className="text-xs text-muted">
                    <span className="font-medium">Teaches: </span>
                    {template.teaches}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-xs text-muted">{template.definition.name}</span>
                    <Button size="sm" variant="secondary" onPress={() => start(template.id)}>
                      Use this
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
