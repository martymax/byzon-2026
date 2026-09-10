import { auth } from './auth';
import { database } from './database';
import { enforceOnboardingAccess } from './onboarding-access';

export const enforceRequestOnboarding = (request: Request) =>
  enforceOnboardingAccess(request, {
    db: database.db,
    getSession: (headers) => auth.api.getSession({ headers }),
  });
