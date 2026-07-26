import { notFound } from 'next/navigation';

import { ParticipantProfile } from '@/components/participant-account-profile';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function ParticipantProfilePage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ParticipantProfile />;
}
