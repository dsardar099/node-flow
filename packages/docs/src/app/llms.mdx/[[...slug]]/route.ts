import { notFound } from 'next/navigation';
import { markdownOf, source } from '../../../lib/source';

/**
 * Every documentation page as Markdown, at its own URL plus `.md`.
 *
 * LLM crawlers and coding agents read text, not rendered HTML; handing them
 * the page without navigation, scripts and markup is the difference between
 * the page being quoted accurately and being summarised from the sidebar.
 * Reached through the rewrite in `next.config.mjs`; this path itself is an
 * implementation detail.
 */
export const revalidate = false;
export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await markdownOf(page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
