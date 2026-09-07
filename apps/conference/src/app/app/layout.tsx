import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { ParticipantLayoutShell } from '@/components/participant-layout-shell';
import type { ParticipantAccountScope } from '@/components/participant-account-resource';
import type { ParticipantShellNavigationMode } from '@/components/participant-shell-navigation';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { resolveParticipantSessionContext } from '@/server/participant-session-context';
import {
  loadParticipantLayoutEventContext,
  type ParticipantCurrentEventState,
} from '@/server/current-event';

export const dynamic = 'force-dynamic';

const loadSessionNavigationContext = async (previewAvailable: boolean) => {
  if (previewAvailable) return null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return await resolveParticipantSessionContext(
      database.db,
      session?.user.id,
    );
  } catch {
    // Navigation hints must not make the account recovery controls unreachable.
    console.error(
      '[BYZON] Could not load participant session navigation context.',
    );
    return null;
  }
};

export const participantShellNavigationMode = (
  currentEvent: Pick<ParticipantCurrentEventState, 'kind'>,
  previewAvailable: boolean,
): ParticipantShellNavigationMode => {
  if (currentEvent.kind === 'archived') {
    return previewAvailable ? 'archived-preview' : 'archived';
  }
  if (currentEvent.kind === 'unavailable') return 'unavailable';
  return previewAvailable ? 'active-preview' : 'active';
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
  const previewAvailable = isFrontendPreviewAvailable();
  const sessionContext = await loadSessionNavigationContext(previewAvailable);
  const { currentEvent } = context;
  const navigationMode = participantShellNavigationMode(
    currentEvent,
    previewAvailable,
  );

  return (
    <ParticipantLayoutShell
      sessionContext={sessionContext}
      accountScope={participantAccountScope(
        currentEvent,
        'eventFingerprint' in context ? context.eventFingerprint : undefined,
      )}
      navigationMode={navigationMode}
      notificationsEnabled={currentEvent.kind === 'available'}
    >
      {children}
    </ParticipantLayoutShell>
  );
}
