import { and, eq } from 'drizzle-orm';
import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import {
  adminEngagementMutationResponseSchema,
  adminEngagementOverviewSchema,
} from '@byzon/domain/contracts/admin-engagement';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminEngagement } from './admin-engagement';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'https://app.byzon.test';

integration('admin engagement integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-engagement-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const organizerId = generateUuidV7();
  const participantId = generateUuidV7();
  const dayId = generateUuidV7();
  const sessionId = generateUuidV7();
  const now = new Date('2026-08-31T14:00:00.000Z');
  const dependencies = (userId = organizerId) => ({
    db: client.db,
    allowedOrigin: origin,
    getSession: async () => ({ user: { id: userId } }),
    now: () => now,
  });

  const mutate = (
    body: Record<string, unknown>,
    idempotencyKey: string,
    userId = organizerId,
  ) =>
    handleAdminEngagement(
      new Request(`${origin}/api/v1/admin/events/${eventId}/engagement`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(body),
      }),
      eventId,
      dependencies(userId),
    );

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `engagement-${eventId}`,
      name: 'Engagement integration event',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00.000Z'),
      endsAt: new Date('2026-09-19T20:00:00.000Z'),
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: organizerId,
        name: 'Organizer Synthetic',
        email: `organizer-${organizerId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Moderator Synthetic',
        email: `moderator-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: organizerId, status: 'active' },
      { eventId, userId: participantId, status: 'active' },
    ]);
    await client.db.insert(schema.eventRoles).values([
      {
        id: generateUuidV7(),
        eventId,
        userId: organizerId,
        role: 'organizer_admin',
      },
      {
        id: generateUuidV7(),
        eventId,
        userId: participantId,
        role: 'participant',
      },
    ]);
    await client.db.insert(schema.eventFeatures).values({ eventId });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: `questions-${sessionId}`,
      title: 'Přednáška s dotazy',
      type: 'talk',
      startsAt: new Date('2026-09-18T08:00:00.000Z'),
      endsAt: new Date('2026-09-18T09:00:00.000Z'),
      status: 'published',
      sortOrder: 0,
    });
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(
        and(
          eq(schema.users.id, organizerId),
          eq(schema.users.email, `organizer-${organizerId}@example.invalid`),
        ),
      );
    await client.db
      .delete(schema.users)
      .where(eq(schema.users.id, participantId));
    await client.close();
  });

  it('loads complete admin candidate identities and atomically configures flags, a session and its moderator', async () => {
    const initial = await handleAdminEngagement(
      new Request(`${origin}/api/v1/admin/events/${eventId}/engagement`),
      eventId,
      dependencies(),
    );
    expect(initial.status).toBe(200);
    const initialBody = adminEngagementOverviewSchema.parse(
      await initial.json(),
    );
    expect(initial.headers.get('cache-control')).toBe('private, no-store');
    expect(initialBody.features).toEqual({
      networkingEnabled: false,
      questionsEnabled: false,
      ratingsEnabled: false,
    });
    const candidate = initialBody.moderatorCandidates.find(
      ({ userId }) => userId === participantId,
    );
    expect(candidate?.contactEmail).toBe(
      `moderator-${participantId}@example.invalid`,
    );

    const features = await mutate(
      {
        action: 'update_features',
        expectedSettingsVersion: initialBody.settingsVersion,
        features: {
          networkingEnabled: true,
          questionsEnabled: true,
          ratingsEnabled: true,
        },
        reason: 'Schválené staging ověření interakcí.',
      },
      'engagement-features-0001',
    );
    expect(features.status).toBe(200);
    const featuresBody = adminEngagementMutationResponseSchema.parse(
      await features.json(),
    );
    expect(featuresBody.action).toBe('update_features');

    const session = await mutate(
      {
        action: 'set_session_questions',
        sessionId,
        expectedSessionVersion: 1,
        enabled: true,
        reason: 'Otázky jsou schválené pro tuto přednášku.',
      },
      'engagement-session-0001',
    );
    expect(session.status).toBe(200);

    const assignment = await mutate(
      {
        action: 'assign_moderator',
        sessionId,
        userId: participantId,
        expectedAssignmentsVersion: initialBody.assignmentsVersion,
        reason: 'Moderátor potvrzený pro tabletové ověření.',
      },
      'engagement-moderator-0001',
    );
    expect(assignment.status).toBe(200);
    const assignmentBody = adminEngagementMutationResponseSchema.parse(
      await assignment.json(),
    );
    expect(assignmentBody).toMatchObject({
      action: 'assign_moderator',
      outcome: 'updated',
      assignment: { sessionId, userId: participantId },
    });

    const role = await client.db.query.eventRoles.findFirst({
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, participantId),
        eq(schema.eventRoles.role, 'moderator'),
      ),
    });
    expect(role?.scope.sessionIds).toEqual([sessionId]);
    const audits = await client.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.eventId, eventId),
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'settings.engagement.update',
        'settings.session-questions.update',
        'role.moderator.assign',
      ]),
    );
  });

  it('replays exact assignments and revokes the final session scope', async () => {
    const current = adminEngagementOverviewSchema.parse(
      await (
        await handleAdminEngagement(
          new Request(`${origin}/api/v1/admin/events/${eventId}/engagement`),
          eventId,
          dependencies(),
        )
      ).json(),
    );
    const repeated = await mutate(
      {
        action: 'assign_moderator',
        sessionId,
        userId: participantId,
        expectedAssignmentsVersion: current.assignmentsVersion,
        reason: 'Přesné opakování existujícího přiřazení.',
      },
      'engagement-moderator-0002',
    );
    expect(
      adminEngagementMutationResponseSchema.parse(await repeated.json()),
    ).toMatchObject({ outcome: 'already_applied' });

    const removed = await mutate(
      {
        action: 'remove_moderator',
        sessionId,
        userId: participantId,
        expectedAssignmentsVersion: current.assignmentsVersion,
        reason: 'Moderátor odebrán po dokončení ověření.',
      },
      'engagement-moderator-0003',
    );
    expect(removed.status).toBe(200);
    expect(
      adminEngagementMutationResponseSchema.parse(await removed.json()),
    ).toMatchObject({ action: 'remove_moderator', outcome: 'updated' });
    const role = await client.db.query.eventRoles.findFirst({
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, participantId),
        eq(schema.eventRoles.role, 'moderator'),
      ),
    });
    expect(role?.revokedAt).toEqual(now);
  });

  it('rejects a participant without admin permissions and a cross-origin mutation', async () => {
    const denied = await handleAdminEngagement(
      new Request(`${origin}/api/v1/admin/events/${eventId}/engagement`),
      eventId,
      dependencies(participantId),
    );
    expect(denied.status).toBe(403);

    const crossOrigin = await handleAdminEngagement(
      new Request(`${origin}/api/v1/admin/events/${eventId}/engagement`, {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
          'idempotency-key': 'engagement-cross-origin-0001',
        },
        body: JSON.stringify({
          action: 'update_features',
          expectedSettingsVersion: 1,
          features: {
            networkingEnabled: false,
            questionsEnabled: false,
            ratingsEnabled: false,
          },
          reason: 'Tento požadavek nesmí projít.',
        }),
      }),
      eventId,
      dependencies(),
    );
    expect(crossOrigin.status).toBe(403);
  });
});
