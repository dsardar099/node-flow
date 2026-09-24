import { markdownOf, source } from '../../lib/source';
import { site } from '../../lib/site';

/**
 * `/llms-full.txt` — every documentation page, concatenated as Markdown.
 *
 * The companion to `/llms.txt` for readers that would rather take the whole
 * corpus in one fetch than follow links. The guide comes first and the
 * comparison pages second, because that is the order a reader deciding
 * whether to use node-flow needs them in.
 */
export const dynamic = 'force-static';

const ORDER = ['guide', 'alternatives', 'contributing'];

export async function GET() {
  const pages = [...source.getPages()].sort(
    (a, b) =>
      rank(a.slugs[0]) - rank(b.slugs[0]) || a.url.localeCompare(b.url),
  );
  const texts = await Promise.all(pages.map(markdownOf));

  return new Response(
    [`# ${site.displayName} documentation\n\n> ${site.description}\n`, ...texts].join(
      '\n---\n\n',
    ),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}

function rank(section: string | undefined) {
  const index = ORDER.indexOf(section ?? '');
  return index === -1 ? ORDER.length : index;
}
