import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@byzon/database';
import { programAccessPreviewSchema } from '@byzon/domain/contracts';
import { createQuestionFixture } from '../test/server/question-fixture';
import { handleProgramAccess } from './admin-program-access';
const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('program access provisioning', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  const call = (
    action: 'search' | 'options' | 'preview' | 'apply',
    body?: unknown,
    userId?: string,
    key?: string,
  ) =>
    handleProgramAccess(
      f.request(
        `/api/v1/admin/events/${f.eventId}/program-access/${action}`,
        body,
        key,
      ),
      f.eventId,
      action,
      f.dependencies(userId ?? f.users.admin),
    );
  it('finds uninvited manual participants and exposes no raw email', async () => {
    const response = await call('search', { query: 'Synthetic' });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(
      data.items.find(
        (p: { participantId: string }) => p.participantId === f.users.coach,
      ),
    ).toMatchObject({
      source: 'manual',
      invitationStatus: 'not_sent',
      baselineReady: true,
    });
    expect(JSON.stringify(data)).not.toContain(`${f.users.coach}@`);
  });
  it('rejects missing baseline and forged role payload', async () => {
    const selection = { preset: 'moderator', sessionIds: [f.sessionId] };
    expect(
      (
        await call('preview', {
          participantId: f.users.unready,
          selection,
          operation: 'apply',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('preview', {
          participantId: f.users.coach,
          selection,
          operation: 'apply',
          roles: ['organizer_admin'],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          'preview',
          { participantId: f.users.coach, selection, operation: 'apply' },
          f.users.other,
        )
      ).status,
    ).toBe(403);
  });
  it('atomically applies a two-part leader scope, retries, and revokes without cancelling membership', async () => {
    const input = {
      participantId: f.users.speaker,
      selection: {
        preset: 'activity_leader',
        speakerProfileId: f.speakerProfileId,
      },
      operation: 'apply',
    };
    const reviewed = programAccessPreviewSchema.parse(
      await (await call('preview', input)).json(),
    );
    expect(
      reviewed.roles.find((role) => role.role === 'room_operator')?.sessionIds,
    ).toEqual([f.part1, f.part2].sort());
    const body = {
      ...input,
      expectedVersion: reviewed.assignmentsVersion,
      previewHash: reviewed.previewHash,
      reason: 'Příprava vedoucího aktivit',
    };
    const response = await call(
      'apply',
      body,
      undefined,
      'program-access-retry-01',
    );
    expect(response.status).toBe(200);
    expect(
      await (
        await call('apply', body, undefined, 'program-access-retry-01')
      ).json(),
    ).toEqual(await response.json());
    expect((await call('apply', body)).status).toBe(409);
    const revokeInput = { ...input, operation: 'revoke' };
    const revoke = programAccessPreviewSchema.parse(
      await (await call('preview', revokeInput)).json(),
    );
    expect(
      (
        await call('apply', {
          ...revokeInput,
          expectedVersion: revoke.assignmentsVersion,
          previewHash: revoke.previewHash,
          reason: 'Odebrání vedení aktivit',
        })
      ).status,
    ).toBe(200);
    const roles = await f.client.db.query.eventRoles.findMany({
      where: and(
        eq(schema.eventRoles.eventId, f.eventId),
        eq(schema.eventRoles.userId, f.users.speaker),
        isNull(schema.eventRoles.revokedAt),
      ),
    });
    expect(roles.map((row) => row.role)).toContain('participant');
    expect(roles.map((row) => row.role)).toContain('speaker');
    expect(roles.map((row) => row.role)).not.toContain('room_operator');
    expect(
      await f.client.db.query.outboxEvents.findMany({
        where: eq(schema.outboxEvents.eventId, f.eventId),
      }),
    ).toHaveLength(0);
  });
  it('prepares moderation with collection OFF and refuses unsupported sessions', async () => {
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    const input = {
      participantId: f.users.coach,
      selection: { preset: 'moderator', sessionIds: [f.sessionId] },
      operation: 'apply',
    };
    expect((await call('preview', input)).status).toBe(200);
    expect(
      (
        await call('preview', {
          ...input,
          selection: { preset: 'moderator', sessionIds: [f.unsupportedId] },
        })
      ).status,
    ).toBe(409);
  });
});
