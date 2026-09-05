import { describe, expect, it } from 'vitest';

import {
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantProgramFiltersSchema,
  participantProgramResponseSchema,
  problemTypeForCode,
  publishedContentSnapshotSchema,
  publishedProgramAgendaSnapshotSchema,
  publishedProgramSnapshotSchema,
  publicContentResponseSchema,
} from './index.js';

const ids = {
  event: '01910000-0000-7000-8000-000000000001',
  day: '01910000-0000-7000-8000-000000000002',
  room: '01910000-0000-7000-8000-000000000003',
  session: '01910000-0000-7000-8000-000000000004',
} as const;

const event = {
  id: ids.event,
  slug: 'byzon-2026',
  name: 'BYZON 2026',
  timezone: 'Europe/Prague',
  startsAt: '2026-09-18T06:00:00.000Z',
  endsAt: '2026-09-19T20:00:00.000Z',
};

const program = {
  days: [
    {
      id: ids.day,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    },
  ],
  rooms: [
    {
      id: ids.room,
      slug: 'main-stage',
      name: 'Main Stage',
      sortOrder: 0,
    },
  ],
  sessions: [
    {
      id: ids.session,
      dayId: ids.day,
      roomId: ids.room,
      slug: 'opening',
      title: 'Opening',
      type: 'talk',
      status: 'published',
      startsAt: '2026-09-18T07:00:00.000Z',
      endsAt: '2026-09-18T08:00:00.000Z',
      sortOrder: 0,
    },
  ],
};

const content = {
  event,
  speakers: [],
  partners: [],
  venues: [],
  practical: { pages: [], faqs: [] },
};

