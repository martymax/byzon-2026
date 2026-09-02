import {
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantProgramProblemSchema,
  participantProgramResponseSchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const contentFixtureIds = Object.freeze({
  event: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
  friday: '01910000-0000-7000-8000-000000000002',
  saturday: '01910000-0000-7000-8000-000000000003',
  mainStage: '01910000-0000-7000-8000-000000000004',
  workshopRoom: '01910000-0000-7000-8000-000000000005',
  opening: '01910000-0000-7000-8000-000000000006',
  workshop: '01910000-0000-7000-8000-000000000007',
  agendaWaiting: '01930000-0000-7000-8000-000000000002',
  agendaFifoFirst: '01930000-0000-7000-8000-000000000003',
  agendaFifoSecond: '01930000-0000-7000-8000-000000000004',
  agendaCancelled: '01930000-0000-7000-8000-000000000005',
  agendaFull: '01930000-0000-7000-8000-000000000006',
  agendaClosed: '01930000-0000-7000-8000-000000000007',
  agendaEstimate: '01930000-0000-7000-8000-000000000008',
  agendaWaitlistCancelled: '01930000-0000-7000-8000-000000000009',
  agendaConflictTarget: '01930000-0000-7000-8000-00000000000d',
  speaker: '01910000-0000-7000-8000-000000000008',
  partner: '01910000-0000-7000-8000-000000000009',
  venue: '01910000-0000-7000-8000-00000000000a',
  page: '01910000-0000-7000-8000-00000000000b',
  faq: '01910000-0000-7000-8000-00000000000c',
} as const);

const agendaProgramSession = ({
  dayId = contentFixtureIds.saturday,
  endsAt,
  id,
  roomId = contentFixtureIds.workshopRoom,
  slug,
  sortOrder,
  startsAt,
  status = 'published',
  title,
  type = 'workshop',
}: {
  readonly dayId?: string;
  readonly endsAt: string;
  readonly id: string;
  readonly roomId?: string;
  readonly slug: string;
  readonly sortOrder: number;
  readonly startsAt: string;
  readonly status?: 'cancelled' | 'published';
  readonly title: string;
  readonly type?: 'mastermind' | 'networking' | 'workshop';
}) => ({
  id,
  dayId,
  roomId,
  slug,
  title,
  summary: `Syntetický bod programu pro průchod stavem „${title}“.`,
  description:
    'Tento bod používá pouze syntetická data pro ověření osobní agendy.',
  type,
  status,
  startsAt,
  endsAt,
  sortOrder,
});

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
    agendaProgramSession({
      id: contentFixtureIds.agendaConflictTarget,
      dayId: contentFixtureIds.friday,
      slug: 'prekryvajici-se-workshop',
      title: 'Překrývající se workshop',
      startsAt: '2026-09-18T07:30:00.000Z',
      endsAt: '2026-09-18T08:30:00.000Z',
      sortOrder: 1,
    }),
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
    agendaProgramSession({
      id: contentFixtureIds.agendaWaiting,
      slug: 'kapacitni-workshop',
      title: 'Kapacitní workshop',
      startsAt: '2026-09-19T10:00:00.000Z',
      endsAt: '2026-09-19T11:00:00.000Z',
      sortOrder: 1,
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaFifoFirst,
      slug: 'workshop-s-aktivni-nabidkou',
      title: 'Workshop – první ve FIFO',
      startsAt: '2026-09-19T11:30:00.000Z',
      endsAt: '2026-09-19T12:30:00.000Z',
      sortOrder: 2,
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaFifoSecond,
      slug: 'workshop-po-vyprseni-nabidky',
      title: 'Workshop – druhý ve FIFO',
      startsAt: '2026-09-19T13:00:00.000Z',
      endsAt: '2026-09-19T14:00:00.000Z',
      sortOrder: 3,
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaWaitlistCancelled,
      slug: 'workshop-s-opustenym-poradnikem',
      title: 'Workshop s opuštěným pořadníkem',
      startsAt: '2026-09-19T14:30:00.000Z',
      endsAt: '2026-09-19T15:30:00.000Z',
      sortOrder: 4,
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaFull,
      slug: 'plne-obsazeny-mastermind',
      title: 'Plně obsazený mastermind',
      startsAt: '2026-09-19T16:00:00.000Z',
      endsAt: '2026-09-19T17:00:00.000Z',
      sortOrder: 5,
      type: 'mastermind',
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaClosed,
      slug: 'uzavrena-rezervace',
      title: 'Uzavřená rezervace',
      startsAt: '2026-09-19T17:30:00.000Z',
      endsAt: '2026-09-19T18:30:00.000Z',
      sortOrder: 6,
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaEstimate,
      roomId: contentFixtureIds.mainStage,
      slug: 'rizeny-networking',
      title: 'Řízený networking',
      startsAt: '2026-09-19T19:00:00.000Z',
      endsAt: '2026-09-19T20:00:00.000Z',
      sortOrder: 7,
      type: 'networking',
    }),
    agendaProgramSession({
      id: contentFixtureIds.agendaCancelled,
      slug: 'zruseny-workshop',
      title: 'Zrušený workshop',
      startsAt: '2026-09-19T20:30:00.000Z',
      endsAt: '2026-09-19T21:30:00.000Z',
      sortOrder: 8,
      status: 'cancelled',
    }),
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
      instagramUrl: 'https://www.instagram.com/synthetic-profile',
      facebookUrl: 'https://www.facebook.com/synthetic-profile',
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
