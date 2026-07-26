import { participantAgendaFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import { participantAgendaCalendar } from './calendar.js';

describe('private participant RFC 5545 calendar', () => {
  it('uses stable non-PII UID/SEQUENCE, UTC dates and cancellation state', () => {
    const fixture = {
      ...participantAgendaFixtures.cancelled!,
      items: [
        participantAgendaFixtures.saved!.items[0]!,
        participantAgendaFixtures.cancelled!.items[0]!,
      ],
    };
    const calendar = participantAgendaCalendar(fixture);

    expect(calendar).toContain(
      `UID:${fixture.items[0]!.session.calendar.uid}\r\nSEQUENCE:3`,
    );
    expect(calendar).toContain('DTSTART:20260918T070000Z');
    expect(calendar).toContain('STATUS:CANCELLED');
    expect(calendar).not.toContain(fixture.userId);
    expect(calendar).not.toContain('example.test');
    expect(calendar.endsWith('\r\n')).toBe(true);
  });

  it('escapes injection text and folds UTF-8 lines at 75 octets', () => {
    const item = participantAgendaFixtures.saved!.items[0]!;
    const agenda = {
      ...participantAgendaFixtures.saved!,
      items: [
        {
          ...item,
          session: {
            ...item.session,
            title: `${'🦬'.repeat(40)};\r\nATTENDEE:mailto:foreign@example.test`,
          },
        },
      ],
    };
    const calendar = participantAgendaCalendar(agenda);

    expect(calendar).not.toContain('\r\nATTENDEE:');
    expect(calendar).toContain('\\;\\nATTENDEE:mailto:foreign@example.test');
    expect(calendar).not.toContain('�');
    expect(
      calendar
        .split('\r\n')
        .every((line) => new TextEncoder().encode(line).byteLength <= 75),
    ).toBe(true);
  });

  it('keeps the UID stable and emits a higher sequence after republication', () => {
    const item = participantAgendaFixtures.saved!.items[0]!;
    const republished = {
      ...participantAgendaFixtures.saved!,
      publicationVersion: 4,
      items: [
        {
          ...item,
          session: {
            ...item.session,
            status: 'cancelled' as const,
            calendar: {
              ...item.session.calendar,
              sequence: 4,
            },
          },
          action: { state: 'cancelled' as const },
        },
      ],
    };
    const originalCalendar = participantAgendaCalendar(
      participantAgendaFixtures.saved!,
    );
    const republishedCalendar = participantAgendaCalendar(republished);

    expect(originalCalendar).toContain(
      `UID:${item.session.calendar.uid}\r\nSEQUENCE:3`,
    );
    expect(republishedCalendar).toContain(
      `UID:${item.session.calendar.uid}\r\nSEQUENCE:4`,
    );
    expect(republishedCalendar).toContain('STATUS:CANCELLED');
  });
});
