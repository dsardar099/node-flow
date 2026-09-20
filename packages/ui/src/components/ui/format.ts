/**
 * Times and durations.
 *
 * Absolute times in local time as `2026-09-16 17:55:51` — an operator
 * correlates them with their own logs and clock — and durations compact
 * (`2m 33s`, `480ms`).
 */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatTime(value: string | Date | null | undefined): string {
  return formatDateTime(value).slice(11);
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  let seconds = Math.round(value / 1000);
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export function msBetween(from: string | Date | null | undefined, to?: string | Date | null): number | undefined {
  if (!from) return undefined;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Number.isNaN(start) || Number.isNaN(end) ? undefined : end - start;
}

export function formatDuration(from: string | Date | null | undefined, to?: string | Date | null): string {
  return formatMs(msBetween(from, to));
}

/** "just now", "5 min ago", "3 h ago", then the date. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 45_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)} d ago`;
  return formatDateTime(value).slice(0, 10);
}

/** `c1fbfe14-87a0-…-c5da883dc717` → `c1fb…c717`. */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
