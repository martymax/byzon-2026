import { z } from 'zod';

import { defineApiProblemSchema } from './base.js';

const MAX_DAYS = 64;
const MAX_ROOMS = 256;
const MAX_SESSIONS = 4_096;
const MAX_DIRECTORY_ITEMS = 2_048;
const MAX_PRACTICAL_ITEMS = 512;

/**
 * CS-CONTENT-01 carries only explicitly published event content. Speaker names
 * and public profile copy are person-associated published data; email, user
 * identity, ticket state, private notes and admin metadata are excluded.
 *
 * Only the anonymous public representation may be offline-readable through
 * the strict version/expiry snapshot in CS-OFFLINE-01. Authenticated
 * participant responses remain private and are never eligible for a shared
 * or service-worker cache.
 */
export const contentCachePolicy = Object.freeze({
  participant: Object.freeze({
    cacheControl: 'private, max-age=0, must-revalidate',
    offline: 'forbidden',
  }),
  public: Object.freeze({
    cacheControl: 'public, max-age=60, stale-while-revalidate=300',
    offline: 'requires-offline-contract-v1-public-snapshot',
  }),
} as const);

const uuidSchema = z.string().uuid();
const boundedNonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Value must contain a non-whitespace character',
    });
const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const shortTextSchema = boundedNonBlankString(256);
const optionalDescriptionSchema = z.string().max(8_192).nullable();
const markdownSchema = z.string().max(65_536);
const publicationVersionSchema = z.number().int().positive();
const sortOrderSchema = z.number().int().nonnegative();
const publishedStatusSchema = z.literal('published');
const safeExternalUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return (
          parsed.protocol === 'https:' &&
          parsed.username.length === 0 &&
          parsed.password.length === 0
        );
      } catch {
        return false;
      }
    },
    {
      message: 'Only credential-free HTTPS URLs are supported',
    },
  );

export const participantSessionTypeSchema = z.enum([
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
]);

export type ParticipantSessionType = z.infer<
  typeof participantSessionTypeSchema
>;

const programDayShape = {
  id: uuidSchema,
  localDate: z.string().date(),
  title: shortTextSchema,
  description: optionalDescriptionSchema.optional(),
  sortOrder: sortOrderSchema,
} as const;

const programRoomShape = {
  id: uuidSchema,
  slug: slugSchema,
  name: shortTextSchema,
  description: optionalDescriptionSchema.optional(),
  sortOrder: sortOrderSchema,
} as const;

const programSessionShape = {
  id: uuidSchema,
  dayId: uuidSchema,
  roomId: uuidSchema.nullable(),
  slug: slugSchema,
  title: boundedNonBlankString(512),
  summary: z.string().max(2_048).nullable().optional(),
  description: z.string().max(65_536).nullable().optional(),
  type: participantSessionTypeSchema,
  status: z.enum(['published', 'cancelled']).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  sortOrder: sortOrderSchema,
} as const;

export const publishedProgramDaySchema = z.strictObject(programDayShape);
export const publishedProgramRoomSchema = z.strictObject(programRoomShape);
export const publishedProgramSessionSchema =
  z.strictObject(programSessionShape);

export type PublishedProgramDay = z.infer<typeof publishedProgramDaySchema>;
export type PublishedProgramRoom = z.infer<typeof publishedProgramRoomSchema>;
export type PublishedProgramSession = z.infer<
  typeof publishedProgramSessionSchema
>;

const uniqueValues = (
  values: readonly string[],
  path: string,
  context: z.RefinementCtx,
): void => {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: 'custom',
      path: [path],
      message: `${path} must be unique`,
    });
  }
};

