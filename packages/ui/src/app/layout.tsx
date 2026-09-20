import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './global.css';
import { Sidebar } from '../components/shell/sidebar';
import { THEME_SCRIPT } from '../components/shell/theme';
import { currentUser } from '../lib/api';
import { Providers } from './providers';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata = {
  title: { default: 'Node Flow', template: '%s · Node Flow' },
  description: 'Workflow orchestration',
};

/**
 * The shell: a slim sidebar and a scrolling content area.
 *
 * The user is resolved once, on the server, so navigation hides what a person
 * cannot reach rather than offering items that lead to a 403.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    // The theme class is set by the inline script before first paint; React
    // must not complain that the server rendered without it.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <Providers>
          {user ? (
            <div className="flex h-screen flex-col overflow-hidden md:flex-row">
              <Sidebar user={user} />
              <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
            </div>
          ) : (
            <main className="min-h-screen">{children}</main>
          )}
        </Providers>
      </body>
    </html>
  );
}
