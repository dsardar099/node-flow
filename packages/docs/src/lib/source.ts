import { defineDocs } from 'fumadocs-mdx/macro';
import { loader } from 'fumadocs-core/source';

/**
 * The content tree.
 *
 * `defineDocs` is the macro API: the bundler compiles this call into real
 * imports of every MDX file under `dir`, so there is no code-generation step,
 * no `postinstall` hook and no generated directory to gitignore. The older
 * config API needs all three, and a generated directory is an input Nx cannot
 * see — which makes its cache wrong rather than merely cold.
 *
 * ## Two audiences, one tree
 *
 * `content/docs/guide` and `content/docs/contributing` are both marked
 * `"root": true` in their `meta.json`. That makes each a hard boundary: a
 * reader inside the guide never sees a contributor page in the sidebar or in
 * search, and Fumadocs renders the two roots as a switcher at the top of the
 * sidebar.
 *
 * They are genuinely separate sets of documentation for genuinely different
 * people — someone running node-flow, and someone changing it — and the only
 * thing they share is the site they live on.
 */
const docs = defineDocs({ dir: 'content/docs' });

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
