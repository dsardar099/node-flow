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
 *
 * ## AI crawlers are named, and welcomed
 *
 * A `*` rule already admits them, but several answer engines treat an explicit
 * `Allow` as the stronger signal, and naming them documents a decision rather
 * than leaving it to a default: this site *wants* to be what ChatGPT, Claude,
 * Perplexity, Gemini and Copilot quote when someone asks for a Conductor or
 * Temporal alternative. `Google-Extended` and `Applebot-Extended` are the
 * opt-ins for training and grounding, separate from ordinary search indexing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/search'] },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: ['/api/search'] },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'Bingbot',
  'DuckAssistBot',
  'cohere-ai',
  'MistralAI-User',
  'meta-externalagent',
  'Amazonbot',
  'YouBot',
  'CCBot',
];
