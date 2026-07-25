'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export const RouteFocus = () => {
  const pathname = usePathname();

  useEffect(() => {
    let observer: MutationObserver | undefined;
    let observerTimeout: number | undefined;

    const frame = window.requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>('#main');
      let focusedHeading = document.querySelector<HTMLElement>(
        '[data-route-heading]',
      );
      (focusedHeading ?? main)?.focus({ preventScroll: true });

      if (!main) {
        return;
      }

      observer = new MutationObserver(() => {
        if (
          document.activeElement !== main &&
          document.activeElement !== focusedHeading &&
          document.activeElement !== document.body
        ) {
          observer?.disconnect();
          return;
        }

        const nextHeading = document.querySelector<HTMLElement>(
          '[data-route-heading]',
        );
        if (nextHeading && nextHeading !== focusedHeading) {
          nextHeading.focus({ preventScroll: true });
          focusedHeading = nextHeading;
          observer?.disconnect();
          if (observerTimeout !== undefined) {
            window.clearTimeout(observerTimeout);
          }
        }
      });
      observer.observe(main, { childList: true, subtree: true });
      observerTimeout = window.setTimeout(() => observer?.disconnect(), 5_000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (observerTimeout !== undefined) {
        window.clearTimeout(observerTimeout);
      }
    };
  }, [pathname]);

  return null;
};
