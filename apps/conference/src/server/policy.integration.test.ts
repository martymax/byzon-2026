import { eq } from 'drizzle-orm';
import { createDatabaseClient, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadEventPolicy, requireEventPermission } from './policy';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('event policy integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-policy-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const userId = crypto.randomUUID();
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
      name: 'Policy test user',
      email: `policy-${userId}@example.invalid`,
    });
    await client.db.insert(schema.eventMemberships).values([
      { eventId: primaryEventId, userId, status: 'active' },
      { eventId: isolationEventId, userId, status: 'active' },
    ]);
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId: primaryEventId,
      userId,
      role: 'organizer_admin',
    });
  });

  afterAll(async () => {
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.close();
  });

  it('does not carry a role into another event', async () => {
    await expect(
      requireEventPermission(
        client.db,
        { userId },
        primaryEventId,
        'program:manage',
      ),
    ).resolves.toMatchObject({ eventId: primaryEventId });

    await expect(
      requireEventPermission(
        client.db,
        { userId },
        isolationEventId,
        'program:manage',
      ),
    ).rejects.toThrow('Event access denied');
  });

  it('fails closed for a suspended membership', async () => {
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(eq(schema.eventMemberships.userId, userId));

    await expect(
      loadEventPolicy(client.db, { userId }, primaryEventId),
    ).resolves.toBeNull();
  });
});
