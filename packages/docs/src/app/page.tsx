import type { Metadata } from 'next';
import { JsonLd, faqGraph, siteGraph } from '../components/json-ld';
import { LandingPage } from '../components/landing';
import { landingFaq } from '../lib/landing-content';
import { pageMetadata } from '../lib/metadata';
import { site } from '../lib/site';
import './landing.css';

export const metadata: Metadata = pageMetadata({
  title: site.title,
  description: site.description,
  path: '/',
  image: '/og/image.png',
  // The title already carries the brand; the layout's template would append
  // it a second time.
  absoluteTitle: true,
});

export default function Home() {
  return (
    <>
      <JsonLd data={siteGraph} />
      <JsonLd data={faqGraph(landingFaq)} />
      <LandingPage />
    </>
  );
}
