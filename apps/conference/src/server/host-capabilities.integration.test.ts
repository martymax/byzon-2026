import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@byzon/database';
import { createQuestionFixture } from '../test/server/question-fixture';
import { readHostCapabilities } from './host-capabilities';
const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('host capability projection', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  const read = (id: string) =>
    readHostCapabilities(
      f.request('/api/v1/me/host-capabilities'),
      f.dependencies(id),
    );
  it('does not grant roster through speaker links', async () => {
    expect(await (await read(f.users.speaker)).json()).toMatchObject({
      activities: false,
      moderation: false,
      followUps: true,
      pendingAnswerCount: 0,
    });
    expect(await (await read(f.users.participant)).json()).toMatchObject({
      activities: false,
      moderation: false,
      followUps: false,
    });
    expect((await read(f.users.unready)).status).toBe(403);
  });
  it('removes revoked capabilities without a new login', async () => {
    expect(await (await read(f.users.moderator)).json()).toMatchObject({
      moderation: true,
    });
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.eventRoles.eventId, f.eventId),
          eq(schema.eventRoles.userId, f.users.moderator),
          eq(schema.eventRoles.role, 'moderator'),
        ),
      );
    const response = await read(f.users.moderator);
    expect(await response.json()).toMatchObject({ moderation: false });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
