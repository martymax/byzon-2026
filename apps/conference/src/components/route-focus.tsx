'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export const RouteFocus = () => {
  const pathname = usePathname();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>('[data-route-heading]') ??
        document.querySelector<HTMLElement>('#main');
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
};
