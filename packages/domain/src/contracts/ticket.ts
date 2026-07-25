import { z } from 'zod';

import { defineApiProblemSchema, sessionExpiredProblemSchema } from './base.js';

/**
 * CS-TICKET-01 carries private participant ticket state. It must never enter a
 * shared cache or service worker. The first F2-04 slice deliberately exposes
 * no presentation value: BLOCKER-TKT-05 still owns its format, expiry,
 * rotation and verifier.
 */
export const participantTicketCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  offline: 'forbidden',
  presentation: 'blocked-by-tkt-05',
} as const);

const uuidSchema = z.string().uuid();
const holderDisplayNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim().length > 0, {
    message: 'Holder display name must not be blank',
  })
  .refine(
    (value) => !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(value),
    {
      message: 'Holder display name contains unsafe control characters',
    },
  );
const referenceSuffixSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{2,4}$/, 'Invalid masked reference suffix');

export const participantTicketStatusSchema = z.enum([
  'valid',
  'cancelled',
  'refunded',
  'blocked',
]);

export type ParticipantTicketStatus = z.infer<
  typeof participantTicketStatusSchema
>;

export const ticketPresentationUnavailableReasonSchema = z.enum([
  'security_gate_pending',
  'ticket_inactive',
  'event_ended',
]);

export type TicketPresentationUnavailableReason = z.infer<
  typeof ticketPresentationUnavailableReasonSchema
>;

/**
 * This union intentionally has no available/value branch yet. Extending it
 * requires the TKT-05 security decision and P4-12 server implementation.
 */
export const participantTicketPresentationSchema = z.discriminatedUnion(
  'state',
  [
    z.strictObject({
      state: z.literal('unavailable'),
      reason: ticketPresentationUnavailableReasonSchema,
    }),
  ],
);

export type ParticipantTicketPresentation = z.infer<
  typeof participantTicketPresentationSchema
>;

const validateTicketState = (
  ticket: {
    readonly presentation: ParticipantTicketPresentation;
    readonly status: ParticipantTicketStatus;
  },
  context: z.RefinementCtx,
): void => {
  const { reason } = ticket.presentation;
  if (
    (ticket.status === 'valid' && reason === 'ticket_inactive') ||
    (ticket.status !== 'valid' && reason === 'security_gate_pending')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['presentation', 'reason'],
      message: 'Presentation reason must match the participant ticket status',
    });
  }
};

export const participantTicketResponseSchema = z.strictObject({
  eventId: uuidSchema,
  ticket: z
    .strictObject({
      status: participantTicketStatusSchema,
      holder: z.strictObject({
        displayName: holderDisplayNameSchema,
      }),
      referenceSuffix: referenceSuffixSchema,
      presentation: participantTicketPresentationSchema,
    })
    .superRefine(validateTicketState),
});

export type ParticipantTicketResponse = z.infer<
  typeof participantTicketResponseSchema
>;

export const ticketAuthenticationRequiredProblemSchema = defineApiProblemSchema(
  'AUTHENTICATION_REQUIRED',
  401,
);
export const ticketNotFoundProblemSchema = defineApiProblemSchema(
  'TICKET_NOT_FOUND',
  404,
);
export const ticketInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const participantTicketProblemSchema = z.discriminatedUnion('code', [
  ticketAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  ticketNotFoundProblemSchema,
  ticketInternalErrorProblemSchema,
]);

export type ParticipantTicketProblem = z.infer<
  typeof participantTicketProblemSchema
>;
