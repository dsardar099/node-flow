/** Lifecycle events a listener can subscribe to, in the order they happen. */
export const STATUS_EVENTS = [
  { id: 'STARTED', label: 'Started', tone: 'accent' },
  { id: 'COMPLETED', label: 'Completed', tone: 'success' },
  { id: 'FAILED', label: 'Failed', tone: 'danger' },
  { id: 'TIMED_OUT', label: 'Timed out', tone: 'danger' },
  { id: 'TERMINATED', label: 'Terminated', tone: 'warning' },
  { id: 'PAUSED', label: 'Paused', tone: 'default' },
  { id: 'RESUMED', label: 'Resumed', tone: 'default' },
  { id: 'RESTARTED', label: 'Restarted', tone: 'default' },
] as const;

export type StatusEventId = (typeof STATUS_EVENTS)[number]['id'];
