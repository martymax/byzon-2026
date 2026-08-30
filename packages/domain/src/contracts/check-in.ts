import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  sessionExpiredProblemSchema,
} from './base.js';

export const CHECKIN_SEARCH_MIN_LENGTH = 2;
export const CHECKIN_SEARCH_MAX_LENGTH = 80;
export const CHECKIN_SEARCH_RESULT_LIMIT = 5;
export const CHECKIN_UNDO_REASON_MIN_LENGTH = 8;
export const CHECKIN_UNDO_REASON_MAX_LENGTH = 240;

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const unsafeInlineTextPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const safeInlineTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Text must not be blank',
    })
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Text contains unsafe control characters',
    });

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Timezone must be a supported IANA timezone' },
  );

/**
 * CS-CHECKIN-01 is deliberately online-only. No browser persistence, offline
 * mutation queue or real credential format is part of this contract.
 */
export const checkinCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  offlineCheckin: 'forbidden',
  authority: 'online-server',
  lookupMutation: 'none',
  confirmIdempotency: 'required',
  undoIdempotency: 'required',
} as const);

export const checkinOperatorRoleSchema = z.enum([
  'checkin_operator',
  'organizer_admin',
]);
export type CheckinOperatorRole = z.infer<typeof checkinOperatorRoleSchema>;

export const checkinDeviceStateSchema = z.enum(['trusted', 'revoked']);
export type CheckinDeviceState = z.infer<typeof checkinDeviceStateSchema>;

const checkinStationSchema = z.strictObject({
  id: uuidSchema,
  name: safeInlineTextSchema(120),
});

export const checkinBootstrapResponseSchema = z
  .strictObject({
    serverNow: dateTimeSchema,
    event: z.strictObject({
      id: uuidSchema,
      name: safeInlineTextSchema(160),
      timezone: timezoneSchema,
    }),
    station: checkinStationSchema,
    device: z.strictObject({
      id: uuidSchema,
      label: safeInlineTextSchema(120),
      state: checkinDeviceStateSchema,
    }),
    actor: z.strictObject({
      displayLabel: safeInlineTextSchema(120),
      role: checkinOperatorRoleSchema,
      permissions: z.strictObject({
        confirm: z.boolean(),
        undo: z.boolean(),
      }),
    }),
    policy: z.strictObject({
      credentialAdapter: z.literal('synthetic_demo_only'),
      operatingMode: z.literal('online_authoritative'),
      offlineCheckinEnabled: z.literal(false),
      searchMinLength: z.literal(CHECKIN_SEARCH_MIN_LENGTH),
      searchMaxLength: z.literal(CHECKIN_SEARCH_MAX_LENGTH),
      searchResultLimit: z.literal(CHECKIN_SEARCH_RESULT_LIMIT),
      undoWindowSeconds: z.number().int().min(30).max(3_600),
    }),
  })
  .superRefine((value, context) => {
    if (value.device.state === 'revoked' && value.actor.permissions.confirm) {
      context.addIssue({
        code: 'custom',
        path: ['actor', 'permissions', 'confirm'],
        message: 'A revoked device cannot confirm check-ins',
      });
    }
    if (
      value.actor.role === 'checkin_operator' &&
      !value.actor.permissions.confirm
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actor', 'permissions', 'confirm'],
        message: 'The check-in operator role requires confirm permission',
      });
    }
  });

export type CheckinBootstrapResponse = z.infer<
  typeof checkinBootstrapResponseSchema
>;

export const checkinTicketStateSchema = z.enum([
  'valid',
  'cancelled',
  'refunded',
  'blocked',
]);
export type CheckinTicketState = z.infer<typeof checkinTicketStateSchema>;

const maskedEmailSchema = safeInlineTextSchema(96)
  .refine(
    (value) =>
      value.includes('***') && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,10}$/.test(value),
    {
      message: 'Email must remain masked',
    },
  )
  .refine((value) => !/^[^*@\s]+@[^*@\s]+\.[A-Za-z]{2,10}$/.test(value), {
    message: 'A complete email address is not allowed',
  });

export const checkinPersonSummarySchema = z.strictObject({
  id: uuidSchema,
  displayName: safeInlineTextSchema(160),
  maskedEmail: maskedEmailSchema,
});
export type CheckinPersonSummary = z.infer<typeof checkinPersonSummarySchema>;

