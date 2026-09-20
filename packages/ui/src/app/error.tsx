'use client';

import { TriangleExclamation } from '@gravity-ui/icons';
import { Button } from '@heroui/react';
import { useEffect } from 'react';

/**
 * A page that failed to load — usually the API being unreachable or refusing.
 *
 * Offered as something to retry rather than a dead end: most causes (a server
 * restarting, a network blip) are gone by the time someone presses the button.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <TriangleExclamation className="size-7" />
      </span>
      <div>
        <h1 className="text-xl font-semibold">This page could not load</h1>
        <p className="mt-1 max-w-md text-sm text-muted">
          The server may be restarting or unreachable. {error.digest && <span className="font-mono text-xs">({error.digest})</span>}
        </p>
      </div>
      <Button onPress={reset}>Try again</Button>
    </div>
  );
}
