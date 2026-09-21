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

type Page = NonNullable<ReturnType<typeof source.getPage>>;

/**
 * Where a page's preview image lives.
 *
 * Defined once because two files depend on it agreeing: the page advertises
 * this URL in its `og:image`, and `app/og/docs/[...slug]/route.tsx` serves it.
 * If they drift, every shared link previews a 404 — silently, since nothing
 * on the page itself looks wrong.
 *
 * The trailing `image.png` gives the section index a slug of its own, and
 * gives crawlers a file extension; some refuse an image URL without one.
 */
export function pageImage(page: Page) {
  const segments = [...page.slugs, 'image.png'];
  return { segments, url: `/og/docs/${segments.join('/')}` };
}

const SECTIONS: Record<string, string> = {
  guide: 'Guide',
  contributing: 'Contributing',
};

/**
 * Which of the two audiences a page is for, as its preview card labels it.
 *
 * Matches the `title` in each root's `meta.json`. It is worth showing: the
 * same site serves people running node-flow and people changing it, and a
 * shared link should say which one it is before anyone clicks it.
 */
export function sectionOf(page: Page): string {
  return SECTIONS[page.slugs[0] ?? ''] ?? 'Documentation';
}