describe('CS-CONTENT-01 contracts', () => {
  it('validates the participant and public success DTOs', () => {
    expect(
      participantProgramResponseSchema.parse({
        eventId: ids.event,
        version: 1,
        publishedAt: '2026-07-24T08:00:00.000Z',
        program,
        filters: { day: null, room: null, type: null },
      }).program.sessions,
    ).toHaveLength(1);
    expect(
      participantContentResponseSchema.parse({
        eventId: ids.event,
        version: 1,
        content,
      }).content.event.slug,
    ).toBe('byzon-2026');
    expect(
      publicContentResponseSchema.parse({
        version: 1,
        publishedAt: '2026-07-24T08:00:00.000Z',
        ...content,
        program,
      }).program.rooms,
    ).toHaveLength(1);
  });

  it('rejects unknown response keys and invalid program relationships', () => {
    expect(
      participantContentResponseSchema.safeParse({
        eventId: ids.event,
        version: 1,
        content,
        privateAdminNote: 'must-not-cross-the-contract',
      }).success,
    ).toBe(false);

    expect(
      participantProgramResponseSchema.safeParse({
        eventId: ids.event,
        version: 1,
        publishedAt: '2026-07-24T08:00:00.000Z',
        program: {
          ...program,
          sessions: [
            {
              ...program.sessions[0],
              dayId: '01910000-0000-7000-8000-000000000099',
            },
          ],
        },
        filters: { day: null, room: null, type: null },
      }).success,
    ).toBe(false);

    expect(
      participantContentResponseSchema.safeParse({
        eventId: ids.event,
        version: 1,
        content: {
          ...content,
          event: {
            ...event,
            id: '01910000-0000-7000-8000-000000000099',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('strips server-only snapshot keys before strict response validation', () => {
    const parsed = publishedContentSnapshotSchema.parse({
      ...content,
      privateAdminNote: 'server-only',
      speakers: [
        {
          id: '01910000-0000-7000-8000-000000000005',
          slug: 'jana-novakova',
          firstName: 'Jana',
          lastName: 'Nováková',
          company: null,
          jobTitle: null,
          bioMarkdown: null,
          linkedinUrl: null,
          websiteUrl: null,
          photoAssetId: null,
          status: 'published',
          sortOrder: 0,
          version: 1,
          privateNote: 'server-only',
        },
      ],
    });

    expect(parsed).not.toHaveProperty('privateAdminNote');
    expect(parsed.speakers[0]).not.toHaveProperty('privateNote');

    const programWithWindow = {
      program: {
        ...program,
        sessions: [
          {
            ...program.sessions[0],
            capacityMode: 'reservation',
            capacity: 10,
            reservationOpensAt: null,
            reservationClosesAt: '2026-09-18T06:45:00.000Z',
            speakerIds: ['01910000-0000-7000-8000-000000000005'],
          },
        ],
      },
    };
    expect(
      publishedProgramAgendaSnapshotSchema.parse(programWithWindow).program
        .sessions[0],
    ).toMatchObject({
      reservationOpensAt: null,
      reservationClosesAt: '2026-09-18T06:45:00.000Z',
    });
    expect(
      publishedProgramSnapshotSchema.parse(programWithWindow).program
        .sessions[0],
    ).not.toHaveProperty('reservationClosesAt');
    expect(
      publishedProgramSnapshotSchema.parse(programWithWindow).program
        .sessions[0],
    ).toMatchObject({
      speakerIds: ['01910000-0000-7000-8000-000000000005'],
    });
    expect(
      publishedProgramAgendaSnapshotSchema.safeParse({
        program: {
          ...program,
          sessions: [
            {
              ...program.sessions[0],
              reservationClosesAt: '2026-09-18T06:45:00.000Z',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only credential-free HTTPS links in published directories', () => {
    const speaker = {
      id: '01910000-0000-7000-8000-000000000005',
      slug: 'jana-novakova',
      firstName: 'Jana',
      lastName: 'Nováková',
      company: null,
      jobTitle: null,
      bioMarkdown: null,
      linkedinUrl: 'https://www.linkedin.com/in/jana-novakova',
      websiteUrl: 'https://jana.example.test',
      photoAssetId: null,
      status: 'published',
      sortOrder: 0,
      version: 1,
    } as const;
    const partner = {
      id: '01910000-0000-7000-8000-000000000006',
      slug: 'bezpecny-partner',
      name: 'Bezpečný partner',
      descriptionMarkdown: null,
      websiteUrl: 'https://partner.example.test',
      category: null,
      tier: null,
      logoAssetId: null,
      status: 'published',
      sortOrder: 0,
      version: 1,
    } as const;
    const response = {
      eventId: ids.event,
      version: 1,
      content: {
        ...content,
        speakers: [speaker],
        partners: [partner],
      },
    };

    expect(participantContentResponseSchema.parse(response)).toEqual(response);
    for (const linkedinUrl of [
      'not-url',
      'http://www.linkedin.com/in/jana-novakova',
    ]) {
      expect(
        participantContentResponseSchema.safeParse({
          ...response,
          content: {
            ...response.content,
            speakers: [{ ...speaker, linkedinUrl }],
          },
        }).success,
      ).toBe(false);
    }
    expect(
      participantContentResponseSchema.safeParse({
        ...response,
        content: {
          ...response.content,
          partners: [
            {
              ...partner,
              websiteUrl: 'https://user:secret@partner.example.test/private',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('bounds and validates participant program filters', () => {
    expect(
      participantProgramFiltersSchema.parse({
        day: '2026-09-18',
        type: 'workshop',
        version: 2,
      }),
    ).toEqual({ day: '2026-09-18', type: 'workshop', version: 2 });
    expect(
      participantProgramFiltersSchema.safeParse({ type: 'unknown' }).success,
    ).toBe(false);
    expect(
      participantProgramFiltersSchema.safeParse({ day: 'a'.repeat(129) })
        .success,
    ).toBe(false);
  });

  it('accepts only endpoint-supported problem codes and statuses', () => {
    const problem = {
      type: problemTypeForCode('CONTENT_NOT_FOUND'),
      title: 'Content not found',
      status: 404,
      code: 'CONTENT_NOT_FOUND',
      detail: 'Published event content is not available.',
      requestId: 'request-content-0001',
    };

    expect(participantContentProblemSchema.parse(problem)).toEqual(problem);
    expect(
      participantContentProblemSchema.safeParse({
        ...problem,
        type: problemTypeForCode('INTERNAL_ERROR'),
        code: 'INTERNAL_ERROR',
      }).success,
    ).toBe(false);
    expect(
      participantContentProblemSchema.safeParse({
        ...problem,
        type: problemTypeForCode('UNKNOWN_CONTENT_ERROR'),
        code: 'UNKNOWN_CONTENT_ERROR',
      }).success,
    ).toBe(false);
  });
});
