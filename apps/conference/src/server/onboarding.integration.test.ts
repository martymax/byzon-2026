import { and, eq, inArray } from 'drizzle-orm';
import { createDatabaseClient, schema } from '@byzon/database';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { completeOnboarding, loadOnboardingState } from './onboarding';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('onboarding integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-onboarding-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const userId = crypto.randomUUID();
  const primaryEventId = crypto.randomUUID();
  const isolationEventId = crypto.randomUUID();
  const primaryDocuments = {
    terms: crypto.randomUUID(),
    privacyNotice: crypto.randomUUID(),
  };
  const isolationDocuments = {
    terms: crypto.randomUUID(),
    privacyNotice: crypto.randomUUID(),
  };
  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: primaryEventId,
        slug: `onboarding-primary-${primaryEventId}`,
        name: 'Onboarding primary test event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:30:00Z'),
        timezone: 'Europe/Prague',
        status: 'draft',
      },
      {
        id: isolationEventId,
        slug: `onboarding-isolation-${isolationEventId}`,
        name: 'Onboarding isolation test event',
        startsAt: new Date('2027-01-01T08:00:00Z'),
        endsAt: new Date('2027-01-01T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'archived',
      },
    ]);
    await client.db.insert(schema.eventFeatures).values([
      { eventId: primaryEventId, networkingEnabled: true },
      { eventId: isolationEventId, networkingEnabled: false },
    ]);
    const publishedAt = new Date('2026-07-20T12:00:00Z');
    await client.db.insert(schema.legalDocuments).values([
      {
        id: primaryDocuments.terms,
        eventId: primaryEventId,
        type: 'terms',
        version: `test-${primaryDocuments.terms}`,
        title: '[TEST DRAFT] Podmínky používání',
        content: 'Testovací verze.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: primaryDocuments.privacyNotice,
        eventId: primaryEventId,
        type: 'privacy_notice',
        version: `test-${primaryDocuments.privacyNotice}`,
        title: '[TEST DRAFT] Informace o zpracování údajů',
        content: 'Testovací verze.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: isolationDocuments.terms,
        eventId: isolationEventId,
        type: 'terms',
        version: `test-${isolationDocuments.terms}`,
        title: '[TEST DRAFT] Izolační podmínky',
        content: 'Testovací verze.',
        publishedAt,
        isCurrent: true,
      },
      {
        id: isolationDocuments.privacyNotice,
        eventId: isolationEventId,
        type: 'privacy_notice',
        version: `test-${isolationDocuments.privacyNotice}`,
        title: '[TEST DRAFT] Izolační privacy notice',
        content: 'Testovací verze.',
        publishedAt,
        isCurrent: true,
      },
    ]);
  });

  beforeEach(async () => {
    await client.db.insert(schema.users).values({
      id: userId,
      name: 'Onboarding test user',
      email: `onboarding-${userId}@example.invalid`,
    });
    await client.db.insert(schema.eventMemberships).values([
      { eventId: primaryEventId, userId, status: 'active' },
      { eventId: isolationEventId, userId, status: 'active' },
    ]);
  });

  afterEach(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, userId));
    await client.db
      .delete(schema.consentRecords)
      .where(eq(schema.consentRecords.userId, userId));
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  afterAll(async () => {
    await client.db
      .delete(schema.events)
      .where(inArray(schema.events.id, [primaryEventId, isolationEventId]));
    await client.close();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    eventId: primaryEventId,
    userId,
    requestId: crypto.randomUUID(),
    firstName: '  Anna ',
    lastName: ' Nováková ',
    contactEmail: ' ANNA@Example.COM ',
    phone: '+420777123456',
    termsDocumentId: primaryDocuments.terms,
    privacyNoticeDocumentId: primaryDocuments.privacyNotice,
    ...overrides,
  });

  it('atomically completes scope-aligned onboarding and is idempotent by request ID', async () => {
    const request = input();
    await expect(
      Promise.all([
        completeOnboarding(client.db, request),
        completeOnboarding(client.db, request),
      ]),
    ).resolves.toEqual([{ status: 'complete' }, { status: 'complete' }]);

    const profile = await client.db.query.participantProfiles.findFirst({
      where: and(
        eq(schema.participantProfiles.eventId, primaryEventId),
        eq(schema.participantProfiles.userId, userId),
      ),
    });
    expect(profile).toMatchObject({
      firstName: 'Anna',
      lastName: 'Nováková',
      contactEmail: 'anna@example.com',
      phone: '+420777123456',
      networkingEnabled: null,
    });
    expect(profile?.onboardingCompletedAt).toBeInstanceOf(Date);

    const records = await client.db.query.consentRecords.findMany({
      where: eq(schema.consentRecords.userId, userId),
    });
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legalDocumentId: primaryDocuments.terms,
          decision: 'accepted',
        }),
        expect.objectContaining({
          legalDocumentId: primaryDocuments.privacyNotice,
          decision: 'acknowledged',
        }),
      ]),
    );
    await expect(
      loadOnboardingState(client.db, primaryEventId, userId),
    ).resolves.toEqual({ status: 'complete' });

    const audit = await client.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.actorId, userId),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'onboarding.completed' });
    expect(JSON.stringify(audit[0]!.after)).not.toContain('anna@example.com');
    expect(JSON.stringify(audit[0]!.after)).not.toContain('Nováková');
  });

  it('rejects a replay whose consent records outlive the stored profile', async () => {
    const request = input();
    await completeOnboarding(client.db, request);
    await client.db
      .delete(schema.participantProfiles)
      .where(
        and(
          eq(schema.participantProfiles.eventId, primaryEventId),
          eq(schema.participantProfiles.userId, userId),
        ),
      );

    await expect(completeOnboarding(client.db, request)).rejects.toMatchObject({
      code: 'REQUEST_ID_REUSED',
    });
  });

  it('rejects stale or cross-event legal document IDs without partial writes', async () => {
    await expect(
      completeOnboarding(
        client.db,
        input({
          eventId: isolationEventId,
          termsDocumentId: primaryDocuments.terms,
          privacyNoticeDocumentId: primaryDocuments.privacyNotice,
        }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_LEGAL_DOCUMENT' });

    await expect(
      client.db.query.participantProfiles.findFirst({
        where: eq(schema.participantProfiles.userId, userId),
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.db.query.consentRecords.findFirst({
        where: eq(schema.consentRecords.userId, userId),
      }),
    ).resolves.toBeUndefined();
  });

  it('requires acknowledgement again when the current terms version changes', async () => {
    await completeOnboarding(client.db, input());
    const replacementTerms = crypto.randomUUID();
    await client.db
      .update(schema.legalDocuments)
      .set({ isCurrent: false })
      .where(eq(schema.legalDocuments.id, primaryDocuments.terms));
    await client.db.insert(schema.legalDocuments).values({
      id: replacementTerms,
      eventId: primaryEventId,
      type: 'terms',
      version: `test-${replacementTerms}`,
      title: '[TEST DRAFT] Nové podmínky',
      content: 'Testovací verze.',
      publishedAt: new Date('2026-07-20T13:00:00Z'),
      isCurrent: true,
    });

    try {
      await expect(
        loadOnboardingState(client.db, primaryEventId, userId),
      ).resolves.toEqual({
        status: 'legal_acknowledgement_required',
        documentIds: [replacementTerms],
      });
    } finally {
      await client.db
        .delete(schema.legalDocuments)
        .where(eq(schema.legalDocuments.id, replacementTerms));
      await client.db
        .update(schema.legalDocuments)
        .set({ isCurrent: true })
        .where(eq(schema.legalDocuments.id, primaryDocuments.terms));
    }
  });
});
