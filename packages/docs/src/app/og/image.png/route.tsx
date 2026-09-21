import { renderCard } from '../../../lib/og';

/**
 * The preview image for the landing page, and for any link that does not
 * have one of its own.
 *
 * Rendered once at build. A route handler rather than an `opengraph-image`
 * file, deliberately: file-convention images take precedence over the
 * `openGraph` object, and one at the root would quietly override every docs
 * page's own card.
 */
export const dynamic = 'force-static';

export function GET() {
  return renderCard({
    eyebrow: 'Workflow orchestration',
    title: 'Make complex workflows flow',
    description:
      'Declarative JSON workflows, workers in any language, and Postgres as the only thing you need to run.',
  });
}
