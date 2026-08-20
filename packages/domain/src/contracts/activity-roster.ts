import { z } from 'zod';

import { defineApiProblemSchema, sessionExpiredProblemSchema } from './base.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Text must not be blank')
    .refine(
      (value) =>
        !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/.test(value),
      'Text contains unsafe characters',
    );

export const activityRosterCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  vary: Object.freeze(['authorization', 'cookie'] as const),
  browserPersistence: 'forbidden',
  mutation: 'none-read-only',
} as const);

export const activityRosterReservationStateSchema = z.enum([
  'reserved',
  'waitlisted',
]);

export const activityRosterParticipantSchema = z.strictObject({
  reservationId: uuidSchema,
  state: activityRosterReservationStateSchema,
  displayName: safeTextSchema(257),
  company: safeTextSchema(160).nullable(),
});

export const activityRosterSessionSchema = z
  .strictObject({
    sessionId: uuidSchema,
    title: safeTextSchema(160),
    startsAt: dateTimeSchema,
    capacity: z.number().int().positive(),
    participants: z.array(activityRosterParticipantSchema).max(250),
  })
  .superRefine((session, context) => {
    const ids = session.participants.map(({ reservationId }) => reservationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Roster reservation IDs must be unique',
      });
    }
    const reserved = session.participants.filter(
      ({ state }) => state === 'reserved',
    ).length;
    if (reserved > session.capacity) {
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Reserved roster cannot exceed capacity',
      });
    }
  });

export const activityRosterResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    generatedAt: dateTimeSchema,
    sessions: z.array(activityRosterSessionSchema).max(30),
  })
  .superRefine((response, context) => {
    const ids = response.sessions.map(({ sessionId }) => sessionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['sessions'],
        message: 'Assigned sessions must be unique',
      });
    }
  });

export type ActivityRosterResponse = z.infer<
  typeof activityRosterResponseSchema
>;

export const activityRosterAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const activityRosterAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const activityRosterNotFoundProblemSchema = defineApiProblemSchema(
  'ROSTER_NOT_FOUND',
  404,
);
export const activityRosterInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const activityRosterProblemSchema = z.discriminatedUnion('code', [
  activityRosterAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  activityRosterAccessDeniedProblemSchema,
  activityRosterNotFoundProblemSchema,
  activityRosterInternalErrorProblemSchema,
]);

export type ActivityRosterProblem = z.infer<typeof activityRosterProblemSchema>;
