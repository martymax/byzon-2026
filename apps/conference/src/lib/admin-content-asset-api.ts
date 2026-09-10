import {
  adminAssetMutationResponseSchema,
  adminAssetResolveResponseSchema,
} from '@byzon/domain/contracts';
import type {
  AdminContentAssetPort,
  AdminContentAssetFailure,
  AdminContentAssetResult,
} from '../components/admin-content-asset-field';

const failure = (
  status: number,
  code?: string,
): { ok: false; failure: AdminContentAssetFailure } => ({
  ok: false,
  failure: {
    kind:
      status === 401
        ? 'session_expired'
        : [403, 404].includes(status)
          ? 'permission'
          : status === 409
            ? 'stale'
            : [400, 413, 422].includes(status)
              ? 'validation'
              : 'transport',
    message:
      status === 401
        ? 'Přihlášení vypršelo. Přihlaste se znovu.'
        : [403, 404].includes(status)
          ? 'Obrázek není dostupný nebo k němu nemáte oprávnění.'
          : status === 409
            ? 'Obsah se mezitím změnil. Zavřete editor a načtěte aktuální stav.'
            : [400, 413, 422].includes(status)
              ? 'Zkontrolujte popis a obrázek: JPEG, PNG nebo WebP, logo do 3 MB, fotografie do 5 MB, nejvýše 25 megapixelů.'
              : status === 429
                ? 'Příliš mnoho požadavků. Zkuste to za minutu.'
                : code === 'ADMIN_ASSET_STORAGE_UNAVAILABLE'
                  ? 'Úložiště obrázků není připojené. Obraťte se na správce aplikace.'
                  : 'Obrázek se nepodařilo přenést. Zkontrolujte připojení a zkuste to znovu.',
  },
});
const path = (eventId: string, owner: { kind: string; id: string }) =>
  `/api/v1/admin/events/${encodeURIComponent(eventId)}/content-assets/${owner.kind === 'partner' ? 'partners' : 'speakers'}/${encodeURIComponent(owner.id)}`;

const decode = async <T>(
  response: Response,
  parse: (value: unknown) => T,
): Promise<AdminContentAssetResult<T>> => {
  try {
    const data = await response.json();
    return response.ok
      ? { ok: true, data: parse(data) }
      : failure(response.status, data.code);
  } catch {
    return failure(0);
  }
};

export const browserAdminContentAssetPort: AdminContentAssetPort = {
  async resolve({ eventId, owner, signal }) {
    try {
      return await decode(
        await fetch(path(eventId, owner), {
          credentials: 'same-origin',
          cache: 'no-store',
          ...(signal ? { signal } : {}),
        }),
        (value) => adminAssetResolveResponseSchema.parse(value).asset,
      );
    } catch {
      return failure(0);
    }
  },
  replace({
    eventId,
    owner,
    file,
    altText,
    expectedOwnerVersion,
    signal,
    onProgress,
  }) {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(failure(0));
        return;
      }
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const finish = (
        result: Awaited<ReturnType<AdminContentAssetPort['replace']>>,
      ) => {
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      xhr.open('PUT', path(eventId, owner));
      xhr.setRequestHeader('if-match', `"${expectedOwnerVersion}"`);
      xhr.timeout = 60_000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(
            Math.min(95, Math.round((event.loaded / event.total) * 95)),
          );
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) {
            finish(failure(xhr.status, body.code));
            return;
          }
          const data = adminAssetMutationResponseSchema.parse(body);
          if (!data.asset) {
            finish(failure(0));
            return;
          }
          onProgress(100);
          finish({
            ok: true,
            data: { asset: data.asset, ownerVersion: data.ownerVersion },
          });
        } catch {
          finish(failure(0));
        }
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => finish(failure(0));
      signal?.addEventListener('abort', abort, { once: true });
      const form = new FormData();
      form.set('file', file);
      form.set('altText', altText);
      onProgress(0);
      xhr.send(form);
    });
  },
  async remove({ asset, expectedOwnerVersion, signal }) {
    try {
      return await decode(
        await fetch(
          `${path(asset.eventId, asset.owner)}?assetId=${asset.assetId}`,
          {
            method: 'DELETE',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'if-match': `"${expectedOwnerVersion}"` },
            ...(signal ? { signal } : {}),
          },
        ),
        (value) => ({
          ownerVersion:
            adminAssetMutationResponseSchema.parse(value).ownerVersion,
        }),
      );
    } catch {
      return failure(0);
    }
  },
  async download({ asset, signal }) {
    try {
      const response = await fetch(
        `${path(asset.eventId, asset.owner)}?file=download&assetId=${asset.assetId}`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok) return failure(response.status);
      if (
        ![
          'image/webp',
          'image/png',
          'image/jpeg',
          'image/svg+xml',
          'image/gif',
          'image/avif',
        ].includes(response.headers.get('content-type') ?? '')
      )
        return failure(0);
      return { ok: true, data: await response.blob() };
    } catch {
      return failure(0);
    }
  },
};
