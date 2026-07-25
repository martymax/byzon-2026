import { ParticipantTicket } from '@/components/participant-ticket';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { notFound } from 'next/navigation';

export default function ParticipantTicketPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ParticipantTicket />;
}
