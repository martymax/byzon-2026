import { notFound } from 'next/navigation';

import { ParticipantPrivacy } from '@/components/participant-account-privacy';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function ParticipantPrivacyPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ParticipantPrivacy />;
}
