import { activityRosterResponseSchema } from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const activityRosterFixtures = defineFixtureSet({
  name: 'activity-roster',
  schema: activityRosterResponseSchema,
  fixtures: {
    assigned: {
      eventId: '019fb900-0000-7000-8000-000000000001',
      generatedAt: '2026-09-18T08:00:00.000+02:00',
      sessions: [
        {
          sessionId: '019fb900-0000-7000-8000-000000000002',
          title: 'Mastermind Expertního Boardu',
          startsAt: '2026-09-18T10:00:00.000+02:00',
          capacity: 12,
          participants: [
            {
              reservationId: '019fb900-0000-7000-8000-000000000003',
              state: 'reserved',
              displayName: 'Alex Novák',
              company: 'Ukázková firma',
            },
            {
              reservationId: '019fb900-0000-7000-8000-000000000004',
              state: 'waitlisted',
              displayName: 'Mila Testová',
              company: null,
            },
          ],
        },
      ],
    },
    empty: {
      eventId: '019fb900-0000-7000-8000-000000000001',
      generatedAt: '2026-09-18T08:00:00.000+02:00',
      sessions: [],
    },
  },
});
