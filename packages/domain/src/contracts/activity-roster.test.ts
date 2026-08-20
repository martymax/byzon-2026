import { describe, expect, it } from 'vitest';

import {
  activityRosterCachePolicy,
  activityRosterResponseSchema,
} from './index.js';

const roster = {
  eventId: '019fb900-0000-7000-8000-000000000001',
  generatedAt: '2026-09-18T08:00:00.000+02:00',
  sessions: [
    {
      sessionId: '019fb900-0000-7000-8000-000000000002',
      title: 'Syntetická kapacitní aktivita',
      startsAt: '2026-09-18T10:00:00.000+02:00',
      capacity: 2,
      participants: [
        {
          reservationId: '019fb900-0000-7000-8000-000000000003',
          state: 'reserved' as const,
          displayName: 'Alex Novák',
          company: 'Ukázková firma',
        },
      ],
    },
  ],
};

describe('CS-ROSTER-01', () => {
  it('contains only read-only assigned-session roster fields', () => {
    expect(activityRosterResponseSchema.parse(roster)).toEqual(roster);
    expect(activityRosterCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      vary: ['authorization', 'cookie'],
      browserPersistence: 'forbidden',
      mutation: 'none-read-only',
    });
  });

  it('rejects duplicate or over-capacity roster entries', () => {
    const participant = roster.sessions[0]!.participants[0]!;
    expect(
      activityRosterResponseSchema.safeParse({
        ...roster,
        sessions: [
          {
            ...roster.sessions[0]!,
            capacity: 1,
            participants: [participant, participant],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
