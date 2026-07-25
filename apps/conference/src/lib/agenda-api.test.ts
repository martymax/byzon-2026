import {
  agendaFixtureIds,
  participantAgendaFixtures,
  participantAgendaMutationFixtures,
  participantAgendaMutationProblemFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from './api/fetch-client';
import {
  mutateParticipantAgenda,
  participantAgendaEndpoint,
  participantAgendaMutationEndpoint,
  requestParticipantAgenda,
} from './agenda-api';

const responseHeaders = {
  'content-type': 'application/json',
  'x-request-id': 'agenda-client-0001',
};

type TestFetch = NonNullable<FetchApiClientOptions['fetch']>;

describe('CS-AGENDA-01 participant browser adapter', () => {
  it('loads a private canonical agenda without mutation metadata', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAgendaFixtures.happy, {
        headers: responseHeaders,
      }),
    );

    await expect(
      requestParticipantAgenda(createFetchApiClient({ fetch, maxRetries: 0 })),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        eventId: agendaFixtureIds.event,
        version: 7,
        items: expect.arrayContaining([
          expect.objectContaining({ state: 'saved' }),
          expect.objectContaining({ state: 'reserved' }),
        ]),
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/agenda',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
    expect(participantAgendaEndpoint.retry).toBe('safe-read');
  });

  it('submits expectedVersion online with a required idempotency key', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAgendaMutationFixtures.reserved, {
        headers: responseHeaders,
      }),
    );
    const body = {
      sessionId: agendaFixtureIds.reservedSession,
      action: 'reserve',
      expectedVersion: 7,
    } as const;

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        body,
        'agenda-action-client-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        version: 8,
        mutation: {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'reserve',
          outcome: 'applied',
        },
      },
    });

    const [path, request] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/me/agenda/actions');
    expect(request).toEqual(
      expect.objectContaining({
        cache: 'no-store',
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(request?.body))).toEqual(body);
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'agenda-action-client-0001',
    );
    expect(participantAgendaMutationEndpoint.idempotency).toBe('required');
    expect(participantAgendaMutationEndpoint.retry).toBe('never');
  });

  it('accepts a correlated time conflict only as a successful canonical warning', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAgendaMutationFixtures.reserved_with_conflict!, {
        headers: responseHeaders,
      }),
    );

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        {
          sessionId: agendaFixtureIds.conflictTargetSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-action-conflict-warning-0001',
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
        timeConflict: {
          eventId: agendaFixtureIds.event,
          sessionId: agendaFixtureIds.conflictTargetSession,
          conflictingSessions: [{ id: agendaFixtureIds.savedSession }],
        },
      },
    });
  });

  it('rejects an unknown private response field instead of casting it', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(
        {
          ...participantAgendaFixtures.happy,
          participantEmail: 'must-not-reach-the-ui@example.test',
        },
        { headers: responseHeaders },
      ),
    );

    await expect(
      requestParticipantAgenda(createFetchApiClient({ fetch, maxRetries: 0 })),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'agenda-client-0001',
      },
    });
  });

  it('rejects a valid snapshot whose mutation does not correlate to the request', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAgendaMutationFixtures.accepted_offer, {
        headers: responseHeaders,
      }),
    );

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-action-correlation-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'agenda-client-0001',
      },
    });
  });

  it('rejects an applied mutation that does not advance the expected version', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(
        {
          ...participantAgendaMutationFixtures.reserved!,
          version: 7,
        },
        { headers: responseHeaders },
      ),
    );

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'reserve',
          expectedVersion: 7,
        },
        'agenda-action-version-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'agenda-client-0001',
      },
    });
  });

  it('allows an already-applied replay at the expected version', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAgendaMutationFixtures.idempotent_replay!, {
        headers: responseHeaders,
      }),
    );

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'reserve',
          expectedVersion: 8,
        },
        'agenda-action-replay-version-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        version: 8,
        mutation: { outcome: 'already_applied' },
      },
    });
  });

  it('maps a validated stale-version problem without retrying the mutation', async () => {
    const problem = participantAgendaMutationProblemFixtures.stale_version!;
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(problem, {
        status: problem.status,
        headers: {
          'content-type': 'application/problem+json',
          'x-request-id': problem.requestId,
        },
      }),
    );

    await expect(
      mutateParticipantAgenda(
        createFetchApiClient({ fetch, maxRetries: 2 }),
        {
          sessionId: agendaFixtureIds.reservedSession,
          action: 'cancel',
          expectedVersion: 7,
        },
        'agenda-action-stale-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
      failure: {
        kind: 'problem',
        problem: { code: 'STALE_VERSION', currentVersion: 8 },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('declares the complete read and mutation failure taxonomies', () => {
    expect(participantAgendaEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'AGENDA_DISABLED',
      'VALIDATION_FAILED',
      'INTERNAL_ERROR',
    ]);
    expect(participantAgendaMutationEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'AGENDA_DISABLED',
      'INTERNAL_ERROR',
      'SESSION_NOT_FOUND',
      'TICKET_INACTIVE',
      'CAPACITY_FULL',
      'RESERVATION_CLOSED',
      'OFFER_EXPIRED',
      'STALE_VERSION',
      'VALIDATION_FAILED',
      'IDEMPOTENCY_KEY_REUSED',
      'IDEMPOTENCY_IN_PROGRESS',
    ]);
  });
});
