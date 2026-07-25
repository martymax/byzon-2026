import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AccessProblem } from '@/components/access-problem';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Přístup není dostupný',
  robots: { index: false, follow: false },
};

export default function AccessProblemPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return <AccessProblem />;
}
