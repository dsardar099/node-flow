import { createMDX } from 'fumadocs-mdx/next';

/**
 * `.mjs`, not `.js`, and that is load-bearing: `fumadocs-mdx` is ESM-only, so a
 * CommonJS config — which is what the Nx generator emits — fails at startup.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Every docs page has a Markdown twin at its own URL plus `.md`, for LLM
   * crawlers and agents; `app/llms.mdx` serves it. A rewrite, not a redirect,
   * so the address an agent quotes is the one it fetched.
   */
  async rewrites() {
    return [{ source: '/docs/:path*.md', destination: '/llms.mdx/:path*' }];
  },
};

export default createMDX()(nextConfig);
