import type { ReactNode } from 'react';
import { ParticipantShellNavigation } from '@/components/participant-shell-navigation';
import { RouteFocus } from '@/components/route-focus';

export default function ParticipantLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <RouteFocus />
      <ParticipantShellNavigation />
      <div className="participant-shell-content">{children}</div>
    </>
  );
}
