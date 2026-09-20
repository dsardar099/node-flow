import { CircleQuestion } from '@gravity-ui/icons';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <CircleQuestion className="size-7" />
      </span>
      <div>
        <h1 className="text-xl font-semibold">Nothing here</h1>
        <p className="mt-1 max-w-md text-sm text-muted">
          It may have been deleted, belong to another namespace, or the link may be mistyped.
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/executions" className="button button--primary">
          Go to executions
        </Link>
        <Link href="/workflowDef" className="button button--secondary">
          Browse workflows
        </Link>
      </div>
    </div>
  );
}
