'use client';

import { useEffect, useState } from 'react';

/**
 * Re-renders once a second while `active`, so a running duration ticks.
 * Stops the moment it is no longer needed.
 */
export function useTicker(active: boolean): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}
