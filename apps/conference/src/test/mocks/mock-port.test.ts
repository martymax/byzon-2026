import {
  defineApiProblemSchema,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';
import { FixtureValidationError } from '@byzon/test-support';
import {
  activationFixtureCode,
  activationFixtureRecoveryCode,
  agendaFixtureIds,
  announcementFixtureIds,
  contentFixtureIds,
  identityFixtureIds,
  identityFixtureProfile,
  participantAgendaMutationFixtures,
  sessionExpiredProblemFixture,
} from '@byzon/test-support/fixtures';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { z } from 'zod';

import { defineApiEndpoint } from '../../lib/api/endpoint.js';
import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from '../../lib/api/fetch-client.js';
import {
  requestCheckinBootstrap,
  requestCheckinConfirm,
  requestCheckinLookup,
  requestCheckinUndo,
} from '../../lib/checkin-api.js';
import { requestParticipantProgram } from '../../lib/content-api.js';
import {
  mutateParticipantAgenda,
  requestParticipantAgenda,
} from '../../lib/agenda-api.js';
import { requestParticipantTicket } from '../../lib/ticket-api.js';
import {
  markAnnouncementRead,
  requestAnnouncementDetail,
  requestAnnouncementInbox,
} from '../../lib/announcement-api.js';
import {
  consumeActivationLink,
  requestActivationLanding,
  submitActivationClaim,
  submitActivationIdentity,
  submitActivationRecovery,
} from '../../lib/activation-api.js';
import { createMockRecoveryLinkToken } from './mock-recovery-link.js';
import {
  requestIdentityBootstrap,
  submitIdentityPrivacyRequest,
  submitIdentityOnboarding,
  submitIdentitySessionAction,
  updateIdentityProfile,
} from '../../lib/identity-api.js';
import {
  adminContextEndpoint,
  requestAdminContext,
  requestAdminOperationsOverview,
  requestAdminReservations,
  requestAdminSessionCapacities,
  requestAdminSessionCapacityMutation,
  requestAdminSupportMutation,
  requestAdminSupportSearch,
  requestAdminTicketImportPreview,
} from '../../lib/admin-api.js';
import { adminFixtureIds } from '@byzon/test-support/fixtures/admin';
import { createMockServer } from './node.js';
import {
  MOCK_REQUEST_ID,
  mockJsonResponse,
  mockProblemResponse,
} from './response.js';
import {
  configureMockAnnouncementAccess,
  configureMockAgendaAccess,
  configureMockIdentityAccess,
  configureMockParticipantPrincipal,
  pauseNextMockAgendaAction,
  resetMockAdminState,
  resetMockActivationState,
  resetMockAgendaState,
  resetMockAnnouncementState,
  resetMockCheckinState,
  resetMockIdentityState,
  selectMockAgendaConflictingSessions,
} from './handlers.js';

const ORIGIN = 'http://mock.byzon.test';
const successSchema = z.strictObject({
  mode: z.literal('mock'),
  count: z.number().int().nonnegative(),
});
const internalErrorSchema = defineApiProblemSchema('INTERNAL_ERROR', 500);
const endpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema,
  problemSchema: internalErrorSchema,
  problemCodes: ['INTERNAL_ERROR'],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});
const server = createMockServer();
const fetchWithOrigin: NonNullable<FetchApiClientOptions['fetch']> = (
  input,
  init,
) => {
  const rawUrl =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return globalThis.fetch(new URL(rawUrl, ORIGIN), init);
};
const client = createFetchApiClient({ fetch: fetchWithOrigin });

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  resetMockActivationState();
  resetMockAgendaState();
  resetMockAnnouncementState();
  resetMockCheckinState();
  resetMockIdentityState();
  resetMockAdminState();
});
afterAll(() => server.close());

