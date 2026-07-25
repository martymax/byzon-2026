import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CheckinOperator } from '@/components/checkin-operator';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Check-in operátor',
  robots: { index: false, follow: false },
};

export default function CheckinPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <CheckinOperator />;
}
