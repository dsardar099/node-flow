import { ApiReference } from '@scalar/nextjs-api-reference';
import { ogImageSize } from '../../lib/metadata';
import { absoluteUrl, site } from '../../lib/site';

const TITLE = `API reference · ${site.name}`;
const DESCRIPTION =
  'Every endpoint of the node-flow REST API — schemas, auth, request examples in several languages — rendered from the same OpenAPI document the generated clients are built from.';

/**
 * Scalar's official standalone Next.js handler. Scalar owns the entire page —
 * navigation, search, schemas, language samples, auth, and request testing.
 */
const scalar = ApiReference({
  url: '/api/openapi',
  pageTitle: TITLE,
  theme: 'deepSpace',
  layout: 'modern',
  darkMode: true,
  forceDarkModeState: 'dark',
  hideDarkModeToggle: true,
  showSidebar: true,
  hideModels: false,
  documentDownloadType: 'both',
  showOperationId: true,
  operationTitleSource: 'summary',
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
});

const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * The tags the rest of the site gets from Next's metadata API.
 *
 * This route is a handler that returns Scalar's own HTML document, so the
 * metadata API never runs for it. Scalar's server-rendered `<head>` holds a
 * `<title>` and nothing else — its `metaData` option is applied by client-side
 * JavaScript, which Slack, X, LinkedIn and every other preview crawler never
 * execute. Without these, a shared API-reference link previews as a bare URL.
 */
function headTags(): string {
  const url = absoluteUrl('/api-reference');
  const image = absoluteUrl('/og/api-reference/image.png');
  const meta = (attribute: 'name' | 'property', key: string, content: string) =>
    `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`;

  return [
    meta('name', 'description', DESCRIPTION),
    `<link rel="canonical" href="${escapeAttribute(url)}" />`,
    '<link rel="icon" href="/favicon.ico" sizes="any" />',
    '<link rel="icon" href="/icon.png" type="image/png" sizes="512x512" />',
    '<link rel="apple-touch-icon" href="/apple-icon" type="image/png" sizes="180x180" />',
    '<link rel="manifest" href="/manifest.webmanifest" />',
    meta('name', 'theme-color', site.colors.ink),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', site.displayName),
    meta('property', 'og:locale', site.locale),
    meta('property', 'og:url', url),
    meta('property', 'og:title', TITLE),
    meta('property', 'og:description', DESCRIPTION),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', String(ogImageSize.width)),
    meta('property', 'og:image:height', String(ogImageSize.height)),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:alt', TITLE),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', TITLE),
    meta('name', 'twitter:description', DESCRIPTION),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', TITLE),
  ].join('\n    ');
}

export async function GET() {
  const response = scalar();
  const html = await response.text();

  // The body changes length; a stale Content-Length would truncate it.
  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(
    html
      // Scalar's template declares no language, which screen readers and
      // search engines both use.
      .replace('<html>', '<html lang="en">')
      .replace('<head>', `<head>\n    ${headTags()}`),
    { status: response.status, headers },
  );
}
