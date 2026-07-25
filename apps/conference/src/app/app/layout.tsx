import type { ReactNode } from 'react';
import { ParticipantLayoutShell } from '@/components/participant-layout-shell';
import type { ParticipantAccountScope } from '@/components/participant-account-resource';
import type { ParticipantShellNavigationMode } from '@/components/participant-shell-navigation';
import {
  loadParticipantLayoutEventContext,
  type ParticipantCurrentEventState,
} from '@/server/current-event';

export const dynamic = 'force-dynamic';

export const participantShellNavigationMode = (
  currentEvent: Pick<ParticipantCurrentEventState, 'kind'>,
): ParticipantShellNavigationMode => {
  if (currentEvent.kind === 'archived') return 'archived';
  if (currentEvent.kind === 'unavailable') return 'unavailable';
  return 'active';
};

export const participantAccountScope = (
  currentEvent:
    | { readonly kind: 'available'; readonly event: { readonly id: string } }
    | { readonly kind: 'archived' | 'unavailable' },
  archivedEventFingerprint?: string,
): ParticipantAccountScope =>
  currentEvent.kind === 'available'
    ? { kind: 'active', eventId: currentEvent.event.id }
    : currentEvent.kind === 'archived'
      ? {
          kind: 'archived',
          eventFingerprint: archivedEventFingerprint ?? '',
        }
      : { kind: 'unavailable' };

export default async function ParticipantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await loadParticipantLayoutEventContext();
  const { currentEvent } = context;

  return (
    <ParticipantLayoutShell
      accountScope={participantAccountScope(
        currentEvent,
        'eventFingerprint' in context ? context.eventFingerprint : undefined,
      )}
      navigationMode={participantShellNavigationMode(currentEvent)}
    >
      {children}
    </ParticipantLayoutShell>
  );
}
