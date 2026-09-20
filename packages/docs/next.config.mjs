import { createMDX } from 'fumadocs-mdx/next';

/**
 * `.mjs`, not `.js`, and that is load-bearing: `fumadocs-mdx` is ESM-only, so a
 * CommonJS config — which is what the Nx generator emits — fails at startup.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
};

export default createMDX()(nextConfig);
