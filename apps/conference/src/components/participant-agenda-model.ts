import type {
  AgendaMutationAction,
  ParticipantAgendaItem,
  ParticipantAgendaResponse,
} from '@byzon/domain/contracts';

export interface ParticipantAgendaDayGroup {
  readonly localDate: string;
  readonly title: string;
  readonly items: readonly ParticipantAgendaItem[];
}

export type AgendaItemStatusTone = 'danger' | 'info' | 'success' | 'warning';

export interface AgendaItemStatusCopy {
  readonly detail: string;
  readonly label: string;
  readonly tone: AgendaItemStatusTone;
}

export type AgendaSimpleMutationIntent = {
  readonly action: Exclude<
    AgendaMutationAction,
    'accept_offer' | 'decline_offer'
  >;
  readonly sessionId: string;
};

export type AgendaOfferMutationIntent = {
  readonly action: 'accept_offer' | 'decline_offer';
  readonly offerId: string;
  readonly sessionId: string;
};

export type AgendaMutationIntent =
  AgendaOfferMutationIntent | AgendaSimpleMutationIntent;

export interface AgendaItemAction {
  readonly intent: AgendaMutationIntent;
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'quiet';
}

const itemStart = (item: ParticipantAgendaItem): number =>
  Date.parse(item.session.startsAt);

export const groupParticipantAgendaByDay = (
  items: readonly ParticipantAgendaItem[],
): readonly ParticipantAgendaDayGroup[] => {
  const groups = new Map<string, ParticipantAgendaDayGroup>();
  for (const item of items) {
    const current = groups.get(item.day.localDate);
    if (current) {
      groups.set(item.day.localDate, {
        ...current,
        items: [...current.items, item],
      });
      continue;
    }
    groups.set(item.day.localDate, {
      localDate: item.day.localDate,
      title: item.day.title,
      items: [item],
    });
  }
  return [...groups.values()];
};

export const selectNextParticipantAgendaItem = (
  agenda: Pick<ParticipantAgendaResponse, 'items'>,
  now: string,
): ParticipantAgendaItem | null => {
  const current = Date.parse(now);
  if (!Number.isFinite(current)) return null;
  return (
    agenda.items.find(
      (item) =>
        item.session.status === 'published' &&
        Number.isFinite(itemStart(item)) &&
        Date.parse(item.session.endsAt) > current,
    ) ?? null
  );
};

export const participantAgendaItemStatus = (
  item: ParticipantAgendaItem,
): AgendaItemStatusCopy => {
  if (
    item.session.status === 'cancelled' ||
    item.action.state === 'cancelled'
  ) {
    return {
      label: 'Zrušeno',
      detail: 'Organizátor tento bod programu zrušil.',
      tone: 'danger',
    };
  }

  if (item.state === 'reserved') {
    return {
      label: 'Rezervováno',
      detail: 'Rezervaci potvrdil server.',
      tone: 'success',
    };
  }

  if (item.state === 'waitlisted') {
    switch (item.waitlist.state) {
      case 'waiting':
        return {
          label: 'Čekací listina',
          detail: `Aktuální pořadí: ${item.waitlist.position}.`,
          tone: 'warning',
        };
      case 'offered':
        return {
          label: 'Nabídnuté místo',
          detail:
            'Místo je dočasně držené pro vás. Potvrďte nebo odmítněte nabídku před vypršením času.',
          tone: 'warning',
        };
      case 'expired':
        return {
          label: 'Nabídka vypršela',
          detail:
            'Předchozí nabídku už nelze potvrdit. Další možnost určí aktuální stav serveru.',
          tone: 'danger',
        };
      case 'cancelled':
        return {
          label: 'Čekání ukončeno',
          detail: 'V čekací listině už nejste.',
          tone: 'info',
        };
    }
  }

  return {
    label: 'Uloženo',
    detail:
      item.source === 'organizer'
        ? 'Bod přidal do osobní agendy organizátor.'
        : 'Bod je uložený v osobní agendě.',
    tone: 'info',
  };
};

