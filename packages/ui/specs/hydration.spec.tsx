import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Ago } from '../src/components/ui/ago';
import { ThemeMenu } from '../src/components/shell/theme';

/**
 * The server-rendered markup has to be markup a browser will parse back into
 * the tree React expects.
 *
 * This is not a style rule. `Dropdown.Trigger` *is* a button — its props type
 * extends the `Button` component's — so putting a `<Button>` inside it emitted
 * `<button><button>`. A browser cannot represent that: the HTML parser closes
 * the outer button when it meets the inner one, so the DOM it builds has two
 * siblings where React expects nesting. React then failed hydration with
 * #418 and **discarded the server HTML for the entire page**, re-rendering
 * everything on the client — on every route, because the offender was in the
 * shell. SSR was silently doing nothing for the whole dashboard.
 *
 * It had spread to eleven call sites before anything noticed, because nothing
 * about it is visible: the component looks right, behaves right, and only the
 * console carries a minified error code.
 */

/** Interactive elements the HTML parser refuses to nest inside one another. */
const NON_NESTABLE = ['button', 'a', 'form'];

function nestedPairs(html: string): string[] {
  const found: string[] = [];
  for (const tag of NON_NESTABLE) {
    // An opening tag, then another before the first one closes.
    const pattern = new RegExp(`<${tag}[^>]*>(?:(?!</${tag}>)[\\s\\S]){0,800}?<${tag}[\\s>]`, 'g');
    for (const match of html.matchAll(pattern)) {
      found.push(`<${tag}> inside <${tag}>: ${match[0].slice(0, 120)}…`);
    }
  }
  return found;
}

describe('server-rendered markup', () => {
  it('nests no interactive element inside another', () => {
    expect(nestedPairs(renderToStaticMarkup(<ThemeMenu />))).toEqual([]);
  });

  /**
   * Time-dependent text is marked as such.
   *
   * `formatRelative` reads the clock, so the server renders "just now" and the
   * browser, hydrating a moment later, renders "1 min ago". React counts that
   * as a failed hydration (#418 again, this time over text) and discards the
   * server HTML for the surrounding tree — the page still looks right, which is
   * why it survived, while the render it throws away was the reason to do one.
   *
   * `<Ago>` carries the `suppressHydrationWarning` that says "this text is
   * expected to differ", so using it is the whole fix. This asserts the
   * component keeps that attribute rather than asserting on any call site.
   */
  it('marks a relative timestamp as expected to differ', () => {
    const html = renderToStaticMarkup(<Ago value={new Date().toISOString()} />);

    // `renderToStaticMarkup` drops the attribute — it is a hydration hint, not
    // markup — so the property is checked on the element React would build.
    const element = Ago({ value: new Date().toISOString() });
    expect(element?.props.suppressHydrationWarning).toBe(true);
    expect(html).toContain('title=');
  });

  // Proves the detector would actually catch a regression, rather than being a
  // test that passes because its regex never matches anything.
  it('detects the nesting it exists to prevent', () => {
    const bad = renderToStaticMarkup(
      <button type="button">
        <button type="button">inner</button>
      </button>
    );
    expect(nestedPairs(bad)).toHaveLength(1);
  });
});
