import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationEntry } from '@/components/activation-entry';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Aktivace',
  robots: { index: false, follow: false },
};

export default function ActivationPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ActivationEntry />;
}
