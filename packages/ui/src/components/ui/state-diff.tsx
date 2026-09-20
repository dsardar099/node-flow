'use client';

import { Chip } from '@heroui/react';
import { Fragment, useMemo } from 'react';
import { DiffLineRow } from '../dag/compare-versions';
import { diffLines, hunks, stable } from '../../lib/dag/diff';

/**
 * What an entity looked like before and after a change, as a reviewer reads it:
 * which fields changed, then the lines around each change.
 *
 * `null` on one side means the entity did not exist — a create or a delete —
 * and `undefined` means that side was not recorded (a change that failed).
 */
export function StateDiff({ before, after }: { before: unknown; after: unknown }) {
  const result = useMemo(() => {
    const pretty = (value: unknown) => (value === null || value === undefined ? '' : JSON.stringify(JSON.parse(stable(value)), null, 2));
    const object = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
    const a = object(before);
    const b = object(after);
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => stable(a[key]) !== stable(b[key])).sort();
    return { fields, hunks: hunks(diffLines(pretty(before), pretty(after)), 2) };
  }, [before, after]);

  const kind = before === null && after !== null ? 'Created' : after === null && before !== null ? 'Deleted' : undefined;

  return (
    <section className="space-y-3" aria-label="Changes">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-medium">Changes</span>
        {kind ? (
          <Chip size="sm" variant="soft" color={kind === 'Created' ? 'success' : 'danger'}>
            {kind}
          </Chip>
        ) : after === undefined ? (
          <Chip size="sm" variant="soft">
            Not applied
          </Chip>
        ) : result.fields.length === 0 ? (
          <span className="text-sm text-muted">Nothing changed.</span>
        ) : (
          result.fields.map((field) => (
            <Chip key={field} size="sm" variant="soft" color="warning">
              <span className="font-mono">{field}</span>
            </Chip>
          ))
        )}
      </div>
      {after !== undefined && result.hunks.length > 0 && (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-separator font-mono text-xs">
          {result.hunks.map((hunk, index) => (
            <Fragment key={index}>
              {index > 0 && <div className="border-y border-separator bg-surface-secondary px-3 py-1 text-muted">⋯</div>}
              {hunk.lines.map((line, i) => (
                <DiffLineRow key={i} line={line} />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
