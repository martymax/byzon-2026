import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OnboardingFlow } from '@/components/onboarding-flow';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Nastavení účasti',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <OnboardingFlow />;
}
