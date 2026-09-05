import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  sessionExpiredProblemSchema,
} from './base.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeDisplayTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Text must not be blank')
    .refine(
      (value) => !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(value),
      'Text contains unsafe control characters',
    );

export const activationCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  offline: 'read-shell-only',
  secretsInHistory: 'forbidden',
} as const);

export const activationEventPhaseSchema = z.enum([
  'draft',
  'activation_open',
  'live',
  'ended',
  'archived',
]);

export type ActivationEventPhase = z.infer<typeof activationEventPhaseSchema>;

export const activationMethodSchema = z.enum([
  'manual_code',
  'camera_scan',
  'recovery_link',
]);

export type ActivationMethod = z.infer<typeof activationMethodSchema>;

export const activationFlowIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._~-]{16,128}$/, 'Invalid activation flow ID');

export const activationSecretSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9._~:-]+$/, 'Invalid opaque activation secret');

export const activationEmailSchema = z
  .email()
  .max(320)
  .refine(
    (value) => !/[\u0000-\u001F\u007F]/.test(value),
    'Email contains unsafe control characters',
  );

const participantActivationStaticReturnToValues = [
  '/app',
  '/app/agenda',
  '/app/informace',
  '/app/networking',
  '/app/nastaveni',
  '/app/oznameni',
  '/app/oznameni?view=unread',
  '/app/partneri',
  '/app/profil',
  '/app/program',
  '/app/recnici',
  '/app/soukromi',
  '/app/vice',
  '/app/vstupenka',
] as const;

export type ParticipantActivationReturnTo =
  | (typeof participantActivationStaticReturnToValues)[number]
  | `/app/program/${string}`
  | `/app/oznameni/${string}`
  | `/app/recnici/${string}`;

export type ActivationReturnTo = '/onboarding' | ParticipantActivationReturnTo;

const participantActivationStaticReturnToSet = new Set<string>(
  participantActivationStaticReturnToValues,
);
const participantActivationDetailReturnToPattern =
  /^\/app\/(program|oznameni|networking)\/([^/?]+)(\?from=agenda)?$/;
const participantSpeakerReturnToPattern =
  /^\/app\/recnici\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const isParticipantActivationReturnTo = (
  value: string,
): value is ParticipantActivationReturnTo => {
  if (participantActivationStaticReturnToSet.has(value)) return true;

  const detailMatch = participantActivationDetailReturnToPattern.exec(value);
  if (detailMatch) {
    const detailKind = detailMatch[1];
    const id = detailMatch[2];
    return (
      (detailMatch[3] === undefined || detailKind === 'program') &&
      id !== undefined &&
      id === id.toLowerCase() &&
      uuidSchema.safeParse(id).success
    );
  }

  const speakerMatch = participantSpeakerReturnToPattern.exec(value);
  return (
    speakerMatch !== null &&
    speakerMatch[1] !== undefined &&
    speakerMatch[1].length <= 128
  );
};

/**
 * Post-authentication navigation is an exact contract, not a general-purpose
 * same-origin redirect. Only published participant routes are accepted.
 */
export const participantActivationReturnToSchema = z
  .string()
  .max(160)
  .refine(isParticipantActivationReturnTo, {
    message: 'Invalid participant activation return destination',
  })
  .transform((value): ParticipantActivationReturnTo => value);

export const activationReturnToSchema = z.union([
  z.literal('/onboarding'),
  participantActivationReturnToSchema,
]);

export const activationLandingFlowSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('anonymous') }),
  z.strictObject({
    state: z.literal('claim_in_progress'),
    flowId: activationFlowIdSchema,
    expiresAt: dateTimeSchema,
    nextStep: z.enum(['identity', 'onboarding']),
    membershipCreated: z.literal(false),
    sessionCreated: z.literal(false),
  }),
  z.strictObject({
    state: z.literal('activated'),
    continueTo: z.literal('/app'),
  }),
  z.strictObject({
    state: z.literal('suspended'),
    supportReference: safeDisplayTextSchema(64),
  }),
]);

export type ActivationLandingFlow = z.infer<typeof activationLandingFlowSchema>;

export const activationLandingResponseSchema = z
  .strictObject({
    event: z.strictObject({
      id: uuidSchema,
      name: safeDisplayTextSchema(160),
      dateLabel: safeDisplayTextSchema(160),
      locationLabel: safeDisplayTextSchema(160),
      phase: activationEventPhaseSchema,
    }),
    availability: z.discriminatedUnion('state', [
      z.strictObject({
        state: z.literal('open'),
        methods: z
          .array(activationMethodSchema)
          .min(1)
          .max(3)
          .refine(
            (methods) => new Set(methods).size === methods.length,
            'Activation methods must be unique',
          ),
      }),
      z.strictObject({
        state: z.literal('closed'),
        reason: z.enum(['not_open_yet', 'event_ended', 'event_archived']),
        methods: z.tuple([]),
      }),
    ]),
    flow: activationLandingFlowSchema,
  })
  .superRefine((response, context) => {
    const openPhase =
      response.event.phase === 'activation_open' ||
      response.event.phase === 'live';
    if (openPhase !== (response.availability.state === 'open')) {
      context.addIssue({
        code: 'custom',
        path: ['availability', 'state'],
        message: 'Activation availability must match the event phase',
      });
    }
    if (
      response.flow.state === 'claim_in_progress' &&
      response.availability.state !== 'open'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['flow', 'state'],
        message: 'A claim can continue only while activation is open',
      });
    }
    if (
      response.availability.state === 'open' &&
      response.availability.methods.includes('camera_scan') &&
      !response.availability.methods.includes('manual_code')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availability', 'methods'],
        message: 'Camera activation must keep the manual fallback available',
      });
    }
  });

