import { describe, expect, it } from 'vitest';

import {
  MAX_FIELD_MESSAGES,
  MAX_PAGE_SIZE,
  MAX_PROBLEM_FIELDS,
  apiFailureKinds,
  apiProblemSchema,
  cursorPageInfoSchema,
  cursorPaginationRequestSchema,
  defineApiProblemSchema,
  etagSchema,
  idempotencyKeySchema,
  problemFieldErrorsSchema,
  problemTypeForCode,
  sessionExpiredProblemSchema,
  transportMetadataSchema,
} from './base';

const validProblem = {
  type: 'urn:byzon:problem:capacity-full',
  title: 'Capacity reached',
  status: 409,
  code: 'CAPACITY_FULL',
  detail: 'No capacity remains for this session.',
  requestId: 'request-12345678',
} as const;

describe('API problem contract', () => {
  it('validates a bounded problem envelope and field errors', () => {
    expect(
      apiProblemSchema.parse({
        ...validProblem,
        fieldErrors: {
          'profile.contactEmail': ['Enter a valid e-mail address.'],
        },
      }),
    ).toEqual({
      ...validProblem,
      fieldErrors: {
        'profile.contactEmail': ['Enter a valid e-mail address.'],
      },
    });
  });

  it('rejects mismatched types, unknown fields and unsafe request IDs', () => {
    expect(
      apiProblemSchema.safeParse({
        ...validProblem,
        type: 'urn:byzon:problem:other-code',
      }).success,
    ).toBe(false);
    expect(
      apiProblemSchema.safeParse({ ...validProblem, secret: 'do-not-expose' })
        .success,
    ).toBe(false);
    expect(
      apiProblemSchema.safeParse({
        ...validProblem,
        requestId: 'unsafe request id',
      }).success,
    ).toBe(false);
  });

  it('defines exact endpoint problem schemas and session expiry', () => {
    const capacityFullSchema = defineApiProblemSchema('CAPACITY_FULL', 409);

    expect(capacityFullSchema.parse(validProblem)).toEqual(validProblem);
    expect(
      capacityFullSchema.safeParse({
        ...validProblem,
        code: 'RESERVATION_CLOSED',
        type: problemTypeForCode('RESERVATION_CLOSED'),
      }).success,
    ).toBe(false);

    expect(
      sessionExpiredProblemSchema.parse({
        ...validProblem,
        type: 'urn:byzon:problem:auth-session-expired',
        title: 'Session expired',
        status: 401,
        code: 'AUTH_SESSION_EXPIRED',
        detail: 'Sign in to continue.',
      }),
    ).toMatchObject({ status: 401, code: 'AUTH_SESSION_EXPIRED' });
  });

  it('rejects invalid schema definitions before they can be exported', () => {
    expect(() => defineApiProblemSchema('invalid-code', 409)).toThrow();
    expect(() => defineApiProblemSchema('INVALID_STATUS', 200)).toThrow();
  });

  it('bounds structured field errors', () => {
    expect(
      problemFieldErrorsSchema.safeParse({
        field: Array.from(
          { length: MAX_FIELD_MESSAGES + 1 },
          () => 'Invalid value',
        ),
      }).success,
    ).toBe(false);
    expect(
      problemFieldErrorsSchema.safeParse({
        'unsafe field': ['Invalid value'],
      }).success,
    ).toBe(false);
    expect(
      problemFieldErrorsSchema.safeParse({
        'profile.__proto__.polluted': ['Invalid value'],
      }).success,
    ).toBe(false);
    expect(
      problemFieldErrorsSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: MAX_PROBLEM_FIELDS + 1 }, (_, index) => [
            `field.${index}`,
            ['Invalid value'],
          ]),
        ),
      ).success,
    ).toBe(false);
  });
});

describe('pagination and transport metadata', () => {
  it('accepts an opaque cursor and a bounded page size', () => {
    expect(
      cursorPaginationRequestSchema.parse({
        cursor: 'opaque:cursor.v1',
        limit: MAX_PAGE_SIZE,
      }),
    ).toEqual({ cursor: 'opaque:cursor.v1', limit: MAX_PAGE_SIZE });
    expect(
      cursorPaginationRequestSchema.safeParse({
        limit: MAX_PAGE_SIZE + 1,
      }).success,
    ).toBe(false);
    expect(
      cursorPaginationRequestSchema.safeParse({
        cursor: 'unsafe\r\ncursor',
      }).success,
    ).toBe(false);
    expect(cursorPageInfoSchema.parse({ nextCursor: null })).toEqual({
      nextCursor: null,
    });
  });

  it('keeps transport metadata small and rejects header injection', () => {
    expect(
      transportMetadataSchema.parse({
        requestId: 'request-12345678',
        etag: 'W/"publication-42"',
      }),
    ).toEqual({
      requestId: 'request-12345678',
      etag: 'W/"publication-42"',
    });
    expect(
      transportMetadataSchema.safeParse({
        requestId: 'request-12345678',
        etag: '"safe"\r\nx-secret: exposed',
      }).success,
    ).toBe(false);
    expect(
      transportMetadataSchema.safeParse({
        requestId: 'request-12345678',
        etag: 'unquoted-etag',
      }).success,
    ).toBe(false);
    expect(
      transportMetadataSchema.safeParse({
        requestId: 'request-12345678',
        responseBody: 'not metadata',
      }).success,
    ).toBe(false);
  });

  it('validates cache and idempotency header values', () => {
    expect(etagSchema.parse('W/"publication-42"')).toBe('W/"publication-42"');
    expect(etagSchema.safeParse('"safe"\r\nx-secret: exposed').success).toBe(
      false,
    );
    expect(idempotencyKeySchema.parse('request-key-0001')).toBe(
      'request-key-0001',
    );
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
  });
});

describe('client failure taxonomy', () => {
  it('uses stable discriminants without localized messages', () => {
    expect(apiFailureKinds).toEqual([
      'aborted',
      'offline',
      'timeout',
      'transport',
      'invalid_response',
      'session_expired',
      'problem',
    ]);
  });
});
