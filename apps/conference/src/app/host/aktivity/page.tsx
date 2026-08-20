import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { ActivityRoster } from '@/components/activity-roster';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { ApiProblemError } from '@/server/api/problem';
import { loadActivityRoster } from '@/server/activity-roster';
import { auth } from '@/server/auth';
import { database } from '@/server/database';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Vedoucí aktivity',
  robots: { index: false, follow: false },
};

export default async function ActivityRosterPage() {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
  ) {
    if (isFrontendPreviewAvailable()) {
      const { ActivityRosterPreview } =
        await import('../../../test/mocks/activity-roster-preview');
      return <ActivityRosterPreview />;
    }
  }

  let data;
  try {
    data = await loadActivityRoster(new Headers(await headers()), {
      db: database.db,
      getSession: (requestHeaders) =>
        auth.api.getSession({ headers: requestHeaders }),
    });
  } catch (error) {
    if (
      error instanceof ApiProblemError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      notFound();
    }
    throw error;
  }
  return <ActivityRoster data={data} />;
}
