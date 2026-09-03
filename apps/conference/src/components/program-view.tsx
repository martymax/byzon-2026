'use client';

import type { ParticipantProgramResponse } from '@byzon/domain/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';

import {
  EmptyContent,
  ResourceStatus,
  useParticipantProgram,
} from './content-state';
import { SessionRating } from './live-interactions';
import {
  ParticipantProgramSchedule,
  participantProgramDateLabel,
} from './participant-program-schedule';
import { ParticipantSessionCalendarExport } from './participant-session-calendar-export';
import { ParticipantSessionAgendaAction } from './participant-session-agenda-action';

const time = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const PROGRAM_FILTER_KEY = 'byzon.program.filters';
const programScrollKey = (eventId: string) => `byzon.program.scroll.${eventId}`;

interface ProgramPreferences {
  readonly day: string;
}

const readSessionValue = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSessionValue = (key: string, value: string): void => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Continuity is an enhancement; unavailable storage must not block content.
  }
};

const readProgramPreferences = (): ProgramPreferences => {
  if (typeof window === 'undefined') return { day: '' };
  const query = new URL(window.location.href).searchParams;
  const stored = readSessionValue(PROGRAM_FILTER_KEY);
  let storedQuery = new URLSearchParams();
  if (stored) {
    try {
      storedQuery = new URLSearchParams(stored);
    } catch {
      storedQuery = new URLSearchParams();
    }
  }
  const day = query.get('day') ?? storedQuery.get('day') ?? undefined;
  return day && day.length <= 128 ? { day } : { day: '' };
};

const useProgramContinuity = (
  eventId: string,
  data: ParticipantProgramResponse | null,
) => {
  const [preferences, setPreferences] = useState(readProgramPreferences);
  const restoredScroll = useRef(false);
  const day =
    data &&
    preferences.day &&
    !data.program.days.some(({ id }) => id === preferences.day)
      ? ''
      : preferences.day;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams();
    if (day) query.set('day', day);
    writeSessionValue(PROGRAM_FILTER_KEY, query.toString());

    const url = new URL(window.location.href);
    if (day) url.searchParams.set('day', day);
    else url.searchParams.delete('day');
    url.searchParams.delete('type');
    try {
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // A locked-down embed may forbid history writes; filtering still works.
    }
  }, [day]);

  const rememberScroll = useCallback(() => {
    writeSessionValue(
      programScrollKey(eventId),
      String(Math.max(0, Math.round(window.scrollY))),
    );
  }, [eventId]);

  useEffect(() => {
    window.addEventListener('pagehide', rememberScroll);
    return () => window.removeEventListener('pagehide', rememberScroll);
  }, [rememberScroll]);

  useEffect(() => {
    if (!data || restoredScroll.current) return;
    const frame = window.requestAnimationFrame(() => {
      const stored = readSessionValue(programScrollKey(eventId));
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000) {
          window.scrollTo({ top: value });
        }
      }
      restoredScroll.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, eventId]);

  return {
    day,
    setDay: (day: string) => setPreferences((current) => ({ ...current, day })),
    rememberScroll,
  };
};

const sessionHref = (
  session: ParticipantProgramResponse['program']['sessions'][number],
  preferences: ProgramPreferences,
): string => {
  const query = new URLSearchParams();
  if (preferences.day) query.set('day', preferences.day);
  if (session.type === 'coaching') query.set('coaching', 'choose');
  const suffix = query.toString();
  return `/app/program/${session.id}${suffix ? `?${suffix}` : ''}`;
};

const weekday = (localDate: string): string => {
  const label = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(`${localDate}T00:00:00Z`));
  return `${label.charAt(0).toLocaleUpperCase('cs-CZ')}${label.slice(1)}`;
};

type ProgramSession = ParticipantProgramResponse['program']['sessions'][number];
type ProgramRoom = ParticipantProgramResponse['program']['rooms'][number];

const coachingCoachName = (
  session: ProgramSession,
  rooms: readonly ProgramRoom[],
): string => {
  const titleMatch = /^Koučink\s*[–—-]\s*(.+)$/iu.exec(session.title.trim());
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const room = rooms.find(({ id }) => id === session.roomId);
  const roomMatch = /Koučovací zóna\s*[·–—-]\s*(.+)$/iu.exec(room?.name ?? '');
  return roomMatch?.[1]?.trim() || 'Kouč bude upřesněn';
};

