import type { Metadata, Viewport } from 'next';
import { Inter, Khand } from 'next/font/google';
import type { ReactNode } from 'react';
import { RouteAwareChrome } from '@/components/route-aware-chrome';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import './styles.css';

const khand = Khand({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-khand',
  weight: ['400', '500', '600', '700'],
});

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: { default: 'BYZON 2026', template: '%s | BYZON 2026' },
  description: 'Konferenční aplikace BYZON 2026',
  applicationName: 'BYZON 2026',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BYZON' },
};

export const viewport: Viewport = {
  themeColor: '#f5218e',
  colorScheme: 'light',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="cs" className={`${khand.variable} ${inter.variable}`}>
      <body>
        <RouteAwareChrome>{children}</RouteAwareChrome>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
