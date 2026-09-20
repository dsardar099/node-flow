'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useResolvedTheme } from '../../components/shell/theme';

/**
 * The API reference, rendered by Scalar.
 *
 * This replaced a hand-rolled viewer — a grouped list of operations and their
 * summaries. That was honest but thin: it could not show a schema, an example,
 * or issue a request, so anyone with a real question still ended up reading
 * `openapi.json` directly. Finishing it would have meant rebuilding an API
 * reference from scratch inside a dashboard.
 *
 * The document is fetched from the *running server*, which is the reason this
 * page exists alongside the public reference on the docs site: this one
 * describes the build you are actually talking to, including whatever this
 * deployment has turned on. The docs-site one is generated at release time from
 * `clients/openapi.json` and describes the published version.
 *
 * Scalar is Vue underneath and ships its own stylesheet, so it stays confined
 * to this one route and never becomes a dependency of the rest of the
 * dashboard.
 */
export function ApiReference({ document }: { document: object }) {
  const theme = useResolvedTheme();

  return (
    // Scalar's stylesheet keys dark mode off a bare `.dark-mode` class rather
    // than the `darkMode` option alone, which sets its internal state but does
    // not put the class on a root it did not create.
    <div className={theme === 'dark' ? 'dark-mode' : 'light-mode'}>
      <ApiReferenceReact
        configuration={{
          content: document,

          // Scalar's own toolbar — Configure, Share, Deploy, and a registry
          // sign-up — is for people publishing docs *with* Scalar. It only
          // renders on localhost, so it would never have reached a deployment,
          // but it is confusing chrome in someone's own dashboard.
          showDeveloperTools: 'never',

          // 155 operations need navigation; without this they render as one
          // flat list and the page is unusable past the first screen. It nests
          // inside the content column rather than competing with the app's own
          // sidebar, which stays the primary navigation.
          showSidebar: true,
          layout: 'modern',

          // Collapsed by default: opening all 25 tags produces a sidebar
          // thousands of rows long.
          defaultOpenAllTags: false,

          // The reader is already authenticated against this exact server, so
          // the request runner is the most useful thing on the page.
          hideTestRequestButton: false,
          hideClientButton: true,

          // Downloading the spec is better served by `/v1/openapi.json`, which
          // is one link away and always current.
          hideDownloadButton: true,

          // Follows the dashboard's theme rather than keeping its own, which
          // would drift from the switcher in the sidebar.
          darkMode: theme === 'dark',
          forceDarkModeState: theme === 'dark' ? 'dark' : 'light',

          // The dashboard already loads its own typeface; letting Scalar pull
          // more would be two font stacks on one page.
          withDefaultFonts: false,
        }}
      />
    </div>
  );
}
