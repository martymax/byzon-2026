import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { readParticipantProgram } from './participant-program';

vi.mock('./policy', () => ({
  requireEventPermission: vi.fn(),
  EventAccessDeniedError: class extends Error {},
}));

const fixture = participantProgramFixtures.happy!;
const first = fixture.program.sessions[0]!;
const second = fixture.program.sessions[1]!;

const responseFor = async (confirmed: number, etag?: string) => {
  const db = {
    query: {
      contentPublications: {
        findFirst: async () => ({
          version: fixture.version,
          snapshot: { program: fixture.program },
          checksumSha256: 'a'.repeat(64),
          publishedAt: new Date(fixture.publishedAt),
        }),
      },
      programSessions: {
        findMany: async () => [
          {
            id: first.id,
            capacityMode: 'reservation',
            capacity: 6,
            reservationGroupId: null,
          },
          {
            id: second.id,
            capacityMode: 'reservation',
            capacity: 99,
            reservationGroupId: first.id,
          },
        ],
      },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: async () => [{ sessionId: first.id, confirmed }],
        }),
      }),
    }),
  };
  return readParticipantProgram(
    new Request(
      `https://app.byzon.test/api/v1/events/${fixture.eventId}/program`,
      {
        ...(etag ? { headers: { 'if-none-match': etag } } : {}),
      },
    ),
    fixture.eventId,
    {
      db: db as never,
      getSession: async () => ({ user: { id: crypto.randomUUID() } }),
    },
  );
};

describe('program operational capacity', () => {
  it('uses the canonical group capacity and confirmed reservations for both sessions', async () => {
    const response = await responseFor(2);
    expect(response.status).toBe(200);
    const body = await response.json();
    for (const id of [first.id, second.id]) {
      expect(
        body.program.sessions.find((s: { id: string }) => s.id === id)
          .availability,
      ).toEqual({ capacity: 6, remaining: 4 });
    }
    expect(
      body.program.sessions
        .filter((s: { id: string }) => ![first.id, second.id].includes(s.id))
        .every((s: { availability: unknown }) => s.availability === null),
    ).toBe(true);
  });

  it('invalidates the ETag when reservations change and never reports negative places', async () => {
    const initial = await responseFor(2);
    const etag = initial.headers.get('etag')!;
    expect((await responseFor(2, etag)).status).toBe(304);
    const full = await responseFor(7, etag);
    expect(full.status).toBe(200);
    expect(full.headers.get('etag')).not.toBe(etag);
    const body = await full.json();
    expect(
      body.program.sessions.find((s: { id: string }) => s.id === first.id)
        .availability,
    ).toEqual({ capacity: 6, remaining: 0 });
  });
});
