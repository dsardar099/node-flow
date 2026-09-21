import type { MetadataRoute } from 'next';
import { site } from '../lib/site';

/**
 * The web app manifest — the name, icon and colours a browser uses when the
 * site is pinned, installed or added to a home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.title,
    short_name: site.displayName,
    description: site.description,
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: site.colors.ink,
    icons: [
      {
        src: '/brand/node-flow-mark.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