const CoachingSlotChoice = ({
  agendaApi,
  eventId,
  initialSessionId,
  rooms,
  sessions,
  showAgendaAction,
}: {
  readonly agendaApi?: ApiPort;
  readonly eventId: string;
  readonly initialSessionId: string | null;
  readonly rooms: readonly ProgramRoom[];
  readonly sessions: readonly ProgramSession[];
  readonly showAgendaAction: boolean;
}) => {
  const availableSessions = useMemo(
    () =>
      [...sessions].sort((first, second) =>
        coachingCoachName(first, rooms).localeCompare(
          coachingCoachName(second, rooms),
          'cs-CZ',
        ),
      ),
    [rooms, sessions],
  );
  const [selectedId, setSelectedId] = useState(() =>
    initialSessionId &&
    availableSessions.some(({ id }) => id === initialSessionId)
      ? initialSessionId
      : null,
  );
  const selected =
    availableSessions.find(({ id }) => id === selectedId) ?? null;

  return (
    <section
      className="coaching-slot-choice"
      aria-labelledby="coach-choice-title"
    >
      <div className="coaching-slot-choice__intro">
        <p className="eyebrow">Koučovací zóna</p>
        <h2 id="coach-choice-title">Vyberte si kouče</h2>
        <p>
          {availableSessions.length > 1
            ? 'Každý kouč má vlastní kapacitu. '
            : 'V tomto čase je dostupný jeden kouč. '}
          Rezervaci dokončíte až po výběru konkrétního kouče.
        </p>
      </div>
      <div
        aria-label="Kouč pro tento čas"
        className="coaching-slot-choice__options"
        role="group"
      >
        {availableSessions.map((option) => {
          const selectedOption = option.id === selected?.id;
          const coachName = coachingCoachName(option, rooms);
          return (
            <button
              aria-pressed={selectedOption}
              className="coaching-slot-choice__option"
              disabled={option.status === 'cancelled'}
              key={option.id}
              onClick={() => setSelectedId(option.id)}
              type="button"
            >
              <span>{coachName}</span>
              <small>
                {option.status === 'cancelled'
                  ? 'Tento kouč není v daném čase dostupný'
                  : selectedOption
                    ? 'Vybráno'
                    : 'Vybrat kouče'}
              </small>
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className="coaching-slot-choice__selected" aria-live="polite">
          <h2>{coachingCoachName(selected, rooms)}</h2>
          {showAgendaAction && selected.status !== 'cancelled' ? (
            <ParticipantSessionAgendaAction
              eventId={eventId}
              sessionId={selected.id}
              {...(agendaApi ? { agendaApi } : {})}
            />
          ) : null}
          <ParticipantSessionCalendarExport
            eventId={eventId}
            session={selected}
          />
        </div>
      ) : (
        <p className="coaching-slot-choice__prompt">
          Pro zobrazení rezervace nejdřív vyberte jednoho z dostupných koučů.
        </p>
      )}
    </section>
  );
};

export const ProgramView = ({
  eventId,
  api,
}: {
  eventId: string;
  api?: ApiPort;
}) => {
  const state = useParticipantProgram(eventId, api);
  const data = state.status === 'ready' ? state.data : null;
  const continuity = useProgramContinuity(eventId, data);
  const days = useMemo(
    () =>
      [...(data?.program.days ?? [])].sort(
        (first, second) => first.sortOrder - second.sortOrder,
      ),
    [data],
  );
  const activeDay =
    days.find(({ id }) => id === continuity.day) ?? days.at(0) ?? null;
  const sessions = useMemo(
    () =>
      data?.program.sessions.filter(
        (session) => !activeDay || session.dayId === activeDay.id,
      ) ?? [],
    [activeDay, data],
  );

  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo="/app/program"
        state={state}
        onRetry={state.retry}
      />
    );
  }

  if (state.data.program.sessions.length === 0) {
    return (
      <EmptyContent
        title="Program zatím není publikovaný"
        detail="Jakmile organizátor zveřejní první body programu, najdete je tady."
      />
    );
  }

  return (
    <>
      <div aria-label="Dny programu" className="program-tabs" role="tablist">
        {days.map((day, index) => {
          const selected = day.id === activeDay?.id;
          return (
            <button
              aria-controls="program-day-panel"
              aria-selected={selected}
              className="program-tab"
              id={`program-day-tab-${day.id}`}
              key={day.id}
              onClick={() => continuity.setDay(index === 0 ? '' : day.id)}
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const tabs = Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  ) ?? [],
                );
                const current = tabs.indexOf(event.currentTarget);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (current +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                tabs[next]?.focus();
                tabs[next]?.click();
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {weekday(day.localDate)}
            </button>
          );
        })}
      </div>
      <div className="program-day-toolbar program-day-toolbar--static">
        {activeDay ? (
          <p className="program-day-meta">
            {participantProgramDateLabel(activeDay.localDate)}
          </p>
        ) : null}
      </div>
      {activeDay ? (
        <div
          aria-labelledby={`program-day-tab-${activeDay.id}`}
          id="program-day-panel"
          role="tabpanel"
        >
          <ParticipantProgramSchedule
            day={activeDay}
            onOpenSession={continuity.rememberScroll}
            rooms={state.data.program.rooms}
            sessions={sessions}
            sessionHref={(session) => sessionHref(session, continuity)}
          />
        </div>
      ) : null}
    </>
  );
};

