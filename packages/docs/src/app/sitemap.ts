import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/site';
import { source } from '../lib/source';

/**
 * Every page a search engine should know about.
 *
 * Built from the same content tree the sidebar is, so a new MDX page is in the
 * sitemap the moment it exists — a hand-kept list is how a site ends up with
 * pages Google has never been told about.
 *
 * No `lastModified`: the content has no reliable per-page date without reading
 * git history at build time, and a date that is simply the build time tells a
 * crawler every page changed on every deploy, which teaches it to ignore the
 * field.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/'), changeFrequency: 'weekly', priority: 1 },
    {
      url: absoluteUrl('/api-reference'),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    ...source.getPages().map((page) => ({
      url: absoluteUrl(page.url),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
