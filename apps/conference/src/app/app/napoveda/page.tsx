import { IDENTITY_SUPPORT_EMAIL } from '@/server/identity';
import { notFound } from 'next/navigation';
import { ParticipantHelp } from '@/components/participant-help';
import { loadParticipantCurrentEvent } from '@/server/current-event';

export default async function ParticipantHelpPage() {
  const event = await loadParticipantCurrentEvent();
  if (event.kind !== 'available') notFound();
  return <ParticipantHelp supportEmail={IDENTITY_SUPPORT_EMAIL} />;
}
