'use client';

import type { ParticipantProgramResponse } from '@byzon/domain/contracts';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

type Program = ParticipantProgramResponse['program'];
type ProgramDay = Program['days'][number];
type ProgramRoom = Program['rooms'][number];
type ProgramSession = Program['sessions'][number];

interface ProgramStage {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sessions: readonly ProgramSession[];
}

interface CalendarRows {
  readonly count: number;
  readonly rows: string;
  readonly rowByMinute: ReadonlyMap<number, number>;
}

const SLOT_MINUTES = 15;
const EVENING_START_MINUTES = 18 * 60 + 15;
const UNASSIGNED_ROOM_ID = 'unassigned';

const pragueParts = (value: string) => {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
  return {
    date: `${values.get('year')}-${values.get('month')}-${values.get('day')}`,
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
  };
};

const dateSerial = (value: string): number => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
};

const minuteInProgramDay = (value: string, localDate: string): number => {
  const parts = pragueParts(value);
  return (
    (dateSerial(parts.date) - dateSerial(localDate)) * 24 * 60 +
    parts.hour * 60 +
    parts.minute
  );
};

const floorSlot = (value: number): number =>
  Math.floor(value / SLOT_MINUTES) * SLOT_MINUTES;

const ceilSlot = (value: number): number =>
  Math.ceil(value / SLOT_MINUTES) * SLOT_MINUTES;

const clock = (value: number): string => {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
};

const dateLabel = (value: string): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));

const sessionRange = (session: ProgramSession, day: ProgramDay) => ({
  end: minuteInProgramDay(session.endsAt, day.localDate),
  start: minuteInProgramDay(session.startsAt, day.localDate),
});

const sessionTime = (session: ProgramSession, day: ProgramDay): string => {
  const { end, start } = sessionRange(session, day);
  return `${clock(start)}–${clock(end)}`;
};

const sessionClass = (session: ProgramSession): string => {
  if (session.type === 'networking' || session.type === 'gala') return 'social';
  if (/networking|afterparty|galakoktejl/i.test(session.title)) return 'social';
  if (
    /^(registrace|úvod|společně|volný program|tombola|společné foto|poděkování)/i.test(
      session.title,
    )
  )
    return 'shared';
  return session.type;
};

const isCondensed = (session: ProgramSession): boolean =>
  session.type === 'break' ||
  session.type === 'meal' ||
  session.title.trim().toLocaleLowerCase('cs-CZ') === 'registrace';

const stageIconKind = (name: string) => {
  const normalized = name.toLocaleLowerCase('cs-CZ');
  if (normalized.includes('leadership') || normalized.includes('předsálí'))
    return 'users';
  if (normalized.includes('loco') || normalized.includes('workshop'))
    return 'tool';
  if (normalized.includes('koučovací')) return 'coffee';
  if (normalized.includes('networking') || normalized.includes('afterparty'))
    return 'sparkles';
  if (normalized.includes('galakoktejl') || normalized.includes('solnice'))
    return 'award';
  return 'mic';
};

const StageIcon = ({ name }: { readonly name: string }) => {
  const common = {
    'aria-hidden': true,
    fill: 'none',
    height: 26,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
    viewBox: '0 0 24 24',
    width: 26,
  };
  switch (stageIconKind(name)) {
    case 'users':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'tool':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1 2.6-2.4z" />
        </svg>
      );
    case 'coffee':
      return (
        <svg {...common}>
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <path d="M6 1v3M10 1v3M14 1v3" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="m12 3 1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6-4.6-1.9 4.6-1.9L12 3z" />
          <path d="m19 14 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
        </svg>
      );
    case 'award':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="7" />
          <path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
        </svg>
      );
  }
};

