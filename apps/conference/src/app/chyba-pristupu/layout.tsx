import type { ReactNode } from 'react';

import { RouteFocus } from '@/components/route-focus';

export default function AccessProblemLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <>
      <RouteFocus />
      {children}
    </>
  );
}
