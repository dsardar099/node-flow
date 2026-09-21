import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/site';

/**
 * What crawlers may fetch.
 *
 * Two paths look disallowable and must not be:
 *
 * - **`/og/`** — the preview images. X's crawler honours robots.txt, so
 *   disallowing them does not hide anything; it turns every shared link into a
 *   card with no image.
 * - **`/api/openapi`** — the API reference page loads it in the browser, and a
 *   search engine rendering that page is subject to the same rules. Block it
 *   and the reference indexes as an empty shell.
 *
 * Only the search endpoint is excluded: it answers queries, and indexing its
 * responses would put arbitrary result lists in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/search'] }],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
