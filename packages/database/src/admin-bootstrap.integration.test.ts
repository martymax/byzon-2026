import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapOrganizerAdmin } from './admin-bootstrap.js';
import { createDatabaseClient } from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('organizer admin bootstrap integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-bootstrap-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const userId = generateUuidV7();
  const userEmail = `admin-bootstrap-${userId}@example.invalid`;
  let primaryEventId: string;
  let isolationEventId: string;

  beforeAll(async () => {
    const eventRows = await client.db
      .select({ id: schema.events.id, slug: schema.events.slug })
      .from(schema.events);
    primaryEventId = eventRows.find(({ slug }) => slug === 'byzon-2026')!.id;
    isolationEventId = eventRows.find(
      ({ slug }) => slug === 'byzon-isolation-test',
    )!.id;

    await client.db.insert(schema.users).values({
      id: userId,
      name: 'Admin bootstrap integration user',
      email: userEmail,
    });
    await client.db.insert(schema.eventMemberships).values({
      eventId: isolationEventId,
      userId,
      status: 'suspended',
    });
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, userId));
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.close();
  });

  it('grants one event-scoped role and is idempotent', async () => {
    const results = await Promise.all([
      bootstrapOrganizerAdmin(client.db, {
        eventSlug: 'byzon-2026',
        userEmail: `  ${userEmail.toUpperCase()}  `,
      }),
      bootstrapOrganizerAdmin(client.db, {
        eventSlug: 'byzon-2026',
        userEmail,
      }),
    ]);
    const granted = results.find(({ status }) => status === 'granted')!;
    const alreadyGranted = results.find(
      ({ status }) => status === 'already_granted',
    )!;

    expect(granted).toMatchObject({
      eventId: primaryEventId,
      userId,
      status: 'granted',
    });
    expect(alreadyGranted).toMatchObject({
      eventId: primaryEventId,
      requestId: null,
      userId,
      roleId: granted.roleId,
      status: 'already_granted',
    });

    const memberships = await client.db
      .select()
      .from(schema.eventMemberships)
      .where(
        and(
          eq(schema.eventMemberships.eventId, primaryEventId),
          eq(schema.eventMemberships.userId, userId),
        ),
      );
    const roles = await client.db
      .select()
      .from(schema.eventRoles)
      .where(
        and(
          eq(schema.eventRoles.eventId, primaryEventId),
          eq(schema.eventRoles.userId, userId),
          eq(schema.eventRoles.role, 'organizer_admin'),
        ),
      );
    const audits = await client.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, primaryEventId),
          eq(schema.auditLogs.targetId, userId),
          eq(schema.auditLogs.action, 'organizer_admin.bootstrap_completed'),
        ),
      );

    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ status: 'active' });
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ revokedAt: null, scope: {} });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      actorType: 'bootstrap_cli',
      reason: 'explicit organizer admin bootstrap',
      before: { membershipStatus: 'absent', role: 'absent' },
      after: { membershipStatus: 'active', role: 'organizer_admin' },
    });
    expect(JSON.stringify(audits[0])).not.toContain(userEmail);
  });

  it('does not carry the role into another event', async () => {
    const roles = await client.db
      .select()
      .from(schema.eventRoles)
      .where(
        and(
          eq(schema.eventRoles.eventId, isolationEventId),
          eq(schema.eventRoles.userId, userId),
        ),
      );

    expect(roles).toEqual([]);
  });

  it('fails closed instead of reactivating a suspended membership', async () => {
    await expect(
      bootstrapOrganizerAdmin(client.db, {
        eventSlug: 'byzon-isolation-test',
        userEmail,
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_ACTIVE' });

    const roles = await client.db
      .select()
      .from(schema.eventRoles)
      .where(
        and(
          eq(schema.eventRoles.eventId, isolationEventId),
          eq(schema.eventRoles.userId, userId),
        ),
      );
    expect(roles).toEqual([]);
  });

  it('requires an existing Better Auth user', async () => {
    await expect(
      bootstrapOrganizerAdmin(client.db, {
        eventSlug: 'byzon-2026',
        userEmail: `missing-${userEmail}`,
      }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