const validateProgram = (
  program: {
    days: readonly PublishedProgramDay[];
    rooms: readonly PublishedProgramRoom[];
    sessions: readonly PublishedProgramSession[];
  },
  context: z.RefinementCtx,
): void => {
  uniqueValues(
    program.days.map(({ id }) => id),
    'days',
    context,
  );
  uniqueValues(
    program.rooms.map(({ id }) => id),
    'rooms',
    context,
  );
  uniqueValues(
    program.rooms.map(({ slug }) => slug),
    'rooms',
    context,
  );
  uniqueValues(
    program.sessions.map(({ id }) => id),
    'sessions',
    context,
  );
  uniqueValues(
    program.sessions.map(({ slug }) => slug),
    'sessions',
    context,
  );

  const dayIds = new Set(program.days.map(({ id }) => id));
  const roomIds = new Set(program.rooms.map(({ id }) => id));
  program.sessions.forEach((session, index) => {
    if (!dayIds.has(session.dayId)) {
      context.addIssue({
        code: 'custom',
        path: ['sessions', index, 'dayId'],
        message: 'Session day must be present in the response',
      });
    }
    if (session.roomId && !roomIds.has(session.roomId)) {
      context.addIssue({
        code: 'custom',
        path: ['sessions', index, 'roomId'],
        message: 'Session room must be present in the response',
      });
    }
    if (Date.parse(session.endsAt) <= Date.parse(session.startsAt)) {
      context.addIssue({
        code: 'custom',
        path: ['sessions', index, 'endsAt'],
        message: 'Session must end after it starts',
      });
    }
  });
};

export const publishedProgramSchema = z
  .strictObject({
    days: z.array(publishedProgramDaySchema).max(MAX_DAYS),
    rooms: z.array(publishedProgramRoomSchema).max(MAX_ROOMS),
    sessions: z.array(publishedProgramSessionSchema).max(MAX_SESSIONS),
  })
  .superRefine(validateProgram);

export type PublishedProgram = z.infer<typeof publishedProgramSchema>;

const eventShape = {
  id: uuidSchema,
  slug: slugSchema,
  name: shortTextSchema,
  timezone: boundedNonBlankString(128),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
} as const;

const speakerShape = {
  id: uuidSchema,
  slug: slugSchema,
  firstName: shortTextSchema,
  lastName: shortTextSchema,
  company: z.string().max(256).nullable(),
  jobTitle: z.string().max(256).nullable(),
  bioMarkdown: markdownSchema.nullable(),
  linkedinUrl: safeExternalUrlSchema.nullable(),
  websiteUrl: safeExternalUrlSchema.nullable(),
  photoAssetId: uuidSchema.nullable(),
  status: publishedStatusSchema,
  sortOrder: sortOrderSchema,
  version: publicationVersionSchema,
} as const;

const partnerShape = {
  id: uuidSchema,
  slug: slugSchema,
  name: shortTextSchema,
  descriptionMarkdown: markdownSchema.nullable(),
  websiteUrl: safeExternalUrlSchema.nullable(),
  category: z.string().max(128).nullable(),
  tier: z.string().max(128).nullable(),
  logoAssetId: uuidSchema.nullable(),
  status: publishedStatusSchema,
  sortOrder: sortOrderSchema,
  version: publicationVersionSchema,
} as const;

