import { z } from 'zod';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PROBLEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const PROBLEM_TYPE_PATTERN = /^urn:byzon:problem:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_.[\]-]{1,128}$/;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9._~:=-]{1,512}$/;
const ETAG_PATTERN = /^(?:W\/)?"[\x21\x23-\x7E]{1,510}"$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const MAX_PAGE_SIZE = 100;
export const MAX_PROBLEM_FIELDS = 50;
export const MAX_FIELD_MESSAGES = 10;

export const requestIdSchema = z
  .string()
  .regex(REQUEST_ID_PATTERN, 'Invalid request ID');

export type RequestId = z.infer<typeof requestIdSchema>;

export const apiProblemCodeSchema = z
  .string()
  .regex(PROBLEM_CODE_PATTERN, 'Invalid API problem code');

export type ApiProblemCode = z.infer<typeof apiProblemCodeSchema>;

export const apiProblemStatusSchema = z.number().int().min(400).max(599);

const problemTitleSchema = z.string().trim().min(1).max(160);
const problemDetailSchema = z.string().trim().min(1).max(2_048);
const fieldPathSchema = z
  .string()
  .regex(FIELD_PATH_PATTERN, 'Invalid problem field path')
  .refine(
    (path) =>
      !path
        .split(/[.[\]-]+/)
        .some((segment) =>
          ['__proto__', 'prototype', 'constructor'].includes(segment),
        ),
    'Unsafe problem field path',
  );
const fieldMessageSchema = z.string().trim().min(1).max(512);

export const problemFieldErrorsSchema = z
  .record(
    fieldPathSchema,
    z.array(fieldMessageSchema).min(1).max(MAX_FIELD_MESSAGES),
  )
  .superRefine((fieldErrors, context) => {
    if (Object.keys(fieldErrors).length > MAX_PROBLEM_FIELDS) {
      context.addIssue({
        code: 'custom',
        message: `Problem field errors must contain at most ${MAX_PROBLEM_FIELDS} fields`,
      });
    }
  });

export type ProblemFieldErrors = z.infer<typeof problemFieldErrorsSchema>;

export const problemTypeForCode = (code: string): string => {
  const validCode = apiProblemCodeSchema.parse(code);
  return `urn:byzon:problem:${validCode.toLowerCase().replaceAll('_', '-')}`;
};

const apiProblemShape = {
  type: z
    .string()
    .max(256)
    .regex(PROBLEM_TYPE_PATTERN, 'Invalid API problem type'),
  title: problemTitleSchema,
  status: apiProblemStatusSchema,
  code: apiProblemCodeSchema,
  detail: problemDetailSchema,
  requestId: requestIdSchema,
  fieldErrors: problemFieldErrorsSchema.optional(),
} as const;

/**
 * Validates the common problem envelope only.
 *
 * Endpoint contracts must narrow `code` to their supported literals, normally
 * with `defineApiProblemSchema`, and reject unknown problem codes.
 */
export const apiProblemSchema = z
  .strictObject(apiProblemShape)
  .superRefine((problem, context) => {
    if (problem.type !== problemTypeForCode(problem.code)) {
      context.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'API problem type must match its code',
      });
    }
  });

export type ApiProblem = z.infer<typeof apiProblemSchema>;

/**
 * Creates a strict problem schema for one supported endpoint code/status pair.
 * Feature slices may extend the returned schema with bounded structured fields.
 */
export const defineApiProblemSchema = <
  const Code extends string,
  const Status extends number,
>(
  code: Code,
  status: Status,
) => {
  apiProblemCodeSchema.parse(code);
  apiProblemStatusSchema.parse(status);

  return z.strictObject({
    ...apiProblemShape,
    type: z.literal(problemTypeForCode(code)),
    status: z.literal(status),
    code: z.literal(code),
  });
};

export const sessionExpiredProblemSchema = defineApiProblemSchema(
  'AUTH_SESSION_EXPIRED',
  401,
);

export type SessionExpiredProblem = z.infer<typeof sessionExpiredProblemSchema>;

export const opaqueCursorSchema = z
  .string()
  .regex(OPAQUE_CURSOR_PATTERN, 'Invalid opaque cursor');

export const cursorPaginationRequestSchema = z.strictObject({
  cursor: opaqueCursorSchema.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type CursorPaginationRequest = z.infer<
  typeof cursorPaginationRequestSchema
>;

export const cursorPageInfoSchema = z.strictObject({
  nextCursor: opaqueCursorSchema.nullable(),
});

export type CursorPageInfo = z.infer<typeof cursorPageInfoSchema>;

export const etagSchema = z.string().regex(ETAG_PATTERN, 'Invalid ETag');

export const idempotencyKeySchema = z
  .string()
  .regex(IDEMPOTENCY_KEY_PATTERN, 'Invalid idempotency key');

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const transportMetadataSchema = z.strictObject({
  requestId: requestIdSchema,
  etag: etagSchema.optional(),
});

export type TransportMetadata = z.infer<typeof transportMetadataSchema>;

export const apiFailureKinds = [
  'aborted',
  'offline',
  'timeout',
  'transport',
  'invalid_response',
  'session_expired',
  'problem',
] as const;

export type ApiFailureKind = (typeof apiFailureKinds)[number];

/**
 * Transport-neutral client taxonomy. It intentionally carries no raw
 * exception, response body or localized message.
 */
export type ApiFailure<Problem extends ApiProblem = ApiProblem> =
  | { kind: 'aborted' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'transport'; requestId?: RequestId }
  | { kind: 'invalid_response'; requestId?: RequestId }
  | { kind: 'session_expired'; problem: SessionExpiredProblem }
  | { kind: 'problem'; problem: Problem };
