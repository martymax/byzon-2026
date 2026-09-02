import { createDatabaseClient, schema } from '@byzon/database';
import { adminOperationsOverviewResponseSchema } from '@byzon/domain/contracts';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminOperations } from './admin-operations';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('admin operations endpoint integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-operations-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-operations-${eventId}`;
  const adminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const endpoint = `http://localhost:3000/api/v1/admin/events/${eventId}/operations`;

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Admin operations integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Operations admin',
        email: `operations-admin-${adminId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Operations participant',
        email: `operations-participant-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: adminId, status: 'active' },
      { eventId, userId: participantId, status: 'active' },
    ]);
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
      announcementsEnabled: true,
    });
  });

  afterAll(async () => {
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, participantId]));
    await client.close();
  });

  it('returns six no-store aggregate metrics for the scoped organizer', async () => {
    const response = await handleAdminOperations(
      new Request(endpoint),
      eventId,
      {
        db: client.db,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
        now: () => new Date('2026-09-02T10:00:00.000Z'),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = adminOperationsOverviewResponseSchema.parse(
      await response.json(),
    );
    expect(body.metrics).toHaveLength(6);
    expect(body.eventId).toBe(eventId);
    expect(JSON.stringify(body)).not.toContain('operations-admin-');
  });

  it('does not expose the overview to a participant without operations read', async () => {
    const response = await handleAdminOperations(
      new Request(endpoint),
      eventId,
      {
        db: client.db,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: participantId } })),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'EVENT_ACCESS_DENIED',
    });
  });
});
