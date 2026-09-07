import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { schema } from '@byzon/database';
import { eq } from 'drizzle-orm';
import { createQuestionFixture } from '../test/server/question-fixture';
import { buildSessionDeepLink, handleSessionQr } from './session-qr';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('question-target QR export', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  it('exports only supported published questions with complete metadata while program QR stays available', async () => {
    const deps = { ...f.dependencies(f.users.admin), appOrigin: f.origin };
    const response = await handleSessionQr(
      f.request('/qr?target=questions'),
      f.eventId,
      undefined,
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(zip['manifest.json']!));
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0]).toMatchObject({
      id: f.sessionId,
      deepLink: `${f.origin}/app/interakce/${f.sessionId}`,
      roomName: 'Coach room',
      startsAt: '2026-09-18T09:00:00.000Z',
    });
    expect(zip[manifest.sessions[0].filename]).toBeDefined();
    expect(
      (
        await handleSessionQr(
          f.request('/qr?target=questions'),
          f.eventId,
          f.unsupportedId,
          deps,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleSessionQr(
          f.request('/qr'),
          f.eventId,
          f.unsupportedId,
          deps,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleSessionQr(
          f.request('/qr?target=external'),
          f.eventId,
          undefined,
          deps,
        )
      ).status,
    ).toBe(422);
  });
  it('uses published snapshot membership even when the editable row is draft, and never returns an empty ZIP', async () => {
    const deps = { ...f.dependencies(f.users.admin), appOrigin: f.origin };
    try {
      await f.client.db
        .update(schema.programSessions)
        .set({ status: 'draft' })
        .where(eq(schema.programSessions.id, f.sessionId));
      const response = await handleSessionQr(
        f.request('/qr?target=questions'),
        f.eventId,
        undefined,
        deps,
      );
      expect(response.status).toBe(200);
      const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const manifest = JSON.parse(strFromU8(zip['manifest.json']!));
      expect(manifest.sessions).toHaveLength(1);
      expect(strFromU8(zip[manifest.sessions[0].filename]!)).toMatch(/^<svg/);
      for (const status of ['archived', 'cancelled'] as const) {
        await f.client.db
          .update(schema.programSessions)
          .set({ status })
          .where(eq(schema.programSessions.id, f.sessionId));
        const empty = await handleSessionQr(
          f.request('/qr?target=questions'),
          f.eventId,
          undefined,
          deps,
        );
        expect(empty.status).toBe(404);
        expect(empty.headers.get('content-disposition')).toBeNull();
        expect(await empty.json()).toMatchObject({ code: 'NO_QR_SESSIONS' });
      }
    } finally {
      await f.client.db
        .update(schema.programSessions)
        .set({ status: 'published' })
        .where(eq(schema.programSessions.id, f.sessionId));
    }
  });
  it('downloads PNG bytes with the correct dimensions and filename', async () => {
    const deps = { ...f.dependencies(f.users.admin), appOrigin: f.origin };
    const response = await handleSessionQr(
      f.request('/qr?target=questions&format=png'),
      f.eventId,
      f.sessionId,
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toContain('.png"');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(bytes.readUInt32BE(16)).toBe(1024);
    expect(bytes.readUInt32BE(20)).toBe(1024);
    expect(
      (
        await handleSessionQr(
          f.request('/qr?format=gif'),
          f.eventId,
          f.sessionId,
          deps,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await handleSessionQr(
          f.request('/qr?format=png'),
          f.eventId,
          undefined,
          deps,
        )
      ).status,
    ).toBe(422);
  });
  it('builds exact safe destinations without credentials or query parameters', () => {
    expect(
      buildSessionDeepLink(
        'https://user:pass@app.byzon.test/base?token=x#hash',
        f.sessionId,
        'questions',
      ),
    ).toBe(`${f.origin}/app/interakce/${f.sessionId}`);
  });
});
