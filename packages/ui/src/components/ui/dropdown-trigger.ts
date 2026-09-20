import { buttonVariants } from '@heroui/styles';

/**
 * Button styling for a `Dropdown.Trigger`.
 *
 * `Dropdown.Trigger` renders its own `<button>` — it extends React Aria's
 * `Button`, not HeroUI's — and the `dropdown__trigger` class it carries has no
 * styling of its own. So a trigger that should look like a button has to say
 * so, and the obvious way to do that is to put a HeroUI `<Button>` inside it.
 *
 * That produces `<button><button>`, which no browser will parse back the way it
 * was written: the parser closes the outer button at the inner one, so the DOM
 * has two siblings where React expects nesting. Hydration then fails and React
 * throws away the server HTML for the whole page. Because the mistake is
 * invisible — the component looks and behaves correctly — it had spread to
 * eleven call sites.
 *
 * This produces the same classes from the library's own variant definition, so
 * the trigger *is* the button. Reading the classes from `buttonVariants` rather
 * than writing `"button button--sm button--ghost"` by hand keeps them correct
 * when HeroUI renames one.
 *
 * `specs/hydration.spec.tsx` fails if the nesting comes back.
 *
 * **`inline-flex` is not decoration.** `buttonVariants` describes a `<button>`
 * HeroUI renders itself, and that element gets its `display:inline-flex` from
 * the component rather than from the `.button` class — a `Dropdown.Trigger`
 * wearing the same classes stays at the `inline-block` a `<button>` defaults
 * to. One child looks identical either way, which is why every icon-only
 * trigger in the app was fine; two children stack vertically instead of
 * sitting in a row, and `gap`, `justify-*` and `truncate` all stop working.
 * That is what made the sidebar's user block render its avatar above an
 * un-truncated email. Setting it here fixes every call site at once.
 */
export const triggerClass = (
  options: Parameters<typeof buttonVariants>[0] = {}
): string => `${buttonVariants(options)} inline-flex`;
