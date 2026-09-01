import {
  adminAssetMutationResponseSchema,
  adminAssetResolveResponseSchema,
  adminPublicationSummarySchema,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const adminContentFixtureIds = Object.freeze({
  event: '019fc900-0000-7000-8000-000000000001',
  speaker: '019fc900-0000-7000-8000-000000000002',
  partner: '019fc900-0000-7000-8000-000000000003',
  speakerAsset: '019fc900-0000-7000-8000-000000000004',
} as const);

const speakerAsset = {
  assetId: adminContentFixtureIds.speakerAsset,
  eventId: adminContentFixtureIds.event,
  owner: { kind: 'speaker' as const, id: adminContentFixtureIds.speaker },
  purpose: 'speaker_photo' as const,
  contentType: 'image/webp' as const,
  byteSize: 84_000,
  altText: 'Portrét syntetického řečníka Alexe Nováka',
  version: 2,
  status: 'ready' as const,
  preview: {
    url: 'https://preview.example.test/assets/speaker-short-lived',
    expiresAt: '2026-09-02T12:05:00.000+02:00',
    width: 800,
    height: 800,
  },
};

export const adminAssetResolveFixtures = defineFixtureSet({
  name: 'admin-content.asset-resolve',
  schema: adminAssetResolveResponseSchema,
  fixtures: {
    ready: {
      asset: speakerAsset,
      requestId: 'asset-resolve-preview-0001',
    },
    empty: {
      asset: null,
      requestId: 'asset-resolve-preview-0002',
    },
  },
});

export const adminAssetMutationFixtures = defineFixtureSet({
  name: 'admin-content.asset-mutation',
  schema: adminAssetMutationResponseSchema,
  fixtures: {
    replaced: {
      asset: speakerAsset,
      ownerVersion: 3,
      requestId: 'asset-mutation-preview-0001',
    },
    removed: {
      asset: null,
      ownerVersion: 4,
      requestId: 'asset-mutation-preview-0002',
    },
  },
});

export const adminPublicationSummaryFixtures = defineFixtureSet({
  name: 'admin-content.publication-summary',
  schema: adminPublicationSummarySchema,
  fixtures: {
    changed: {
      available: true,
      changeCount: 2,
      changes: [
        {
          kind: 'updated',
          resource: 'sessions',
          title: 'Růst bez zkratek',
          impact: ['time', 'location'],
        },
        {
          kind: 'added',
          resource: 'faqs',
          title: 'Kde najdu registraci?',
          impact: ['content'],
        },
      ],
      previousPublication: {
        version: 2,
        publishedAt: '2026-09-01T17:20:00.000+02:00',
      },
    },
    unavailable: {
      available: false,
      changeCount: null,
      changes: [],
      previousPublication: null,
    },
  },
});
