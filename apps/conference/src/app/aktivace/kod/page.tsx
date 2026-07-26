import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationCodeForm } from '@/components/activation-code-form';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Aktivace kódem',
  robots: { index: false, follow: false },
};

export default function ActivationCodePage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ActivationCodeForm />;
}
