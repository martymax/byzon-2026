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
  const hostRoute = pathname === '/host' || pathname.startsWith('/host/');
  const signedInApplicationRoute = participantRoute || hostRoute;

  if (isAdminPath(pathname)) return children;

  return (
    <>
      <a className="skip-link" href="#main">
        Přejít na obsah
      </a>
      <header
        className={`app-header${signedInApplicationRoute ? ' app-header--application' : ''}`}
      >
        <Link
          aria-current={pathname === '/app' ? 'page' : undefined}
          aria-label={
            signedInApplicationRoute
              ? 'BYZON – účastnická aplikace'
              : 'BYZON – přihlášení'
          }
          className="brand"
          href={signedInApplicationRoute ? '/app' : '/'}
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
        {signedInApplicationRoute ? (
          <nav
            aria-label="Nápověda aplikace"
            className={`app-header-help${participantRoute ? ' app-header-help--with-notifications' : ''}`}
          >
            <Link
              aria-current={pathname === '/app/napoveda' ? 'page' : undefined}
              className="app-help-link"
              href="/app/napoveda"
            >
              <svg
                aria-hidden="true"
                fill="none"
                focusable="false"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 16h.01" />
              </svg>
              <span>Nápověda</span>
            </Link>
          </nav>
        ) : null}
      </header>
      <AppMain>{children}</AppMain>
    </>
  );
};
