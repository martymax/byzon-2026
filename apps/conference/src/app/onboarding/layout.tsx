import type { ReactNode } from 'react';

import { RouteFocus } from '@/components/route-focus';

export default function OnboardingLayout({
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