const stagesFor = (
  sessions: readonly ProgramSession[],
  rooms: readonly ProgramRoom[],
): readonly ProgramStage[] => {
  const byRoom = new Map<string, ProgramSession[]>();
  for (const session of sessions) {
    const roomId = session.roomId ?? UNASSIGNED_ROOM_ID;
    const roomSessions = byRoom.get(roomId) ?? [];
    roomSessions.push(session);
    byRoom.set(roomId, roomSessions);
  }
  const stages: ProgramStage[] = rooms
    .filter(({ id }) => byRoom.has(id))
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .map((room) => ({
      id: room.id,
      name: room.name,
      description: room.description ?? null,
      sessions: (byRoom.get(room.id) ?? []).sort(compareSessions),
    }));
  const unassigned = byRoom.get(UNASSIGNED_ROOM_ID);
  if (unassigned?.length) {
    stages.push({
      id: UNASSIGNED_ROOM_ID,
      name: 'Bez stage',
      description: null,
      sessions: [...unassigned].sort(compareSessions),
    });
  }
  return stages;
};

const compareSessions = (first: ProgramSession, second: ProgramSession) =>
  Date.parse(first.startsAt) - Date.parse(second.startsAt) ||
  first.sortOrder - second.sortOrder;

const overlapsSlot = (
  stages: readonly ProgramStage[],
  day: ProgramDay,
  slotStart: number,
): readonly ProgramSession[] => {
  const slotEnd = slotStart + SLOT_MINUTES;
  return stages.flatMap(({ sessions }) =>
    sessions.filter((session) => {
      const range = sessionRange(session, day);
      return range.start < slotEnd && range.end > slotStart;
    }),
  );
};

const calendarRows = (
  stages: readonly ProgramStage[],
  day: ProgramDay,
): CalendarRows => {
  const sessions = stages.flatMap(({ sessions }) => sessions);
  const start = floorSlot(
    Math.min(...sessions.map((session) => sessionRange(session, day).start)),
  );
  const end = ceilSlot(
    Math.max(...sessions.map((session) => sessionRange(session, day).end)),
  );
  const slotCount = Math.max(1, (end - start) / SLOT_MINUTES);
  const rowByMinute = new Map<number, number>();
  const rows: string[] = [];
  let index = 0;
  let row = 2;

  while (index < slotCount) {
    const slotStart = start + index * SLOT_MINUTES;
    const overlapping = overlapsSlot(stages, day, slotStart);
    if (overlapping.length === 0) {
      while (
        index < slotCount &&
        overlapsSlot(stages, day, start + index * SLOT_MINUTES).length === 0
      ) {
        rowByMinute.set(start + index * SLOT_MINUTES, row);
        index += 1;
      }
      rows.push('var(--slot-gap-h)');
      row += 1;
      continue;
    }
    if (overlapping.every(isCondensed)) {
      while (index < slotCount) {
        const current = start + index * SLOT_MINUTES;
        const currentOverlaps = overlapsSlot(stages, day, current);
        if (currentOverlaps.length === 0 || !currentOverlaps.every(isCondensed))
          break;
        rowByMinute.set(current, row);
        index += 1;
      }
      rows.push('var(--slot-compact-short-h)');
      row += 1;
      continue;
    }
    rowByMinute.set(slotStart, row);
    rows.push('var(--slot-h)');
    row += 1;
    index += 1;
  }

  return { count: rows.length, rows: rows.join(' '), rowByMinute };
};

const sessionPosition = (
  session: ProgramSession,
  day: ProgramDay,
  rows: CalendarRows,
) => {
  const range = sessionRange(session, day);
  const eventRows: number[] = [];
  for (
    let minute = floorSlot(range.start);
    minute < ceilSlot(range.end);
    minute += SLOT_MINUTES
  ) {
    const row = rows.rowByMinute.get(minute);
    if (row) eventRows.push(row);
  }
  const first = eventRows[0] ?? 2;
  const span = isCondensed(session)
    ? 1
    : Math.max(1, Math.max(...eventRows) - first + 1);
  return { row: first, span };
};