const venueShape = {
  id: uuidSchema,
  slug: slugSchema,
  name: shortTextSchema,
  addressLine1: z.string().max(256).nullable(),
  addressLine2: z.string().max(256).nullable(),
  city: z.string().max(128).nullable(),
  postalCode: z.string().max(32).nullable(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  mapQuery: z.string().max(1_024).nullable(),
  navigationMarkdown: markdownSchema.nullable(),
  accessibilityMarkdown: markdownSchema.nullable(),
  status: publishedStatusSchema,
  sortOrder: sortOrderSchema,
  version: publicationVersionSchema,
} as const;

const practicalPageShape = {
  id: uuidSchema,
  slug: slugSchema,
  kind: z.enum(['practical', 'marketing', 'other']),
  title: shortTextSchema,
  summary: z.string().max(2_048).nullable(),
  bodyMarkdown: markdownSchema,
  status: publishedStatusSchema,
  sortOrder: sortOrderSchema,
  version: publicationVersionSchema,
} as const;

const faqShape = {
  id: uuidSchema,
  category: z.string().max(128).nullable(),
  question: boundedNonBlankString(1_024),
  answerMarkdown: markdownSchema,
  status: publishedStatusSchema,
  sortOrder: sortOrderSchema,
  version: publicationVersionSchema,
} as const;

export const publishedEventSchema = z
  .strictObject(eventShape)
  .refine((event) => Date.parse(event.endsAt) > Date.parse(event.startsAt), {
    path: ['endsAt'],
    message: 'Event must end after it starts',
  });
export const publishedSpeakerSchema = z.strictObject(speakerShape);
export const publishedPartnerSchema = z.strictObject(partnerShape);
export const publishedVenueSchema = z.strictObject(venueShape);
export const publishedPracticalPageSchema = z.strictObject(practicalPageShape);
export const publishedFaqSchema = z.strictObject(faqShape);

export const publishedContentSchema = z.strictObject({
  event: publishedEventSchema,
  speakers: z.array(publishedSpeakerSchema).max(MAX_DIRECTORY_ITEMS),
  partners: z.array(publishedPartnerSchema).max(MAX_DIRECTORY_ITEMS),
  venues: z.array(publishedVenueSchema).max(MAX_DIRECTORY_ITEMS),
  practical: z.strictObject({
    pages: z.array(publishedPracticalPageSchema).max(MAX_PRACTICAL_ITEMS),
    faqs: z.array(publishedFaqSchema).max(MAX_PRACTICAL_ITEMS),
  }),
});

export type PublishedContent = z.infer<typeof publishedContentSchema>;

/**
 * Publication snapshots may contain server-only fields. These extraction
 * schemas intentionally strip unknown keys before a response is validated by
 * one of the strict HTTP schemas below.
 */
export const publishedProgramSnapshotSchema = z.object({
  program: z
    .object({
      days: z.array(z.object(programDayShape)).max(MAX_DAYS),
      rooms: z.array(z.object(programRoomShape)).max(MAX_ROOMS),
      sessions: z.array(z.object(programSessionShape)).max(MAX_SESSIONS),
    })
    .superRefine(validateProgram),
});

const reservationWindowShape = {
  reservationOpensAt: z.string().datetime({ offset: true }).nullable(),
  reservationClosesAt: z.string().datetime({ offset: true }).nullable(),
};

const validateReservationWindow = (
  window: {
    reservationOpensAt: string | null;
    reservationClosesAt: string | null;
  },
  context: z.RefinementCtx,
): void => {
  if (
    window.reservationOpensAt &&
    window.reservationClosesAt &&
    Date.parse(window.reservationClosesAt) <=
      Date.parse(window.reservationOpensAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reservationClosesAt'],
      message: 'Snapshot reservation window must be ordered',
    });
  }
};

export const publishedAgendaReservationWindowsSchema = z.record(
  uuidSchema,
  z.strictObject(reservationWindowShape).superRefine(validateReservationWindow),
);

export type PublishedAgendaReservationWindows = z.infer<
  typeof publishedAgendaReservationWindowsSchema
>;

/**
 * Server publication writes retain the reservation window beside the public
 * session projection. Public readers continue to use
 * `publishedProgramSnapshotSchema`, which strips these operational fields.
 */
export const publishedProgramAgendaSnapshotSchema = z.object({
  program: z
    .object({
      days: z.array(z.object(programDayShape)).max(MAX_DAYS),
      rooms: z.array(z.object(programRoomShape)).max(MAX_ROOMS),
      sessions: z
        .array(
          z
            .object({
              ...programSessionShape,
              reservationOpensAt:
                reservationWindowShape.reservationOpensAt.optional(),
              reservationClosesAt:
                reservationWindowShape.reservationClosesAt.optional(),
            })
            .superRefine((session, context) => {
              const hasWindow =
                session.reservationOpensAt !== undefined ||
                session.reservationClosesAt !== undefined;
              if (
                hasWindow &&
                (session.reservationOpensAt === undefined ||
                  session.reservationClosesAt === undefined)
              ) {
                context.addIssue({
                  code: 'custom',
                  path: ['reservationClosesAt'],
                  message: 'Snapshot reservation window must be complete',
                });
              }
              validateReservationWindow(
                {
                  reservationOpensAt: session.reservationOpensAt ?? null,
                  reservationClosesAt: session.reservationClosesAt ?? null,
                },
                context,
              );
            }),
        )
        .max(MAX_SESSIONS),
    })
    .superRefine(validateProgram),
});

export type PublishedProgramAgendaSnapshot = z.infer<
  typeof publishedProgramAgendaSnapshotSchema
>['program'];

export const publishedContentSnapshotSchema = z.object({
  event: z
    .object(eventShape)
    .refine((event) => Date.parse(event.endsAt) > Date.parse(event.startsAt), {
      path: ['endsAt'],
      message: 'Event must end after it starts',
    }),
  speakers: z.array(z.object(speakerShape)).max(MAX_DIRECTORY_ITEMS),
  partners: z.array(z.object(partnerShape)).max(MAX_DIRECTORY_ITEMS),
  venues: z.array(z.object(venueShape)).max(MAX_DIRECTORY_ITEMS),
  practical: z.object({
    pages: z.array(z.object(practicalPageShape)).max(MAX_PRACTICAL_ITEMS),
    faqs: z.array(z.object(faqShape)).max(MAX_PRACTICAL_ITEMS),
  }),
});

