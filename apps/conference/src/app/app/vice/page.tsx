import { notFound } from 'next/navigation';

import { ParticipantMoreHub } from '@/components/participant-account-more';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import {
  loadParticipantCurrentEvent,
  type ParticipantCurrentEventState,
} from '@/server/current-event';

export const canOpenParticipantMore = (
  state: Pick<ParticipantCurrentEventState, 'kind'>,
): boolean => state.kind === 'available';

export default async function ParticipantMorePage() {
  if (!isFrontendPreviewAvailable()) notFound();
  const currentEvent = await loadParticipantCurrentEvent();
  if (!canOpenParticipantMore(currentEvent)) notFound();
  return <ParticipantMoreHub />;
}