const SessionBadge = ({ session }: { readonly session: ProgramSession }) => {
  if (session.status === 'cancelled')
    return <span className="program-cal-event__badge">Zrušeno</span>;
  if (session.type === 'mastermind')
    return <span className="program-cal-event__badge">Mastermind</span>;
  return null;
};

const Calendar = ({
  day,
  label,
  modifier,
  onOpenSession,
  stages,
  sessionHref,
}: {
  readonly day: ProgramDay;
  readonly label?: string;
  readonly modifier?: 'compact' | 'dense';
  readonly onOpenSession: () => void;
  readonly stages: readonly ProgramStage[];
  readonly sessionHref: (sessionId: string) => string;
}) => {
  const rows = useMemo(() => calendarRows(stages, day), [day, stages]);
  const startMinute = Math.min(
    ...stages.flatMap(({ sessions }) =>
      sessions.map((session) => floorSlot(sessionRange(session, day).start)),
    ),
  );
  const endMinute = Math.max(
    ...stages.flatMap(({ sessions }) =>
      sessions.map((session) => ceilSlot(sessionRange(session, day).end)),
    ),
  );
  const labelMinutes = [
    ...(startMinute % 60 === 0 ? [] : [startMinute]),
    ...Array.from(
      { length: Math.max(0, Math.ceil((endMinute - startMinute) / 60) + 1) },
      (_, index) => Math.ceil(startMinute / 60) * 60 + index * 60,
    ).filter((value) => value < endMinute),
  ];
  const usedLabelRows = new Set<number>();
  const labels = [...new Set(labelMinutes)].flatMap((minute) => {
    const row = rows.rowByMinute.get(minute);
    if (!row || usedLabelRows.has(row)) return [];
    usedLabelRows.add(row);
    return [{ minute, row }];
  });
  const style = {
    '--slot-count': rows.count,
    '--slot-rows': rows.rows,
    '--stage-count': stages.length,
  } as CSSProperties;

  return (
    <>
      {label ? <h2 className="program-calendar-title">{label}</h2> : null}
      <div
        aria-label={`${label ? `${label}, ` : ''}program podle času a stage`}
        className="program-calendar-wrap"
        role="region"
        tabIndex={0}
      >
        <div
          className={`program-calendar program-calendar--cols-${String(stages.length)}${modifier ? ` program-calendar--${modifier}` : ''}`}
          style={style}
        >
          <div
            aria-hidden="true"
            className="program-calendar__gridlines"
            style={{
              gridColumn: '1 / -1',
              gridRow: `2 / span ${String(rows.count)}`,
            }}
          />
          <div
            aria-hidden="true"
            className="program-calendar__time-head"
            style={{ gridColumn: 1, gridRow: 1 }}
          />
          {stages.map((stage, index) => (
            <div
              className="program-calendar__stage-head"
              key={stage.id}
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              <div className="stage-ico">
                <StageIcon name={stage.name} />
              </div>
              <div>
                <h3>{stage.name}</h3>
                {stage.description ? <p>{stage.description}</p> : null}
              </div>
            </div>
          ))}
          {labels.map(({ minute, row }) => (
            <div
              aria-hidden="true"
              className="program-calendar__time-label"
              key={minute}
              style={{ gridColumn: 1, gridRow: row }}
            >
              {clock(minute)}
            </div>
          ))}
          {stages.flatMap((stage, stageIndex) =>
            stage.sessions.map((session) => {
              const position = sessionPosition(session, day, rows);
              const short = position.span === 1 || isCondensed(session);
              return (
                <article
                  className={`program-cal-event program-cal-event--${sessionClass(session)} program-cal-event--has-link${short ? ' program-cal-event--short' : ''}`}
                  key={session.id}
                  style={{
                    gridColumn: stageIndex + 2,
                    gridRow: `${String(position.row)} / span ${String(position.span)}`,
                  }}
                >
                  <Link
                    aria-label={`Detail programu: ${session.title}`}
                    className="program-cal-event__inner program-cal-event__inner--link"
                    href={sessionHref(session.id)}
                    onClick={onOpenSession}
                  >
                    <time
                      className="program-cal-event__time"
                      dateTime={session.startsAt}
                    >
                      {sessionTime(session, day)}
                    </time>
                    <strong className="program-cal-event__title">
                      {session.title}
                    </strong>
                    {session.summary ? (
                      <span
                        className="program-cal-event__meta"
                        title={session.summary}
                      >
                        {session.summary}
                      </span>
                    ) : null}
                    <SessionBadge session={session} />
                  </Link>
                </article>
              );
            }),
          )}
        </div>
      </div>
    </>
  );
};

