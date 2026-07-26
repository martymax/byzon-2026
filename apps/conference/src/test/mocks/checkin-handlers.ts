import {
  idempotencyKeySchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';
import {
  checkinBootstrapResponseSchema,
  checkinConfirmProblemSchema,
  checkinConfirmRequestSchema,
  checkinConfirmResponseSchema,
  checkinLookupProblemSchema,
  checkinLookupRequestSchema,
  checkinLookupResponseSchema,
  checkinSearchQuerySchema,
  checkinSearchResponseSchema,
  checkinUndoProblemSchema,
  checkinUndoRequestSchema,
  checkinUndoResponseSchema,
  type CheckinConfirmResponse,
  type CheckinUndoResponse,
} from '@byzon/domain/contracts/check-in';
import {
  checkinBootstrapFixtures,
  checkinConfirmFixtures,
  checkinConfirmProblemFixtures,
  checkinFixtureIds,
  checkinLookupFixtures,
  checkinLookupProblemFixtures,
  checkinSearchFixtures,
  checkinUndoFixtures,
  checkinUndoProblemFixtures,
} from '@byzon/test-support/fixtures/check-in';
import { http, type RequestHandler } from 'msw';

import {
  mockJsonResponse,
  mockProblemResponse,
  type MockJsonResponseOptions,
} from './response';

interface StoredCheckinMutation<Response> {
  readonly fingerprint: string;
  readonly response: Response;
}

interface MockCheckinState {
  checkedIn: boolean;
  undone: boolean;
  readonly mutationFingerprints: Map<string, string>;
  readonly confirms: Map<string, StoredCheckinMutation<CheckinConfirmResponse>>;
  readonly undos: Map<string, StoredCheckinMutation<CheckinUndoResponse>>;
}

const mockCheckinState: MockCheckinState = {
  checkedIn: false,
  undone: false,
  mutationFingerprints: new Map(),
  confirms: new Map(),
  undos: new Map(),
};

export const resetMockCheckinState = (): void => {
  mockCheckinState.checkedIn = false;
  mockCheckinState.undone = false;
  mockCheckinState.mutationFingerprints.clear();
  mockCheckinState.confirms.clear();
  mockCheckinState.undos.clear();
};

const fingerprint = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const idempotencyReusedProblem = {
  type: problemTypeForCode('IDEMPOTENCY_KEY_REUSED'),
  title: 'Synthetic check-in problem',
  status: 409,
  code: 'IDEMPOTENCY_KEY_REUSED',
  detail: 'Synthetic idempotency conflict.',
  requestId: 'fixture-checkin-key-reused-0001',
} as const;

const lookupFixtureForCode = (code: string) => {
  if (code === 'DEMO-VALID') {
    return mockCheckinState.checkedIn
      ? checkinLookupFixtures.duplicate
      : checkinLookupFixtures.valid;
  }
  if (code === 'DEMO-DUPLICATE') return checkinLookupFixtures.duplicate;
  if (code === 'DEMO-CANCELLED') return checkinLookupFixtures.cancelled;
  if (code === 'DEMO-REFUNDED') return checkinLookupFixtures.refunded;
  if (code === 'DEMO-BLOCKED') return checkinLookupFixtures.blocked;
  return checkinLookupFixtures.unknown;
};

const successOptions = (fixtureName: string): MockJsonResponseOptions => ({
  fixtureName,
  cacheControl: 'private, no-store',
  vary: ['authorization', 'cookie'],
});

export const checkinMockHandlers: readonly RequestHandler[] = Object.freeze([
  http.get('*/api/v1/check-in/context', () =>
    mockJsonResponse(
      checkinBootstrapResponseSchema,
      checkinBootstrapFixtures.operator,
      successOptions('checkin.mock.context'),
    ),
  ),
  http.get('*/api/v1/check-in/search', ({ request }) => {
    const url = new URL(request.url);
    const query = checkinSearchQuerySchema.safeParse(url.searchParams.get('q'));
    if (!query.success || url.searchParams.get('limit') !== '5') {
      return mockProblemResponse(
        checkinLookupProblemSchema,
        checkinLookupProblemFixtures.internal_error,
        { fixtureName: 'checkin.mock.search-invalid' },
      );
    }
    const result =
      query.data.toLocaleLowerCase('cs').includes('nikdo') ||
      query.data.toLocaleLowerCase('cs').includes('empty')
        ? checkinSearchFixtures.empty
        : checkinSearchFixtures.matches;
    return mockJsonResponse(
      checkinSearchResponseSchema,
      result,
      successOptions('checkin.mock.search'),
    );
  }),
  http.post('*/api/v1/check-in/lookup', async ({ request }) => {
    const parsed = checkinLookupRequestSchema.safeParse(
      await request.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return mockProblemResponse(
        checkinLookupProblemSchema,
        checkinLookupProblemFixtures.internal_error,
        { fixtureName: 'checkin.mock.lookup-invalid' },
      );
    }
    if (
      parsed.data.method !== 'manual_search' &&
      parsed.data.credential.opaqueValue === 'DEMO-ERROR'
    ) {
      return mockProblemResponse(
        checkinLookupProblemSchema,
        checkinLookupProblemFixtures.internal_error,
        { fixtureName: 'checkin.mock.lookup-error' },
      );
    }
    const result =
      parsed.data.method === 'manual_search'
        ? mockCheckinState.checkedIn
          ? checkinLookupFixtures.duplicate
          : checkinLookupFixtures.valid
        : lookupFixtureForCode(parsed.data.credential.opaqueValue);
    return mockJsonResponse(
      checkinLookupResponseSchema,
      result,
      successOptions('checkin.mock.lookup'),
    );
  }),
  http.post('*/api/v1/check-in/confirm', async ({ request }) => {
    const parsed = checkinConfirmRequestSchema.safeParse(
      await request.json().catch(() => undefined),
    );
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (
      !parsed.success ||
      !idempotencyKey.success ||
      parsed.data.lookupId !== checkinFixtureIds.lookup ||
      parsed.data.stationId !== checkinFixtureIds.station ||
      parsed.data.deviceId !== checkinFixtureIds.device
    ) {
      return mockProblemResponse(
        checkinConfirmProblemSchema,
        checkinConfirmProblemFixtures.lookup_expired,
        { fixtureName: 'checkin.mock.confirm-invalid' },
      );
    }
    const requestFingerprint = await fingerprint({
      method: request.method,
      path: new URL(request.url).pathname,
      body: parsed.data,
    });
    const storedFingerprint = mockCheckinState.mutationFingerprints.get(
      idempotencyKey.data,
    );
    if (storedFingerprint && storedFingerprint !== requestFingerprint) {
      return mockProblemResponse(
        checkinConfirmProblemSchema,
        idempotencyReusedProblem,
        { fixtureName: 'checkin.mock.confirm-key-reused' },
      );
    }
    const previous = mockCheckinState.confirms.get(idempotencyKey.data);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) {
        return mockProblemResponse(
          checkinConfirmProblemSchema,
          idempotencyReusedProblem,
          { fixtureName: 'checkin.mock.confirm-key-reused' },
        );
      }
      return mockJsonResponse(
        checkinConfirmResponseSchema,
        previous.response,
        successOptions('checkin.mock.confirm-replay'),
      );
    }
    const response = mockCheckinState.checkedIn
      ? checkinConfirmFixtures.duplicate
      : checkinConfirmFixtures.checked_in;
    mockCheckinState.checkedIn = true;
    mockCheckinState.undone = false;
    mockCheckinState.mutationFingerprints.set(
      idempotencyKey.data,
      requestFingerprint,
    );
    mockCheckinState.confirms.set(idempotencyKey.data, {
      fingerprint: requestFingerprint,
      response,
    });
    return mockJsonResponse(
      checkinConfirmResponseSchema,
      response,
      successOptions('checkin.mock.confirm'),
    );
  }),
  http.post(
    '*/api/v1/check-in/:checkinId/undo',
    async ({ params, request }) => {
      const parsed = checkinUndoRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const idempotencyKey = idempotencyKeySchema.safeParse(
        request.headers.get('idempotency-key'),
      );
      if (
        !parsed.success ||
        !idempotencyKey.success ||
        String(params.checkinId) !== checkinFixtureIds.checkin
      ) {
        return mockProblemResponse(
          checkinUndoProblemSchema,
          checkinUndoProblemFixtures.role_forbidden,
          { fixtureName: 'checkin.mock.undo-invalid' },
        );
      }
      const requestFingerprint = await fingerprint({
        method: request.method,
        path: new URL(request.url).pathname,
        checkinId: String(params.checkinId),
        body: parsed.data,
      });
      const storedFingerprint = mockCheckinState.mutationFingerprints.get(
        idempotencyKey.data,
      );
      if (storedFingerprint && storedFingerprint !== requestFingerprint) {
        return mockProblemResponse(
          checkinUndoProblemSchema,
          idempotencyReusedProblem,
          { fixtureName: 'checkin.mock.undo-key-reused' },
        );
      }
      const previous = mockCheckinState.undos.get(idempotencyKey.data);
      if (previous) {
        if (previous.fingerprint !== requestFingerprint) {
          return mockProblemResponse(
            checkinUndoProblemSchema,
            idempotencyReusedProblem,
            { fixtureName: 'checkin.mock.undo-key-reused' },
          );
        }
        return mockJsonResponse(
          checkinUndoResponseSchema,
          previous.response,
          successOptions('checkin.mock.undo-replay'),
        );
      }
      const response = mockCheckinState.undone
        ? checkinUndoFixtures.already_undone
        : checkinUndoFixtures.undone;
      mockCheckinState.checkedIn = false;
      mockCheckinState.undone = true;
      mockCheckinState.mutationFingerprints.set(
        idempotencyKey.data,
        requestFingerprint,
      );
      mockCheckinState.undos.set(idempotencyKey.data, {
        fingerprint: requestFingerprint,
        response,
      });
      return mockJsonResponse(
        checkinUndoResponseSchema,
        response,
        successOptions('checkin.mock.undo'),
      );
    },
  ),
]);