export const SessionView = ({
  agendaApi,
  eventId,
  sessionId,
  chooseCoach = false,
  showAgendaAction = false,
  returnQuery = '',
  returnOrigin = 'program',
  api,
}: {
  agendaApi?: ApiPort;
  eventId: string;
  sessionId: string;
  chooseCoach?: boolean;
  showAgendaAction?: boolean;
  returnQuery?: string;
  returnOrigin?: 'agenda' | 'program';
  api?: ApiPort;
}) => {
  const state = useParticipantProgram(eventId, api);
  if (state.status !== 'ready') {
    const loginQuery = new URLSearchParams();
    if (returnOrigin === 'agenda') loginQuery.set('from', 'agenda');
    if (chooseCoach) loginQuery.set('coaching', 'choose');
    const loginReturnTo = `/app/program/${encodeURIComponent(sessionId)}${
      loginQuery.size > 0 ? `?${loginQuery.toString()}` : ''
    }`;
    return (
      <ResourceStatus
        loginReturnTo={loginReturnTo}
        state={state}
        onRetry={state.retry}
      />
    );
  }
  const session = state.data.program.sessions.find(
    ({ id }) => id === sessionId,
  );
  if (!session) {
    return (
      <EmptyContent
        title="Bod programu nebyl nalezen"
        detail="Mohl být odebraný v novější publikaci programu."
      />
    );
  }
  const room = state.data.program.rooms.find(({ id }) => id === session.roomId);
  const coachingSessions =
    session.type === 'coaching'
      ? state.data.program.sessions.filter(
          (candidate) =>
            candidate.type === 'coaching' &&
            candidate.dayId === session.dayId &&
            candidate.startsAt === session.startsAt &&
            candidate.endsAt === session.endsAt,
        )
      : [];
  const coachingSlot = coachingSessions.length > 0;
  const backHref =
    returnOrigin === 'agenda'
      ? '/app/agenda'
      : `/app/program${returnQuery ? `?${returnQuery}` : ''}`;
  return (
    <article className="detail-card">
      <p className="eyebrow">{coachingSlot ? 'Koučink' : session.type}</p>
      <h1 data-route-heading tabIndex={-1}>
        {coachingSlot ? 'Koučovací slot' : session.title}
      </h1>
      <p className="detail-meta">
        <time dateTime={session.startsAt}>
          {time(session.startsAt)}–{time(session.endsAt)}
        </time>
        {coachingSlot ? ' · Koučovací zóna' : room ? ` · ${room.name}` : ''}
      </p>
      {session.status === 'cancelled' ? (
        <p className="status-notice" role="status">
          Tento bod programu byl zrušen.
        </p>
      ) : null}
      {coachingSlot ? (
        <p className="lead">
          Vyberte si konkrétního kouče a následně dokončete rezervaci místa.
        </p>
      ) : session.summary ? (
        <p className="lead">{session.summary}</p>
      ) : null}
      {!coachingSlot && session.description ? (
        <div className="prose">
          {session.description.split('\n\n').map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      ) : null}
      {coachingSlot ? (
        <CoachingSlotChoice
          eventId={eventId}
          initialSessionId={chooseCoach ? null : session.id}
          rooms={state.data.program.rooms}
          sessions={coachingSessions}
          showAgendaAction={showAgendaAction}
          {...(agendaApi ? { agendaApi } : {})}
        />
      ) : showAgendaAction && session.status !== 'cancelled' ? (
        <ParticipantSessionAgendaAction
          eventId={eventId}
          sessionId={session.id}
          {...(agendaApi ? { agendaApi } : {})}
        />
      ) : null}
      {!coachingSlot ? (
        <ParticipantSessionCalendarExport eventId={eventId} session={session} />
      ) : null}
      {!coachingSlot &&
      session.questionsEnabled &&
      session.status !== 'cancelled' ? (
        <Link className="ui-button" href={`/app/interakce/${session.id}`}>
          Položit dotaz moderátorovi
        </Link>
      ) : null}
      {!coachingSlot && session.status !== 'cancelled' ? (
        <SessionRating sessionId={session.id} endsAt={session.endsAt} />
      ) : null}
      <Link className="text-link" href={backHref}>
        ←{' '}
        {returnOrigin === 'agenda'
          ? 'Zpět do osobní agendy'
          : 'Zpět na program'}
      </Link>
    </article>
  );
};
