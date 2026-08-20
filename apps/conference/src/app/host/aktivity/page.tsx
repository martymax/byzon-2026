import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Vedoucí aktivity',
  robots: { index: false, follow: false },
};

export default async function ActivityRosterPage() {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
  ) {
    if (!isFrontendPreviewAvailable()) notFound();
    const { ActivityRosterPreview } =
      await import('../../../test/mocks/activity-roster-preview');
    return <ActivityRosterPreview />;
  }
  notFound();
}
