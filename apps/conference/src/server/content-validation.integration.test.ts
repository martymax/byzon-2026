import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { validateContentMutation } from './content-validation';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('content validation integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-content-validation-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7(),
    otherEventId = generateUuidV7(),
    venueId = generateUuidV7(),
    roomId = generateUuidV7(),
    otherRoomId = generateUuidV7(),
    dayId = generateUuidV7();
  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: `validation-${eventId}`,
        name: 'Validation',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T20:00:00Z'),
      },
      {
        id: otherEventId,
        slug: `validation-other-${otherEventId}`,
        name: 'Other',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T20:00:00Z'),
      },
    ]);
    await client.db.insert(schema.venues).values([
      { id: venueId, eventId, slug: 'venue', name: 'Venue', sortOrder: 0 },
      {
        id: generateUuidV7(),
        eventId: otherEventId,
        slug: 'other-venue',
        name: 'Other',
        sortOrder: 0,
      },
    ]);
    const otherVenue = (await client.db.query.venues.findFirst({
      where: (fields, { eq }) => eq(fields.eventId, otherEventId),
    }))!;
    await client.db.insert(schema.rooms).values([
      {
        id: roomId,
        eventId,
        venueId,
        slug: 'main',
        name: 'Main',
        sortOrder: 0,
      },
      {
        id: otherRoomId,
        eventId: otherEventId,
        venueId: otherVenue.id,
        slug: 'other',
        name: 'Other',
        sortOrder: 0,
      },
    ]);
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: generateUuidV7(),
      eventId,
      dayId,
      roomId,
      slug: 'existing',
      title: 'Existing',
      type: 'talk',
      startsAt: new Date('2026-09-18T08:00:00Z'),
      endsAt: new Date('2026-09-18T09:00:00Z'),
      sortOrder: 0,
    });
  });
  afterAll(async () => client.close());
  it('rejects room collisions and duplicate slugs', async () => {
    await expect(
      validateContentMutation(client.db, {
        eventId,
        resource: 'sessions',
        data: {
          dayId,
          roomId,
          slug: 'existing',
          startsAt: new Date('2026-09-18T08:30:00Z'),
          endsAt: new Date('2026-09-18T09:30:00Z'),
        },
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining(['room:time_collision', 'slug:duplicate']),
    });
  });
  it('rejects cross-event rooms and a timestamp outside the selected local day', async () => {
    await expect(
      validateContentMutation(client.db, {
        eventId,
        resource: 'sessions',
        data: {
          dayId,
          roomId: otherRoomId,
          slug: 'new',
          startsAt: new Date('2026-09-19T08:00:00Z'),
          endsAt: new Date('2026-09-19T09:00:00Z'),
        },
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        'room:not_in_event',
        'time:outside_event_day',
      ]),
    });
  });
});
