import { formatDateTime, formatTime } from './format';

/**
 * An absolute timestamp in the viewer's own timezone, without breaking hydration.
 *
 * `formatDateTime` is built from `getFullYear`/`getHours`/…, which read the
 * *renderer's* timezone. The server container runs UTC and the browser runs
 * wherever the operator is, so every one of these strings differed between the
 * two renders — a hydration mismatch on every page that shows a time, which is
 * most of them.
 *
 * Rendering UTC on both sides would also fix it, and would be wrong: the whole
 * point of an absolute timestamp here is that someone can line it up against
 * their own logs and their own clock. So the local time stays, and the element
 * carries `suppressHydrationWarning` to tell React the difference is expected.
 *
 * This is the same failure as {@link ../ui/ago!Ago}, from a different cause —
 * that one varies with *when* the render happens, this one with *where*.
 */
export function LocalTime({
  value,
  className,
  timeOnly = false,
}: {
  value: string | Date | null | undefined;
  className?: string;
  /** Just `17:55:51`, for a column whose date is already established. */
  timeOnly?: boolean;
}) {
  if (!value) return null;

  return (
    <span className={className} suppressHydrationWarning>
      {timeOnly ? formatTime(value) : formatDateTime(value)}
    </span>
  );
}
