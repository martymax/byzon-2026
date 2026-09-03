import { adminEngagementOverviewSchema } from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

describe('admin engagement identity policy', () => {
  it('requires a complete contact e-mail in the authorized admin overview', () => {
    expect(
      adminEngagementOverviewSchema.safeParse({
        eventId: '019fb200-0000-7000-8000-000000000001',
        settingsVersion: 1,
        assignmentsVersion: 1,
        features: {
          networkingEnabled: false,
          questionsEnabled: false,
          ratingsEnabled: false,
        },
        sessions: [],
        moderatorCandidates: [
          {
            userId: '019fb200-0000-7000-8000-000000000002',
            displayName: 'Demo Moderátor',
            contactEmail: 'moderator@example.test',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
