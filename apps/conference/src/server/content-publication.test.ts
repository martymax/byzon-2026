import { describe, expect, it } from 'vitest';
import {
  checksumSnapshot,
  detectSignificantProgramChanges,
} from './content-publication';
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
});
