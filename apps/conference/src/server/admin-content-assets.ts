import { and, eq, isNull } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminAssetDescriptorSchema,
  type AdminAssetDescriptor,
} from '@byzon/domain/contracts';
import sharp from 'sharp';
import { z } from 'zod';

import type { AdminContentDependencies } from './admin-content';
import { requireWritableAdminEvent } from './admin-event-writability';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import {
  createContentAssetStorage,
  imageLimit,
  invalidImage,
  MAX_IMAGE_PIXELS,
  prepareContentImage,
  type ContentAssetStorage,
} from './content-asset-storage';

const uuid = z.string().uuid();
const headers = {
  'cache-control': 'private, no-store',
  vary: 'Cookie, Authorization',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const notFound = () =>
  new ApiProblemError({
    status: 404,
    code: 'ADMIN_ASSET_NOT_FOUND',
    title: 'Image not found',
    detail: 'Obrázek nebo obsah není dostupný.',
  });
const stale = () =>
  new ApiProblemError({
    status: 409,
    code: 'ADMIN_ASSET_STALE',
    title: 'Content changed',
    detail: 'Obsah se mezitím změnil. Zavřete editor a načtěte aktuální stav.',
  });

type Asset = typeof schema.assets.$inferSelect;
type Owner = {
  id: string;
  version: number;
  assetId: string | null;
  label: string;
  status: string;
};
type Resource = 'partners' | 'speakers';
const purposeOf = (resource: Resource) =>
  resource === 'partners' ? 'partner_logo' : 'speaker_photo';

const readOwner = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  resource: Resource,
  id: string,
): Promise<Owner> => {
  if (resource === 'partners') {
    const row = await db.query.partners.findFirst({
      where: and(
        eq(schema.partners.eventId, eventId),
        eq(schema.partners.id, id),
      ),
    });
    if (!row) throw notFound();
    return {
      id,
      version: row.version,
      assetId: row.logoAssetId,
      label: row.name,
      status: row.status,
    };
  }
  const row = await db.query.speakerProfiles.findFirst({
    where: and(
      eq(schema.speakerProfiles.eventId, eventId),
      eq(schema.speakerProfiles.id, id),
    ),
  });
  if (!row) throw notFound();
  return {
    id,
    version: row.version,
    assetId: row.photoAssetId,
    label: `${row.firstName} ${row.lastName}`,
    status: row.status,
  };
};

const readAsset = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  assetId: string | null,
) => {
  if (!assetId) return null;
  const asset = await db.query.assets.findFirst({
    where: and(
      eq(schema.assets.eventId, eventId),
      eq(schema.assets.id, assetId),
      isNull(schema.assets.deletedAt),
      eq(schema.assets.status, 'ready'),
    ),
  });
  if (!asset) throw notFound();
  return asset;
};

const descriptor = async (
  asset: Asset,
  resource: Resource,
  owner: Owner,
  storage: ContentAssetStorage,
): Promise<AdminAssetDescriptor> => {
  const dimensions =
    asset.width && asset.height
      ? { width: asset.width, height: asset.height }
      : await sharp(await storage.read(asset.bucketKey, asset.eventId), {
          limitInputPixels: MAX_IMAGE_PIXELS,
        }).metadata();
  const expires = Date.now() + 5 * 60_000;
  return adminAssetDescriptorSchema.parse({
    assetId: asset.id,
    eventId: asset.eventId,
    owner: {
      kind: resource === 'partners' ? 'partner' : 'speaker',
      id: owner.id,
    },
    purpose: purposeOf(resource),
    contentType: asset.sniffedMimeType,
    byteSize: asset.sizeBytes,
    altText: asset.altText || owner.label.slice(0, 300),
    version: 1,
    status: 'ready',
    preview: {
      url: `/api/v1/admin/events/${asset.eventId}/content-assets/${resource}/${owner.id}?file=preview&assetId=${asset.id}&expires=${expires}`,
      expiresAt: new Date(expires).toISOString(),
      width: dimensions.width,
      height: dimensions.height,
    },
  });
};

