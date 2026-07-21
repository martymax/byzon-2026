import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readPublicContent, toCalendar } from './public-content';
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
describe('public calendar', () => {
  it('uses stable UID, publication sequence, UTC dates and escaping', () => {
    const calendar = toCalendar(
      'byzon-2026',
      3,
      new Date('2026-07-21T10:00:00Z'),
      'BYZON, 2026',
      [
        {
          id: 'session-id',
          title: 'Talk; one',
          summary: 'Line 1\nLine 2',
          startsAt: '2026-09-18T08:00:00Z',
          endsAt: '2026-09-18T09:00:00Z',
          status: 'cancelled',
          roomId: null,
        },
      ],
    );
    expect(calendar).toContain(
      'UID:session-id@byzon-2026.byzon.cz\r\nSEQUENCE:3',
    );
    expect(calendar).toContain('SUMMARY:Talk\\; one');
    expect(calendar).toContain('STATUS:CANCELLED');
    expect(calendar.endsWith('\r\n')).toBe(true);
    expect(
      calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
    const unicode = toCalendar(
      'byzon-2026',
      3,
      new Date('2026-07-21T10:00:00Z'),
      'BYZON',
      [
        {
          id: 'unicode',
          title: '🦬'.repeat(40),
          startsAt: '2026-09-18T08:00:00Z',
          endsAt: '2026-09-18T09:00:00Z',
          roomId: null,
        },
      ],
    );
    expect(unicode).not.toContain('�');
    expect(
      unicode.split('\r\n').every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
  });
});
integration('public content integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-public-content-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7(),
    publisherId = generateUuidV7(),
    sessionId = generateUuidV7(),
    dayId = generateUuidV7(),
    slug = `public-${eventId}`;
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug,
      name: 'Public event',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values({
      id: publisherId,
      name: 'Publisher',
      email: `${publisherId}@example.invalid`,
    });
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId: publisherId });
    await client.db.insert(schema.contentPublications).values({
      id: generateUuidV7(),
      eventId,
      version: 1,
      checksumSha256: 'e'.repeat(64),
      publishedBy: publisherId,
      snapshot: {
        event: {
          id: eventId,
          slug,
          name: 'Public event',
          timezone: 'Europe/Prague',
          startsAt: '2026-09-18T06:00:00.000Z',
          endsAt: '2026-09-19T20:00:00.000Z',
        },
        program: {
          days: [
            {
              id: dayId,
              localDate: '2026-09-18',
              title: 'Pátek',
              sortOrder: 0,
            },
          ],
          rooms: [],
          sessions: [
            {
              id: sessionId,
              dayId,
              roomId: null,
              slug: 'talk',
              title: 'Talk',
              type: 'talk',
              status: 'published',
              startsAt: '2026-09-18T08:00:00.000Z',
              endsAt: '2026-09-18T09:00:00.000Z',
              sortOrder: 0,
            },
          ],
        },
        speakers: [],
        partners: [],
        venues: [],
        practical: { pages: [], faqs: [] },
        privateAdminNote: 'hidden',
      },
    });
  });
  afterAll(async () => client.close());
  it('serves deterministic whitelisted content without authentication and revalidates ETag', async () => {
    const first = await readPublicContent(
      new Request(
        `https://app.byzon.test/api/v1/public/events/${slug}/content`,
      ),
      slug,
      'content',
      client.db,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('public');
    const firstText = await first.text();
    const body = JSON.parse(firstText) as Record<string, unknown> & {
      program: { sessions: Array<{ id: string }> };
    };
    expect(body).not.toHaveProperty('privateAdminNote');
    expect(body.program.sessions[0]!.id).toBe(sessionId);
    const repeated = await readPublicContent(
      new Request(
        `https://app.byzon.test/api/v1/public/events/${slug}/content`,
      ),
      slug,
      'content',
      client.db,
    );
    expect(await repeated.text()).toBe(firstText);
    const second = await readPublicContent(
      new Request(
        `https://app.byzon.test/api/v1/public/events/${slug}/content`,
        { headers: { 'if-none-match': first.headers.get('etag')! } },
      ),
      slug,
      'content',
      client.db,
    );
    expect(second.status).toBe(304);

    const original = await client.db.query.contentPublications.findFirst({
      where: (publication, { eq }) => eq(publication.eventId, eventId),
    });
    await client.db.insert(schema.contentPublications).values({
      id: generateUuidV7(),
      eventId,
      version: 2,
      checksumSha256: original!.checksumSha256,
      publishedBy: publisherId,
      snapshot: original!.snapshot,
    });
    const republished = await readPublicContent(
      new Request(
        `https://app.byzon.test/api/v1/public/events/${slug}/content`,
        { headers: { 'if-none-match': first.headers.get('etag')! } },
      ),
      slug,
      'content',
      client.db,
    );
    expect(republished.status).toBe(200);
    await expect(republished.json()).resolves.toMatchObject({ version: 2 });
  });
  it('does not expose events without a publication', async () => {
    const response = await readPublicContent(
      new Request('https://app.byzon.test/api'),
      `missing-${generateUuidV7()}`,
      'bootstrap',
      client.db,
    );
    expect(response.status).toBe(404);
  });
});
