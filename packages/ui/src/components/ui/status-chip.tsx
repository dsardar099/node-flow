import { Chip } from '@heroui/react';

/**
 * Statuses, coloured by meaning rather than by name: every flavour of failure
 * is danger, every flavour of still-going is accent. The text is always the
 * status itself, so colour is never the only signal.
 */

export type StatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const TONE: Record<string, StatusTone> = {
  COMPLETED: 'success',
  COMPLETED_WITH_ERRORS: 'warning',
  RUNNING: 'accent',
  IN_PROGRESS: 'accent',
  SCHEDULED: 'accent',
  PAUSED: 'warning',
  // Not a stored status: RUNNING, but waiting for a rate-limit slot.
  QUEUED: 'warning',
  FAILED: 'danger',
  FAILED_WITH_TERMINAL_ERROR: 'danger',
  TIMED_OUT: 'danger',
  TERMINATED: 'danger',
  CANCELED: 'default',
  SKIPPED: 'default',
};

export function statusTone(status: string): StatusTone {
  return TONE[status] ?? 'default';
}

/** The CSS colour for a status, for drawing (timeline bars, graph borders). */
export function statusColor(status: string | undefined): string {
  if (!status) return 'var(--muted)';
  const tone = statusTone(status);
  return tone === 'default' ? 'var(--muted)' : `var(--${tone})`;
}

export function statusLabel(status: string): string {
  const words = status.toLowerCase().split('_');
  return words.map((word, i) => (i === 0 ? word[0].toUpperCase() + word.slice(1) : word)).join(' ');
}

const LIVE = new Set(['RUNNING', 'IN_PROGRESS', 'SCHEDULED']);

export function StatusChip({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <Chip color={statusTone(status)} variant="soft" size={size} className="gap-1.5">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${LIVE.has(status) ? 'animate-pulse' : ''}`}
        style={{ background: 'currentColor' }}
      />
      {statusLabel(status)}
    </Chip>
  );
}
