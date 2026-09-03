'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppMain } from './app-main';

const isAdminPath = (pathname: string): boolean =>
  pathname === '/admin' || pathname.startsWith('/admin/');

export const RouteAwareChrome = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const pathname = usePathname();
  const participantRoute = pathname === '/app' || pathname.startsWith('/app/');

  if (isAdminPath(pathname)) return children;

  return (
    <>
      <a className="skip-link" href="#main">
        Přejít na obsah
      </a>
      <header className="app-header">
        <Link
          aria-current={pathname === '/app' ? 'page' : undefined}
          aria-label={
            participantRoute
              ? 'BYZON – přehled účastnické aplikace'
              : 'BYZON – přihlášení'
          }
          className="brand"
          href={participantRoute ? '/app' : '/'}
        >
          <Image
            alt=""
            className="brand-logo"
            height={451}
            priority
            src="/brand/logo.png"
            unoptimized
            width={2884}
          />
        </Link>
      </header>
      <AppMain>{children}</AppMain>
    </>
  );
};
