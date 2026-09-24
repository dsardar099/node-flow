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
  title: 'Node Flow — self-hosted workflow orchestration on Postgres',
  tagline: 'Conductor’s model, Node’s ecosystem, one dependency.',
  description:
    'A self-hosted workflow orchestration engine and Conductor-compatible alternative to Orkes, Temporal and Trigger.dev. Durable JSON workflows, workers in any language, and Postgres as the only dependency.',
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
  /**
   * The searches the site should answer.
   *
   * Google ignores `<meta name="keywords">`, but Bing, Yandex, Baidu and
   * several LLM crawlers still read it — and keeping the list here keeps the
   * comparison pages, the landing copy and the structured data honest about
   * which queries they are meant to serve.
   */
  keywords: [
    'workflow orchestration',
    'workflow orchestrator',
    'workflow engine',
    'open source workflow engine alternative',
    'self-hosted workflow engine',
    'durable workflows',
    'durable execution',
    'Conductor',
    'Netflix Conductor',
    'Netflix Conductor alternative',
    'Conductor OSS alternative',
    'Orkes',
    'Orkes Conductor alternative',
    'Temporal alternative',
    'Trigger.dev alternative',
    'iii alternative',
    'Inngest alternative',
    'Restate alternative',
    'Hatchet alternative',
    'Airflow alternative',
    'AWS Step Functions alternative',
    'Camunda alternative',
    'microservice orchestration',
    'saga pattern',
    'DAG',
    'JSON workflow DSL',
    'task queue',
    'Postgres queue',
    'Postgres',
    'PostgreSQL',
    'Node.js',
    'TypeScript',
    'human in the loop',
    'AI agent orchestration',
    'LLM workflows',
    'BPMN',
  ],
  /**
   * Search-engine ownership tokens, from Google Search Console and Bing
   * Webmaster Tools. Environment variables rather than literals so a preview
   * deployment never claims to be the production property.
   */
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    bing: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION,
    yandex: process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION,
  },
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
