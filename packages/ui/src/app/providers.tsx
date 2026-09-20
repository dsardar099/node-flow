'use client';

import { RouterProvider, Toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, type ReactNode } from 'react';
import { applyStoredTheme } from '../components/shell/theme';

/**
 * Client-side context for the whole app.
 *
 * `RouterProvider` is what makes HeroUI's `href` props — on links, breadcrumbs,
 * menu items and table rows — navigate through Next's router. Without it every
 * one of them is a plain anchor and a full page reload, which throws away
 * client state on every click.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Hydration resets the attributes the inline theme script put on <html>, so
  // the theme is applied again here — in a layout effect, before the browser
  // paints, so a dark user never sees the light theme flash in between.
  useLayoutEffect(applyStoredTheme, []);

  return (
    <RouterProvider navigate={(path) => router.push(path)}>
      {children}
      <Toast.Provider placement="bottom end" />
    </RouterProvider>
  );
}
