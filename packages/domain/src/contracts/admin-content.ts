import { z } from 'zod';

import { defineApiProblemSchema, requestIdSchema } from './base.js';

const uuidSchema = z.string().uuid();
const versionSchema = z.number().int().positive();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001F\u007F<>]/.test(value), {
      message: 'Text contains unsafe control characters or markup',
    });
const safeHttpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username.length === 0 &&
        url.password.length === 0
      );
    } catch {
      return false;
    }
  });

export const adminContentResourceSchema = z.enum([
  'days',
  'venues',
  'rooms',
  'sessions',
  'speakers',
  'partners',
  'pages',
  'faqs',
]);

export type AdminContentContractResource = z.infer<
  typeof adminContentResourceSchema
>;

export const adminPublicationChangeSchema = z.strictObject({
  kind: z.enum(['added', 'updated', 'cancelled', 'archived']),
  resource: adminContentResourceSchema,
  title: safeText(512),
  impact: z
    .array(z.enum(['content', 'time', 'location', 'status', 'order']))
    .min(1)
    .max(5)
    .refine((impact) => new Set(impact).size === impact.length, {
      message: 'Change impact values must be unique',
    }),
});

export type AdminPublicationChange = z.infer<
  typeof adminPublicationChangeSchema
>;

export const adminPublicationSummarySchema = z
  .strictObject({
    available: z.boolean(),
    changeCount: z.number().int().nonnegative().nullable(),
    changes: z.array(adminPublicationChangeSchema).max(12_000),
    previousPublication: z
      .strictObject({
        version: versionSchema,
        publishedAt: dateTimeSchema,
      })
      .nullable(),
  })
  .superRefine((summary, context) => {
    if (!summary.available && summary.changeCount !== null) {
      context.addIssue({
        code: 'custom',
        path: ['changeCount'],
        message: 'Unavailable summary cannot claim a change count',
      });
    }
    if (!summary.available && summary.changes.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'Unavailable summary cannot contain authoritative changes',
      });
    }
    if (summary.available && summary.changeCount !== summary.changes.length) {
      context.addIssue({
        code: 'custom',
        path: ['changeCount'],
        message: 'Change count must match the authoritative change list',
      });
    }
  });

export type AdminPublicationSummary = z.infer<
  typeof adminPublicationSummarySchema
>;

export const adminPublicationMetadataSchema = z.strictObject({
  createdAt: dateTimeSchema,
  summary: adminPublicationSummarySchema,
});

export type AdminPublicationMetadata = z.infer<
  typeof adminPublicationMetadataSchema
>;

export const adminAssetPurposeSchema = z.enum([
  'speaker_photo',
  'partner_logo',
]);
export type AdminAssetPurpose = z.infer<typeof adminAssetPurposeSchema>;
export const adminAssetContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const adminAssetOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('speaker'), id: uuidSchema }),
  z.strictObject({ kind: z.literal('partner'), id: uuidSchema }),
]);

export const adminAssetPreviewSchema = z.strictObject({
  url: safeHttpsUrlSchema,
  expiresAt: dateTimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const adminAssetDescriptorSchema = z
  .strictObject({
    assetId: uuidSchema,
    eventId: uuidSchema,
    owner: adminAssetOwnerSchema,
    purpose: adminAssetPurposeSchema,
    contentType: adminAssetContentTypeSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(5 * 1_024 * 1_024),
    altText: safeText(300),
    version: versionSchema,
    status: z.enum(['processing', 'ready', 'failed']),
    preview: adminAssetPreviewSchema.nullable(),
  })
  .superRefine((asset, context) => {
    if (
      (asset.owner.kind === 'speaker') !==
      (asset.purpose === 'speaker_photo')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['purpose'],
        message: 'Asset purpose must match its content owner',
      });
    }
    if (
      asset.purpose === 'partner_logo' &&
      asset.byteSize > 3 * 1_024 * 1_024
    ) {
      context.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: 3 * 1_024 * 1_024,
        inclusive: true,
        path: ['byteSize'],
        message: 'Partner logos must not exceed 3 MiB',
      });
    }
    if ((asset.status === 'ready') !== (asset.preview !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['preview'],
        message: 'Only ready assets must expose an authorized preview',
      });
    }
  });

export type AdminAssetDescriptor = z.infer<typeof adminAssetDescriptorSchema>;

export const adminAssetResolveRequestSchema = z.strictObject({
  eventId: uuidSchema,
  owner: adminAssetOwnerSchema,
  purpose: adminAssetPurposeSchema,
});

export const adminAssetResolveResponseSchema = z.strictObject({
  asset: adminAssetDescriptorSchema.nullable(),
  requestId: requestIdSchema,
});

export const adminAssetUploadRequestSchema = z
  .strictObject({
    eventId: uuidSchema,
    owner: adminAssetOwnerSchema,
    purpose: adminAssetPurposeSchema,
    fileName: safeText(255).refine(
      (value) => !/[\\/\u202A-\u202E\u2066-\u2069]/.test(value),
      'File name must not contain a path or directional controls',
    ),
    contentType: adminAssetContentTypeSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(5 * 1_024 * 1_024),
    altText: safeText(300),
    expectedOwnerVersion: versionSchema,
  })
  .superRefine((request, context) => {
    if (
      (request.owner.kind === 'speaker') !==
      (request.purpose === 'speaker_photo')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['purpose'],
        message: 'Asset purpose must match its content owner',
      });
    }
    if (
      request.purpose === 'partner_logo' &&
      request.byteSize > 3 * 1_024 * 1_024
    ) {
      context.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: 3 * 1_024 * 1_024,
        inclusive: true,
        path: ['byteSize'],
        message: 'Partner logos must not exceed 3 MiB',
      });
    }
  });

export const adminAssetUploadResponseSchema = z.strictObject({
  assetId: uuidSchema,
  uploadUrl: safeHttpsUrlSchema,
  expiresAt: dateTimeSchema,
  version: versionSchema,
  requestId: requestIdSchema,
});

export const adminAssetFinalizeRequestSchema = z.strictObject({
  eventId: uuidSchema,
  assetId: uuidSchema,
  expectedAssetVersion: versionSchema,
});

export const adminAssetRemoveRequestSchema = z.strictObject({
  eventId: uuidSchema,
  owner: adminAssetOwnerSchema,
  purpose: adminAssetPurposeSchema,
  expectedAssetVersion: versionSchema,
  expectedOwnerVersion: versionSchema,
});

export const adminAssetMutationResponseSchema = z.strictObject({
  asset: adminAssetDescriptorSchema.nullable(),
  ownerVersion: versionSchema,
  requestId: requestIdSchema,
});

export const adminAssetProblemSchemas = [
  defineApiProblemSchema('ADMIN_ASSET_NOT_FOUND', 404),
  defineApiProblemSchema('ADMIN_ASSET_INVALID_FILE', 422),
  defineApiProblemSchema('ADMIN_ASSET_STALE', 409),
  defineApiProblemSchema('ADMIN_ASSET_UPLOAD_EXPIRED', 409),
  defineApiProblemSchema('ADMIN_ASSET_STORAGE_UNAVAILABLE', 503),
] as const;

export const adminAssetProblemSchema = z.union(adminAssetProblemSchemas);

export const adminAssetCachePolicy = Object.freeze({
  descriptor: 'private, no-store',
  mutation: 'online-only',
  previewUrl: 'short-lived, never persisted',
  storageUrl: 'forbidden in API responses',
} as const);
