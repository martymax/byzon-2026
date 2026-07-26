import { describe, expect, it } from 'vitest';
import {
  checksumSnapshot,
  detectSignificantProgramChanges,
  parseContentPublicationSnapshot,
  requirePublicationChanges,
} from './content-publication';

const emptySnapshot = {
  event: {
    endsAt: '2026-09-20T18:00:00.000Z',
    id: '019fca00-0000-7000-8000-000000000001',
    name: 'BYZON 2026',
    slug: 'byzon-2026',
    startsAt: '2026-09-18T06:00:00.000Z',
    timezone: 'Europe/Prague',
  },
  partners: [],
  practical: { faqs: [], pages: [] },
  program: { days: [], rooms: [], sessions: [] },
  speakers: [],
  venues: [],
};

describe('content publication projection', () => {
  it('hashes equivalent objects deterministically regardless of key insertion order', () => {
    expect(checksumSnapshot({ b: 2, a: { d: 4, c: 3 } })).toBe(
      checksumSnapshot({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
  it('targets removed sessions and sessions affected by a renamed room', () => {
    const previous = {
      program: {
        rooms: [{ id: 'room', name: 'Old', venueId: 'venue' }],
        sessions: [
          {
            id: 'kept',
            roomId: 'room',
            startsAt: 'a',
            endsAt: 'b',
            status: 'published',
          },
          {
            id: 'removed',
            roomId: null,
            startsAt: 'a',
            endsAt: 'b',
            status: 'published',
          },
        ],
      },
    };
    const current = {
      program: {
        rooms: [{ id: 'room', name: 'New', venueId: 'venue' }],
        sessions: [
          {
            id: 'kept',
            roomId: 'room',
            startsAt: 'a',
            endsAt: 'b',
            status: 'published',
          },
        ],
      },
    };
    expect(detectSignificantProgramChanges(previous, current)).toEqual([
      'kept',
      'removed',
    ]);
  });

  it('turns a non-publishable field into an actionable invalid-draft error', () => {
    expect(() =>
      parseContentPublicationSnapshot({
        ...emptySnapshot,
        partners: [
          {
            category: null,
            descriptionMarkdown: null,
            id: '019fca00-0000-7000-8000-000000000002',
            logoAssetId: null,
            name: 'Partner',
            slug: 'partner',
            sortOrder: 0,
            status: 'published',
            tier: null,
            version: 1,
            websiteUrl: 'http://user:secret@example.test',
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_DRAFT',
        issues: expect.arrayContaining([
          expect.stringContaining('partners.0.websiteUrl'),
        ]),
      }),
    );
  });

  it('rejects an unchanged draft before another publication version is made', () => {
    expect(() => requirePublicationChanges('abc', 'abc')).toThrow(
      expect.objectContaining({ code: 'NO_CHANGES' }),
    );
    expect(() => requirePublicationChanges('abc', 'def')).not.toThrow();
    expect(() => requirePublicationChanges(null, 'abc')).not.toThrow();
  });
});
