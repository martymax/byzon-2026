import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readParticipantContent } from './participant-content';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('participant content integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-participant-content-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const userId = generateUuidV7();
  const publisherId = generateUuidV7();
  const speakerId = generateUuidV7();

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `content-${eventId}`,
      name: 'Content event',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values([
      { id: userId, name: 'Participant', email: `${userId}@example.invalid` },
      {
        id: publisherId,
        name: 'Publisher',
        email: `${publisherId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId },
      { eventId, userId: publisherId },
    ]);
    await client.db
      .insert(schema.eventRoles)
      .values({ id: generateUuidV7(), eventId, userId, role: 'participant' });
    await client.db.insert(schema.contentPublications).values({
      id: generateUuidV7(),
      eventId,
      version: 1,
      checksumSha256: 'd'.repeat(64),
      publishedBy: publisherId,
      snapshot: {
        event: {
          id: eventId,
          slug: 'content-event',
          name: 'Content event',
          timezone: 'Europe/Prague',
          startsAt: '2026-09-18T06:00:00.000Z',
          endsAt: '2026-09-19T20:00:00.000Z',
        },
        speakers: [
          {
            id: speakerId,
            slug: 'jana-novakova',
            firstName: 'Jana',
            lastName: 'Nováková',
            company: null,
            jobTitle: 'CEO',
            bioMarkdown: 'Bio',
            linkedinUrl: null,
            websiteUrl: null,
            photoAssetId: null,
            status: 'published',
            sortOrder: 0,
            version: 1,
            privateNote: 'must not escape',
          },
        ],
        partners: [],
        venues: [],
        practical: { pages: [], faqs: [] },
      },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('returns whitelisted published directories for an event participant', async () => {
    const response = await readParticipantContent(
      new Request(`https://app.byzon.test/api/v1/events/${eventId}/content`),
      eventId,
      { db: client.db, getSession: async () => ({ user: { id: userId } }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.content.speakers[0]).toMatchObject({
      id: speakerId,
      firstName: 'Jana',
    });
    expect(body.content.speakers[0]).not.toHaveProperty('privateNote');
    expect(response.headers.get('cache-control')).toContain('private');
  });

  it('rejects anonymous directory reads', async () => {
    const response = await readParticipantContent(
      new Request(`https://app.byzon.test/api/v1/events/${eventId}/content`),
      eventId,
      { db: client.db, getSession: async () => null },
    );
    expect(response.status).toBe(401);
  });
});
