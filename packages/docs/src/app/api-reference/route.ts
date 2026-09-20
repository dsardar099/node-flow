import { ApiReference } from '@scalar/nextjs-api-reference';

/**
 * Scalar's official standalone Next.js handler. Scalar owns the entire page —
 * navigation, search, schemas, language samples, auth, and request testing.
 */
export const GET = ApiReference({
  url: '/api/openapi',
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
