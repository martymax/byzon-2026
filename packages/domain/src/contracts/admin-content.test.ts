import { describe, expect, it } from 'vitest';

import {
  adminAssetCachePolicy,
  adminAssetDescriptorSchema,
  adminAssetUploadRequestSchema,
  adminPublicationSummarySchema,
} from './admin-content.js';

const eventId = '019fc900-0000-7000-8000-000000000001';
const ownerId = '019fc900-0000-7000-8000-000000000002';

describe('admin content UX contracts', () => {
  it('requires authoritative publication count to match title-level changes', () => {
    expect(
      adminPublicationSummarySchema.safeParse({
        available: true,
        changeCount: 2,
        changes: [
          {
            kind: 'updated',
            resource: 'sessions',
            title: 'Růst bez zkratek',
            impact: ['time', 'location'],
          },
        ],
        previousPublication: null,
      }).success,
    ).toBe(false);
  });

  it('binds asset purpose, owner, type and purpose-specific size', () => {
    const base = {
      eventId,
      owner: { kind: 'partner' as const, id: ownerId },
      purpose: 'partner_logo' as const,
      fileName: 'partner.webp',
      contentType: 'image/webp' as const,
      byteSize: 2_000_000,
      altText: 'Logo partnera Example',
      expectedOwnerVersion: 2,
    };
    expect(adminAssetUploadRequestSchema.safeParse(base).success).toBe(true);
    expect(
      adminAssetUploadRequestSchema.safeParse({
        ...base,
        purpose: 'speaker_photo',
      }).success,
    ).toBe(false);
    expect(
      adminAssetUploadRequestSchema.safeParse({
        ...base,
        byteSize: 4_000_000,
      }).success,
    ).toBe(false);
    expect(
      adminAssetUploadRequestSchema.safeParse({
        ...base,
        fileName: '../partner.webp',
      }).success,
    ).toBe(false);
  });

  it('accepts only short-lived HTTPS previews without a storage URL field', () => {
    const descriptor = adminAssetDescriptorSchema.parse({
      assetId: '019fc900-0000-7000-8000-000000000003',
      eventId,
      owner: { kind: 'speaker', id: ownerId },
      purpose: 'speaker_photo',
      contentType: 'image/jpeg',
      byteSize: 42_000,
      altText: 'Portrét Alexe Nováka',
      version: 1,
      status: 'ready',
      preview: {
        url: 'https://preview.example.test/short-lived-token',
        expiresAt: '2026-09-02T12:05:00.000+02:00',
        width: 800,
        height: 800,
      },
    });
    expect(descriptor).not.toHaveProperty('storageUrl');
    expect(adminAssetCachePolicy.storageUrl).toContain('forbidden');
    expect(
      adminAssetDescriptorSchema.safeParse({
        ...descriptor,
        preview: {
          ...descriptor.preview!,
          url: 'https://user:secret@preview.example.test/image',
        },
      }).success,
    ).toBe(false);
    expect(() =>
      adminAssetDescriptorSchema.safeParse({
        ...descriptor,
        preview: { ...descriptor.preview!, url: 'not a URL' },
      }),
    ).not.toThrow();
    expect(
      adminAssetDescriptorSchema.safeParse({
        ...descriptor,
        owner: { kind: 'partner', id: ownerId },
      }).success,
    ).toBe(false);
    expect(
      adminAssetDescriptorSchema.safeParse({
        ...descriptor,
        status: 'processing',
      }).success,
    ).toBe(false);
  });
});