const checkinTicketSummarySchema = z.strictObject({
  referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,4}$/),
  state: checkinTicketStateSchema,
});

export const checkinUndoAvailabilitySchema = z
  .strictObject({
    allowed: z.boolean(),
    expiresAt: dateTimeSchema.nullable(),
    unavailableReason: z
      .enum(['role_forbidden', 'window_expired', 'already_undone'])
      .nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.allowed !== (value.expiresAt !== null) ||
      value.allowed === (value.unavailableReason !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Undo availability must carry one canonical branch',
      });
    }
  });

export const checkinRecordSchema = z.strictObject({
  id: uuidSchema,
  occurredAt: dateTimeSchema,
  station: checkinStationSchema,
  undo: checkinUndoAvailabilitySchema,
});
export type CheckinRecord = z.infer<typeof checkinRecordSchema>;

const credentialValueSchema = z
  .string()
  .min(4)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Credential must remain opaque');

const credentialLookupShape = {
  credential: z.strictObject({
    adapter: z.literal('synthetic_demo'),
    opaqueValue: credentialValueSchema,
  }),
} as const;

export const checkinLookupRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('camera_scan'),
    ...credentialLookupShape,
  }),
  z.strictObject({
    method: z.literal('manual_code'),
    ...credentialLookupShape,
  }),
  z.strictObject({
    method: z.literal('manual_search'),
    personId: uuidSchema,
  }),
]);
export type CheckinLookupRequest = z.infer<typeof checkinLookupRequestSchema>;

const lookupBaseShape = {
  lookupId: uuidSchema,
  expiresAt: dateTimeSchema,
} as const;

const unavailableLookup = <State extends 'cancelled' | 'refunded' | 'blocked'>(
  state: State,
) =>
  z.strictObject({
    ...lookupBaseShape,
    outcome: z.literal(state),
    person: checkinPersonSummarySchema,
    ticket: checkinTicketSummarySchema.extend({ state: z.literal(state) }),
    previousCheckin: z.null(),
    confirmation: z.strictObject({ state: z.literal('unavailable') }),
  });

export const checkinLookupResponseSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    ...lookupBaseShape,
    outcome: z.literal('valid'),
    person: checkinPersonSummarySchema,
    ticket: checkinTicketSummarySchema.extend({ state: z.literal('valid') }),
    previousCheckin: z.null(),
    confirmation: z.strictObject({ state: z.literal('required') }),
  }),
  z.strictObject({
    ...lookupBaseShape,
    outcome: z.literal('duplicate'),
    person: checkinPersonSummarySchema,
    ticket: checkinTicketSummarySchema.extend({ state: z.literal('valid') }),
    previousCheckin: checkinRecordSchema,
    confirmation: z.strictObject({ state: z.literal('unavailable') }),
  }),
  unavailableLookup('cancelled'),
  unavailableLookup('refunded'),
  unavailableLookup('blocked'),
  z.strictObject({
    ...lookupBaseShape,
    outcome: z.literal('unknown'),
    person: z.null(),
    ticket: z.null(),
    previousCheckin: z.null(),
    confirmation: z.strictObject({ state: z.literal('unavailable') }),
  }),
]);
export type CheckinLookupResponse = z.infer<typeof checkinLookupResponseSchema>;
export type CheckinLookupOutcome = CheckinLookupResponse['outcome'];

export const checkinSearchQuerySchema = z
  .string()
  .trim()
  .min(CHECKIN_SEARCH_MIN_LENGTH)
  .max(CHECKIN_SEARCH_MAX_LENGTH)
  .refine((value) => !unsafeInlineTextPattern.test(value), {
    message: 'Search query contains unsafe control characters',
  });

export const checkinSearchRequestSchema = z.strictObject({
  query: checkinSearchQuerySchema,
});
export type CheckinSearchRequest = z.infer<typeof checkinSearchRequestSchema>;

export const checkinSearchResponseSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        person: checkinPersonSummarySchema,
        ticket: checkinTicketSummarySchema,
      }),
    )
    .max(CHECKIN_SEARCH_RESULT_LIMIT),
  limitedTo: z.literal(CHECKIN_SEARCH_RESULT_LIMIT),
});
export type CheckinSearchResponse = z.infer<typeof checkinSearchResponseSchema>;

