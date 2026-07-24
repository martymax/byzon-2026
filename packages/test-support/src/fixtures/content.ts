import {
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantProgramProblemSchema,
  participantProgramResponseSchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const contentFixtureIds = Object.freeze({
  event: '01910000-0000-7000-8000-000000000001',
  friday: '01910000-0000-7000-8000-000000000002',
  saturday: '01910000-0000-7000-8000-000000000003',
  mainStage: '01910000-0000-7000-8000-000000000004',
  workshopRoom: '01910000-0000-7000-8000-000000000005',
  opening: '01910000-0000-7000-8000-000000000006',
  workshop: '01910000-0000-7000-8000-000000000007',
  speaker: '01910000-0000-7000-8000-000000000008',
  partner: '01910000-0000-7000-8000-000000000009',
  venue: '01910000-0000-7000-8000-00000000000a',
  page: '01910000-0000-7000-8000-00000000000b',
  faq: '01910000-0000-7000-8000-00000000000c',
} as const);

const program = {
  days: [
    {
      id: contentFixtureIds.friday,
      localDate: '2026-09-18',
      title: 'Pátek',
      description: 'První konferenční den.',
      sortOrder: 0,
    },
    {
      id: contentFixtureIds.saturday,
      localDate: '2026-09-19',
      title: 'Sobota',
      description: 'Druhý konferenční den.',
      sortOrder: 1,
    },
  ],
  rooms: [
    {
      id: contentFixtureIds.mainStage,
      slug: 'main-stage',
      name: 'Main Stage',
      description: null,
      sortOrder: 0,
    },
    {
      id: contentFixtureIds.workshopRoom,
      slug: 'workshop',
      name: 'Workshop room',
      description: null,
      sortOrder: 1,
    },
  ],
  sessions: [
    {
      id: contentFixtureIds.opening,
      dayId: contentFixtureIds.friday,
      roomId: contentFixtureIds.mainStage,
      slug: 'otevreni-konference',
      title: 'Otevření konference',
      summary: 'Společný start programu BYZON 2026.',
      description: 'Přivítání účastníků a praktický úvod k programu.',
      type: 'talk' as const,
      status: 'published' as const,
      startsAt: '2026-09-18T07:00:00.000Z',
      endsAt: '2026-09-18T08:00:00.000Z',
      sortOrder: 0,
    },
    {
      id: contentFixtureIds.workshop,
      dayId: contentFixtureIds.saturday,
      roomId: contentFixtureIds.workshopRoom,
      slug: 'rust-bez-zkratek',
      title: 'Růst bez zkratek',
      summary: 'Praktický workshop s konkrétními příklady.',
      description:
        'Workshop pracuje pouze se syntetickými scénáři a neobsahuje údaje skutečných účastníků.',
      type: 'workshop' as const,
      status: 'published' as const,
      startsAt: '2026-09-19T08:00:00.000Z',
      endsAt: '2026-09-19T09:30:00.000Z',
      sortOrder: 0,
    },
  ],
};

export const participantProgramFixtures = defineFixtureSet({
  name: 'content.program',
  schema: participantProgramResponseSchema,
  fixtures: {
    happy: {
      eventId: contentFixtureIds.event,
      version: 3,
      publishedAt: '2026-07-24T08:00:00.000Z',
      program,
      filters: { day: null, room: null, type: null },
    },
    empty: {
      eventId: contentFixtureIds.event,
      version: 3,
      publishedAt: '2026-07-24T08:00:00.000Z',
      program: { days: [], rooms: [], sessions: [] },
      filters: { day: null, room: null, type: null },
    },
  },
});

const content = {
  event: {
    id: contentFixtureIds.event,
    slug: 'byzon-2026',
    name: 'BYZON 2026',
    timezone: 'Europe/Prague',
    startsAt: '2026-09-18T06:00:00.000Z',
    endsAt: '2026-09-19T20:00:00.000Z',
  },
  speakers: [
    {
      id: contentFixtureIds.speaker,
      slug: 'jana-novakova',
      firstName: 'Jana',
      lastName: 'Nováková',
      company: 'Syntetická firma',
      jobTitle: 'Zakladatelka',
      bioMarkdown:
        'Jana vede syntetický tým a sdílí zkušenosti s odpovědným růstem.\n\nProfil nepopisuje skutečnou osobu.',
      linkedinUrl: 'https://www.linkedin.com/in/synthetic-profile',
      websiteUrl: 'https://example.test/jana',
      photoAssetId: null,
      status: 'published' as const,
      sortOrder: 0,
      version: 1,
    },
  ],
  partners: [
    {
      id: contentFixtureIds.partner,
      slug: 'synteticky-partner',
      name: 'Syntetický partner',
      descriptionMarkdown:
        'Testovací partner pro ověření dlouhého českého obsahu.',
      websiteUrl: 'https://example.test/partner',
      category: 'Hlavní partner',
      tier: 'main',
      logoAssetId: null,
      status: 'published' as const,
      sortOrder: 0,
      version: 1,
    },
  ],
  venues: [
    {
      id: contentFixtureIds.venue,
      slug: 'vystaviste',
      name: 'Výstaviště',
      addressLine1: 'Syntetická 1',
      addressLine2: null,
      city: 'České Budějovice',
      postalCode: '370 01',
      countryCode: 'CZ',
      mapQuery: 'Výstaviště České Budějovice',
      navigationMarkdown:
        'Vstup je hlavní branou. Sledujte značení ke konferenčnímu sálu.',
      accessibilityMarkdown:
        'Bezbariérový vstup je v úrovni chodníku a obsluha je k dispozici u registrace.',
      status: 'published' as const,
      sortOrder: 0,
      version: 1,
    },
  ],
  practical: {
    pages: [
      {
        id: contentFixtureIds.page,
        slug: 'pred-prijezdem',
        kind: 'practical' as const,
        title: 'Před příjezdem',
        summary: 'Co si připravit před cestou.',
        bodyMarkdown:
          'Přijeďte s dostatečnou rezervou a mějte aplikaci dostupnou v telefonu.\n\nPokud potřebujete asistenci, obraťte se na označený tým u registrace. Extrémnědlouhéčeskéslovoproověřeníbezpečnéhozalomeníobsahunamalémtelefonu.',
        status: 'published' as const,
        sortOrder: 0,
        version: 1,
      },
    ],
    faqs: [
      {
        id: contentFixtureIds.faq,
        category: 'Na místě',
        question: 'Kde získám pomoc?',
        answerMarkdown:
          'U registračního pultu bude po celou dobu označený člen týmu.',
        status: 'published' as const,
        sortOrder: 0,
        version: 1,
      },
    ],
  },
};

export const participantContentFixtures = defineFixtureSet({
  name: 'content.directory',
  schema: participantContentResponseSchema,
  fixtures: {
    happy: {
      eventId: contentFixtureIds.event,
      version: 3,
      content,
    },
    empty: {
      eventId: contentFixtureIds.event,
      version: 3,
      content: {
        ...content,
        speakers: [],
        partners: [],
        venues: [],
        practical: { pages: [], faqs: [] },
      },
    },
  },
});

interface ContentProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly CONTENT_NOT_FOUND: 404;
  readonly INTERNAL_ERROR: 500;
  readonly INVALID_EVENT_ID: 400;
  readonly INVALID_PROGRAM_FILTERS: 400;
  readonly PROGRAM_NOT_FOUND: 404;
}

