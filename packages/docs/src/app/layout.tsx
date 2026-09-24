import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Analytics } from '../components/analytics';
import { ogImageSize } from '../lib/metadata';
import { site } from '../lib/site';
import './global.css';

const defaultImage = {
  url: '/og/image.png',
  ...ogImageSize,
  alt: site.title,
  type: 'image/png',
};

/**
 * Site-wide defaults.
 *
 * Every page overrides the shareable parts through `pageMetadata`, so what is
 * here is mostly the floor: what a crawler sees on a route that sets nothing,
 * such as a 404. Two things are deliberately absent:
 *
 * - **No canonical URL.** A layout-level canonical is inherited by every page
 *   that does not set its own, so each of them — a 404 included — would tell
 *   search engines it is a duplicate of the homepage.
 * - **No `twitter:site` handle.** The project has none, and an invented one
 *   attributes the card to whoever owns it.
 */
export const metadata: Metadata = {
  // Resolves every relative URL below. Preview crawlers need absolute image
  // URLs; without this Next warns and falls back to localhost, and every
  // shared card in production points at an image nobody else can load.
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.displayName,
  keywords: [...site.keywords],
  authors: [{ name: site.author.name, url: site.author.url }],
  creator: site.author.name,
  publisher: site.author.name,
  category: 'technology',
  openGraph: {
    type: 'website',
    siteName: site.displayName,
    locale: site.locale,
    url: '/',
    title: site.title,
    description: site.description,
    images: [defaultImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: site.title,
    description: site.description,
    images: [defaultImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Lets search results show the full preview image and snippet rather
      // than the thumbnail Google defaults to without an explicit opt-in.
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  verification: {
    google: site.verification.google,
    yandex: site.verification.yandex,
    other: site.verification.bing
      ? { 'msvalidate.01': site.verification.bing }
      : undefined,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

/** The browser chrome colour, matched to whichever theme the reader is in. */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: site.colors.ink },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
