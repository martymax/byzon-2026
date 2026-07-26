import { publicContentResponseSchema } from '@byzon/domain/contracts';
import {
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import { loadPublicOfflineContent } from './public-offline-content';

const fixture = publicContentResponseSchema.parse({
  ...participantContentFixtures.happy!.content,
  program: participantProgramFixtures.happy!.program,
  version: 3,
  publishedAt: '2026-07-24T08:00:00.000Z',
});

const json = (
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
) =>
  Response.json(body, {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });

describe('public offline content loader', () => {
  it('reports a correlated cached publication and its stale age', async () => {
    const fetch = vi.fn(async () =>
      json(fixture, {
        'x-byzon-cache-source': 'cache',
        'x-byzon-cache-stored-at': '2026-07-24T08:00:00.000Z',
        'x-byzon-event-id': fixture.event.id,
        'x-byzon-event-slug': fixture.event.slug,
        'x-byzon-publication-version': '3',
      }),
    );

    const result = await loadPublicOfflineContent('byzon-2026', {
      fetch,
      now: new Date('2026-07-24T08:06:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'ready',
      source: 'cache',
      freshness: 'stale',
      storedAt: '2026-07-24T08:00:00.000Z',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/public/events/byzon-2026/content',
      expect.objectContaining({
        cache: 'no-cache',
        credentials: 'omit',
      }),
    );
  });

  it('treats a direct network response as freshly verified', async () => {
    const result = await loadPublicOfflineContent('byzon-2026', {
      fetch: async () => json(fixture),
      now: new Date('2026-07-25T10:30:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'ready',
      source: 'network',
      freshness: 'fresh',
      storedAt: '2026-07-25T10:30:00.000Z',
    });
  });

  it('rejects mismatched or incomplete cache metadata', async () => {
    await expect(
      loadPublicOfflineContent('byzon-2026', {
        fetch: async () =>
          json(fixture, {
            'x-byzon-cache-source': 'cache',
            'x-byzon-cache-stored-at': '2026-07-24T08:00:00.000Z',
            'x-byzon-event-id': fixture.event.id,
            'x-byzon-event-slug': fixture.event.slug,
            'x-byzon-publication-version': '4',
          }),
      }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });

    await expect(
      loadPublicOfflineContent('byzon-2026', {
        fetch: async () => json(fixture, { 'x-byzon-cache-source': 'cache' }),
      }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('rejects a body or service-worker metadata outside the requested event slug', async () => {
    const otherSlug = {
      ...fixture,
      event: { ...fixture.event, slug: 'other-event' },
    };
    for (const response of [
      json(otherSlug),
      json(fixture, {
        'x-byzon-cache-source': 'cache',
        'x-byzon-cache-stored-at': '2026-07-24T08:00:00.000Z',
        'x-byzon-event-id': '01930000-0000-7000-8000-000000000099',
        'x-byzon-event-slug': fixture.event.slug,
        'x-byzon-publication-version': String(fixture.version),
      }),
      json(fixture, {
        'x-byzon-cache-source': 'network',
        'x-byzon-event-id': fixture.event.id,
        'x-byzon-event-slug': 'other-event',
        'x-byzon-publication-version': String(fixture.version),
      }),
    ]) {
      await expect(
        loadPublicOfflineContent('byzon-2026', {
          fetch: async () => response.clone(),
        }),
      ).resolves.toEqual({
        status: 'unavailable',
        reason: 'invalid_response',
      });
    }
  });

  it('keeps not-found, server and transport failures distinct', async () => {
    await expect(
      loadPublicOfflineContent('byzon-2026', {
        fetch: async () => json({}, {}, 404),
      }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_found' });
    await expect(
      loadPublicOfflineContent('byzon-2026', {
        fetch: async () => json({}, {}, 503),
      }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'server' });
    await expect(
      loadPublicOfflineContent('byzon-2026', {
        fetch: async () => {
          throw new TypeError('offline');
        },
      }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'offline' });
  });
});