const problem = <Code extends keyof ContentProblemStatus>(
  code: Code,
  status: ContentProblemStatus[Code],
  detail: string,
) => ({
  type: problemTypeForCode(code),
  title: 'Content fixture problem',
  status,
  code,
  detail,
  requestId: 'fixture-content-0001',
});

export const participantProgramProblemFixtures = defineFixtureSet({
  name: 'content.program-problem',
  schema: participantProgramProblemSchema,
  fixtures: {
    permission: problem(
      'PROGRAM_NOT_FOUND',
      404,
      'Published program is unavailable for this event.',
    ),
    authentication: problem(
      'AUTHENTICATION_REQUIRED',
      401,
      'A valid session is required.',
    ),
    domain_error: problem(
      'INVALID_PROGRAM_FILTERS',
      400,
      'Program filters are invalid.',
    ),
    internal_error: problem(
      'INTERNAL_ERROR',
      500,
      'The request could not be completed.',
    ),
  },
});

export const participantContentProblemFixtures = defineFixtureSet({
  name: 'content.directory-problem',
  schema: participantContentProblemSchema,
  fixtures: {
    permission: problem(
      'CONTENT_NOT_FOUND',
      404,
      'Published content is unavailable for this event.',
    ),
    authentication: problem(
      'AUTHENTICATION_REQUIRED',
      401,
      'A valid session is required.',
    ),
    internal_error: problem(
      'INTERNAL_ERROR',
      500,
      'The request could not be completed.',
    ),
  },
});
