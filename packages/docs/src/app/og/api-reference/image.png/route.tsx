import { renderCard } from '../../../../lib/og';

/** The preview image for the API reference. Rendered once, at build. */
export const dynamic = 'force-static';

export function GET() {
  return renderCard({
    eyebrow: 'API reference',
    title: 'The node-flow REST API',
    description:
      'Every endpoint, schema and example, rendered from the OpenAPI document the generated clients are built from.',
  });
}
