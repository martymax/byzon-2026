import type { ReactNode } from 'react';

import { RouteFocus } from '@/components/route-focus';

export default function LoginLayout({
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
