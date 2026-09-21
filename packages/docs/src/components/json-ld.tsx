import { absoluteUrl, site } from '../lib/site';

/**
 * Structured data for search engines.
 *
 * `JSON.stringify` does not escape `<`, so a string containing `</script>`
 * would close the tag and let the rest run as markup. Our strings come from our
 * own frontmatter, but replacing `<` with its unicode escape is what the
 * Next.js guide prescribes, and it costs nothing to be safe against content
 * that someone else writes later.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}

const websiteId = absoluteUrl('/#website');
const softwareId = absoluteUrl('/#software');

/**
 * What the site is, and what it documents.
 *
 * Deliberately says nothing it cannot back up. The licence is source
 * available, not open source, so there is no `isAccessibleForFree`-style claim
 * about openness beyond the price; the price is zero because running node-flow
 * costs nothing under its licence.
 */
export const siteGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: site.url,
      name: site.displayName,
      alternateName: site.name,
      description: site.description,
      inLanguage: 'en',
      publisher: {
        '@type': 'Person',
        name: site.author.name,
        url: site.author.url,
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': softwareId,
      name: site.displayName,
      alternateName: site.name,
      description: site.description,
      url: site.url,
      image: absoluteUrl('/og/image.png'),
      logo: absoluteUrl('/brand/node-flow-mark.png'),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Linux, macOS, Windows (Docker)',
      softwareVersion: '1.0.0',
      softwareRequirements: 'PostgreSQL 18',
      license: `${site.repository}/blob/main/LICENSE`,
      downloadUrl: site.repository,
      author: {
        '@type': 'Person',
        name: site.author.name,
        url: site.author.url,
      },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

interface DocPage {
  title: string;
  description: string;
  path: string;
  /** The page's preview image, from `pageImage` — never re-derived here. */
  image: string;
  section: string;
  /** Root path of the section, e.g. `/docs/guide`. */
  sectionPath: string;
}

/**
 * One documentation page: the article itself, and the breadcrumb trail that
 * search results show in place of a bare URL.
 */
export function docGraph({
  title,
  description,
  path,
  image,
  section,
  sectionPath,
}: DocPage) {
  const url = absoluteUrl(path);
  const crumbs = [
    { name: site.displayName, item: site.url },
    { name: section, item: absoluteUrl(sectionPath) },
    // A section's own index page is already the second crumb.
    ...(path === sectionPath ? [] : [{ name: title, item: url }]),
  ];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline: title,
        description,
        url,
        inLanguage: 'en',
        image: absoluteUrl(image),
        isPartOf: { '@id': websiteId },
        about: { '@id': softwareId },
        author: {
          '@type': 'Person',
          name: site.author.name,
          url: site.author.url,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          ...crumb,
        })),
      },
    ],
  };
}
