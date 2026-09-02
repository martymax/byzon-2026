import { describe, expect, it } from 'vitest';

import { participantProgramSessionCalendar } from './program-calendar.js';

const session = {
  id: '01990f96-7830-7000-8000-000000000001',
  dayId: '01990f96-7830-7000-8000-000000000002',
  roomId: '01990f96-7830-7000-8000-000000000003',
  slug: 'rust-bez-zkratek',
  title: 'Růst bez zkratek, ale s důvěrou',
  summary: 'Praktická přednáška; bez marketingových zkratek.',
  description: null,
  type: 'talk' as const,
  status: 'published' as const,
  startsAt: '2026-09-18T08:00:00.000Z',
  endsAt: '2026-09-18T09:00:00.000Z',
  questionsEnabled: true,
  sortOrder: 1,
};

describe('participant program session calendar', () => {
  it('produces one portable RFC 5545 event without participant data', () => {
    const calendar = participantProgramSessionCalendar({
      session,
      room: { name: 'BYZON Stage' },
      version: 2,
      publishedAt: '2026-08-24T10:15:00.000Z',
    });

    expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
    expect(calendar).toContain(`UID:${session.id}@program.byzon.cz`);
    expect(calendar).toContain('SEQUENCE:2\r\n');
    expect(calendar).toContain('DTSTART:20260918T080000Z\r\n');
    expect(calendar).toContain('DTEND:20260918T090000Z\r\n');
    expect(calendar).toContain('LOCATION:BYZON Stage\r\n');
    expect(calendar).not.toContain('bez marketingových zkratek\\.');
    expect(calendar).toContain(
      'DESCRIPTION:Praktická přednáška\\; bez marketingových zkratek.',
    );
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendar.endsWith('\r\n')).toBe(true);
  });

  it('marks a cancelled item and folds long UTF-8 lines', () => {
    const calendar = participantProgramSessionCalendar({
      session: {
        ...session,
        title: `Příliš žluťoučký kůň ${'ú'.repeat(90)}`,
        status: 'cancelled',
      },
      version: 3,
      publishedAt: '2026-08-24T10:15:00.000Z',
    });

    expect(calendar).toContain('STATUS:CANCELLED\r\n');
    expect(calendar).toContain('\r\n ');
    for (const line of calendar.split('\r\n')) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
  });
});
