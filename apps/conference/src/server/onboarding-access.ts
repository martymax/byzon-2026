import { eq } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';
import { NextResponse } from 'next/server';

import { getRequestId } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { loadOnboardingState } from './onboarding';

import {
  requiresOnboardingAccess,
  within,
} from '../lib/onboarding-access-policy';

export const needsOnboarding = async (
  db: Database,
  userId: string,
  eventSlug = CURRENT_EVENT_SLUG,
): Promise<boolean> => {
  const event = await db.query.events.findFirst({
    columns: { id: true },
    where: eq(schema.events.slug, eventSlug),
  });
  if (!event) return false;
  // Existing endpoint authorization continues to handle missing/revoked access.
  const state = await loadOnboardingState(db, event.id, userId);
  return state !== null && state.status !== 'complete';
};

export interface OnboardingAccessDependencies {
  readonly currentEventSlug?: string;
  readonly db: Database;
  readonly getSession: (
    headers: Headers,
  ) => Promise<{ user: { id: string } } | null>;
}

export const enforceOnboardingAccess = async (
  request: Request,
  dependencies: OnboardingAccessDependencies,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!requiresOnboardingAccess(url.pathname)) return null;
  const responseHeaders = {
    'cache-control': 'private, no-store',
    vary: 'Cookie, Authorization',
    'x-request-id': getRequestId(request.headers),
  };
  try {
    const session = await dependencies.getSession(request.headers);
    if (
      !session ||
      !(await needsOnboarding(
        dependencies.db,
        session.user.id,
        dependencies.currentEventSlug,
      ))
    )
      return null;
  } catch {
    // Never expose the application when the prerequisite cannot be verified.
    return Response.json(
      {
        type: 'about:blank',
        title: 'Access verification unavailable',
        status: 503,
        code: 'INTERNAL_ERROR',
        detail: 'Access could not be verified. Please retry.',
        requestId: responseHeaders['x-request-id'],
      },
      {
        status: 503,
        headers: {
          ...responseHeaders,
          'content-type': 'application/problem+json',
        },
      },
    );
  }
  if (within(url.pathname, '/api/v1')) {
    return Response.json(
      {
        type: 'about:blank',
        title: 'Onboarding required',
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        detail:
          'Complete the current legal acknowledgement and profile before using the application.',
        requestId: responseHeaders['x-request-id'],
      },
      {
        status: 403,
        headers: {
          ...responseHeaders,
          'content-type': 'application/problem+json',
          'x-byzon-onboarding-required': 'true',
        },
      },
    );
  }
  // 303 also prevents replaying a protected form's POST body to onboarding.
  const response = NextResponse.redirect(
    new URL('/onboarding', url.origin),
    303,
  );
  for (const [name, value] of Object.entries(responseHeaders))
    response.headers.set(name, value);
  return response;
};
