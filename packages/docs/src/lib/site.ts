/**
 * Who this site is, in one place.
 *
 * Every tag a crawler or a link preview reads — the canonical URL, the Open
 * Graph card, the Twitter card, the sitemap, the structured data — is built
 * from this object. Kept together because they drift apart otherwise: a
 * description edited in one place and not another is how a shared link ends up
 * previewing text the site no longer says.
 */
export const site = {
  name: 'node-flow',
  /** The brand as the logo spells it, for places a human reads it. */
  displayName: 'Node Flow',
  title: 'Node Flow — make complex workflows flow',
  tagline: 'Conductor’s model, Node’s ecosystem, one dependency.',
  description:
    'Workflow orchestration you can read. Build durable workflows with declarative JSON, workers in any language, and Postgres as your only infrastructure dependency.',
  /**
   * Absolute origin, used to resolve every relative URL in the metadata.
   *
   * Link previews need absolute image URLs — a crawler fetching
   * `/og/image.png` has no page to resolve it against — so this must be the
   * address the site is actually served from. Overridable for preview
   * deployments, whose cards should point at their own images rather than at
   * production's.
   */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://node-flow.dev',
  repository: 'https://github.com/dsardar099/node-flow',
  locale: 'en_US',
  author: {
    name: 'Dwaipayan Sardar',
    url: 'https://github.com/dsardar099',
  },
  keywords: [
    'workflow orchestration',
    'workflow engine',
    'Conductor',
    'Netflix Conductor',
    'Orkes',
    'Conductor alternative',
    'durable workflows',
    'DAG',
    'Postgres',
    'PostgreSQL',
    'Node.js',
    'TypeScript',
    'saga',
    'task queue',
    'microservice orchestration',
    'AI agents',
    'self-hosted',
  ],
  /** Brand colours, for the parts of the preview image the logo does not cover. */
  colors: {
    ink: '#0c0d10',
    muted: '#4b5563',
    cyan: '#06d6ff',
    blue: '#1f5bff',
    violet: '#b61cff',
  },
} as const;

/** `path` made absolute against the site origin. */
export const absoluteUrl = (path: string) => new URL(path, site.url).toString();
