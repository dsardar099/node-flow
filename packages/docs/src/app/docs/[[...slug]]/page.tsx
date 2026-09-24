import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import {
  markdownUrl,
  pageImage,
  sectionOf,
  source,
} from '../../../lib/source';
import { pageMetadata } from '../../../lib/metadata';
import { site } from '../../../lib/site';
import { JsonLd, docGraph } from '../../../components/json-ld';
import { getMDXComponents } from '../../../components/mdx';

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd
        data={docGraph({
          title: page.data.title,
          description: page.data.description ?? site.description,
          path: page.url,
          image: pageImage(page).url,
          section: sectionOf(page),
          sectionPath: `/docs/${page.slugs[0] ?? ''}`.replace(/\/$/, ''),
        })}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return pageMetadata({
    title: page.data.title,
    // Every page has one today; the fallback keeps a future page without one
    // from previewing with no text at all.
    description: page.data.description ?? site.description,
    path: page.url,
    image: pageImage(page).url,
    type: 'article',
    markdown: markdownUrl(page),
  });
}