export const participantAgendaCapacityCopy = (
  item: ParticipantAgendaItem,
): string | null => {
  if (item.session.status === 'cancelled') return null;
  if (item.capacity.mode === 'none') return null;
  if (item.state === 'reserved') {
    const held =
      item.capacity.held > 0
        ? ` Dalších ${item.capacity.held} míst je dočasně drženo v nabídkách.`
        : '';
    return `Rezervace je potvrzená. Poslední stav serveru: ${item.capacity.remaining} dalších míst k okamžité rezervaci.${held}`;
  }
  if (item.action.state === 'closed') {
    return 'Rezervace jsou uzavřené.';
  }
  if (item.state === 'waitlisted' && item.waitlist.state === 'waiting') {
    return item.capacity.remaining === 0
      ? `K okamžité rezervaci zbývá 0 míst. V čekací listině už jste na ${item.waitlist.position}. místě; není potřeba žádat znovu.`
      : `Volná kapacita: ${item.capacity.remaining}. V čekací listině zůstáváte na ${item.waitlist.position}. místě a čekáte na zpracování serverem; není potřeba žádat znovu.`;
  }
  if (item.action.state === 'capacity_full') {
    const held =
      item.capacity.held > 0
        ? ` ${item.capacity.held} míst je dočasně drženo v nabídkách.`
        : '';
    return item.capacity.waitlistAvailable
      ? `K okamžité rezervaci zbývá 0 míst.${held} Můžete požádat o zařazení do čekací listiny.`
      : `K okamžité rezervaci zbývá 0 míst.${held} Čekací listina není dostupná.`;
  }
  if (item.state === 'waitlisted' && item.waitlist.state === 'offered') {
    return `Server drží místo pro tento účet. Další okamžitě dostupná kapacita: ${item.capacity.remaining}. Rezervace vznikne až přijetím nabídky.`;
  }
  const held =
    item.capacity.held > 0
      ? ` Dalších ${item.capacity.held} míst je dočasně drženo v nabídkách.`
      : '';
  return `Poslední stav serveru: ${item.capacity.remaining} míst k okamžité rezervaci.${held} Rezervaci potvrdí až další odpověď serveru.`;
};

export const participantAgendaActions = (
  item: ParticipantAgendaItem,
): readonly AgendaItemAction[] => {
  const sessionId = item.session.id;
  if (
    item.session.status === 'cancelled' ||
    item.action.state === 'cancelled'
  ) {
    return item.state === 'saved'
      ? [
          {
            label: 'Odebrat z agendy',
            intent: { action: 'remove', sessionId },
            variant: 'quiet',
          },
        ]
      : [];
  }

  if (item.state === 'reserved') {
    if (item.reservation.cancellation?.state === 'unavailable') return [];
    return [
      {
        label: 'Zrušit rezervaci',
        intent: { action: 'cancel', sessionId },
        variant: 'secondary',
      },
    ];
  }

  if (item.state === 'waitlisted') {
    if (item.waitlist.actionsAvailable === false) return [];
    if (item.waitlist.state === 'waiting') {
      return [
        {
          label: 'Opustit čekací listinu',
          intent: { action: 'leave_waitlist', sessionId },
          variant: 'secondary',
        },
      ];
    }
    if (item.waitlist.state === 'offered') return [];
    if (
      item.action.state === 'capacity_full' &&
      item.capacity.mode === 'reservation' &&
      item.capacity.waitlistAvailable
    ) {
      return [
        {
          label: 'Znovu do čekací listiny',
          intent: { action: 'join_waitlist', sessionId },
          variant: 'primary',
        },
      ];
    }
    if (item.action.state === 'available') {
      return [
        {
          label: 'Rezervovat místo',
          intent: { action: 'reserve', sessionId },
          variant: 'primary',
        },
      ];
    }
    return [];
  }

  const actions: AgendaItemAction[] = [];
  if (item.action.state === 'available') {
    if (item.capacity.mode === 'reservation') {
      actions.push({
        label: 'Rezervovat místo',
        intent: { action: 'reserve', sessionId },
        variant: 'primary',
      });
    }
  } else if (
    item.action.state === 'capacity_full' &&
    item.capacity.mode === 'reservation' &&
    item.capacity.waitlistAvailable
  ) {
    actions.push({
      label: 'Přidat se na čekací listinu',
      intent: { action: 'join_waitlist', sessionId },
      variant: 'primary',
    });
  }
  actions.push({
    label: 'Odebrat z agendy',
    intent: { action: 'remove', sessionId },
    variant: 'quiet',
  });
  return actions;
};

export const agendaOfferIntents = (
  item: ParticipantAgendaItem,
): {
  readonly accept: AgendaOfferMutationIntent;
  readonly decline: AgendaOfferMutationIntent;
} | null => {
  if (
    item.state !== 'waitlisted' ||
    item.waitlist.state !== 'offered' ||
    item.waitlist.actionsAvailable === false
  ) {
    return null;
  }
  return {
    accept: {
      action: 'accept_offer',
      offerId: item.waitlist.offerId,
      sessionId: item.session.id,
    },
    decline: {
      action: 'decline_offer',
      offerId: item.waitlist.offerId,
      sessionId: item.session.id,
    },
  };
};

export const remainingOfferSeconds = (
  serverNow: string,
  expiresAt: string,
  elapsedMilliseconds: number,
): number => {
  const baseline = Date.parse(serverNow);
  const expiry = Date.parse(expiresAt);
  if (
    !Number.isFinite(baseline) ||
    !Number.isFinite(expiry) ||
    !Number.isFinite(elapsedMilliseconds)
  ) {
    return 0;
  }
  return Math.max(
    0,
    Math.ceil((expiry - baseline - Math.max(0, elapsedMilliseconds)) / 1000),
  );
};

export const formatOfferCountdown = (seconds: number): string => {
  const bounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const remainingSeconds = bounded % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

export const formatAgendaLocalDate = (localDate: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
    }).format(new Date(`${localDate}T12:00:00Z`));
  } catch {
    return localDate;
  }
};