export type ActivationLandingResponse = z.infer<
  typeof activationLandingResponseSchema
>;

export const activationClaimRequestSchema = z.strictObject({
  code: activationSecretSchema,
  method: z.enum(['manual_code', 'camera_scan']),
});

export type ActivationClaimRequest = z.infer<
  typeof activationClaimRequestSchema
>;

export const activationClaimResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('identity_required'),
    flowId: activationFlowIdSchema,
    expiresAt: dateTimeSchema,
    membershipCreated: z.literal(false),
    sessionCreated: z.literal(false),
  }),
  z.strictObject({
    state: z.literal('recovery_required'),
    flowId: activationFlowIdSchema,
    expiresAt: dateTimeSchema,
    membershipCreated: z.literal(false),
    sessionCreated: z.literal(false),
  }),
]);

export type ActivationClaimResponse = z.infer<
  typeof activationClaimResponseSchema
>;

export const activationIdentityRequestSchema = z.strictObject({
  flowId: activationFlowIdSchema,
  email: activationEmailSchema,
  returnTo: activationReturnToSchema,
});

export type ActivationIdentityRequest = z.infer<
  typeof activationIdentityRequestSchema
>;

export const activationIdentityResponseSchema = z.strictObject({
  state: z.literal('link_sent'),
  flowId: activationFlowIdSchema,
  expiresAt: dateTimeSchema,
  resendAfterSeconds: z.number().int().min(1).max(3_600),
  membershipCreated: z.literal(false),
  sessionCreated: z.literal(false),
});

export type ActivationIdentityResponse = z.infer<
  typeof activationIdentityResponseSchema
>;

export const activationLinkRequestSchema = z.strictObject({
  token: activationSecretSchema,
});

export const activationLinkResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('onboarding_required'),
    continueTo: z.literal('/onboarding'),
  }),
  z.strictObject({
    state: z.literal('active'),
    continueTo: participantActivationReturnToSchema,
  }),
]);

export type ActivationLinkResponse = z.infer<
  typeof activationLinkResponseSchema
>;

export const activationRecoveryRequestSchema = z.strictObject({
  email: activationEmailSchema,
  returnTo: activationReturnToSchema,
});

export type ActivationRecoveryRequest = z.infer<
  typeof activationRecoveryRequestSchema
>;

export const activationRecoveryResponseSchema = z.strictObject({
  accepted: z.literal(true),
  resendAfterSeconds: z.number().int().min(1).max(3_600),
});

export const activationClosedProblemSchema = defineApiProblemSchema(
  'ACTIVATION_CLOSED',
  409,
);
export const activationClaimRejectedProblemSchema = defineApiProblemSchema(
  'CLAIM_REJECTED',
  400,
);
export const activationClaimRateLimitedProblemSchema = defineApiProblemSchema(
  'CLAIM_RATE_LIMITED',
  429,
);
export const activationFlowExpiredProblemSchema = defineApiProblemSchema(
  'ACTIVATION_FLOW_EXPIRED',
  410,
);
export const activationLinkRejectedProblemSchema = defineApiProblemSchema(
  'ACTIVATION_LINK_REJECTED',
  400,
);
export const activationInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const activationLandingProblemSchema = z.discriminatedUnion('code', [
  activationClosedProblemSchema,
  sessionExpiredProblemSchema,
  activationInternalErrorProblemSchema,
]);

export const activationClaimProblemSchema = z.discriminatedUnion('code', [
  activationClaimRejectedProblemSchema,
  activationClosedProblemSchema,
  activationClaimRateLimitedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  activationInternalErrorProblemSchema,
]);

export const activationIdentityProblemSchema = z.discriminatedUnion('code', [
  activationFlowExpiredProblemSchema,
  activationClaimRateLimitedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  activationInternalErrorProblemSchema,
]);

export const activationLinkProblemSchema = z.discriminatedUnion('code', [
  activationLinkRejectedProblemSchema,
  activationFlowExpiredProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  activationInternalErrorProblemSchema,
]);

export const activationRecoveryProblemSchema = z.discriminatedUnion('code', [
  activationClaimRateLimitedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  activationInternalErrorProblemSchema,
]);

export type ActivationLandingProblem = z.infer<
  typeof activationLandingProblemSchema
>;
export type ActivationClaimProblem = z.infer<
  typeof activationClaimProblemSchema
>;
export type ActivationIdentityProblem = z.infer<
  typeof activationIdentityProblemSchema
>;
export type ActivationLinkProblem = z.infer<typeof activationLinkProblemSchema>;
export type ActivationRecoveryProblem = z.infer<
  typeof activationRecoveryProblemSchema
>;
