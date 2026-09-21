import type { Metadata } from 'next';
import { site } from './site';

/** The size every preview image is rendered at, and the size crawlers expect. */
export const ogImageSize = { width: 1200, height: 630 } as const;

interface PageMetadata {
  /** The page's own title. The layout's template adds the site name to `<title>`. */
  title: string;
  description: string;
  /** Path from the site root, e.g. `/docs/guide/quickstart`. */
  path: string;
  /** Path to this page's preview image. */
  image: string;
  /** `article` for documentation, `website` for the landing page. */
  type?: 'website' | 'article';
  /** Replace the templated `<title>` outright instead of suffixing the site name. */
  absoluteTitle?: boolean;
}

/**
 * Everything a page needs for search results and link previews.
 *
 * One builder, not a layout default plus per-page overrides, because of how
 * Next merges metadata: **shallowly, by key.** A page that sets `openGraph` at
 * all replaces the layout's `openGraph` entirely — so a page overriding only
 * `openGraph.images` silently loses `siteName`, `locale` and `type`, and its
 * previews look subtly wrong in exactly the places nobody checks. Building the
 * complete object here every time makes that impossible.
 *
 * `twitter` is set in full for the same reason, and because X reads
 * `twitter:card` to decide whether to show a large image at all — without it a
 * link previews as a small thumbnail however good the image is.
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
  type = 'website',
  absoluteTitle = false,
}: PageMetadata): Metadata {
  // Previews show the site name alongside a page title, so `Quickstart` alone
  // would read as an orphan in a feed. The landing page's title already
  // carries the brand.
  const shareTitle = absoluteTitle ? title : `${title} · ${site.name}`;
  const images = [
    { url: image, ...ogImageSize, alt: shareTitle, type: 'image/png' },
  ];

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      siteName: site.displayName,
      locale: site.locale,
      url: path,
      title: shareTitle,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description,
      images,
    },
  };
}
