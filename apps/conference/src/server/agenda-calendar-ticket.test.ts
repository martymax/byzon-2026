import { describe, expect, it } from 'vitest';

import {
  AGENDA_CALENDAR_TICKET_TTL_MS,
  issueAgendaCalendarTicket,
  readAgendaCalendarTicket,
} from './agenda-calendar-ticket';

const secret = 'agenda-calendar-ticket-test-secret-at-least-32-characters';
const now = new Date('2026-09-18T07:00:00.000Z');
const claims = {
  userId: '1b433bf5-23fd-4c72-908f-91a6748d92f2',
  eventId: '9b433bf5-23fd-4c72-908f-91a6748d92f2',
  agendaVersion: 3,
  publicationVersion: 7,
};

describe('agenda calendar download ticket', () => {
  it('round-trips encrypted claims and permits repeated reads during its TTL', () => {
    const token = issueAgendaCalendarTicket({ ...claims, now, secret });
    const input = { token, now, secret };

    expect(readAgendaCalendarTicket(input)).toEqual(claims);
    expect(readAgendaCalendarTicket(input)).toEqual(claims);
    expect(token).not.toContain(claims.userId);
    expect(token).not.toContain(claims.eventId);
  });

  it('rejects tampering, another secret and expired tickets without throwing', () => {
    const token = issueAgendaCalendarTicket({ ...claims, now, secret });
    const tamperAt = Math.floor(token.length / 2);
    const replacement = token[tamperAt] === 'A' ? 'B' : 'A';
    const tampered = `${token.slice(0, tamperAt)}${replacement}${token.slice(tamperAt + 1)}`;

    expect(
      readAgendaCalendarTicket({ token: tampered, now, secret }),
    ).toBeNull();
    expect(
      readAgendaCalendarTicket({
        token,
        now,
        secret: 'another-agenda-calendar-secret-at-least-32-characters',
      }),
    ).toBeNull();
    expect(
      readAgendaCalendarTicket({
        token,
        now: new Date(now.getTime() + AGENDA_CALENDAR_TICKET_TTL_MS),
        secret,
      }),
    ).toBeNull();
  });

  it('rejects invalid inputs and refuses to issue with a weak secret', () => {
    expect(
      readAgendaCalendarTicket({ token: 'not-a-ticket', now, secret }),
    ).toBeNull();
    expect(() =>
      issueAgendaCalendarTicket({ ...claims, now, secret: 'too-short' }),
    ).toThrow(TypeError);
  });
});
