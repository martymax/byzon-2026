import { notFound } from 'next/navigation';

import { ParticipantAnnouncement } from '@/components/participant-announcement';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEventId } from '@/server/current-event';

export const dynamic = 'force-dynamic';

export default async function ParticipantAnnouncementPage({
  params,
}: {
  readonly params: Promise<{ readonly announcementId: string }>;
}) {
  if (!isFrontendPreviewAvailable()) notFound();
  const [{ announcementId }, eventId] = await Promise.all([
    params,
    loadCurrentEventId(),
  ]);
  if (!eventId) notFound();
  return (
    <ParticipantAnnouncement
      announcementId={announcementId}
      eventId={eventId}
    />
  );
}