export const checkinConfirmRequestSchema = z.strictObject({
  lookupId: uuidSchema,
  stationId: uuidSchema,
  deviceId: uuidSchema,
});
export type CheckinConfirmRequest = z.infer<typeof checkinConfirmRequestSchema>;

export const checkinConfirmResponseSchema = z.strictObject({
  outcome: z.enum(['checked_in', 'duplicate']),
  person: checkinPersonSummarySchema,
  ticket: checkinTicketSummarySchema.extend({ state: z.literal('valid') }),
  checkin: checkinRecordSchema,
});
export type CheckinConfirmResponse = z.infer<
  typeof checkinConfirmResponseSchema
>;

export const checkinUndoRequestSchema = z.strictObject({
  reason: safeInlineTextSchema(CHECKIN_UNDO_REASON_MAX_LENGTH).pipe(
    z.string().min(CHECKIN_UNDO_REASON_MIN_LENGTH),
  ),
});
export type CheckinUndoRequest = z.infer<typeof checkinUndoRequestSchema>;

export const checkinUndoResponseSchema = z.strictObject({
  outcome: z.enum(['undone', 'already_undone']),
  checkinId: uuidSchema,
  undoneAt: dateTimeSchema,
});
export type CheckinUndoResponse = z.infer<typeof checkinUndoResponseSchema>;

export const checkinStatsResponseSchema = z.strictObject({
  checkedIn: z.number().int().nonnegative().max(1_000_000),
  duplicates: z.number().int().nonnegative().max(1_000_000),
  exceptions: z.number().int().nonnegative().max(1_000_000),
  updatedAt: dateTimeSchema,
});

export const checkinAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const checkinPermissionDeniedProblemSchema = defineApiProblemSchema(
  'CHECKIN_PERMISSION_DENIED',
  403,
);
export const checkinDeviceRevokedProblemSchema = defineApiProblemSchema(
  'CHECKIN_DEVICE_REVOKED',
  403,
);
export const checkinNotFoundProblemSchema = defineApiProblemSchema(
  'CHECKIN_NOT_FOUND',
  404,
);
export const checkinLookupExpiredProblemSchema = defineApiProblemSchema(
  'CHECKIN_LOOKUP_EXPIRED',
  409,
);
export const checkinTicketStateChangedProblemSchema = defineApiProblemSchema(
  'CHECKIN_TICKET_STATE_CHANGED',
  409,
);
export const checkinUndoForbiddenProblemSchema = defineApiProblemSchema(
  'CHECKIN_UNDO_FORBIDDEN',
  403,
);
export const checkinUndoWindowExpiredProblemSchema = defineApiProblemSchema(
  'CHECKIN_UNDO_WINDOW_EXPIRED',
  409,
);
export const checkinValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const checkinRateLimitedProblemSchema = defineApiProblemSchema(
  'CHECKIN_RATE_LIMITED',
  429,
);
export const checkinInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

const checkinBaseProblems = [
  checkinAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  checkinPermissionDeniedProblemSchema,
  checkinDeviceRevokedProblemSchema,
  checkinValidationProblemSchema,
  checkinRateLimitedProblemSchema,
  checkinInternalErrorProblemSchema,
] as const;

export const checkinReadProblemSchema = z.discriminatedUnion('code', [
  ...checkinBaseProblems,
  checkinNotFoundProblemSchema,
]);
export const checkinLookupProblemSchema = z.discriminatedUnion('code', [
  ...checkinBaseProblems,
  checkinNotFoundProblemSchema,
]);
export const checkinConfirmProblemSchema = z.discriminatedUnion('code', [
  ...checkinBaseProblems,
  checkinLookupExpiredProblemSchema,
  checkinTicketStateChangedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);
export const checkinUndoProblemSchema = z.discriminatedUnion('code', [
  ...checkinBaseProblems,
  checkinNotFoundProblemSchema,
  checkinUndoForbiddenProblemSchema,
  checkinUndoWindowExpiredProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export type CheckinReadProblem = z.infer<typeof checkinReadProblemSchema>;
export type CheckinLookupProblem = z.infer<typeof checkinLookupProblemSchema>;
export type CheckinConfirmProblem = z.infer<typeof checkinConfirmProblemSchema>;
export type CheckinUndoProblem = z.infer<typeof checkinUndoProblemSchema>;
