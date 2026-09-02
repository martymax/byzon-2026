import { describe, expect, it } from 'vitest';

import {
  adminContentBodyFromForm,
  localInputValue,
  programTimeRangeLabel,
  zonedLocalToIso,
} from './admin-content-console';

const ids = {
  day: '019fc800-0000-7000-8000-000000000001',
  room: '019fc800-0000-7000-8000-000000000002',
  speaker: '019fc800-0000-7000-8000-000000000003',
  venue: '019fc800-0000-7000-8000-000000000004',
  session: '019fc800-0000-7000-8000-000000000005',
} as const;

const formData = (
  values: Readonly<Record<string, string | readonly string[]>>,
): FormData => {
  const form = new FormData();
  Object.entries(values).forEach(([field, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => form.append(field, entry));
    } else {
      form.set(field, value as string);
    }
  });
  return form;
};

describe('admin event timezone conversion', () => {
  it('formats a compact event-local program time range', () => {
    expect(
      programTimeRangeLabel(
        '2026-09-18T07:00:00.000Z',
        '2026-09-18T08:00:00.000Z',
        'Europe/Prague',
      ),
    ).toBe('9:00–10:00');
    expect(programTimeRangeLabel(null, null, 'Europe/Prague')).toBe(
      'Čas neurčen',
    );
  });

  it('uses the named timezone daylight-saving offset', () => {
    expect(zonedLocalToIso('2026-01-15T10:00', 'Europe/Prague')).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(zonedLocalToIso('2026-07-15T10:00', 'Europe/Prague')).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('round-trips an event-local form value', () => {
    const local = localInputValue('2026-01-15T09:00:00.000Z', 'Europe/Prague');
    expect(local).toBe('2026-01-15T10:00');
    expect(zonedLocalToIso(local, 'Europe/Prague')).toBe(
      '2026-01-15T09:00:00.000Z',
    );
  });

  it('round-trips valid local times on both sides of Prague DST changes', () => {
    expect(zonedLocalToIso('2026-03-29T01:30', 'Europe/Prague')).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(localInputValue('2026-03-29T00:30:00.000Z', 'Europe/Prague')).toBe(
      '2026-03-29T01:30',
    );
    expect(zonedLocalToIso('2026-10-25T01:30', 'Europe/Prague')).toBe(
      '2026-10-24T23:30:00.000Z',
    );
    expect(localInputValue('2026-10-24T23:30:00.000Z', 'Europe/Prague')).toBe(
      '2026-10-25T01:30',
    );
  });

  it('rejects nonexistent and ambiguous Prague wall-clock times', () => {
    expect(() => zonedLocalToIso('2026-03-29T02:30', 'Europe/Prague')).toThrow(
      /does not exist/,
    );
    expect(() => zonedLocalToIso('2026-10-25T02:30', 'Europe/Prague')).toThrow(
      /ambiguous/,
    );
  });
});

describe('admin content form contract mapping', () => {
  it.each([
    [
      'days',
      {
        description: 'Popis dne',
        localDate: '2026-09-18',
        sortOrder: '1',
        title: 'Pátek',
      },
      {
        description: 'Popis dne',
        localDate: '2026-09-18',
        sortOrder: 1,
        title: 'Pátek',
      },
    ],
    [
      'venues',
      {
        mapQuery: 'Clarion České Budějovice',
        navigationMarkdown: 'Hlavním vchodem.',
        slug: 'clarion',
        sortOrder: '2',
        status: 'published',
        title: 'Clarion',
      },
      {
        mapQuery: 'Clarion České Budějovice',
        name: 'Clarion',
        navigationMarkdown: 'Hlavním vchodem.',
        slug: 'clarion',
        sortOrder: 2,
        status: 'published',
      },
    ],
    [
      'rooms',
      {
        capacity: '80',
        description: 'Menší workshopová místnost.',
        slug: 'workshop-room',
        sortOrder: '3',
        status: 'draft',
        title: 'Workshop room',
        venueId: ids.venue,
      },
      {
        capacity: 80,
        description: 'Menší workshopová místnost.',
        name: 'Workshop room',
        slug: 'workshop-room',
        sortOrder: 3,
        status: 'draft',
        venueId: ids.venue,
      },
    ],
    [
      'sessions',
      {
        summary: 'Krátké shrnutí.',
        dayId: ids.day,
        description: 'Podrobný popis.',
        endsAt: '2026-09-18T11:00',
        roomId: ids.room,
        slug: 'bezpecny-rust',
        sortOrder: '4',
        speakerIds: [ids.speaker],
        startsAt: '2026-09-18T10:00',
        status: 'published',
        title: 'Bezpečný růst',
        type: 'talk',
      },
      {
        dayId: ids.day,
        description: 'Podrobný popis.',
        endsAt: '2026-09-18T11:00:00.000Z',
        roomId: ids.room,
        slug: 'bezpecny-rust',
        sortOrder: 4,
        speakerIds: [ids.speaker],
        startsAt: '2026-09-18T10:00:00.000Z',
        status: 'published',
        summary: 'Krátké shrnutí.',
        title: 'Bezpečný růst',
        type: 'talk',
      },
    ],
    [
      'speakers',
      {
        bioMarkdown: 'Bio řečnice.',
        firstName: 'Dana',
        jobTitle: 'Facilitátorka',
        company: 'Example.test',
        facebookUrl: 'https://www.facebook.com/dana',
        instagramUrl: 'https://www.instagram.com/dana',
        lastName: 'Nová',
        linkedinUrl: 'https://example.test/linkedin',
        sessionIds: [ids.session],
        slug: 'dana-nova',
        sortOrder: '5',
        status: 'draft',
        websiteUrl: 'https://example.test/dana',
      },
      {
        bioMarkdown: 'Bio řečnice.',
        company: 'Example.test',
        facebookUrl: 'https://www.facebook.com/dana',
        firstName: 'Dana',
        instagramUrl: 'https://www.instagram.com/dana',
        jobTitle: 'Facilitátorka',
        lastName: 'Nová',
        linkedinUrl: 'https://example.test/linkedin',
        sessionIds: [ids.session],
        slug: 'dana-nova',
        sortOrder: 5,
        status: 'draft',
        websiteUrl: 'https://example.test/dana',
      },
    ],
    [
      'partners',
      {
        descriptionMarkdown: 'Popis partnera.',
        category: 'Hlavní partner',
        slug: 'partner-example',
        sortOrder: '6',
        status: 'published',
        tier: 'gold',
        title: 'Partner Example',
        websiteUrl: 'https://example.test/partner',
      },
      {
        category: 'Hlavní partner',
        descriptionMarkdown: 'Popis partnera.',
        name: 'Partner Example',
        slug: 'partner-example',
        sortOrder: 6,
        status: 'published',
        tier: 'gold',
        websiteUrl: 'https://example.test/partner',
      },
    ],
    [
      'pages',
      {
        bodyMarkdown: 'Obsah praktické stránky.',
        kind: 'practical',
        slug: 'registrace',
        sortOrder: '7',
        status: 'published',
        summary: 'Krátké shrnutí.',
        title: 'Registrace',
      },
      {
        bodyMarkdown: 'Obsah praktické stránky.',
        kind: 'practical',
        slug: 'registrace',
        sortOrder: 7,
        status: 'published',
        summary: 'Krátké shrnutí.',
        title: 'Registrace',
      },
    ],
    [
      'faqs',
      {
        answerMarkdown: 'Ano, v přízemí.',
        category: 'Na místě',
        sortOrder: '8',
        status: 'published',
        title: 'Je k dispozici šatna?',
      },
      {
        answerMarkdown: 'Ano, v přízemí.',
        category: 'Na místě',
        question: 'Je k dispozici šatna?',
        sortOrder: 8,
        status: 'published',
      },
    ],
  ] as const)(
    'maps the %s editor to the route payload',
    (resource, values, expected) => {
      expect(
        adminContentBodyFromForm(resource, formData(values), 'UTC'),
      ).toEqual(expected);
    },
  );

  it.each([
    'talk',
    'panel',
    'workshop',
    'mastermind',
    'coaching',
    'networking',
    'break',
    'meal',
    'gala',
    'other',
  ] as const)('preserves the supported session type %s', (type) => {
    const body = adminContentBodyFromForm(
      'sessions',
      formData({
        dayId: ids.day,
        endsAt: '2026-09-18T11:00',
        slug: 'session-type',
        startsAt: '2026-09-18T10:00',
        title: 'Typ programu',
        type,
      }),
      'UTC',
    );

    expect(body.type).toBe(type);
  });

  it('includes the exact current version only for an update', () => {
    const values = formData({
      descriptionMarkdown: 'Popis partnera.',
      slug: 'partner',
      title: 'Partner',
    });

    expect(
      adminContentBodyFromForm('partners', values, 'UTC', {
        id: ids.speaker,
        version: 7,
      }),
    ).toMatchObject({ version: 7 });
    expect(
      adminContentBodyFromForm('partners', values, 'UTC'),
    ).not.toHaveProperty('version');
  });
});
