'use client';

import { Copy } from '@gravity-ui/icons';
import { Button, Tooltip, toast } from '@heroui/react';

/** Copies a value — an id, most often — and says so. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={label}
          onPress={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success('Copied to clipboard');
            } catch {
              toast.danger('Could not copy — the browser refused clipboard access');
            }
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
