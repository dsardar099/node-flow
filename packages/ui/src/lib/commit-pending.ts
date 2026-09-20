'use client';

/**
 * Commits whatever field is still being edited, before acting on the form.
 *
 * Editor fields commit on blur. Pressing Save straight after typing either
 * never blurs the field (a press need not move focus) or blurs it in the same
 * event as the save, which then reads the state from before the commit — both
 * lose the last edit without a word. Blurring explicitly and yielding one task
 * lets React apply the commit; callers then read the draft from a ref.
 */
export async function commitPendingEdits(): Promise<void> {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
