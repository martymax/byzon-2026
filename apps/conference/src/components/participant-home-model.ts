import type {
  ParticipantProgramResponse,
  PublishedProgramSession,
} from '@byzon/domain/contracts';

export type ParticipantEventPhase =
  'draft' | 'activation_open' | 'live' | 'ended' | 'archived';

export interface ParticipantHomeEvent {
  readonly endsAt: string;
  readonly id: string;
  readonly phase: ParticipantEventPhase;
  readonly startsAt: string;
  readonly timezone: string;
}

export const participantHomePhaseCopy: Record<
  ParticipantEventPhase,
  {
    readonly cta: string | null;
    readonly detail: string;
    readonly eyebrow: string;
    readonly title: string;
  }
> = {
  draft: {
    eyebrow: 'Přehled',
    title: 'Akce se připravuje',
    detail:
      'Účastnický přehled se otevře, jakmile organizátor zpřístupní publikovaný program.',
    cta: null,
  },
  activation_open: {
    eyebrow: 'Před akcí',
    title: 'Připravte se na BYZON',
    detail:
      'Projděte si publikovaný program a praktické informace před příjezdem.',
    cta: 'Prohlédnout program',
  },
  live: {
    eyebrow: 'Průběh akce',
    title: 'Dnes na BYZON',
    detail:
      'Nejdůležitější body podle publikovaného programu, bez odhadovaného živého stavu.',
    cta: 'Otevřít celý program',
  },
  ended: {
    eyebrow: 'Po akci',
    title: 'Děkujeme, že jste byli u toho',
    detail:
      'Publikovaný program a praktické informace zůstávají dostupné k prohlédnutí.',
    cta: 'Prohlédnout program',
  },
  archived: {
    eyebrow: 'Archiv',
    title: 'Tato akce už je uzavřená',
    detail:
      'Účastnický obsah už není dostupný. Relace ani nastavení soukromí se z archivovaných dat neobnovují.',
    cta: null,
  },
};

export const parseParticipantHomeDate = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const localDateKey = (value: string, timezone: string): string | null => {
  const date = parseParticipantHomeDate(value);
  if (!date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone,
      year: 'numeric',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
};

const sessionStart = (session: PublishedProgramSession): number =>
  parseParticipantHomeDate(session.startsAt)?.getTime() ??
  Number.POSITIVE_INFINITY;

export const selectHomeProgramSessions = ({
  now,
  phase,
  program,
  timezone,
}: {
  readonly now: string;
  readonly phase: ParticipantEventPhase;
  readonly program: ParticipantProgramResponse['program'];
  readonly timezone: string;
}): readonly PublishedProgramSession[] => {
  const nowDate = parseParticipantHomeDate(now);
  if (!nowDate || (phase !== 'activation_open' && phase !== 'live')) {
    return [];
  }

  const available = program.sessions
    .filter(({ status }) => status !== 'cancelled')
    .sort((left, right) => sessionStart(left) - sessionStart(right));

  if (phase === 'activation_open') {
    return available
      .filter(
        ({ endsAt }) =>
          (parseParticipantHomeDate(endsAt)?.getTime() ?? 0) >
          nowDate.getTime(),
      )
      .slice(0, 2);
  }

  const today = localDateKey(now, timezone);
  if (!today) return [];
  const todayDayIds = new Set(
    program.days
      .filter(({ localDate }) => localDate === today)
      .map(({ id }) => id),
  );
  return available
    .filter(
      ({ dayId, endsAt }) =>
        todayDayIds.has(dayId) &&
        (parseParticipantHomeDate(endsAt)?.getTime() ?? 0) > nowDate.getTime(),
    )
    .slice(0, 2);
};