export const participantProgramFiltersSchema = z.strictObject({
  day: boundedNonBlankString(128).optional(),
  room: boundedNonBlankString(128).optional(),
  type: participantSessionTypeSchema.optional(),
  version: publicationVersionSchema.optional(),
});

export type ParticipantProgramFilters = z.infer<
  typeof participantProgramFiltersSchema
>;

export const participantProgramResponseSchema = z.strictObject({
  eventId: uuidSchema,
  version: publicationVersionSchema,
  publishedAt: z.string().datetime({ offset: true }),
  program: publishedProgramSchema,
  filters: z.strictObject({
    day: boundedNonBlankString(128).nullable(),
    room: boundedNonBlankString(128).nullable(),
    type: participantSessionTypeSchema.nullable(),
  }),
});

export type ParticipantProgramResponse = z.infer<
  typeof participantProgramResponseSchema
>;

export const participantContentResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    version: publicationVersionSchema,
    content: publishedContentSchema,
  })
  .superRefine((response, context) => {
    if (response.eventId !== response.content.event.id) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'event', 'id'],
        message: 'Content event must match the response event scope',
      });
    }
  });

export type ParticipantContentResponse = z.infer<
  typeof participantContentResponseSchema
>;

export const publicContentBootstrapResponseSchema = z.strictObject({
  version: publicationVersionSchema,
  publishedAt: z.string().datetime({ offset: true }),
  event: publishedEventSchema,
});

export type PublicContentBootstrapResponse = z.infer<
  typeof publicContentBootstrapResponseSchema
>;

export const publicContentResponseSchema = z.strictObject({
  version: publicationVersionSchema,
  publishedAt: z.string().datetime({ offset: true }),
  event: publishedEventSchema,
  program: publishedProgramSchema,
  speakers: z.array(publishedSpeakerSchema).max(MAX_DIRECTORY_ITEMS),
  partners: z.array(publishedPartnerSchema).max(MAX_DIRECTORY_ITEMS),
  venues: z.array(publishedVenueSchema).max(MAX_DIRECTORY_ITEMS),
  practical: z.strictObject({
    pages: z.array(publishedPracticalPageSchema).max(MAX_PRACTICAL_ITEMS),
    faqs: z.array(publishedFaqSchema).max(MAX_PRACTICAL_ITEMS),
  }),
});

export type PublicContentResponse = z.infer<typeof publicContentResponseSchema>;

export const invalidEventIdProblemSchema = defineApiProblemSchema(
  'INVALID_EVENT_ID',
  400,
);
export const invalidProgramFiltersProblemSchema = defineApiProblemSchema(
  'INVALID_PROGRAM_FILTERS',
  400,
);
export const authenticationRequiredProblemSchema = defineApiProblemSchema(
  'AUTHENTICATION_REQUIRED',
  401,
);
export const programNotFoundProblemSchema = defineApiProblemSchema(
  'PROGRAM_NOT_FOUND',
  404,
);
export const contentNotFoundProblemSchema = defineApiProblemSchema(
  'CONTENT_NOT_FOUND',
  404,
);
export const publicContentNotFoundProblemSchema = defineApiProblemSchema(
  'PUBLIC_CONTENT_NOT_FOUND',
  404,
);
export const internalContentErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const participantProgramProblemSchema = z.discriminatedUnion('code', [
  invalidEventIdProblemSchema,
  invalidProgramFiltersProblemSchema,
  authenticationRequiredProblemSchema,
  programNotFoundProblemSchema,
  internalContentErrorProblemSchema,
]);

export const participantContentProblemSchema = z.discriminatedUnion('code', [
  invalidEventIdProblemSchema,
  authenticationRequiredProblemSchema,
  contentNotFoundProblemSchema,
  internalContentErrorProblemSchema,
]);

export const publicContentProblemSchema = z.discriminatedUnion('code', [
  publicContentNotFoundProblemSchema,
  internalContentErrorProblemSchema,
]);

export type ParticipantProgramProblem = z.infer<
  typeof participantProgramProblemSchema
>;
export type ParticipantContentProblem = z.infer<
  typeof participantContentProblemSchema
>;
export type PublicContentProblem = z.infer<typeof publicContentProblemSchema>;
