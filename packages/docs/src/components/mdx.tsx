import defaultComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Callout } from 'fumadocs-ui/components/callout';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import type { MDXComponents } from 'mdx/types';
import { FAQ } from './faq';
import { Mermaid } from './mermaid';

/**
 * Components every MDX page can use without importing them.
 *
 * Registering them centrally rather than importing per-page is what makes them
 * actually get used — documentation that is annoying to illustrate ends up
 * unillustrated. It also means a page cannot reference a component that was
 * never wired up, which fails at *prerender* with a message about a missing
 * component rather than anywhere near the file that caused it.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    Accordion,
    Accordions,
    Callout,
    FAQ,
    File,
    Files,
    Folder,
    Mermaid,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  };
}
