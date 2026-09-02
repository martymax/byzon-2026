import { describe, expect, it, vi } from 'vitest';

import {
  readParticipantProgram,
  readParticipantProgramSessionCalendar,
} from './participant-program';

describe('participant program request validation', () => {
  it('rejects malformed identifiers before authentication or database access', async () => {
    const getSession = vi.fn();
    const response = await readParticipantProgram(
      new Request('https://app.byzon.test/api/v1/events/not-a-uuid/program'),
      'not-a-uuid',
      { db: undefined as never, getSession },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_EVENT_ID',
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects unknown, repeated and unbounded filters', async () => {
    const getSession = vi.fn();
    const eventId = crypto.randomUUID();
    const response = await readParticipantProgram(
      new Request(
        `https://app.byzon.test/api/v1/events/${eventId}/program?day=a&day=b&unknown=x`,
      ),
      eventId,
      { db: undefined as never, getSession },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_PROGRAM_FILTERS',
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects malformed session calendar identifiers before authentication', async () => {
    const getSession = vi.fn();
    const eventId = crypto.randomUUID();
    const response = await readParticipantProgramSessionCalendar(
      new Request(
        `https://app.byzon.test/api/v1/events/${eventId}/program/not-a-uuid/calendar.ics`,
      ),
      eventId,
      'not-a-uuid',
      { db: undefined as never, getSession },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_SESSION_ID',
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects calendar query parameters before authentication', async () => {
    const getSession = vi.fn();
    const eventId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const response = await readParticipantProgramSessionCalendar(
      new Request(
        `https://app.byzon.test/api/v1/events/${eventId}/program/${sessionId}/calendar.ics?version=1`,
      ),
      eventId,
      sessionId,
      { db: undefined as never, getSession },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_CALENDAR_EXPORT_REQUEST',
    });
    expect(getSession).not.toHaveBeenCalled();
  });
});
