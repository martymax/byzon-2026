import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@byzon/database';
import { eq } from 'drizzle-orm';
import { createQuestionFixture } from '../test/server/question-fixture';
import { handleAdminEngagement } from './admin-engagement';
import { validateProgramRoleScope } from './admin-role-export';
const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('Q&A administration preflight', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  const overview = async () =>
    await (
      await handleAdminEngagement(
        f.request('/overview'),
        f.eventId,
        f.dependencies(f.users.admin),
      )
    ).json();
  const mutate = (body: unknown) =>
    handleAdminEngagement(
      f.request('/mutate', body),
      f.eventId,
      f.dependencies(f.users.admin),
    );
  const features = async (
    questionsEnabled: boolean,
    questionFollowUpsEnabled: boolean,
  ) =>
    mutate({
      action: 'update_features',
      expectedSettingsVersion: (await overview()).settingsVersion,
      features: {
        questionsEnabled,
        questionFollowUpsEnabled,
        networkingEnabled: false,
        ratingsEnabled: false,
      },
      reason: 'Ověření bezpečného zapnutí',
    });
  it('shows only supported metadata and permits moderator preparation while both flags are OFF', async () => {
    expect((await features(false, false)).status).toBe(200);
    const view = await overview();
    expect(
      view.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual([f.sessionId]);
    expect(JSON.stringify(view)).not.toContain('authorUserId');
    expect(
      (
        await mutate({
          action: 'assign_moderator',
          sessionId: f.sessionId,
          userId: f.users.other,
          expectedAssignmentsVersion: view.assignmentsVersion,
          reason: 'Příprava druhého moderátora',
        })
      ).status,
    ).toBe(200);
    await expect(
      validateProgramRoleScope(f.client.db, f.eventId, 'moderator', {
        kind: 'session',
        sessionId: f.sessionId,
        label: 'Test',
      }),
    ).resolves.toEqual({ sessionIds: [f.sessionId] });
    await expect(
      validateProgramRoleScope(f.client.db, f.eventId, 'moderator', {
        kind: 'session',
        sessionId: f.unsupportedId,
        label: 'Test',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await mutate({
          action: 'set_session_questions',
          sessionId: f.unsupportedId,
          expectedSessionVersion: 1,
          enabled: true,
          reason: 'Nepodporovaný blok dotazů',
        })
      ).status,
    ).toBe(409);
  });
  it('rejects missing moderator and speaker coverage and allows switching OFF at any time', async () => {
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(eq(schema.eventRoles.userId, f.users.moderator));
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(eq(schema.eventRoles.userId, f.users.other));
    expect((await features(true, false)).status).toBe(409);
    await f.client.db
      .update(schema.speakerProfiles)
      .set({ userId: null })
      .where(eq(schema.speakerProfiles.id, f.speakerProfileId));
    expect((await features(false, true)).status).toBe(409);
    expect((await features(false, false)).status).toBe(200);
  });
});
