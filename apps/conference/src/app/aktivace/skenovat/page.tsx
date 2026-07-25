import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationScannerGate } from '@/components/activation-scanner';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Aktivace kamerou',
  robots: { index: false, follow: false },
};

export default function ActivationScannerPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ActivationScannerGate />;
}