describe('MSW through the production API port', () => {
  it('runs canonical admin reads through the production port with event correlation', async () => {
    const context = await requestAdminContext(client);
    expect(context).toMatchObject({
      ok: true,
      data: {
        event: { id: adminFixtureIds.event },
        actor: { roles: ['organizer_admin'] },
      },
    });

    const overview = await requestAdminOperationsOverview(
      client,
      adminFixtureIds.event,
    );
    expect(overview).toMatchObject({
      ok: true,
      data: {
        eventId: adminFixtureIds.event,
        metrics: expect.any(Array),
        queues: expect.any(Array),
      },
    });
  });

  it('loads a sanitized SimpleShop preview through the production API port', async () => {
    const result = await requestAdminTicketImportPreview(
      client,
      adminFixtureIds.event,
    );

    expect(result).toMatchObject({
      ok: true,
      kind: 'success',
      data: {
        eventId: adminFixtureIds.event,
        source: {
          kind: 'simpleshop_api',
          productId: 143_958,
          formKey: '0MnNQ',
          strict: true,
        },
      },
    });
  });

  it('returns exact admin idempotent replay, collision and stale snapshots', async () => {
    await requestAdminContext(client);
    const search = await requestAdminSupportSearch(
      client,
      adminFixtureIds.event,
      'single',
    );
    expect(search).toMatchObject({
      ok: true,
      data: { outcome: 'single_match' },
    });
    if (!search.ok || search.kind !== 'success') return;
    const record = search.data.matches[0]!;
    const body = {
      participantId: record.participantId,
      ticketId: record.ticketId,
      action: 'block' as const,
      expectedVersion: record.version,
      reason: 'Bezpečný test blokace vstupenky.',
      targetTicketId: null,
    };
    const key = 'admin-support-test-0001';
    const first = await requestAdminSupportMutation(
      client,
      adminFixtureIds.event,
      body,
      key,
    );
    expect(first).toMatchObject({ ok: true, data: { outcome: 'applied' } });
    const replay = await requestAdminSupportMutation(
      client,
      adminFixtureIds.event,
      body,
      key,
    );
    expect(replay).toMatchObject({
      ok: true,
      data: { outcome: 'already_applied' },
    });
    const collision = await requestAdminSupportMutation(
      client,
      adminFixtureIds.event,
      { ...body, reason: 'Jiné tělo pod stejným klíčem.' },
      key,
    );
    expect(collision).toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    if (!first.ok || first.kind !== 'success') return;
    const stale = await requestAdminSupportMutation(
      client,
      adminFixtureIds.event,
      {
        participantId: first.data.record.participantId,
        ticketId: first.data.record.ticketId,
        action: 'reactivate',
        expectedVersion: first.data.record.version,
        reason: 'Stale scénář pro bezpečnou obnovu.',
        targetTicketId: null,
      },
      'admin-support-stale-0001',
    );
    expect(stale).toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'STALE_VERSION', currentVersion: 5 },
      },
    });
    const refreshed = await requestAdminSupportSearch(
      client,
      adminFixtureIds.event,
      'single',
    );
    expect(refreshed).toMatchObject({
      ok: true,
      data: { matches: [{ version: 5 }] },
    });
  });

  it('serves exact admin 403 and session-expired problem envelopes', async () => {
    const denied = await client.request(adminContextEndpoint, {
      path: '/api/v1/admin/context?persona=denied',
      cache: 'no-store',
    });
    expect(denied).toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED', status: 403 },
      },
    });
    const expired = await client.request(adminContextEndpoint, {
      path: '/api/v1/admin/context?persona=session_expired',
      cache: 'no-store',
    });
    expect(expired).toMatchObject({
      ok: false,
      failure: {
        kind: 'session_expired',
        problem: { code: 'AUTH_SESSION_EXPIRED', status: 401 },
      },
    });
  });

  it('allows read-only admin personas to read but rejects their write combinations', async () => {
    await client.request(adminContextEndpoint, {
      path: '/api/v1/admin/context?persona=support_read_only',
      cache: 'no-store',
    });
    const search = await requestAdminSupportSearch(
      client,
      adminFixtureIds.event,
      'single',
    );
    expect(search).toMatchObject({
      ok: true,
      data: { outcome: 'single_match' },
    });
    if (!search.ok || search.kind !== 'success') return;
    const supportRecord = search.data.matches[0]!;
    await expect(
      requestAdminSupportMutation(
        client,
        adminFixtureIds.event,
        {
          participantId: supportRecord.participantId,
          ticketId: supportRecord.ticketId,
          action: 'block',
          expectedVersion: supportRecord.version,
          reason: 'Čtenář podpory nesmí měnit vstupenku.',
          targetTicketId: null,
        },
        'admin-support-read-only-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });

    await client.request(adminContextEndpoint, {
      path: '/api/v1/admin/context?persona=reservation_reader',
      cache: 'no-store',
    });
    const reservations = await requestAdminReservations(
      client,
      adminFixtureIds.event,
    );
    expect(reservations).toMatchObject({ ok: true });
    if (!reservations.ok || reservations.kind !== 'success') return;
    const capacities = await requestAdminSessionCapacities(
      client,
      adminFixtureIds.event,
    );
    expect(capacities).toMatchObject({ ok: true });
    if (!capacities.ok || capacities.kind !== 'success') return;
    const capacity = capacities.data.items[0]!;
    await expect(
      requestAdminSessionCapacityMutation(
        client,
        adminFixtureIds.event,
        {
          sessionId: capacity.sessionId,
          capacity: (capacity.capacity ?? 1) + 1,
          expectedVersion: capacity.version,
          reason: 'Čtenář rezervací nesmí měnit kapacitu.',
        },
        'admin-reservation-read-only-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });
  });

  it('runs check-in preview through the production fetch port and dev-only handlers', async () => {
    const context = await requestCheckinBootstrap(client);
    expect(context).toMatchObject({
      ok: true,
      data: {
        actor: { permissions: { confirm: true, undo: true } },
        device: { state: 'trusted' },
      },
    });
    if (!context.ok || context.kind !== 'success') return;

    const lookup = await requestCheckinLookup(client, {
      method: 'manual_code',
      credential: {
        adapter: 'synthetic_demo',
        opaqueValue: 'DEMO-VALID',
      },
    });
    expect(lookup).toMatchObject({
      ok: true,
      data: { outcome: 'valid' },
    });
    if (
      !lookup.ok ||
      lookup.kind !== 'success' ||
      lookup.data.outcome !== 'valid'
    ) {
      return;
    }

    const confirmBody = {
      lookupId: lookup.data.lookupId,
      stationId: context.data.station.id,
      deviceId: context.data.device.id,
    };
    const confirmed = await requestCheckinConfirm(
      client,
      confirmBody,
      'checkin-confirm-msw-test-0001',
    );
    const replay = await requestCheckinConfirm(
      client,
      confirmBody,
      'checkin-confirm-msw-test-0001',
    );
    expect(confirmed).toEqual(replay);
    expect(confirmed).toMatchObject({
      ok: true,
      data: { outcome: 'checked_in' },
    });
    if (!confirmed.ok || confirmed.kind !== 'success') return;

    await expect(
      requestCheckinUndo(
        client,
        confirmed.data.checkin.id,
        { reason: 'Syntetický check-in byl označen omylem.' },
        'checkin-undo-msw-test-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { outcome: 'undone' },
    });
  });

  it('validates a synthetic success fixture and returns normal ApiPort data', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/foundation`, () =>
        mockJsonResponse(
          successSchema,
          { mode: 'mock', count: 2 },
          { fixtureName: 'foundation.success', etag: '"mock-v1"' },
        ),
      ),
    );

    await expect(
      client.request(endpoint, { path: '/api/v1/foundation' }),
    ).resolves.toEqual({
      ok: true,
      kind: 'success',
      status: 200,
      data: { mode: 'mock', count: 2 },
      metadata: { requestId: MOCK_REQUEST_ID, etag: '"mock-v1"' },
    });
  });

  it('maps a validated problem fixture through the same failure taxonomy', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/foundation`, () =>
        mockProblemResponse(
          sessionExpiredProblemSchema,
          sessionExpiredProblemFixture,
          { fixtureName: 'foundation.session-expired' },
        ),
      ),
    );

    await expect(
      client.request(endpoint, { path: '/api/v1/foundation' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      failure: {
        kind: 'session_expired',
        problem: { code: 'AUTH_SESSION_EXPIRED' },
      },
    });
  });

  it('rejects an invalid synthetic payload before MSW can return it', () => {
    let thrown: unknown;
    try {
      mockJsonResponse(
        successSchema,
        { mode: 'mock', count: -1, secret: 'must-not-leak' },
        { fixtureName: 'foundation.invalid' },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FixtureValidationError);
    expect(String(thrown)).not.toContain('must-not-leak');
    expect(JSON.stringify(thrown)).not.toContain('must-not-leak');
  });

  it('serves content only for the canonical synthetic event scope', async () => {
    configureMockParticipantPrincipal({ active: true });

    await expect(
      requestParticipantProgram(client, contentFixtureIds.event),
    ).resolves.toMatchObject({
      ok: true,
      data: { eventId: contentFixtureIds.event },
    });

    await expect(
      requestParticipantProgram(client, '01910000-0000-7000-8000-000000000099'),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'PROGRAM_NOT_FOUND' },
      },
    });
  });

  it('keeps all participant-private resources closed before onboarding completes', async () => {
    await expect(
      requestParticipantProgram(client, contentFixtureIds.event),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-pending-principal-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
  });

  it('activates the synthetic E2E participant on every protected read', async () => {
    const paths = [
      '/api/v1/me/agenda',
      '/api/v1/me/announcements?filter=all',
      '/api/v1/me/ticket',
      `/api/v1/events/${contentFixtureIds.event}/program`,
      `/api/v1/events/${contentFixtureIds.event}/content`,
    ];

    for (const path of paths) {
      resetMockActivationState();
      const response = await fetchWithOrigin(path, {
        headers: { 'x-byzon-mock-participant': 'active' },
      });
      expect(response.ok, path).toBe(true);
    }
  });

  it('marks private mock data as no-store and varies by session context', async () => {
    configureMockParticipantPrincipal({ active: true });

    const response = await fetchWithOrigin(
      `/api/v1/events/${contentFixtureIds.event}/program`,
    );

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('authorization, cookie');
  });

  it('serves a canonical private agenda and a safe RFC 5545 download', async () => {
    configureMockParticipantPrincipal({ active: true });

    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        eventId: agendaFixtureIds.event,
        userId: identityFixtureIds.user,
        eventTimezone: 'Europe/Prague',
        version: 7,
        items: expect.arrayContaining([
          expect.objectContaining({
            session: expect.objectContaining({
              id: agendaFixtureIds.fifoFirstSession,
            }),
            capacity: expect.objectContaining({
              held: 0,
              remaining: 0,
              actorAvailability: expect.objectContaining({
                state: 'unavailable',
              }),
            }),
          }),
        ]),
      },
    });

    const readResponse = await fetchWithOrigin('/api/v1/me/agenda');
    expect(readResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(readResponse.headers.get('vary')).toBe('authorization, cookie');

    const calendarResponse = await fetchWithOrigin('/api/v1/me/agenda.ics');
    expect(calendarResponse.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(calendarResponse.headers.get('vary')).toBe('authorization, cookie');
    expect(calendarResponse.headers.get('content-type')).toBe(
      'text/calendar; charset=utf-8',
    );
    expect(calendarResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="byzon-2026-moje-agenda.ics"',
    );
    const calendar = await calendarResponse.text();
    expect(calendar).toContain(
      `UID:${agendaFixtureIds.savedSession}@byzon-2026.byzon.cz\r\nSEQUENCE:3`,
    );
    expect(calendar).toContain('DTSTART:20260918T070000Z');
    expect(calendar).toContain('STATUS:CANCELLED');
    expect(calendar).not.toContain(identityFixtureIds.user);
    expect(calendar).not.toContain('alex@example.test');
    expect(
      calendar
        .split('\r\n')
        .every((line) => new TextEncoder().encode(line).byteLength <= 75),
    ).toBe(true);
  });

  it('mutates one agenda snapshot with exact replay and stale-version recovery', async () => {
    configureMockParticipantPrincipal({ active: true });
    const request = {
      sessionId: agendaFixtureIds.savedSession,
      action: 'remove',
      expectedVersion: 7,
    } as const;
    const first = await mutateParticipantAgenda(
      client,
      request,
      'agenda-remove-port-0001',
    );
    expect(first).toMatchObject({
      ok: true,
      data: {
        version: 8,
        mutation: {
          sessionId: agendaFixtureIds.savedSession,
          action: 'remove',
          outcome: 'applied',
        },
      },
    });
    expect(JSON.stringify(first)).not.toContain(
      `"id":"${agendaFixtureIds.savedSession}"`,
    );
    await expect(
      mutateParticipantAgenda(client, request, 'agenda-remove-port-0001'),
    ).resolves.toEqual(first);
    await expect(
      mutateParticipantAgenda(
        client,
        { ...request, action: 'add' },
        'agenda-remove-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        { ...request, action: 'add' },
        'agenda-stale-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: {
          code: 'STALE_VERSION',
          currentVersion: 8,
          agenda: { version: 8 },
        },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.savedSession,
          action: 'add',
          expectedVersion: 8,
        },
        'agenda-add-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { version: 9, mutation: { action: 'add', outcome: 'applied' } },
    });
    await expect(
      mutateParticipantAgenda(client, request, 'agenda-remove-port-0001'),
    ).resolves.toEqual(first);
  });

  it('serializes concurrent use of one agenda idempotency key', async () => {
    configureMockParticipantPrincipal({ active: true });
    const request = {
      sessionId: agendaFixtureIds.savedSession,
      action: 'remove',
      expectedVersion: 7,
    } as const;

    const [first, replay] = await Promise.all([
      mutateParticipantAgenda(client, request, 'agenda-race-port-0001'),
      mutateParticipantAgenda(client, request, 'agenda-race-port-0001'),
    ]);

    expect(first).toMatchObject({ ok: true, data: { version: 8 } });
    expect(replay).toEqual(first);
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: { version: 8 },
    });
  });

  it('replays an exact terminal agenda problem after canonical state changes', async () => {
    configureMockParticipantPrincipal({ active: true });
    const request = {
      sessionId: agendaFixtureIds.fullSession,
      action: 'reserve',
      expectedVersion: 7,
    } as const;
    const first = await mutateParticipantAgenda(
      client,
      request,
      'agenda-terminal-replay-0001',
    );
    expect(first).toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: {
          code: 'CAPACITY_FULL',
          agenda: { version: 7 },
        },
      },
    });

    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.savedSession,
          action: 'remove',
          expectedVersion: 7,
        },
        'agenda-terminal-state-change-0001',
      ),
    ).resolves.toMatchObject({ ok: true, data: { version: 8 } });

    await expect(
      mutateParticipantAgenda(client, request, 'agenda-terminal-replay-0001'),
    ).resolves.toEqual(first);
  });

  it('replays the exact successful reservation after later canonical changes', async () => {
    configureMockParticipantPrincipal({ active: true });
    const request = {
      sessionId: agendaFixtureIds.conflictTargetSession,
      action: 'reserve',
      expectedVersion: 7,
    } as const;
    const first = await mutateParticipantAgenda(
      client,
      request,
      'agenda-conflict-replay-0001',
    );

    expect(first).toMatchObject({
      ok: true,
      data: {
        version: 8,
        mutation: { action: 'reserve', outcome: 'applied' },
        timeConflict: null,
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.savedSession,
          action: 'remove',
          expectedVersion: 8,
        },
        'agenda-conflict-replay-state-change-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { version: 9, timeConflict: null },
    });
    await expect(
      mutateParticipantAgenda(client, request, 'agenda-conflict-replay-0001'),
    ).resolves.toEqual(first);
  });

  it('lets only one distinct key consume the final unheld seat', async () => {
    configureMockParticipantPrincipal({ active: true });
    const request = {
      sessionId: agendaFixtureIds.waitlistCancelledSession,
      action: 'reserve',
      expectedVersion: 7,
    } as const;

    const results = await Promise.all([
      mutateParticipantAgenda(client, request, 'agenda-last-seat-a-0001'),
      mutateParticipantAgenda(client, request, 'agenda-last-seat-b-0001'),
    ]);

    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          !result.ok &&
          result.failure.kind === 'problem' &&
          result.failure.problem.code === 'STALE_VERSION',
      ),
    ).toHaveLength(1);
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        version: 8,
        items: expect.arrayContaining([
          expect.objectContaining({
            state: 'reserved',
            session: expect.objectContaining({
              id: agendaFixtureIds.waitlistCancelledSession,
            }),
            capacity: expect.objectContaining({
              confirmed: 10,
              held: 0,
              remaining: 0,
            }),
          }),
        ]),
      },
    });
  });

  it('rejects state-skipping agenda actions without mutating canonical data', async () => {
    configureMockParticipantPrincipal({ active: true });
    const invalidRequests = [
      {
        sessionId: agendaFixtureIds.reservedSession,
        action: 'remove',
        expectedVersion: 7,
      },
      {
        sessionId: agendaFixtureIds.reservedSession,
        action: 'join_waitlist',
        expectedVersion: 7,
      },
      {
        sessionId: agendaFixtureIds.waitlistCancelledSession,
        action: 'join_waitlist',
        expectedVersion: 7,
      },
      {
        sessionId: agendaFixtureIds.waitingSession,
        action: 'cancel',
        expectedVersion: 7,
      },
      {
        sessionId: agendaFixtureIds.reservedSession,
        action: 'leave_waitlist',
        expectedVersion: 7,
      },
    ] as const;

    for (const [index, request] of invalidRequests.entries()) {
      await expect(
        mutateParticipantAgenda(
          client,
          request,
          `agenda-invalid-transition-${String(index + 1).padStart(4, '0')}`,
        ),
      ).resolves.toMatchObject({
        ok: false,
        failure: {
          kind: 'problem',
          problem: { code: 'VALIDATION_FAILED' },
        },
      });
    }
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        version: 7,
        items: expect.arrayContaining([
          expect.objectContaining({
            state: 'reserved',
            session: expect.objectContaining({
              id: agendaFixtureIds.reservedSession,
            }),
          }),
          expect.objectContaining({
            state: 'waitlisted',
            session: expect.objectContaining({
              id: agendaFixtureIds.fifoFirstSession,
            }),
            waitlist: expect.objectContaining({ state: 'waiting' }),
          }),
        ]),
      },
    });
  });

  it('returns correlated capacity and non-blocking conflict snapshots', async () => {
    configureMockParticipantPrincipal({ active: true });

    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.fullSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-capacity-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: {
          code: 'CAPACITY_FULL',
          sessionId: agendaFixtureIds.fullSession,
          agenda: {
            version: 7,
            items: expect.arrayContaining([
              expect.objectContaining({
                session: expect.objectContaining({
                  id: agendaFixtureIds.fullSession,
                }),
                capacity: expect.objectContaining({
                  held: 0,
                  remaining: 0,
                  actorAvailability: { state: 'unavailable' },
                }),
              }),
            ]),
          },
        },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.closedSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-capacity-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.closedSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-closed-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: {
          code: 'RESERVATION_CLOSED',
          sessionId: agendaFixtureIds.closedSession,
          agenda: { version: 7 },
        },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.conflictTargetSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-conflict-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        version: 8,
        mutation: {
          action: 'reserve',
          outcome: 'applied',
          sessionId: agendaFixtureIds.conflictTargetSession,
        },
        timeConflict: null,
        items: expect.arrayContaining([
          expect.objectContaining({
            state: 'reserved',
            session: expect.objectContaining({
              id: agendaFixtureIds.conflictTargetSession,
            }),
          }),
        ]),
      },
    });
    configureMockAgendaAccess({ ticketActive: false });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'cancel',
          expectedVersion: 8,
        },
        'agenda-ticket-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: {
          code: 'TICKET_INACTIVE',
          sessionId: agendaFixtureIds.reservedSession,
          agenda: { version: 8 },
        },
      },
    });
  });

  it('excludes the target and cancelled sessions from mock conflict detection', () => {
    const fixture = participantAgendaMutationFixtures.reserved_with_conflict!;
    const warning = fixture.timeConflict;
    if (!warning) throw new TypeError('Conflict fixture must carry a warning');
    const canonicalConflict = warning.conflictingSessions[0]!;
    const cancelledConflict = {
      ...canonicalConflict,
      id: agendaFixtureIds.cancelledSession,
      status: 'cancelled' as const,
      calendar: {
        ...canonicalConflict.calendar,
        uid: `${agendaFixtureIds.cancelledSession}@byzon-2026.byzon.cz`,
      },
    };

    expect(
      selectMockAgendaConflictingSessions(
        [warning.targetSession, cancelledConflict, canonicalConflict],
        warning.targetSession,
      ),
    ).toEqual([canonicalConflict]);
  });

  it('fails agenda reads, actions and downloads closed outside event scope', async () => {
    configureMockParticipantPrincipal({ active: true });
    configureMockAgendaAccess({ eventAccess: false });

    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: false,
      status: 403,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.savedSession,
          action: 'remove',
          expectedVersion: 7,
        },
        'agenda-scope-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });
    const calendar = await fetchWithOrigin('/api/v1/me/agenda.ics');
    expect(calendar.status).toBe(403);
    await expect(calendar.json()).resolves.toMatchObject({
      code: 'EVENT_ACCESS_DENIED',
    });
  });

  it('cannot apply a paused agenda mutation after the authenticated principal switches', async () => {
    configureMockParticipantPrincipal({ active: true });
    const pause = pauseNextMockAgendaAction();
    const pendingMutation = mutateParticipantAgenda(
      client,
      {
        sessionId: agendaFixtureIds.savedSession,
        action: 'remove',
        expectedVersion: 7,
      },
      'agenda-principal-race-0001',
    );
    await pause.entered;

    try {
      await expect(
        submitIdentitySessionAction(
          client,
          'switch_account',
          'agenda-principal-race-switch-0001',
        ),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        consumeActivationLink(
          client,
          'recovery-app:00000000-0000-4000-8000-000000000021',
          'agenda-principal-race-link-0001',
        ),
      ).resolves.toMatchObject({ ok: true, data: { state: 'active' } });
    } finally {
      pause.release();
    }

    await expect(pendingMutation).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        userId: '01910000-0000-7000-8000-000000000302',
        version: 1,
        items: [],
      },
    });

    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'agenda-principal-race-logout-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'recovery-app:primary:00000000-0000-4000-8000-000000000022',
        'agenda-principal-race-primary-0001',
      ),
    ).resolves.toMatchObject({ ok: true, data: { state: 'active' } });
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        userId: identityFixtureIds.user,
        version: 7,
        items: expect.arrayContaining([
          expect.objectContaining({
            state: 'saved',
            session: expect.objectContaining({
              id: agendaFixtureIds.savedSession,
            }),
          }),
        ]),
      },
    });
  });

  it('serves a private announcement inbox and updates canonical read state', async () => {
    configureMockParticipantPrincipal({ active: true });

    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        eventId: announcementFixtureIds.event,
        unreadCount: 2,
        items: [
          { id: announcementFixtureIds.critical, readAt: null },
          { id: announcementFixtureIds.important, readAt: null },
          {
            id: announcementFixtureIds.information,
            readAt: '2026-09-17T12:15:00.000Z',
          },
        ],
      },
    });

    await expect(
      markAnnouncementRead(
        client,
        announcementFixtureIds.important,
        'announcement-read-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcementId: announcementFixtureIds.important,
        state: 'read',
        unreadCount: 1,
      },
    });
    await expect(
      requestAnnouncementDetail(client, announcementFixtureIds.important),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcement: {
          id: announcementFixtureIds.important,
          readAt: '2026-09-18T06:35:00.000Z',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, { filter: 'unread' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [{ id: announcementFixtureIds.critical, readAt: null }],
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCounts: { announcements: 1 },
      },
    });

    const response = await fetchWithOrigin(
      '/api/v1/me/announcements?filter=all',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('authorization, cookie');
  });

  it('scopes the announcement inbox and unread count to the current recipient', async () => {
    configureMockParticipantPrincipal({ active: true });
    configureMockAnnouncementAccess({
      recipientAnnouncementIds: [
        announcementFixtureIds.critical,
        announcementFixtureIds.information,
      ],
    });

    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [
          { id: announcementFixtureIds.critical, readAt: null },
          {
            id: announcementFixtureIds.information,
            readAt: '2026-09-17T12:15:00.000Z',
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
    await expect(
      requestAnnouncementInbox(client, { filter: 'unread' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [{ id: announcementFixtureIds.critical, readAt: null }],
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: { unreadCounts: { announcements: 1 } },
    });
  });

  it('does not distinguish a cross-recipient announcement from a missing ID', async () => {
    configureMockParticipantPrincipal({ active: true });
    configureMockAnnouncementAccess({
      recipientAnnouncementIds: [
        announcementFixtureIds.critical,
        announcementFixtureIds.information,
      ],
    });
    const missingId = '01920000-0000-7000-8000-000000000099';

    const crossRecipientDetail = await fetchWithOrigin(
      `/api/v1/me/announcements/${announcementFixtureIds.important}`,
    );
    const missingDetail = await fetchWithOrigin(
      `/api/v1/me/announcements/${missingId}`,
    );
    expect(crossRecipientDetail.status).toBe(404);
    expect(missingDetail.status).toBe(404);
    expect(await crossRecipientDetail.text()).toBe(await missingDetail.text());

    const readRequest = {
      method: 'POST',
      headers: {
        'idempotency-key': 'announcement-recipient-probe-0001',
      },
    };
    const crossRecipientRead = await fetchWithOrigin(
      `/api/v1/me/announcements/${announcementFixtureIds.important}/read`,
      readRequest,
    );
    const missingRead = await fetchWithOrigin(
      `/api/v1/me/announcements/${missingId}/read`,
      readRequest,
    );
    expect(crossRecipientRead.status).toBe(404);
    expect(missingRead.status).toBe(404);
    expect(await crossRecipientRead.text()).toBe(await missingRead.text());
  });

  it('replays an exact announcement read and rejects key reuse for another item', async () => {
    configureMockParticipantPrincipal({ active: true });
    const key = 'announcement-read-replay-0001';
    const first = await markAnnouncementRead(
      client,
      announcementFixtureIds.important,
      key,
    );
    const replay = await markAnnouncementRead(
      client,
      announcementFixtureIds.important,
      key,
    );
    expect(replay).toEqual(first);

    await expect(
      markAnnouncementRead(client, announcementFixtureIds.critical, key),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('advances bounded announcement cursors without repeating a page', async () => {
    configureMockParticipantPrincipal({ active: true });

    await expect(
      requestAnnouncementInbox(client, { filter: 'all', limit: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.critical }],
        pageInfo: {
          hasMore: true,
          nextCursor: 'fixture-announcements-offset-1',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, {
        filter: 'all',
        cursor: 'fixture-announcements-offset-1',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.important }],
        pageInfo: {
          hasMore: true,
          nextCursor: 'fixture-announcements-offset-2',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, {
        filter: 'all',
        cursor: 'fixture-announcements-offset-2',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.information }],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
  });

  it('fails announcement access closed for auth, feature, scope and missing IDs', async () => {
    configureMockParticipantPrincipal({ active: true });
    configureMockAnnouncementAccess({ featureEnabled: false });
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENTS_DISABLED' },
      },
    });

    resetMockAnnouncementState();
    configureMockAnnouncementAccess({ eventAccess: false });
    await expect(
      requestAnnouncementDetail(client, announcementFixtureIds.critical),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });

    resetMockAnnouncementState();
    configureMockIdentityAccess({ eventAccess: true });
    const missingId = '01920000-0000-7000-8000-000000000099';
    await expect(
      requestAnnouncementDetail(client, missingId),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      },
    });
    await expect(
      markAnnouncementRead(client, missingId, 'announcement-read-missing-0001'),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      },
    });

    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'announcement-logout-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
  });

  it('rejects announcement query failure switches as validation errors', async () => {
    configureMockParticipantPrincipal({ active: true });
    const response = await fetchWithOrigin(
      '/api/v1/me/announcements?filter=all&failure=offline',
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('accepts only the canonical synthetic claim code without enumeration', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureRecoveryCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    await expect(
      submitActivationClaim(
        client,
        { code: 'UNKNOWN-CODE-2026', method: 'manual_code' },
        'claim-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'CLAIM_REJECTED' },
      },
    });

    await expect(
      submitActivationClaim(
        client,
        {
          code: 'camera:00000000-0000-4000-8000-000000000001',
          method: 'camera_scan',
        },
        'claim-mock-port-0003',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'alex@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'other@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('continues the synthetic identity and one-time-link handoff', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-handoff-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(requestActivationLanding(client)).resolves.toMatchObject({
      ok: true,
      data: {
        flow: {
          state: 'claim_in_progress',
          flowId: 'flow.synthetic.2026',
        },
      },
    });

    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'alex@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'link_sent',
        membershipCreated: false,
        sessionCreated: false,
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'onboarding_required',
        continueTo: '/onboarding',
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ACTIVATION_LINK_REJECTED' },
      },
    });
  });

  it('keeps already-active recovery neutral and returns the active branch', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureRecoveryCode, method: 'manual_code' },
        'claim-recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'recovery_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { accepted: true, resendAfterSeconds: 60 },
    });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'other@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    const token = 'recovery-app:00000000-0000-4000-8000-000000000001';
    await expect(
      consumeActivationLink(client, token, 'recovery-link-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: '/app' },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        membership: {
          access: { state: 'active' },
          roles: ['participant'],
        },
        onboarding: { status: 'complete' },
      },
    });
    await expect(
      consumeActivationLink(client, token, 'recovery-link-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: '/app' },
    });
    await expect(
      consumeActivationLink(
        client,
        'recovery-app:00000000-0000-4000-8000-000000000002',
        'recovery-link-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/onboarding' },
        'recovery-port-0002',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'recovery-onboarding:00000000-0000-4000-8000-000000000003',
        'recovery-link-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'onboarding_required', continueTo: '/onboarding' },
    });
  });

  it('round-trips exact static and detail recovery destinations and replays the stored destination', async () => {
    const unreadRoute = '/app/oznameni?view=unread' as const;
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: unreadRoute },
        'recovery-route-request-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    const unreadToken = createMockRecoveryLinkToken(
      unreadRoute,
      '00000000-0000-4000-8000-000000000021',
    );
    await expect(
      consumeActivationLink(client, unreadToken, 'recovery-route-link-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: unreadRoute },
    });

    const detailRoute =
      '/app/program/550e8400-e29b-41d4-a716-446655440000' as const;
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: detailRoute },
        'recovery-route-request-0002',
      ),
    ).resolves.toMatchObject({ ok: true });
    const detailToken = createMockRecoveryLinkToken(
      detailRoute,
      '00000000-0000-4000-8000-000000000022',
    );
    await expect(
      consumeActivationLink(client, detailToken, 'recovery-route-link-0002'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: detailRoute },
    });
    await expect(
      consumeActivationLink(client, detailToken, 'recovery-route-link-0002'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: detailRoute },
    });
    await expect(
      consumeActivationLink(client, unreadToken, 'recovery-route-link-0002'),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it.each([
    'https://evil.example/app',
    '//evil.example/app',
    '\\\\evil.example\\app',
    '/app/program#fragment',
    '/%2e%2e/app',
    '/app/program/../profil',
    '/app/program/%2Fprofil',
    '/app/program/%252Fprofil',
    '/app/oznameni?view=unread&next=%2Fapp',
  ])(
    'rejects a synthetic recovery token carrying unsafe route %#',
    async (route) => {
      const payload = globalThis
        .btoa(route)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
      const token = `recovery-route:${payload}:00000000-0000-4000-8000-000000000023`;

      await expect(
        consumeActivationLink(
          client,
          token,
          `recovery-route-rejected-${payload.slice(0, 16)}`,
        ),
      ).resolves.toMatchObject({
        ok: false,
        failure: {
          kind: 'problem',
          problem: { code: 'ACTIVATION_LINK_REJECTED' },
        },
      });
    },
  );

  it('completes synthetic onboarding with exact legal versions and replay safety', async () => {
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        dataMode: 'synthetic_preview',
        membership: { access: { state: 'pending_activation' } },
        onboarding: { status: 'profile_required' },
      },
    });
    const request = {
      profile: identityFixtureProfile,
      legal: {
        termsDocumentId: identityFixtureIds.terms,
        termsAccepted: true,
        privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
        privacyAcknowledged: true,
      },
    } as const;

    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'complete',
      },
    });
    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({ ok: true });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        dataMode: 'synthetic_preview',
        membership: {
          access: { state: 'active' },
          roles: ['participant'],
        },
        onboarding: { status: 'complete' },
      },
    });

    await expect(
      submitIdentityOnboarding(
        client,
        {
          ...request,
          profile: { ...request.profile, firstName: 'Druhý' },
        },
        'onboarding-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'VALIDATION_FAILED' },
      },
    });
    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { profile: { firstName: 'Alex' } },
    });
    await expect(
      submitIdentityOnboarding(
        client,
        {
          ...request,
          profile: { ...request.profile, firstName: 'Jiný' },
        },
        'onboarding-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('rejects non-canonical or suffix-smuggled synthetic recovery tokens', async () => {
    await expect(
      consumeActivationLink(
        client,
        'recovery-route:L2FwcB:00000000-0000-4000-8000-000000000024',
        'recovery-route-noncanonical-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ACTIVATION_LINK_REJECTED' },
      },
    });
    await expect(
      consumeActivationLink(
        client,
        'recovery-route:L2FwcA:00000000-0000-4000-8000-000000000025:extra',
        'recovery-route-suffix-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ACTIVATION_LINK_REJECTED' },
      },
    });
    await expect(
      consumeActivationLink(
        client,
        'RECOVERY-APP:00000000-0000-4000-8000-000000000026',
        'recovery-route-uppercase-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ACTIVATION_LINK_REJECTED' },
      },
    });

    for (const [index, token] of [
      'recovery-route:L2FwcA==:00000000-0000-4000-8000-000000000027',
      'recovery-route:L2FwcA:00000000-0000-4000-8000-000000000028?next=/app',
    ].entries()) {
      const response = await fetchWithOrigin('/api/v1/activation/link', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `recovery-route-raw-rejected-${String(index)}`,
        },
        body: JSON.stringify({ token }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'ACTIVATION_LINK_REJECTED',
      });
    }
  });

  it('updates only the current profile version and returns canonical state', async () => {
    const onboarding = {
      profile: identityFixtureProfile,
      legal: {
        termsDocumentId: identityFixtureIds.terms,
        termsAccepted: true,
        privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
        privacyAcknowledged: true,
      },
    } as const;
    await expect(
      submitIdentityOnboarding(client, onboarding, 'profile-onboarding-0001'),
    ).resolves.toMatchObject({ ok: true });

    const updatedProfile = {
      ...identityFixtureProfile,
      firstName: 'Alexandra',
    };
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 1,
        profile: updatedProfile,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        profile: updatedProfile,
        profileManagement: { state: 'editable', version: 2 },
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        profile: updatedProfile,
        profileManagement: { state: 'editable', version: 2 },
      },
    });

    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 1,
        profile: { ...updatedProfile, lastName: 'Stará verze' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'STALE_VERSION', currentVersion: 2 },
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        profile: updatedProfile,
        profileManagement: { state: 'editable', version: 2 },
      },
    });

    configureMockIdentityAccess({ profileManagementState: 'read_only' });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 2,
        profile: updatedProfile,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'PROFILE_NOT_EDITABLE' },
      },
    });
  });

  it('keeps privacy request replay exact and rejects collisions or duplicates', async () => {
    configureMockParticipantPrincipal({ active: true });
    const deletionRequest = { kind: 'data_deletion' } as const;
    const first = await submitIdentityPrivacyRequest(
      client,
      deletionRequest,
      'privacy-mock-port-0001',
    );
    expect(first).toMatchObject({
      ok: true,
      status: 202,
      data: {
        request: { kind: 'data_deletion', state: 'pending' },
      },
    });
    const replay = await submitIdentityPrivacyRequest(
      client,
      deletionRequest,
      'privacy-mock-port-0001',
    );
    expect(replay).toEqual(first);

    await expect(
      submitIdentityPrivacyRequest(
        client,
        deletionRequest,
        'privacy-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'PRIVACY_REQUEST_UNAVAILABLE' },
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        privacy: {
          deletionRequest: 'pending',
        },
      },
    });
  });

  it('validates account mutations and preserves canonical server state across access revocation', async () => {
    configureMockParticipantPrincipal({ active: true });
    const malformedProfileResponse = await fetchWithOrigin(
      '/api/v1/me/profile',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          profile: identityFixtureProfile,
        }),
      },
    );
    await expect(malformedProfileResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(malformedProfileResponse.status).toBe(422);
    const malformedPrivacyResponse = await fetchWithOrigin(
      '/api/v1/me/privacy-requests',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'data_export' }),
      },
    );
    await expect(malformedPrivacyResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(malformedPrivacyResponse.status).toBe(422);

    resetMockActivationState();
    await expect(
      submitIdentityOnboarding(
        client,
        {
          profile: identityFixtureProfile,
          legal: {
            termsDocumentId: identityFixtureIds.terms,
            termsAccepted: true,
            privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
            privacyAcknowledged: true,
          },
        },
        'onboarding-before-revocation-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 1,
        profile: { ...identityFixtureProfile, firstName: 'Soukromá změna' },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-before-revocation-0001',
      ),
    ).resolves.toMatchObject({ ok: true });

    configureMockIdentityAccess({ eventAccess: false });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 2,
        profile: identityFixtureProfile,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-before-revocation-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });

    configureMockIdentityAccess({ eventAccess: true });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        profile: {
          firstName: 'Soukromá změna',
        },
        profileManagement: { state: 'editable', version: 2 },
        privacy: { deletionRequest: 'pending' },
      },
    });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 2,
        profile: identityFixtureProfile,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-before-revocation-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { request: { state: 'pending' } },
    });
  });

  it('replays exact session actions and invalidates the mock owner context', async () => {
    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        action: 'switch_account',
        effect: 'synthetic_preview',
        personalData: { disposition: 'none_present' },
      },
    });
    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_all',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 1,
        profile: identityFixtureProfile,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-signed-out-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'session-action-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
  });

  it('isolates switched principals and restores only the requested canonical account', async () => {
    configureMockParticipantPrincipal({ active: true });
    await expect(
      updateIdentityProfile(client, {
        expectedVersion: 1,
        profile: { ...identityFixtureProfile, firstName: 'Soukromá A' },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitIdentityPrivacyRequest(
        client,
        { kind: 'data_deletion' },
        'privacy-primary-principal-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      markAnnouncementRead(
        client,
        announcementFixtureIds.important,
        'announcement-primary-principal-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      mutateParticipantAgenda(
        client,
        {
          sessionId: agendaFixtureIds.savedSession,
          action: 'remove',
          expectedVersion: 7,
        },
        'agenda-primary-principal-0001',
      ),
    ).resolves.toMatchObject({ ok: true, data: { version: 8 } });

    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-switch-principal-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'recovery-app:00000000-0000-4000-8000-000000000011',
        'link-alternate-principal-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active' },
    });

    const alternateBootstrap = await requestIdentityBootstrap(client);
    expect(alternateBootstrap).toMatchObject({
      ok: true,
      data: {
        user: {
          id: '01910000-0000-7000-8000-000000000302',
          email: 'beata@example.test',
        },
        profile: {
          firstName: 'Beáta',
          contactEmail: 'beata@example.test',
        },
        privacy: { deletionRequest: 'available' },
      },
    });
    expect(JSON.stringify(alternateBootstrap)).not.toContain('Soukromá A');
    const alternateTicket = await requestParticipantTicket(client);
    expect(alternateTicket).toMatchObject({
      ok: true,
      data: {
        ticket: {
          holder: { displayName: 'Beáta Svobodová' },
          referenceSuffix: 'BTA6',
        },
      },
    });
    expect(JSON.stringify(alternateTicket)).not.toContain('Alex Novák');
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.critical }],
      },
    });
    await expect(requestParticipantAgenda(client)).resolves.toMatchObject({
      ok: true,
      data: {
        userId: '01910000-0000-7000-8000-000000000302',
        version: 1,
        items: [],
      },
    });
    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-switch-principal-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'session-logout-alternate-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'recovery-app:primary:00000000-0000-4000-8000-000000000012',
        'link-primary-principal-0001',
      ),
    ).resolves.toMatchObject({ ok: true, data: { state: 'active' } });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        user: { email: identityFixtureProfile.contactEmail },
        profile: { firstName: 'Soukromá A' },
        privacy: { deletionRequest: 'pending' },
      },
    });
    await expect(requestParticipantTicket(client)).resolves.toMatchObject({
      ok: true,
      data: {
        ticket: {
          holder: { displayName: 'Alex Novák' },
          referenceSuffix: 'TST6',
        },
      },
    });
    const restoredAgenda = await requestParticipantAgenda(client);
    expect(restoredAgenda).toMatchObject({
      ok: true,
      data: {
        userId: identityFixtureIds.user,
        version: 8,
      },
    });
    expect(JSON.stringify(restoredAgenda)).not.toContain(
      `"id":"${agendaFixtureIds.savedSession}"`,
    );
    await expect(
      requestAnnouncementDetail(client, announcementFixtureIds.important),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcement: {
          id: announcementFixtureIds.important,
          readAt: '2026-09-18T06:35:00.000Z',
        },
      },
    });
  });

  it('keeps the mock owner signed out until a one-time link is consumed', async () => {
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'session-action-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000099',
        'link-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'onboarding_required', continueTo: '/onboarding' },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: { onboarding: { status: 'profile_required' } },
    });
  });
});