const MobileBadge = ({ session }: { readonly session: ProgramSession }) => {
  if (session.status === 'cancelled')
    return <span className="program-mobile-event__badge">Zrušeno</span>;
  if (session.type === 'mastermind')
    return <span className="program-mobile-event__badge">Mastermind</span>;
  return null;
};

const MobileAgenda = ({
  day,
  label,
  onOpenSession,
  stages,
  sessionHref,
}: {
  readonly day: ProgramDay;
  readonly label?: string;
  readonly onOpenSession: () => void;
  readonly stages: readonly ProgramStage[];
  readonly sessionHref: (sessionId: string) => string;
}) => {
  const [activeStage, setActiveStage] = useState('all');
  const stageIds = stages.map(({ id }) => id);
  const selectedStage = stageIds.includes(activeStage) ? activeStage : 'all';

  const itemsByKey = new Map<
    string,
    {
      session: ProgramSession;
      stageIds: string[];
      stageNames: string[];
      start: number;
    }
  >();
  for (const stage of stages) {
    for (const session of stage.sessions) {
      const range = sessionRange(session, day);
      const key = isCondensed(session)
        ? [
            range.start,
            range.end,
            session.title,
            session.summary,
            session.type,
          ].join('|')
        : session.id;
      const current = itemsByKey.get(key);
      if (current) {
        current.stageIds.push(stage.id);
        current.stageNames.push(stage.name);
      } else {
        itemsByKey.set(key, {
          session,
          stageIds: [stage.id],
          stageNames: [stage.name],
          start: range.start,
        });
      }
    }
  }
  const items = [...itemsByKey.values()]
    .filter(
      ({ stageIds: itemStageIds }) =>
        selectedStage === 'all' || itemStageIds.includes(selectedStage),
    )
    .sort(
      (first, second) =>
        first.start - second.start ||
        compareSessions(first.session, second.session),
    );
  const starts = [...new Set(items.map(({ start }) => start))];

  return (
    <>
      {label ? <h2 className="program-mobile-title">{label}</h2> : null}
      <div className="program-mobile-agenda">
        {stages.length > 1 ? (
          <div
            aria-label="Filtrovat program podle místa"
            className="program-mobile-filters"
            role="group"
          >
            <button
              aria-pressed={selectedStage === 'all'}
              className={`program-mobile-filter${selectedStage === 'all' ? ' is-active' : ''}`}
              onClick={() => setActiveStage('all')}
              type="button"
            >
              Vše
            </button>
            {stages.map((stage) => (
              <button
                aria-pressed={selectedStage === stage.id}
                className={`program-mobile-filter${selectedStage === stage.id ? ' is-active' : ''}`}
                key={stage.id}
                onClick={() => setActiveStage(stage.id)}
                type="button"
              >
                {stage.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="program-mobile-list">
          {starts.map((start) => (
            <section className="program-mobile-time-group" key={start}>
              <div className="program-mobile-time">{clock(start)}</div>
              <div className="program-mobile-time-events">
                {items
                  .filter((item) => item.start === start)
                  .map(({ session, stageIds: itemStageIds, stageNames }) => (
                    <article
                      className={`program-mobile-event program-mobile-event--${sessionClass(session)} program-mobile-event--has-link`}
                      data-stage-ids={itemStageIds.join(' ')}
                      key={session.id}
                    >
                      <Link
                        aria-label={`Detail programu: ${session.title}`}
                        className="program-mobile-event__inner program-mobile-event__inner--link"
                        href={sessionHref(session.id)}
                        onClick={onOpenSession}
                      >
                        <div className="program-mobile-event__top">
                          <span className="program-mobile-event__stage">
                            {stageNames.length === stages.length &&
                            stages.length > 1
                              ? 'Všechny stage'
                              : stageNames.length > 2
                                ? `${String(stageNames.length)} stage`
                                : stageNames.join(', ')}
                          </span>
                          <time
                            className="program-mobile-event__time"
                            dateTime={session.startsAt}
                          >
                            {sessionTime(session, day)}
                          </time>
                          <MobileBadge session={session} />
                        </div>
                        <strong className="program-mobile-event__title">
                          {session.title}
                        </strong>
                        {session.summary ? (
                          <span className="program-mobile-event__meta">
                            {session.summary}
                          </span>
                        ) : null}
                      </Link>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
};

const ProgramScheduleSection = ({
  day,
  label,
  modifier,
  onOpenSession,
  rooms,
  sessions,
  sessionHref,
}: {
  readonly day: ProgramDay;
  readonly label?: string;
  readonly modifier?: 'compact' | 'dense';
  readonly onOpenSession: () => void;
  readonly rooms: readonly ProgramRoom[];
  readonly sessions: readonly ProgramSession[];
  readonly sessionHref: (sessionId: string) => string;
}) => {
  const stages = useMemo(() => stagesFor(sessions, rooms), [rooms, sessions]);
  if (stages.length === 0) return null;
  return (
    <>
      <Calendar
        day={day}
        {...(label ? { label } : {})}
        {...(modifier ? { modifier } : {})}
        onOpenSession={onOpenSession}
        stages={stages}
        sessionHref={sessionHref}
      />
      <MobileAgenda
        day={day}
        {...(label ? { label } : {})}
        onOpenSession={onOpenSession}
        stages={stages}
        sessionHref={sessionHref}
      />
    </>
  );
};

export const ParticipantProgramSchedule = ({
  day,
  onOpenSession,
  rooms,
  sessions,
  sessionHref,
}: {
  readonly day: ProgramDay;
  readonly onOpenSession: () => void;
  readonly rooms: readonly ProgramRoom[];
  readonly sessions: readonly ProgramSession[];
  readonly sessionHref: (sessionId: string) => string;
}) => {
  const eveningRoomIds = new Set(
    rooms
      .filter(({ name }) => /networking|afterparty/i.test(name))
      .map(({ id }) => id),
  );
  const hasEveningStage = sessions.some(
    ({ roomId }) => roomId && eveningRoomIds.has(roomId),
  );
  const mainSessions = sessions.filter((session) => {
    if (session.roomId && eveningRoomIds.has(session.roomId)) return false;
    return (
      !hasEveningStage ||
      sessionRange(session, day).start < EVENING_START_MINUTES
    );
  });
  const eveningSessions = sessions.filter(
    ({ roomId }) => roomId && eveningRoomIds.has(roomId),
  );

  return (
    <div className="participant-program-schedule">
      <ProgramScheduleSection
        day={day}
        {...(hasEveningStage ? {} : { modifier: 'dense' as const })}
        onOpenSession={onOpenSession}
        rooms={rooms}
        sessions={mainSessions}
        sessionHref={sessionHref}
      />
      {eveningSessions.length > 0 ? (
        <ProgramScheduleSection
          day={day}
          label="Večerní program"
          modifier="compact"
          onOpenSession={onOpenSession}
          rooms={rooms}
          sessions={eveningSessions}
          sessionHref={sessionHref}
        />
      ) : null}
    </div>
  );
};

export const participantProgramDateLabel = dateLabel;
