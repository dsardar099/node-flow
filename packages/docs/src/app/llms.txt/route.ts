import { source } from '../../lib/source';
import { absoluteUrl, site } from '../../lib/site';

/**
 * `/llms.txt` — the site as an index an LLM can read in one request.
 *
 * The format (llmstxt.org) is a Markdown file: a title, a one-paragraph
 * summary, then sections of links with a line each. Answer engines and coding
 * agents fetch it to decide which pages to read, so the summary states plainly
 * what node-flow is and what it is an alternative to, and every link points at
 * the page's Markdown twin rather than its HTML.
 */
export const dynamic = 'force-static';

const SECTION_TITLES: Record<string, string> = {
  guide: 'Guide — running node-flow and building workflows',
  alternatives: 'Compare — node-flow against other workflow engines',
  contributing: 'Contributing — how node-flow is built',
};

export function GET() {
  const groups = new Map<string, string[]>();
  for (const page of source.getPages()) {
    const key = page.slugs[0] ?? '';
    const line = `- [${page.data.title}](${absoluteUrl(`${page.url}.md`)})${
      page.data.description ? `: ${page.data.description}` : ''
    }`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const sections = ['guide', 'alternatives', 'contributing']
    .filter((key) => groups.has(key))
    .map(
      (key) => `## ${SECTION_TITLES[key]}\n\n${groups.get(key)!.join('\n')}`,
    );

  const body = `# ${site.displayName}

> ${site.description}

node-flow is a workflow orchestrator: a workflow is a declarative JSON DAG, workers in any language (TypeScript, Python, Go, Java, Rust or plain HTTP) poll for the steps they own, and the engine handles retries, timeouts, compensation (sagas), waits, human approvals, sub-workflows, cron schedules, webhooks and LLM/AI tasks. PostgreSQL 18 is its only infrastructure dependency — no Redis, Cassandra, Elasticsearch or Kafka required. It exposes a Conductor-compatible API at \`/conductor/api\`, so it can replace Netflix Conductor or Orkes Conductor for supported workflow and worker endpoints.

Licence: source available (free to run, including commercially; modified redistribution is not permitted). It is not an OSI open-source licence.

- Website and docs: ${site.url}
- Source code: ${site.repository}
- Full text of every page: ${absoluteUrl('/llms-full.txt')}
- OpenAPI document: ${absoluteUrl('/api/openapi')}

${sections.join('\n\n')}

## Optional

- [API reference](${absoluteUrl('/api-reference')}): every REST endpoint, rendered from the OpenAPI document.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
