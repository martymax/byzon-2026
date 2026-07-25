'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type MouseEvent, type ReactNode } from 'react';

import { subscribeToClientNavigation } from '@/lib/client-navigation-events';

const shouldUseClientNavigation = (
  event: MouseEvent<HTMLElement>,
  link: HTMLAnchorElement,
): boolean => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target === '_blank' ||
    link.hasAttribute('download')
  ) {
    return false;
  }

  const current = new URL(window.location.href);
  const destination = new URL(link.href, current);
  if (destination.origin !== current.origin) return false;
  if (
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.hash !== current.hash
  ) {
    return false;
  }
  return true;
};

export const AppMain = ({ children }: { readonly children: ReactNode }) => {
  const router = useRouter();

  useEffect(
    () =>
      subscribeToClientNavigation((href) => {
        const current = new URL(window.location.href);
        const destination = new URL(href, current);
        if (destination.origin !== current.origin) return;
        router.push(
          `${destination.pathname}${destination.search}${destination.hash}`,
        );
      }),
    [router],
  );

  return (
    <main
      id="main"
      onClickCapture={(event) => {
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[href]')
            : null;
        if (!link || !shouldUseClientNavigation(event, link)) return;

        const destination = new URL(link.href, window.location.href);
        event.preventDefault();
        router.push(
          `${destination.pathname}${destination.search}${destination.hash}`,
        );
      }}
      tabIndex={-1}
    >
      {children}
    </main>
  );
};
