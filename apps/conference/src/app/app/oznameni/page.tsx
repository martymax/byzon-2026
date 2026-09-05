import { notFound } from 'next/navigation';

import { ParticipantInbox } from '@/components/participant-inbox';
import { loadCurrentEventId } from '@/server/current-event';

export const dynamic = 'force-dynamic';

export default async function ParticipantAnnouncementInboxPage() {
  const eventId = await loadCurrentEventId();
  if (!eventId) notFound();
  return <ParticipantInbox eventId={eventId} />;
}
