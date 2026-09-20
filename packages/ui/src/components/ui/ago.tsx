import { formatDateTime, formatRelative } from './format';

/**
 * A relative timestamp — "4 min ago" — that does not break hydration.
 *
 * `formatRelative` reads the clock, so the server renders it at one instant and
 * the browser hydrates at another. Cross a boundary — "just now" becoming
 * "1 min ago" — and the text no longer matches what the server sent. React
 * treats that as a failed hydration (#418), throws away the server HTML for the
 * surrounding tree and re-renders it on the client: the page still looks right,
 * which is exactly why it went unnoticed, while the server-side render it
 * discards was the whole point of doing one.
 *
 * `suppressHydrationWarning` is React's answer to precisely this case, and it
 * belongs on the element holding the text rather than anywhere further out — it
 * covers an element's own attributes and its direct text children only, so a
 * wrapper further up would suppress nothing.
 *
 * The absolute time rides along as a `title`, because "4 min ago" is the wrong
 * thing to read out to someone correlating against their own logs.
 */
export function Ago({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  if (!value) return null;

  return (
    <span className={className} title={formatDateTime(value)} suppressHydrationWarning>
      {formatRelative(value)}
    </span>
  );
}
