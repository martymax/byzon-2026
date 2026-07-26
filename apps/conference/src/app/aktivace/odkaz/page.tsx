import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationLinkConsumer } from '@/components/activation-link-consumer';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Jednorázový aktivační odkaz',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ActivationLinkPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <ActivationLinkConsumer />;
}
