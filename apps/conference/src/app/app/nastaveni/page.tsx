import { notFound } from 'next/navigation';

import { ParticipantAccountSettings } from '@/components/participant-account-settings';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function ParticipantSettingsPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ParticipantAccountSettings />;
}
