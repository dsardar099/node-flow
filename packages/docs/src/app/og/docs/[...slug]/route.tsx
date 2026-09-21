import { notFound } from 'next/navigation';
import { renderCard } from '../../../../lib/og';
import { pageImage, sectionOf, source } from '../../../../lib/source';

/**
 * The preview image for one documentation page.
 *
 * Every image is rendered at build time from `generateStaticParams`, so a
 * crawler fetching one costs a static file rather than a render. An unknown
 * path is a 404 instead of an on-demand render: nothing links to one, and
 * rendering whatever a stranger asks for is a cheap way to be made to burn CPU.
 */
export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  // The last segment is the `image.png` that `pageImage` appends.
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return renderCard({
    eyebrow: sectionOf(page),
    title: page.data.title,
    description: page.data.description,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: pageImage(page).segments }));
}
