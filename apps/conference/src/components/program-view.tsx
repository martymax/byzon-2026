'use client';

import {
  participantProgramFiltersSchema,
  type ParticipantProgramResponse,
} from '@byzon/domain/contracts';
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
  readonly type: string;
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
  if (typeof window === 'undefined') return { day: '', type: '' };
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
  const type = query.get('type') ?? storedQuery.get('type') ?? undefined;
  const parsed = participantProgramFiltersSchema.safeParse({
    ...(day ? { day } : {}),
    ...(type ? { type } : {}),
  });
  return parsed.success
    ? { day: parsed.data.day ?? '', type: parsed.data.type ?? '' }
    : { day: '', type: '' };
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
  const type =
    data &&
    preferences.type &&
    !data.program.sessions.some(
      ({ type: sessionType }) => sessionType === preferences.type,
    )
      ? ''
      : preferences.type;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams();
    if (day) query.set('day', day);
    if (type) query.set('type', type);
    writeSessionValue(PROGRAM_FILTER_KEY, query.toString());

    const url = new URL(window.location.href);
    if (day) url.searchParams.set('day', day);
    else url.searchParams.delete('day');
    if (type) url.searchParams.set('type', type);
    else url.searchParams.delete('type');
    try {
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // A locked-down embed may forbid history writes; filtering still works.
    }
  }, [day, type]);

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
    type,
    setDay: (day: string) => setPreferences((current) => ({ ...current, day })),
    setType: (type: string) =>
      setPreferences((current) => ({ ...current, type })),
    reset: () => setPreferences({ day: '', type: '' }),
    rememberScroll,
  };
};

const sessionHref = (
  sessionId: string,
  preferences: Pick<ProgramPreferences, 'day' | 'type'>,
): string => {
  const query = new URLSearchParams();
  if (preferences.day) query.set('day', preferences.day);
  if (preferences.type) query.set('type', preferences.type);
  const suffix = query.toString();
  return `/app/program/${sessionId}${suffix ? `?${suffix}` : ''}`;
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
        (session) =>
          (!activeDay || session.dayId === activeDay.id) &&
          (!continuity.type || session.type === continuity.type),
      ) ?? [],
    [activeDay, continuity.type, data],
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
              {day.title}
            </button>
          );
        })}
      </div>
      <div className="program-day-toolbar">
        {activeDay ? (
          <p className="program-day-meta">
            {participantProgramDateLabel(activeDay.localDate)}
          </p>
        ) : null}
        <fieldset className="filter-bar program-type-filter">
          <legend className="ui-visually-hidden">Filtry programu</legend>
          <label>
            Typ
            <select
              value={continuity.type}
              onChange={(event) => continuity.setType(event.target.value)}
            >
              <option value="">Všechny typy</option>
              {[
                ...new Set(
                  state.data.program.sessions.map((session) => session.type),
                ),
              ].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <p className="result-count" aria-live="polite">
          {sessions.length} bodů programu
        </p>
      </div>
      {sessions.length === 0 ? (
        <EmptyContent
          title="Tomuto filtru nic neodpovídá"
          detail="Zrušte filtry a zobrazte celý publikovaný program."
          action={{ label: 'Zrušit filtry', onClick: continuity.reset }}
        />
      ) : activeDay ? (
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
            sessionHref={(sessionId) => sessionHref(sessionId, continuity)}
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
  showAgendaAction = false,
  returnQuery = '',
  returnOrigin = 'program',
  api,
}: {
  agendaApi?: ApiPort;
  eventId: string;
  sessionId: string;
  showAgendaAction?: boolean;
  returnQuery?: string;
  returnOrigin?: 'agenda' | 'program';
  api?: ApiPort;
}) => {
  const state = useParticipantProgram(eventId, api);
  if (state.status !== 'ready') {
    const loginReturnTo = `/app/program/${encodeURIComponent(sessionId)}${
      returnOrigin === 'agenda' ? '?from=agenda' : ''
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
  const backHref =
    returnOrigin === 'agenda'
      ? '/app/agenda'
      : `/app/program${returnQuery ? `?${returnQuery}` : ''}`;
  return (
    <article className="detail-card">
      <p className="eyebrow">{session.type}</p>
      <h1 data-route-heading tabIndex={-1}>
        {session.title}
      </h1>
      <p className="detail-meta">
        <time dateTime={session.startsAt}>
          {time(session.startsAt)}–{time(session.endsAt)}
        </time>
        {room ? ` · ${room.name}` : ''}
      </p>
      {session.status === 'cancelled' ? (
        <p className="status-notice" role="status">
          Tento bod programu byl zrušen.
        </p>
      ) : null}
      {session.summary ? <p className="lead">{session.summary}</p> : null}
      {session.description ? (
        <div className="prose">
          {session.description.split('\n\n').map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      ) : null}
      {showAgendaAction && session.status !== 'cancelled' ? (
        <ParticipantSessionAgendaAction
          eventId={eventId}
          sessionId={session.id}
          {...(agendaApi ? { agendaApi } : {})}
        />
      ) : null}
      {session.questionsEnabled && session.status !== 'cancelled' ? (
        <Link className="ui-button" href={`/app/interakce/${session.id}`}>
          Položit dotaz moderátorovi
        </Link>
      ) : null}
      {session.status !== 'cancelled' ? (
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
