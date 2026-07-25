import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Check-in operátor',
  robots: { index: false, follow: false },
};

export default async function CheckinPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.NODE_ENV !== 'test'
  ) {
    notFound();
  }
  const { CheckinPreviewOperator } =
    await import('../../test/mocks/checkin-preview-operator');
  return <CheckinPreviewOperator />;
}
