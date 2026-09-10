import { describe, expect, it } from 'vitest';
import {
  emptyProgramFilters,
  matchesProgramFilters,
} from './admin-program-filters';
import type { AdminContentItem } from './admin-content-api';
const session: AdminContentItem = {
  id: 's1',
  title: 'Lidskost a důvěra',
  dayId: 'd1',
  roomId: 'r1',
  speakerIds: ['p1'],
  type: 'talk',
  status: 'draft',
  publicationState: 'published',
  questionMode: 'moderated_follow_up',
  startsAt: '2026-09-18T08:00:00Z',
  endsAt: '2026-09-18T09:00:00Z',
};
const rooms = [{ id: 'r1', venueId: 'v1' }];
const match = (changes = {}, item = session) =>
  matchesProgramFilters(
    item,
    { ...emptyProgramFilters, ...changes },
    rooms,
    'Europe/Prague',
  );
describe('admin program filters', () => {
  it('combines title search without accents with reference and publication filters', () => {
    expect(
      match({
        title: 'DUVERA',
        dayId: 'd1',
        roomId: 'r1',
        venueId: 'v1',
        speakerId: 'p1',
        type: 'talk',
        status: 'draft',
        publicationState: 'published',
        questionMode: 'moderated_follow_up',
      }),
    ).toBe(true);
    expect(match({ title: 'duvera', speakerId: 'p2' })).toBe(false);
    expect(match({ publicationState: 'unpublished' })).toBe(false);
  });
  it('uses event-local times and inclusive bounds for starts and ends', () => {
    expect(
      match({
        startsFrom: '10:00',
        startsTo: '10:00',
        endsFrom: '11:00',
        endsTo: '11:00',
      }),
    ).toBe(true);
    expect(match({ startsFrom: '10:01' })).toBe(false);
    expect(match({ endsTo: '10:59' })).toBe(false);
  });
  it('supports missing speakers and rooms and resets to all items', () => {
    const without = { ...session, roomId: null, speakerIds: [] };
    expect(match({ roomId: '__none', speakerId: '__none' }, without)).toBe(
      true,
    );
    expect(match({ roomId: '__none' })).toBe(false);
    expect(match({}, without)).toBe(true);
  });
});
