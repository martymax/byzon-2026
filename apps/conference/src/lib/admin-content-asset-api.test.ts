import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAdminContentAssetPort } from './admin-content-asset-api';

const eventId = '019fc700-0000-7000-8000-000000000001';
const owner = {
  kind: 'partner' as const,
  id: '019fc700-0000-7000-8000-000000000025',
};
const asset = {
  assetId: '019fc700-0000-7000-8000-000000000030',
  eventId,
  owner,
  purpose: 'partner_logo' as const,
  contentType: 'image/webp' as const,
  byteSize: 123,
  altText: 'Logo',
  version: 1,
  status: 'ready' as const,
  preview: {
    url: `/api/v1/admin/events/${eventId}/content-assets/partners/${owner.id}?file=preview&assetId=019fc700-0000-7000-8000-000000000030&expires=9999999999999`,
    expiresAt: '2026-09-09T12:00:00Z',
    width: 100,
    height: 50,
  },
};
afterEach(() => vi.unstubAllGlobals());

describe('production image client', () => {
  it('loads the authorized descriptor without caching or exposing a storage path', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ asset, requestId: crypto.randomUUID() }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await browserAdminContentAssetPort.resolve({
        eventId,
        owner,
        purpose: 'partner_logo',
      }),
    ).toEqual({ ok: true, data: asset });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/admin/events/${eventId}/content-assets/partners/${owner.id}`,
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  });
  it('uploads multipart with the owner version and reports actual transfer progress', async () => {
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      upload: {
        onprogress: (_event: {
          loaded: number;
          total: number;
          lengthComputable: boolean;
        }) => {
          void _event;
        },
      },
      onload: () => {},
      onerror: () => {},
      ontimeout: () => {},
      onabort: () => {},
      timeout: 0,
      status: 200,
      responseText: JSON.stringify({
        asset,
        ownerVersion: 3,
        requestId: crypto.randomUUID(),
      }),
    };
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          return xhr;
        }
      },
    );
    const progress = vi.fn();
    const result = browserAdminContentAssetPort.replace({
      eventId,
      owner,
      purpose: 'partner_logo',
      expectedOwnerVersion: 2,
      file: new File(['png'], 'logo.png', { type: 'image/png' }),
      altText: 'Logo',
      onProgress: progress,
    });
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('if-match', '"2"');
    const body = xhr.send.mock.calls[0]![0] as FormData;
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('altText')).toBe('Logo');
    xhr.upload.onprogress({ loaded: 50, total: 100, lengthComputable: true });
    expect(progress).toHaveBeenLastCalledWith(48);
    xhr.onload();
    expect(await result).toMatchObject({ ok: true, data: { ownerVersion: 3 } });
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it('returns session expiry and a readable storage configuration error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    );
    expect(
      await browserAdminContentAssetPort.resolve({
        eventId,
        owner,
        purpose: 'partner_logo',
      }),
    ).toMatchObject({ ok: false, failure: { kind: 'session_expired' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { code: 'ADMIN_ASSET_STORAGE_UNAVAILABLE' },
          { status: 503 },
        ),
      ),
    );
    expect(
      await browserAdminContentAssetPort.resolve({
        eventId,
        owner,
        purpose: 'partner_logo',
      }),
    ).toMatchObject({
      ok: false,
      failure: {
        message: expect.stringContaining('Úložiště obrázků není připojené'),
      },
    });
  });
  it('downloads the requested asset but rejects an HTML error page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('image', { headers: { 'content-type': 'image/webp' } }),
      ),
    );
    const result = await browserAdminContentAssetPort.download!({ asset });
    expect(result.ok).toBe(true);
    if (result.ok) expect(await result.data.text()).toBe('image');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>login</html>', {
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    expect((await browserAdminContentAssetPort.download!({ asset })).ok).toBe(
      false,
    );
  });
});
