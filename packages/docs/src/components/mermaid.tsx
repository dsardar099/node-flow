import { renderMermaidSVG } from 'beautiful-mermaid';

/**
 * A Mermaid diagram, rendered to SVG on the server.
 *
 * Server-rendered rather than the usual client component, for two reasons. The
 * diagram ends up in the static HTML, so it is there for a reader with no
 * JavaScript and for anything crawling the page — including the language models
 * these docs are partly written for. And it cannot flash the wrong theme on
 * load, because there is no second render to disagree with the first.
 *
 * Colours come from Fumadocs' CSS variables rather than Mermaid's own palette,
 * so a diagram follows the site into dark mode without a theme listener.
 */
export async function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const svg = await renderMermaidSVG(chart, {
    bg: 'var(--color-fd-background)',
    fg: 'var(--color-fd-foreground)',
    transparent: true,
    interactive: false,
  });

  // beautiful-mermaid embeds a Google Fonts @import inside every SVG. The
  // diagrams already declare a system-ui fallback, so remove the remote import:
  // docs remain fully self-contained, CSP can stay narrow, and an offline reader
  // does not get one failed stylesheet request per diagram.
  const selfContainedSvg = svg.replace(
    /\s*@import url\(['"]?https:\/\/fonts\.googleapis\.com[^)]*\);\s*/g,
    ''
  );

  return (
    <figure className="my-6 overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4">
      {/* The SVG is generated here from source in this repository, never from
          user input, so there is no untrusted markup to sanitise. */}
      <div dangerouslySetInnerHTML={{ __html: selfContainedSvg }} />
      {title ? (
        <figcaption className="mt-3 text-center text-sm text-fd-muted-foreground">{title}</figcaption>
      ) : null}
    </figure>
  );
}