// Bound the actual streamed body as well as Content-Length, before multipart parsing.
const uploadForm = async (request: Request, limit: number) => {
  if (
    !request.headers.get('content-type')?.startsWith('multipart/form-data;') ||
    !request.body
  )
    throw invalidImage();
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw invalidImage();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw invalidImage();
      }
      chunks.push(next.value);
    }
    return await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': request.headers.get('content-type')! },
    }).formData();
  } catch (error) {
    if (error instanceof ApiProblemError) throw error;
    throw invalidImage();
  } finally {
    reader.releaseLock();
  }
};

export interface AdminContentAssetDependencies extends AdminContentDependencies {
  storage?: ContentAssetStorage;
  rateLimit(
    kind: 'read' | 'mutation',
    userId: string,
    eventId: string,
  ): Promise<void>;
}

export const handleAdminContentAsset = async (
  request: Request,
  eventId: string,
  resourceValue: string,
  id: string,
  dependencies: AdminContentAssetDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  const responseHeaders = { ...headers, 'x-request-id': requestId };
  const storage = dependencies.storage ?? createContentAssetStorage();
  let writtenKey: string | undefined;
  let writtenId: string | undefined;
  try {
    if (
      !uuid.safeParse(eventId).success ||
      !uuid.safeParse(id).success ||
      !['partners', 'speakers'].includes(resourceValue)
    )
      throw notFound();
    const resource = resourceValue as Resource;
    const session = await dependencies.getSession(request.headers);
    if (!session)
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'Přihlaste se znovu.',
      });
    await requireEventPermission(
      dependencies.db,
      { userId: session.user.id },
      eventId,
      'program:manage',
    );
    if (!['GET', 'PUT', 'DELETE'].includes(request.method))
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'Nepodporovaná operace.',
      });
    if (
      request.method !== 'GET' &&
      request.headers.get('origin') !== dependencies.allowedOrigin
    )
      throw new ApiProblemError({
        status: 403,
        code: 'ORIGIN_REJECTED',
        title: 'Request rejected',
        detail: 'Požadavek musí pocházet z aplikace.',
      });
    await dependencies.rateLimit(
      request.method === 'GET' ? 'read' : 'mutation',
      session.user.id,
      eventId,
    );
    const owner = await readOwner(dependencies.db, eventId, resource, id);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const asset = await readAsset(dependencies.db, eventId, owner.assetId);
      const file = url.searchParams.get('file');
      if (file) {
        if (
          !asset ||
          !['preview', 'download'].includes(file) ||
          url.searchParams.get('assetId') !== asset.id
        )
          throw notFound();
        if (file === 'preview') {
          const expires = Number(url.searchParams.get('expires'));
          if (
            !Number.isSafeInteger(expires) ||
            expires < Date.now() ||
            expires > Date.now() + 5 * 60_000
          )
            throw notFound();
        }
        const bytes = await storage.read(asset.bucketKey, eventId);
        if (file === 'download')
          await writeAuditLog(dependencies.db, {
            eventId,
            actorId: session.user.id,
            actorType: 'user',
            action: 'content.asset.download',
            targetType: 'asset',
            targetId: asset.id,
            requestId: uuid.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
          });
        const extension = {
          'image/webp': 'webp',
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/svg+xml': 'svg',
          'image/gif': 'gif',
          'image/avif': 'avif',
        }[asset.sniffedMimeType ?? ''];
        if (!extension) throw notFound();
        return new Response(new Uint8Array(bytes), {
          headers: {
            ...responseHeaders,
            'content-type': asset.sniffedMimeType!,
            'content-length': String(bytes.length),
            'content-disposition': `${file === 'download' ? 'attachment' : 'inline'}; filename="${purposeOf(resource)}-${id}.${extension}"`,
          },
        });
      }
      return Response.json(
        {
          asset: asset
            ? await descriptor(asset, resource, owner, storage)
            : null,
          requestId,
        },
        { headers: responseHeaders },
      );
    }
    await requireWritableAdminEvent(dependencies.db, eventId);
    const expectedVersion = Number(
      request.headers.get('if-match')?.replaceAll('"', ''),
    );
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw stale();
    if (owner.version !== expectedVersion) throw stale();
    if (owner.status === 'archived')
      throw new ApiProblemError({
        status: 409,
        code: 'ADMIN_INVALID_TRANSITION',
        title: 'Content archived',
        detail: 'Archivovaný obsah je pouze ke čtení.',
      });
    let prepared: Awaited<ReturnType<typeof prepareContentImage>> | undefined;
    let altText = '';
    let declaredMimeType = '';
    if (request.method === 'PUT') {
      const form = await uploadForm(
        request,
        imageLimit(purposeOf(resource)) + 16_384,
      );
      const file = form.get('file');
      const alt = form.get('altText');
      if (
        !(file instanceof File) ||
        typeof alt !== 'string' ||
        !alt.trim() ||
        alt.trim().length > 300 ||
        /[\u0000-\u001f\u007f<>]/.test(alt) ||
        form.getAll('file').length !== 1 ||
        form.getAll('altText').length !== 1 ||
        [...form.keys()].some((key) => !['file', 'altText'].includes(key))
      )
        throw invalidImage();
      altText = alt.trim();
      declaredMimeType = file.type;
      prepared = await prepareContentImage(
        Buffer.from(await file.arrayBuffer()),
        file.type,
        purposeOf(resource),
      );
    }
    const result = await withTransaction(
      dependencies.db,
      async (transaction) => {
        await acquireTransactionLock(transaction, `content-publish:${eventId}`);
        await requireWritableAdminEvent(transaction, eventId);
        await requireEventPermission(
          transaction,
          { userId: session.user.id },
          eventId,
          'program:manage',
        );
        const current = await readOwner(transaction, eventId, resource, id);
        if (current.version !== expectedVersion) throw stale();
        let assetId: string | null = null;
        let asset: Asset | undefined;
        if (prepared) {
          assetId = generateUuidV7();
          const bucketKey = `content-images/${eventId}/${assetId}.webp`;
          await storage.write(bucketKey, prepared.bytes);
          writtenKey = bucketKey;
          writtenId = assetId;
          [asset] = await transaction
            .insert(schema.assets)
            .values({
              id: assetId,
              eventId,
              ownerUserId: session.user.id,
              bucketKey,
              purpose: purposeOf(resource),
              originalFilename: `${purposeOf(resource)}.webp`,
              declaredMimeType,
              sniffedMimeType: 'image/webp',
              sizeBytes: prepared.bytes.length,
              checksumSha256: prepared.checksum,
              status: 'ready',
              isPublic: false,
              altText,
              width: prepared.width,
              height: prepared.height,
            })
            .returning();
        } else if (
          !current.assetId ||
          url.searchParams.get('assetId') !== current.assetId
        )
          throw stale();
        const values = { version: current.version + 1, updatedAt: new Date() };
        if (resource === 'partners')
          await transaction
            .update(schema.partners)
            .set({ ...values, logoAssetId: assetId })
            .where(
              and(
                eq(schema.partners.eventId, eventId),
                eq(schema.partners.id, id),
              ),
            );
        else
          await transaction
            .update(schema.speakerProfiles)
            .set({ ...values, photoAssetId: assetId })
            .where(
              and(
                eq(schema.speakerProfiles.eventId, eventId),
                eq(schema.speakerProfiles.id, id),
              ),
            );
        // Old immutable assets remain available to already-published snapshots.
        await writeAuditLog(transaction, {
          eventId,
          actorId: session.user.id,
          actorType: 'user',
          action: prepared ? 'content.asset.replace' : 'content.asset.remove',
          targetType: `content_${resource}`,
          targetId: id,
          requestId: uuid.safeParse(requestId).success
            ? requestId
            : generateUuidV7(),
          before: { assetId: current.assetId },
          after: { assetId, version: values.version, httpRequestId: requestId },
        });
        return {
          asset: asset
            ? await descriptor(asset, resource, current, storage)
            : null,
          ownerVersion: values.version,
          requestId,
        };
      },
    );
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    if (writtenKey && writtenId) {
      // A lost COMMIT response must not delete an image that was actually committed.
      const persisted = await dependencies.db.query.assets
        .findFirst({
          where: eq(schema.assets.id, writtenId),
          columns: { id: true },
        })
        .catch(() => ({ id: writtenId }));
      if (!persisted) await storage.remove(writtenKey).catch(() => {});
    }
    const response = problemResponse(
      error instanceof EventAccessDeniedError ? notFound() : error,
      requestId,
    );
    for (const [name, value] of Object.entries(responseHeaders))
      response.headers.set(name, value);
    return response;
  }
};
