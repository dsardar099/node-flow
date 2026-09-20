import { Breadcrumbs } from '@heroui/react';
import type { ReactNode } from 'react';

/**
 * The top of every page: where you are, what this is, what you can do.
 *
 * Breadcrumbs only on detail pages — a list page is already a destination. The
 * description is one line that says what the page is for, because a title
 * alone ("Queues") does not say what to look at.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  badge,
  actions,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-4 px-4 md:px-8 pb-5 pt-7 ${className}`}>
      <div className="min-w-0">
        {breadcrumbs && (
          <Breadcrumbs className="mb-2 text-sm">
            {breadcrumbs.map((crumb) => (
              <Breadcrumbs.Item key={crumb.label} href={crumb.href}>
                {crumb.label}
              </Breadcrumbs.Item>
            ))}
          </Breadcrumbs>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
