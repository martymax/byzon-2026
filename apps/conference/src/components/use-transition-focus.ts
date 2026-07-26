'use client';

import { useEffect, useRef } from 'react';

export const useTransitionFocus = (active: boolean) => {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return heading;
};
