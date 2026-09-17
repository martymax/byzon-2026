import { describe, expect, it } from 'vitest';
import type { AdminInvitationRecipient } from '@byzon/domain/contracts';
import {
  filterInvitationRecipients,
  selectVisibleRecipients,
} from './admin-invitations-model';

const person = (index: number): AdminInvitationRecipient => ({
  userId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  displayName: index === 1 ? 'Kateřina Novotná' : `Osoba ${index}`,
  email: `person${index}@example.test`,
  roles: index === 1 ? ['participant', 'speaker'] : ['organizer_admin'],
  invitation: { status: 'not_sent', lastSentAt: null },
  delivery: index === 1 ? 'participant' : 'team',
});

describe('invitation recipient selection', () => {
  it('combines roles with OR, matches names without accents and returns a person once', () => {
    expect(
      filterInvitationRecipients(
        [person(1), person(2)],
        new Set(['participant', 'speaker']),
        'katerina',
        'not_sent',
      ),
    ).toEqual([person(1)]);
    expect(
      filterInvitationRecipients([person(1)], new Set(), '', 'sent'),
    ).toEqual([]);
    expect(
      filterInvitationRecipients(
        [person(1), person(2)],
        new Set(),
        'PERSON2@',
        'all',
      ),
    ).toEqual([person(2)]);
  });
  it('selects and deselects only the visible recipients while preserving other roles', () => {
    const selected = selectVisibleRecipients(
      new Set(['hidden']),
      ['a', 'b'],
      true,
    );
    expect([...selected]).toEqual(['hidden', 'a', 'b']);
    expect([...selectVisibleRecipients(selected, ['a', 'b'], false)]).toEqual([
      'hidden',
    ]);
  });
});
