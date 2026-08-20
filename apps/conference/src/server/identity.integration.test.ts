import { createDatabaseClient, schema } from '@byzon/database';
import {
  identityBootstrapResponseSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateResponseSchema,
} from '@byzon/domain/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  completeIdentityOnboarding,
  createIdentityPrivacyRequest,
  performIdentitySessionAction,
  readIdentityBootstrap,
  updateIdentityProfile,
  type IdentityDependencies,
} from './identity';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const appOrigin = 'http://localhost:3000';

integration('CS-BOOT-01 identity HTTP integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-identity-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const isolationEventId = crypto.randomUUID();
  const eventSlug = `identity-primary-${eventId}`;
  const isolationSlug = `identity-isolation-${isolationEventId}`;
  const userId = crypto.randomUUID();
  const crossEventUserId = crypto.randomUUID();
  const termsId = crypto.randomUUID();
  const privacyNoticeId = crypto.randomUUID();
  const isolationTermsId = crypto.randomUUID();
  const isolationPrivacyNoticeId = crypto.randomUUID();
  const authSessionId = crypto.randomUUID();
  const session = {
    user: { id: userId, email: `identity-${userId}@example.invalid` },
    session: { id: authSessionId },
  };
  const crossEventSession = {
    user: {
      id: crossEventUserId,
      email: `identity-cross-${crossEventUserId}@example.invalid`,
    },
    session: { id: crypto.randomUUID() },
  };

  const dependencies = (
    activeSession: typeof session | null = session,
  ): IdentityDependencies => ({
    db: client.db,
    allowedOrigin: appOrigin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => activeSession),
  });

  const jsonRequest = (
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    idempotencyKey?: string,
  ): Request =>
    new Request(`${appOrigin}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: appOrigin,
        'x-request-id': `identity-${method.toLowerCase()}-request`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

  const onboardingBody = (overrides: Record<string, unknown> = {}) => ({
    profile: {
      firstName: 'Anna',
      lastName: 'Nováková',
      contactEmail: 'anna@example.invalid',
      phone: '+420777123456',
    },
    legal: {
      termsDocumentId: termsId,
      termsAccepted: true,
      privacyNoticeDocumentId: privacyNoticeId,
      privacyAcknowledged: true,
    },
    ...overrides,
  });

  const onboard = async (key = 'identity-onboarding-key-0001') => {
    const response = await completeIdentityOnboarding(
      jsonRequest('/api/v1/me/onboarding', 'POST', onboardingBody(), key),
      dependencies(),
    );
    expect(response.status).toBe(200);
    return identityOnboardingResponseSchema.parse(await response.json());
  };

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: eventSlug,
        name: 'Identity primary event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:30:00Z'),
        timezone: 'Europe/Prague',
        status: 'activation_open',
      },
      {
        id: isolationEventId,
        slug: isolationSlug,
        name: 'Identity isolation event',
        startsAt: new Date('2027-01-01T08:00:00Z'),
        endsAt: new Date('2027-01-01T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
    ]);
    await client.db.insert(schema.eventFeatures).values([
      { eventId, announcementsEnabled: true },
      { eventId: isolationEventId, announcementsEnabled: false },
    ]);
    await client.db.insert(schema.users).values([
      { id: userId, name: 'Identity user', email: session.user.email },
      {
        id: crossEventUserId,
        name: 'Cross-event identity user',
        email: crossEventSession.user.email,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId, status: 'active', activatedAt: new Date() },
      {
        eventId: isolationEventId,
        userId: crossEventUserId,
        status: 'active',
        activatedAt: new Date(),
      },
    ]);
    await client.db.insert(schema.eventRoles).values([
      {
        id: crypto.randomUUID(),
        eventId,
        userId,
        role: 'participant',
      },
      {
        id: crypto.randomUUID(),
        eventId: isolationEventId,
        userId: crossEventUserId,
        role: 'participant',
      },
    ]);
    const publishedAt = new Date('2026-08-20T08:00:00Z');
    await client.db.insert(schema.legalDocuments).values([
      {
        id: termsId,
        eventId,
        type: 'terms',
        version: 'test-v1',
        title: 'Testovací podmínky',
        content: 'Testovací právní text podmínek.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: privacyNoticeId,
        eventId,
        type: 'privacy_notice',
        version: 'test-v1',
        title: 'Testovací informace o soukromí',
        content: 'Testovací informace o zpracování údajů.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: isolationTermsId,
        eventId: isolationEventId,
        type: 'terms',
        version: 'test-v1',
        title: 'Izolační podmínky',
        content: 'Izolační právní text.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: isolationPrivacyNoticeId,
        eventId: isolationEventId,
        type: 'privacy_notice',
        version: 'test-v1',
        title: 'Izolační informace o soukromí',
        content: 'Izolační informace o zpracování údajů.',
        publishedAt,
        isCurrent: true,
      },
    ]);
  });

  beforeEach(async () => {
    await client.db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.eventId, eventId));
    await client.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    await client.db
      .delete(schema.privacyRequests)
      .where(eq(schema.privacyRequests.eventId, eventId));
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db
      .delete(schema.consentRecords)
      .where(eq(schema.consentRecords.eventId, eventId));
    await client.db
      .delete(schema.participantProfiles)
      .where(eq(schema.participantProfiles.eventId, eventId));
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(inArray(schema.auditLogs.eventId, [eventId, isolationEventId]));
    await client.db
      .delete(schema.consentRecords)
      .where(
        inArray(schema.consentRecords.eventId, [eventId, isolationEventId]),
      );
    await client.db
      .delete(schema.eventRoles)
      .where(inArray(schema.eventRoles.eventId, [eventId, isolationEventId]));
    await client.db
      .delete(schema.eventMemberships)
      .where(
        inArray(schema.eventMemberships.eventId, [eventId, isolationEventId]),
      );
    await client.db
      .delete(schema.legalDocuments)
      .where(
        inArray(schema.legalDocuments.eventId, [eventId, isolationEventId]),
      );
    await client.db
      .delete(schema.eventFeatures)
      .where(
        inArray(schema.eventFeatures.eventId, [eventId, isolationEventId]),
      );
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [userId, crossEventUserId]));
    await client.db
      .delete(schema.events)
      .where(inArray(schema.events.id, [eventId, isolationEventId]));
    await client.close();
  });

  it('returns a private live bootstrap and completes idempotent onboarding', async () => {
    const initialResponse = await readIdentityBootstrap(
      new Request(`${appOrigin}/api/v1/me/bootstrap`, {
        headers: { 'x-request-id': 'identity-bootstrap-request' },
      }),
      dependencies(),
    );
    expect(initialResponse.status).toBe(200);
    expect(initialResponse.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(initialResponse.headers.get('vary')).toContain('Cookie');
    const initial = identityBootstrapResponseSchema.parse(
      await initialResponse.json(),
    );
    expect(initial).toMatchObject({
      dataMode: 'live',
      event: { id: eventId, slug: eventSlug },
      user: { id: userId },
      membership: { access: { state: 'active' }, roles: ['participant'] },
      profile: null,
      profileManagement: { state: 'missing' },
      onboarding: { status: 'profile_required' },
      features: { reservations: false, announcements: true },
      privacy: { deletionRequest: 'available' },
    });
    expect(initial.legalDocuments.map(({ id }) => id).sort()).toEqual(
      [termsId, privacyNoticeId].sort(),
    );

    const first = await onboard();
    const replay = await onboard();
    expect(replay).toEqual(first);
    expect(first.profile).toMatchObject({
      firstName: 'Anna',
      phone: '+420777123456',
    });

    const records = await client.db.query.consentRecords.findMany({
      where: and(
        eq(schema.consentRecords.eventId, eventId),
        eq(schema.consentRecords.userId, userId),
      ),
    });
    expect(records).toHaveLength(2);
    const completed = identityBootstrapResponseSchema.parse(
      await (
        await readIdentityBootstrap(
          new Request(`${appOrigin}/api/v1/me/bootstrap`),
          dependencies(),
        )
      ).json(),
    );
    expect(completed.onboarding.status).toBe('complete');
    expect(completed.profileManagement).toEqual({
      state: 'editable',
      version: 1,
    });
    expect(completed.legalAcknowledgements).toHaveLength(2);
  });

  it('does not expose event roles while membership is suspended', async () => {
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, userId),
        ),
      );
    try {
      const response = await readIdentityBootstrap(
        new Request(`${appOrigin}/api/v1/me/bootstrap`),
        dependencies(),
      );
      expect(response.status).toBe(200);
      const body = identityBootstrapResponseSchema.parse(await response.json());
      expect(body.membership).toEqual({
        access: {
          state: 'suspended',
          supportReference: 'event-access-suspended',
        },
        roles: [],
      });
      expect(body.privacy.deletionRequest).toBe('unavailable');
    } finally {
      await client.db
        .update(schema.eventMemberships)
        .set({ status: 'active' })
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, userId),
          ),
        );
    }
  });

  it('rejects cross-origin onboarding before creating private state', async () => {
    const request = jsonRequest(
      '/api/v1/me/onboarding',
      'POST',
      onboardingBody(),
      'cross-origin-onboarding-key',
    );
    request.headers.set('origin', 'https://attacker.example');
    const response = await completeIdentityOnboarding(request, dependencies());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'EVENT_ACCESS_DENIED',
    });
    await expect(
      client.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, userId),
        ),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects changed onboarding data under the same idempotency key', async () => {
    await onboard('identity-onboarding-collision');
    const response = await completeIdentityOnboarding(
      jsonRequest(
        '/api/v1/me/onboarding',
        'POST',
        onboardingBody({
          profile: {
            ...onboardingBody().profile,
            firstName: 'Jiná',
          },
        }),
        'identity-onboarding-collision',
      ),
      dependencies(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('replays the stored onboarding DTO after legal configuration changes', async () => {
    const key = 'identity-onboarding-legal-replay';
    const firstResponse = await completeIdentityOnboarding(
      jsonRequest('/api/v1/me/onboarding', 'POST', onboardingBody(), key),
      dependencies(),
    );
    expect(firstResponse.status).toBe(200);
    const first = identityOnboardingResponseSchema.parse(
      await firstResponse.json(),
    );
    const replacementTermsId = crypto.randomUUID();
    await client.db
      .update(schema.legalDocuments)
      .set({ isCurrent: false })
      .where(eq(schema.legalDocuments.id, termsId));
    await client.db.insert(schema.legalDocuments).values({
      id: replacementTermsId,
      eventId,
      type: 'terms',
      version: 'test-v2',
      title: 'Nové testovací podmínky',
      content: 'Nová testovací právní verze.',
      publishedAt: new Date('2026-08-20T09:00:00Z'),
      isCurrent: true,
    });
    try {
      const replayResponse = await completeIdentityOnboarding(
        jsonRequest('/api/v1/me/onboarding', 'POST', onboardingBody(), key),
        dependencies(),
      );
      expect(replayResponse.status).toBe(200);
      expect(replayResponse.headers.get('idempotency-replayed')).toBe('true');
      expect(
        identityOnboardingResponseSchema.parse(await replayResponse.json()),
      ).toEqual(first);
    } finally {
      await client.db
        .delete(schema.legalDocuments)
        .where(eq(schema.legalDocuments.id, replacementTermsId));
      await client.db
        .update(schema.legalDocuments)
        .set({ isCurrent: true })
        .where(eq(schema.legalDocuments.id, termsId));
    }
  });

  it('does not let a new onboarding key bypass optimistic profile updates', async () => {
    await onboard('identity-onboarding-original');
    const response = await completeIdentityOnboarding(
      jsonRequest(
        '/api/v1/me/onboarding',
        'POST',
        onboardingBody({
          profile: {
            ...onboardingBody().profile,
            firstName: 'Obejití verze',
          },
        }),
        'identity-onboarding-new-key',
      ),
      dependencies(),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    const profile = await client.db.query.participantProfiles.findFirst({
      where: and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, userId),
      ),
    });
    expect(profile).toMatchObject({ firstName: 'Anna', version: 1 });
  });

  it('updates only the owned profile and returns the authoritative stale version', async () => {
    await onboard();
    const updateBody = {
      expectedVersion: 1,
      profile: {
        firstName: 'Anna Marie',
        lastName: 'Nováková',
        contactEmail: 'anna@example.invalid',
        phone: null,
      },
    };
    const response = await updateIdentityProfile(
      jsonRequest('/api/v1/me/profile', 'PATCH', updateBody),
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(
      identityProfileUpdateResponseSchema.parse(await response.json()),
    ).toMatchObject({
      eventId,
      userId,
      profile: { firstName: 'Anna Marie', phone: null },
      profileManagement: { state: 'editable', version: 2 },
    });

    const stale = await updateIdentityProfile(
      jsonRequest('/api/v1/me/profile', 'PATCH', updateBody),
      dependencies(),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'STALE_VERSION',
      currentVersion: 2,
    });
  });

  it('creates one event-scoped deletion request and replays the stored response', async () => {
    await onboard();
    const request = () =>
      jsonRequest(
        '/api/v1/me/privacy-requests',
        'POST',
        { kind: 'data_deletion' },
        'identity-privacy-key-0001',
      );
    const firstResponse = await createIdentityPrivacyRequest(
      request(),
      dependencies(),
    );
    const replayResponse = await createIdentityPrivacyRequest(
      request(),
      dependencies(),
    );
    expect(firstResponse.status).toBe(202);
    expect(replayResponse.status).toBe(202);
    expect(replayResponse.headers.get('idempotency-replayed')).toBe('true');
    const first = identityPrivacyRequestResponseSchema.parse(
      await firstResponse.json(),
    );
    const replay = identityPrivacyRequestResponseSchema.parse(
      await replayResponse.json(),
    );
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      eventId,
      userId,
      request: { state: 'pending' },
    });

    const duplicate = await createIdentityPrivacyRequest(
      jsonRequest(
        '/api/v1/me/privacy-requests',
        'POST',
        { kind: 'data_deletion' },
        'identity-privacy-key-0002',
      ),
      dependencies(),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: 'PRIVACY_REQUEST_UNAVAILABLE',
    });
    const rows = await client.db.query.privacyRequests.findMany({
      where: eq(schema.privacyRequests.eventId, eventId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId, userId, kind: 'data_deletion' });
  });

  it('revokes all Better Auth sessions through the integrated account control', async () => {
    const secondSessionId = crypto.randomUUID();
    const expiresAt = new Date('2026-09-20T12:00:00Z');
    await client.db.insert(schema.sessions).values([
      {
        id: authSessionId,
        userId,
        token: `identity-token-${authSessionId}`,
        expiresAt,
      },
      {
        id: secondSessionId,
        userId,
        token: `identity-token-${secondSessionId}`,
        expiresAt,
      },
    ]);
    const auth = {
      handler: vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: {
              'set-cookie':
                'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
            },
          }),
      ),
    };
    const response = await performIdentitySessionAction(
      jsonRequest(
        '/api/v1/me/session-action',
        'POST',
        { action: 'logout_all' },
        'identity-session-action-key',
      ),
      { ...dependencies(), auth },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      action: 'logout_all',
      effect: 'completed',
      state: 'all_sessions_revoked',
      personalData: { disposition: 'none_present' },
    });
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringContaining('Max-Age=0'),
    ]);
    expect(auth.handler).toHaveBeenCalledOnce();
    await expect(
      client.db.query.sessions.findMany({
        where: eq(schema.sessions.userId, userId),
      }),
    ).resolves.toEqual([]);
  });

  it('rejects an anonymous account session action without touching sessions', async () => {
    await client.db.insert(schema.sessions).values({
      id: authSessionId,
      userId,
      token: `identity-token-${authSessionId}`,
      expiresAt: new Date('2026-09-20T12:00:00Z'),
    });
    const auth = { handler: vi.fn() };
    const response = await performIdentitySessionAction(
      jsonRequest(
        '/api/v1/me/session-action',
        'POST',
        { action: 'logout_current' },
        'anonymous-session-action-key',
      ),
      { ...dependencies(null), auth },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    expect(auth.handler).not.toHaveBeenCalled();
    await expect(
      client.db.query.sessions.findMany({
        where: eq(schema.sessions.userId, userId),
      }),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ['bootstrap', 'GET'] as const,
    ['onboarding', 'POST'] as const,
    ['profile', 'PATCH'] as const,
    ['privacy-requests', 'POST'] as const,
  ])('rejects anonymous %s access', async (resource, method) => {
    const request =
      method === 'GET'
        ? new Request(`${appOrigin}/api/v1/me/${resource}`)
        : jsonRequest(
            `/api/v1/me/${resource}`,
            method,
            resource === 'profile'
              ? { expectedVersion: 1, profile: onboardingBody().profile }
              : resource === 'privacy-requests'
                ? { kind: 'data_deletion' }
                : onboardingBody(),
            method === 'POST' ? `anonymous-${resource}-key` : undefined,
          );
    const handler =
      resource === 'bootstrap'
        ? readIdentityBootstrap
        : resource === 'onboarding'
          ? completeIdentityOnboarding
          : resource === 'profile'
            ? updateIdentityProfile
            : createIdentityPrivacyRequest;
    const response = await handler(request, dependencies(null));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it.each([
    ['bootstrap', 'GET'] as const,
    ['onboarding', 'POST'] as const,
    ['profile', 'PATCH'] as const,
    ['privacy-requests', 'POST'] as const,
  ])(
    'rejects %s when the account belongs only to another event',
    async (resource, method) => {
      const request =
        method === 'GET'
          ? new Request(`${appOrigin}/api/v1/me/${resource}`)
          : jsonRequest(
              `/api/v1/me/${resource}`,
              method,
              resource === 'profile'
                ? { expectedVersion: 1, profile: onboardingBody().profile }
                : resource === 'privacy-requests'
                  ? { kind: 'data_deletion' }
                  : onboardingBody(),
              method === 'POST' ? `cross-event-${resource}-key` : undefined,
            );
      const handler =
        resource === 'bootstrap'
          ? readIdentityBootstrap
          : resource === 'onboarding'
            ? completeIdentityOnboarding
            : resource === 'profile'
              ? updateIdentityProfile
              : createIdentityPrivacyRequest;
      const response = await handler(request, dependencies(crossEventSession));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'EVENT_ACCESS_DENIED',
      });
    },
  );
});
