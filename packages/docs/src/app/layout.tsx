import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Analytics } from '../components/analytics';
import './global.css';

export const metadata = {
  title: {
    default: 'node-flow documentation',
    template: '%s · node-flow',
  },
  description:
    'Documentation for node-flow, a workflow orchestrator with Conductor’s model running on Postgres alone.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
