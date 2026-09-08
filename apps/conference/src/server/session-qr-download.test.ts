import type { Database } from '@byzon/database';
import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./policy', () => ({
  requireEventPermission: vi.fn(),
  EventAccessDeniedError: class extends Error {},
}));
import { EventAccessDeniedError, requireEventPermission } from './policy';
import { handleSessionQr } from './session-qr';

const fixture = participantProgramFixtures.happy!;
const session = fixture.program.sessions[0]!;
const load = vi.fn();
const supported = vi.fn();
const getSession = vi.fn();
const dependencies = {
  db: {
    query: {
      contentPublications: { findFirst: load },
      programSessions: { findMany: supported },
    },
  } as unknown as Database,
  appOrigin: 'https://app.byzon.cz',
  getSession,
};
const download = (query = '', id: string | undefined = session.id) =>
  handleSessionQr(
    new Request(`https://app.byzon.cz/api/qr${query}`),
    fixture.eventId,
    id,
    dependencies,
  );

beforeEach(() => {
  vi.clearAllMocks();
  supported.mockResolvedValue([{ id: session.id }]);
  getSession.mockResolvedValue({ user: { id: 'admin' } });
  vi.mocked(requireEventPermission).mockResolvedValue({} as never);
  load.mockResolvedValue({
    snapshot: {
      program: {
        ...fixture.program,
        sessions: [{ ...session, questionsEnabled: true }],
      },
    },
  });
});

describe('QR downloads', () => {
  it('preserves default SVG downloads', async () => {
    const result = await download();
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('image/svg+xml');
    expect(result.headers.get('content-disposition')).toContain(
      `${session.id}.svg`,
    );
    expect(await result.text()).toMatch(/^<svg/);
  });

  it.each(['questions', 'rating'])(
    'downloads a presentation PNG for %s',
    async (target) => {
      const result = await download(`?target=${target}&format=png`);
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toBe('image/png');
      expect(result.headers.get('content-disposition')).toContain(
        `-${target}.png`,
      );
      const bytes = new Uint8Array(await result.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([1024, 1024]);
    },
  );

  it('exports only eligible Q&A sessions and their direct links in ZIP', async () => {
    const response = await handleSessionQr(
      new Request('https://app.byzon.cz/api/qr?target=questions&format=png'),
      fixture.eventId,
      undefined,
      dependencies,
    );
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest.target).toBe('questions');
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0].deepLink).toBe(
      `https://app.byzon.cz/app/interakce/${session.id}`,
    );
    expect(files[manifest.sessions[0].filename]).toBeDefined();
  });

  it.each([
    ['rating', { type: 'coaching' }],
    ['questions', { status: 'cancelled' }],
    ['rating', { status: 'cancelled' }],
    ['program', { status: 'cancelled' }],
  ])('rejects unavailable %s QR (%j)', async (target, changes) => {
    load.mockResolvedValue({
      snapshot: {
        program: {
          ...fixture.program,
          sessions: [{ ...session, questionsEnabled: true, ...changes }],
        },
      },
    });
    expect((await download(`?target=${target}`)).status).toBe(404);
  });

  it('excludes sessions without Q&A capability', async () => {
    supported.mockResolvedValue([]);
    expect((await download('?target=questions')).status).toBe(404);
  });

  it('validates options and retains authentication and permission checks', async () => {
    expect((await download('?target=unknown')).status).toBe(422);
    expect((await download('?format=pdf')).status).toBe(422);
    getSession.mockResolvedValueOnce(null);
    expect((await download('?target=rating')).status).toBe(401);
    vi.mocked(requireEventPermission).mockRejectedValueOnce(
      new EventAccessDeniedError(),
    );
    const result = await download('?target=questions');
    expect(result.status).toBe(404);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
});
