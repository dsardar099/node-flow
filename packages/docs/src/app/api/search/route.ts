import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '../../../lib/source';

/**
 * Search, served by the site itself.
 *
 * Fumadocs' default engine indexes at build time and answers from memory, so
 * the docs site has no search dependency to operate — which matters because the
 * whole point of node-flow is that it needs one piece of infrastructure, and a
 * documentation site that needs Algolia would be an odd way to say so.
 */
export const { GET } = createFromSource(source, { language: 'english' });
