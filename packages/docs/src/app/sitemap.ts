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
      priority: PRIORITY[page.slugs[0] ?? ''] ?? 0.7,
    })),
  ];
}

/**
 * How much each section matters relative to the rest of the site.
 *
 * The guide and the comparison pages are what someone searching for a
 * workflow engine should land on; the contributor docs are for people already
 * inside the project.
 */
const PRIORITY: Record<string, number> = {
  guide: 0.8,
  alternatives: 0.9,
  contributing: 0.5,
};
