import type { Metadata } from 'next';

import { OnboardingFlow } from '@/components/onboarding-flow';

export const metadata: Metadata = {
  title: 'Nastavení účasti',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
