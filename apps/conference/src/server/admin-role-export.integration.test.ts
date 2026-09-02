import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminExportJobListResponseSchema,
  adminExportResponseSchema,
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsResponseSchema,
} from '@byzon/domain/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  handleAdminExport,
  handleAdminExportJobList,
  handleAdminRoleAssignment,
  handleAdminRoleAssignmentList,
  handleAdminRolePersonSearch,
  handleAdminRoleScopeOptions,
} from './admin-role-export';
import { handleAdminExportDownload } from './admin-export-download';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'http://localhost:3000';

integration('admin role and export integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-role-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-role-${eventId}`;
  const adminId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const dayId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  const readyExportId = crypto.randomUUID();
  const expiredExportId = crypto.randomUUID();
  const url = `${origin}/api/v1/admin/events/${eventId}/role-assignments`;

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Role integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Role admin',
        email: `role-admin-${adminId}@example.invalid`,
      },
      {
        id: staffId,
        name: 'Patrik Provozní',
        email: `patrik-${staffId}@example.invalid`,
        emailVerified: true,
      },
      {
        id: participantId,
        name: 'Bez oprávnění',
        email: `participant-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values(
      [adminId, staffId, participantId].map((userId) => ({
        eventId,
        userId,
        status: 'active' as const,
      })),
    );
    await client.db.insert(schema.eventRoles).values([
      {
        id: crypto.randomUUID(),
        eventId,
        userId: adminId,
        role: 'organizer_admin',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: participantId,
        role: 'participant',
      },
    ]);
    await client.db.insert(schema.eventFeatures).values({
      eventId,
      questionsEnabled: true,
    });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Hlavní den',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: `role-session-${sessionId}`,
      title: 'Růst bez zkratek',
      type: 'workshop',
      startsAt: new Date('2026-09-18T08:00:00Z'),
      endsAt: new Date('2026-09-18T09:00:00Z'),
      status: 'published',
      capacityMode: 'reservation',
      capacity: 20,
      questionsEnabled: true,
      sortOrder: 0,
    });
    await client.db.insert(schema.checkinStations).values({
      id: stationId,
      eventId,
      name: 'Hlavní vstup',
    });
    await client.db.insert(schema.eventRoles).values({
      id: assignmentId,
      eventId,
      userId: staffId,
      role: 'room_operator',
      scope: { sessionIds: [sessionId] },
      grantedBy: adminId,
    });
    await client.db.insert(schema.operationalExportRequests).values([
      {
        id: readyExportId,
        eventId,
        requestedBy: adminId,
        report: 'participant_summary',
        format: 'csv',
        reason: 'Ready export integration fixture.',
        state: 'ready',
        content: '"status","count"\r\n"active","1"\r\n',
        contentType: 'text/csv; charset=utf-8',
        checksumSha256: 'a'.repeat(64),
        expiresAt: new Date('2026-09-03T10:00:00Z'),
        createdAt: new Date('2026-09-02T08:00:00Z'),
        updatedAt: new Date('2026-09-02T08:00:00Z'),
      },
      {
        id: expiredExportId,
        eventId,
        requestedBy: adminId,
        report: 'audit_log',
        format: 'json',
        reason: 'Expired export integration fixture.',
        state: 'ready',
        content: '[]\n',
        contentType: 'application/json',
        checksumSha256: 'b'.repeat(64),
        expiresAt: new Date('2026-09-01T10:00:00Z'),
        createdAt: new Date('2026-08-31T10:00:00Z'),
        updatedAt: new Date('2026-08-31T10:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    await client.db
      .delete(schema.operationalExportRequests)
      .where(eq(schema.operationalExportRequests.eventId, eventId));
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db
      .delete(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, staffId, participantId]));
    await client.close();
  });

  const dependencies = (actorId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => ({ user: { id: actorId } })),
    now: () => new Date('2026-09-02T10:00:00Z'),
  });

  it('lists named scopes and searches only through a masked POST response', async () => {
    const list = await handleAdminRoleAssignmentList(
      new Request(url),
      eventId,
      dependencies(),
    );
    expect(list.status).toBe(200);
    const listed = adminRoleAssignmentListResponseSchema.parse(
      await list.json(),
    );
    expect(listed.items).toEqual([
      expect.objectContaining({
        assignmentId,
        operatorLabel: 'Patrik Provozní',
        scope: expect.objectContaining({
          kind: 'session',
          label: 'Růst bez zkratek',
        }),
      }),
    ]);

    const search = await handleAdminRolePersonSearch(
      new Request(`${url}/search`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'patrik' }),
      }),
      eventId,
      dependencies(),
    );
    expect(search.status).toBe(200);
    const found = adminRolePersonSearchResponseSchema.parse(
      await search.json(),
    );
    expect(found.items[0]).toMatchObject({
      operatorId: staffId,
      displayName: 'Patrik Provozní',
    });
    expect(found.items[0]?.maskedVerifiedContact).toContain('***@');
    expect(JSON.stringify(found)).not.toContain(`patrik-${staffId}@`);
  });

  it('returns only role-compatible server-named scope options', async () => {
    for (const [role, expectedKind] of [
      ['checkin_operator', 'station'],
      ['moderator', 'session'],
      ['room_operator', 'session'],
    ] as const) {
      const response = await handleAdminRoleScopeOptions(
        new Request(`${url}/scope-options`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        }),
        eventId,
        dependencies(),
      );
      expect(response.status).toBe(200);
      const body = adminRoleScopeOptionsResponseSchema.parse(
        await response.json(),
      );
      expect(body.options).toEqual([
        expect.objectContaining({ kind: expectedKind }),
      ]);
    }
  });

  it('rejects missing permission and a scope outside the current event', async () => {
    const denied = await handleAdminRoleAssignmentList(
      new Request(url),
      eventId,
      dependencies(participantId),
    );
    expect(denied.status).toBe(403);

    const mutation = await handleAdminRoleAssignment(
      new Request(url, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'grant',
          operatorId: staffId,
          role: 'moderator',
          scope: {
            kind: 'session',
            sessionId: crypto.randomUUID(),
            label: 'Cizí aktivita',
          },
          expectedVersion: 1,
          reason: 'Negativní test rozsahu role v jiné akci.',
        }),
      }),
      eventId,
      dependencies(),
    );
    expect(mutation.status).toBe(409);
    expect(await mutation.json()).toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
    });
  });

  it('queues and pages same-event export jobs with truthful expiry and paths', async () => {
    const queued = await handleAdminExport(
      new Request(`${origin}/api/v1/admin/events/${eventId}/exports`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          report: 'reservation_summary',
          format: 'csv',
          range: null,
          reason: 'Provozní export pro integrační ověření.',
        }),
      }),
      eventId,
      dependencies(),
    );
    expect(queued.status).toBe(202);
    expect(adminExportResponseSchema.parse(await queued.json())).toMatchObject({
      eventId,
      state: 'queued',
    });

    const firstPageResponse = await handleAdminExportJobList(
      new Request(`${url.replace('/role-assignments', '/exports')}?limit=1`),
      eventId,
      dependencies(),
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = adminExportJobListResponseSchema.parse(
      await firstPageResponse.json(),
    );
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.pageInfo).toMatchObject({ hasMore: true });

    const readyResponse = await handleAdminExportJobList(
      new Request(
        `${url.replace('/role-assignments', '/exports')}?state=ready&limit=25`,
      ),
      eventId,
      dependencies(),
    );
    const ready = adminExportJobListResponseSchema.parse(
      await readyResponse.json(),
    );
    expect(ready.items).toEqual([
      expect.objectContaining({
        exportId: readyExportId,
        state: 'ready',
        downloadPath: `/api/v1/admin/events/${eventId}/exports/${readyExportId}`,
      }),
    ]);

    const expiredResponse = await handleAdminExportJobList(
      new Request(
        `${url.replace('/role-assignments', '/exports')}?state=expired&limit=25`,
      ),
      eventId,
      dependencies(),
    );
    const expired = adminExportJobListResponseSchema.parse(
      await expiredResponse.json(),
    );
    expect(expired.items).toEqual([
      expect.objectContaining({
        exportId: expiredExportId,
        state: 'expired',
        downloadPath: null,
      }),
    ]);
  });

  it('audits a ready download and destroys expired inline content', async () => {
    const ready = await handleAdminExportDownload(
      new Request(
        `${origin}/api/v1/admin/events/${eventId}/exports/${readyExportId}`,
      ),
      eventId,
      readyExportId,
      dependencies(),
    );
    expect(ready.status).toBe(200);
    expect(ready.headers.get('cache-control')).toBe('private, no-store');
    expect(await ready.text()).toContain('active');
    const audit = await client.db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'export.download'),
        eq(schema.auditLogs.targetId, readyExportId),
      ),
    });
    expect(audit).toMatchObject({ actorId: adminId });

    const expired = await handleAdminExportDownload(
      new Request(
        `${origin}/api/v1/admin/events/${eventId}/exports/${expiredExportId}`,
      ),
      eventId,
      expiredExportId,
      dependencies(),
    );
    expect(expired.status).toBe(404);
    const expiredRow =
      await client.db.query.operationalExportRequests.findFirst({
        where: eq(schema.operationalExportRequests.id, expiredExportId),
      });
    expect(expiredRow).toMatchObject({ state: 'expired', content: null });

    const wrongEvent = await handleAdminExportDownload(
      new Request(
        `${origin}/api/v1/admin/events/${eventId}/exports/${readyExportId}`,
      ),
      eventId,
      readyExportId,
      { ...dependencies(), currentEventSlug: 'not-the-current-event' },
    );
    expect(wrongEvent.status).toBe(403);
  });
});
