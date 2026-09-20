import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

/**
 * Chrome shared by every page on the docs site.
 *
 * The documentation application has its own visual index at `/`. The separate
 * product site can still deploy independently; docs navigation never depends
 * on its routing or availability.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <Image src="/brand/node-flow.png" alt="Node Flow" width={2172} height={724} className="h-7 w-auto" />
          <span className="text-fd-muted-foreground">docs</span>
        </span>
      ),
      url: '/',
    },
    links: [
      { text: 'Guide', url: '/docs/guide', active: 'nested-url' },
      { text: 'Contributing', url: '/docs/contributing', active: 'nested-url' },
      { text: 'API', url: '/api-reference', active: 'nested-url' },
    ],
  };
}
