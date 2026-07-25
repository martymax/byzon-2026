import { participantAgendaFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import {
  agendaOfferIntents,
  formatAgendaLocalDate,
  formatOfferCountdown,
  groupParticipantAgendaByDay,
  participantAgendaActions,
  participantAgendaCapacityCopy,
  participantAgendaItemStatus,
  remainingOfferSeconds,
  selectNextParticipantAgendaItem,
} from './participant-agenda-model';

const onlyItem = (
  fixture: NonNullable<
    (typeof participantAgendaFixtures)[keyof typeof participantAgendaFixtures]
  >,
) => {
  const item = fixture.items[0];
  if (!item) throw new TypeError('Agenda fixture must contain one item.');
  return item;
};

describe('participant agenda view model', () => {
  it('groups the canonical ordered snapshot by event-local day', () => {
    const groups = groupParticipantAgendaByDay(
      participantAgendaFixtures.happy!.items,
    );

    expect(
      groups.map(({ localDate, items }) => [localDate, items.length]),
    ).toEqual([
      ['2026-09-18', 1],
      ['2026-09-19', 2],
    ]);
    expect(groups[1]?.items.map(({ state }) => state)).toEqual([
      'reserved',
      'waitlisted',
    ]);
  });

  it('selects only the next canonical non-cancelled item', () => {
    expect(
      selectNextParticipantAgendaItem(
        participantAgendaFixtures.happy!,
        '2026-09-18T06:30:00.000Z',
      )?.session.title,
    ).toBe('Otevření konference');
    expect(
      selectNextParticipantAgendaItem(
        participantAgendaFixtures.cancelled!,
        '2026-09-18T06:30:00.000Z',
      ),
    ).toBeNull();
    expect(
      selectNextParticipantAgendaItem(
        participantAgendaFixtures.happy!,
        'not-a-time',
      ),
    ).toBeNull();
  });

  it('describes saved, reserved and every waitlist state with text', () => {
    expect(
      participantAgendaItemStatus(onlyItem(participantAgendaFixtures.saved!))
        .label,
    ).toBe('Uloženo');
    expect(
      participantAgendaItemStatus(onlyItem(participantAgendaFixtures.reserved!))
        .label,
    ).toBe('Rezervováno');
    expect(
      participantAgendaItemStatus(onlyItem(participantAgendaFixtures.waiting!)),
    ).toMatchObject({
      label: 'Čekací listina',
      detail: 'Aktuální pořadí: 3.',
    });
    expect(
      participantAgendaItemStatus(onlyItem(participantAgendaFixtures.offered!))
        .label,
    ).toBe('Nabídnuté místo');
    expect(
      participantAgendaItemStatus(onlyItem(participantAgendaFixtures.expired!))
        .label,
    ).toBe('Nabídka vypršela');
    expect(
      participantAgendaItemStatus(
        onlyItem(participantAgendaFixtures.waitlist_cancelled!),
      ).label,
    ).toBe('Čekání ukončeno');
    expect(
      participantAgendaItemStatus(
        onlyItem(participantAgendaFixtures.cancelled!),
      ).label,
    ).toBe('Zrušeno');
  });

  it('builds explicit canonical mutation intents without a local toggle contract', () => {
    expect(
      participantAgendaActions(onlyItem(participantAgendaFixtures.reserved!)),
    ).toEqual([
      {
        label: 'Zrušit rezervaci',
        intent: {
          action: 'cancel',
          sessionId: participantAgendaFixtures.reserved!.items[0]!.session.id,
        },
        variant: 'secondary',
      },
    ]);
    expect(
      participantAgendaActions(
        onlyItem(participantAgendaFixtures.registration_estimate!),
      )[0]?.intent,
    ).toMatchObject({
      action: 'registration_estimate',
      registered: false,
    });

    const offered = onlyItem(participantAgendaFixtures.offered!);
    const intents = agendaOfferIntents(offered);
    expect(intents?.accept).toMatchObject({
      action: 'accept_offer',
      offerId:
        offered.state === 'waitlisted' && offered.waitlist.state === 'offered'
          ? offered.waitlist.offerId
          : '',
    });
    expect(intents?.decline).toMatchObject({
      action: 'decline_offer',
      offerId:
        offered.state === 'waitlisted' && offered.waitlist.state === 'offered'
          ? offered.waitlist.offerId
          : '',
    });
  });

  it('does not describe held capacity as a generally free place', () => {
    const copy = participantAgendaCapacityCopy(
      onlyItem(participantAgendaFixtures.offered!),
    );
    expect(copy).toContain('drží místo pro tento účet');
    expect(copy).toContain('Rezervace vznikne až přijetím nabídky');

    const fullCopy = participantAgendaCapacityCopy(
      onlyItem(participantAgendaFixtures.full!),
    );
    expect(fullCopy).toContain('0 míst');
  });

  it('describes a confirmed last-seat reservation before generic full capacity', () => {
    const reserved = onlyItem(participantAgendaFixtures.reserved!);
    if (reserved.capacity.mode !== 'reservation') {
      throw new TypeError('Reserved fixture must expose reservation capacity.');
    }
    const copy = participantAgendaCapacityCopy({
      ...reserved,
      action: { state: 'capacity_full' },
      capacity: {
        ...reserved.capacity,
        remaining: 0,
        waitlistAvailable: true,
      },
    });

    expect(copy).toContain('Rezervace je potvrzená');
    expect(copy).toContain('0 dalších míst');
    expect(copy).not.toContain('Můžete požádat');
  });

  it('does not invite an already-waiting participant to join again', () => {
    const copy = participantAgendaCapacityCopy(
      onlyItem(participantAgendaFixtures.waiting!),
    );

    expect(copy).toContain('V čekací listině už jste');
    expect(copy).toContain('3. místě');
    expect(copy).not.toContain('Můžete požádat');
  });

  it('derives a stable countdown from server time and monotonic elapsed time', () => {
    expect(
      remainingOfferSeconds(
        '2026-09-18T06:30:00.000Z',
        '2026-09-18T06:45:00.000Z',
        1_500,
      ),
    ).toBe(899);
    expect(
      remainingOfferSeconds(
        '2026-09-18T06:30:00.000Z',
        '2026-09-18T06:45:00.000Z',
        900_001,
      ),
    ).toBe(0);
    expect(formatOfferCountdown(899)).toBe('00:14:59');
  });

  it('formats an event-local calendar date without applying a timezone twice', () => {
    expect(formatAgendaLocalDate('2026-09-18')).toContain('18.');
    expect(formatAgendaLocalDate('2026-09-18')).not.toContain('19.');
  });
});
