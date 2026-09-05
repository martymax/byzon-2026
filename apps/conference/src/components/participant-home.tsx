'use client';

import type { PublishedProgramSession } from '@byzon/domain/contracts';
import { Card } from '@byzon/ui';
import Link from 'next/link';

import type { ApiPort } from '@/lib/api';
import { ParticipantPartnersFooter } from './content-directory';
import {
  participantAgendaItemStatus,
  selectNextParticipantAgendaItem,
} from './participant-agenda-model';
import {
  useParticipantAgendaResource,
  type ParticipantAgendaResource,
} from './participant-agenda-resource';
import {
  ResourceStatus,
  useParticipantContent,
  useParticipantProgram,
} from './content-state';
import {
  parseParticipantHomeDate as validDate,
  participantHomePhaseCopy,
  selectHomeProgramSessions,
  type ParticipantHomeEvent,
} from './participant-home-model';

export type {
  ParticipantEventPhase,
  ParticipantHomeEvent,
} from './participant-home-model';
export {
  participantHomePhaseCopy,
  selectHomeProgramSessions,
} from './participant-home-model';

const sessionTime = (value: string, timezone: string): string => {
  const date = validDate(value);
  if (!date) return 'Čas bude upřesněn';
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date);
  } catch {
    return 'Čas bude upřesněn';
  }
};

const sessionDateTime = (value: string, timezone: string): string => {
  const date = validDate(value);
  if (!date) return 'Termín bude upřesněn';
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'long',
      timeZone: timezone,
    }).format(date);
  } catch {
    return 'Termín bude upřesněn';
  }
};

const eventDateRange = (
  event: ParticipantHomeEvent,
): { readonly end: string; readonly start: string } | null => {
  const starts = validDate(event.startsAt);
  const ends = validDate(event.endsAt);
  if (!starts || !ends) return null;
  try {
    const formatter = new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      month: 'long',
      timeZone: event.timezone,
      year: 'numeric',
    });
    return {
      end: formatter.format(ends),
      start: formatter.format(starts),
    };
  } catch {
    return null;
  }
};

const isCurrentByPublishedTime = (
  session: PublishedProgramSession,
  now: string,
): boolean => {
  const current = validDate(now)?.getTime();
  const starts = validDate(session.startsAt)?.getTime();
  const ends = validDate(session.endsAt)?.getTime();
  return (
    current !== undefined &&
    starts !== undefined &&
    ends !== undefined &&
    starts <= current &&
    current < ends
  );
};

const PhaseHeader = ({ event }: { readonly event: ParticipantHomeEvent }) => {
  const copy = participantHomePhaseCopy[event.phase];
  const dateRange =
    event.phase === 'activation_open' || event.phase === 'ended'
      ? eventDateRange(event)
      : null;
  return (
    <header className={`home-hero home-hero--${event.phase}`}>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1 data-route-heading tabIndex={-1}>
        {copy.title}
      </h1>
      <p className="lead">{copy.detail}</p>
      {dateRange ? (
        <p className="home-event-window">
          <time dateTime={event.startsAt}>{dateRange.start}</time>
          {dateRange.start === dateRange.end ? null : (
            <>
              {' – '}
              <time dateTime={event.endsAt}>{dateRange.end}</time>
            </>
          )}
        </p>
      ) : null}
      {copy.cta ? (
        <Link className="home-primary-action" href="/app/program">
          {copy.cta}
        </Link>
      ) : null}
    </header>
  );
};

const ProgramOverview = ({
  agenda,
  api,
  event,
  now,
}: {
  readonly agenda?: ParticipantAgendaResource;
  readonly api?: ApiPort;
  readonly event: ParticipantHomeEvent;
  readonly now: string;
}) => {
  const state = useParticipantProgram(event.id, api);
  if (state.status !== 'ready') {
    return <ResourceStatus state={state} onRetry={state.retry} />;
  }

  const sessions = selectHomeProgramSessions({
    now,
    phase: event.phase,
    program: state.data.program,
    timezone: event.timezone,
  });
  const nextAgendaItem =
    agenda?.state.status === 'ready'
      ? selectNextParticipantAgendaItem(agenda.state.data, now)
      : null;
  const nextAgendaStatus = nextAgendaItem
    ? participantAgendaItemStatus(nextAgendaItem)
    : null;

  return (
    <section className="home-section" aria-labelledby="home-program-heading">
      <div className="home-section-heading">
        <div>
          <p className="home-section-kicker">Program</p>
          <h2 id="home-program-heading">
            {event.phase === 'live'
              ? 'Dnešní minimum'
              : event.phase === 'ended'
                ? 'Program po akci'
                : 'Co vás čeká'}
          </h2>
        </div>
        <Link
          className="home-section-link home-program-link"
          href="/app/program"
        >
          Celý program
        </Link>
      </div>
      <div className="home-card-grid">
        <Card className="home-card">
          <p className="home-card-kicker">
            {event.phase === 'live'
              ? 'Podle publikovaného programu'
              : event.phase === 'ended'
                ? 'Program akce'
                : 'Nejbližší body'}
          </p>
          {sessions.length > 0 ? (
            <ol className="home-session-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link href={`/app/program/${encodeURIComponent(session.id)}`}>
                    <span className="home-session-time">
                      {event.phase === 'live'
                        ? sessionTime(session.startsAt, event.timezone)
                        : sessionDateTime(session.startsAt, event.timezone)}
                    </span>
                    {isCurrentByPublishedTime(session, now) ? (
                      <span className="home-timing-label">
                        Právě podle času v programu
                      </span>
                    ) : null}
                    <strong>{session.title}</strong>
                    {session.summary ? <span>{session.summary}</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="home-card-empty" role="status">
              <h3>
                {event.phase === 'ended'
                  ? 'Program je stále k dispozici'
                  : 'Žádný další publikovaný bod'}
              </h3>
              <p>
                {event.phase === 'ended'
                  ? 'V celém programu si můžete znovu projít zveřejněné body akce.'
                  : 'Jakmile organizátor zveřejní další program, objeví se tady.'}
              </p>
            </div>
          )}
        </Card>

        {agenda ? (
          <Card className="home-card">
            <p className="home-card-kicker">Moje další položka</p>
            {nextAgendaItem && nextAgendaStatus ? (
              <>
                <p className="home-session-time">
                  {sessionDateTime(
                    nextAgendaItem.session.startsAt,
                    agenda.state.status === 'ready'
                      ? agenda.state.data.eventTimezone
                      : event.timezone,
                  )}
                </p>
                <h3>{nextAgendaItem.session.title}</h3>
                <p>
                  {nextAgendaStatus.label}. {nextAgendaStatus.detail}
                </p>
                <Link
                  className="home-card-link"
                  href={`/app/program/${encodeURIComponent(
                    nextAgendaItem.session.id,
                  )}`}
                >
                  Otevřít detail
                </Link>
              </>
            ) : agenda.state.status === 'ready' ? (
              <div className="home-card-empty" role="status">
                <h3>
                  {event.phase === 'ended'
                    ? 'Osobní agenda zůstává dostupná'
                    : 'Osobní agenda je zatím prázdná'}
                </h3>
                <p>
                  {event.phase === 'ended'
                    ? 'V uloženém plánu si můžete projít body skončené akce.'
                    : 'V detailu programu si uložte první bod do osobního plánu.'}
                </p>
                <Link
                  className="home-card-link"
                  href={
                    event.phase === 'ended' ? '/app/agenda' : '/app/program'
                  }
                >
                  {event.phase === 'ended'
                    ? 'Prohlédnout osobní agendu'
                    : 'Prohlédnout program'}
                </Link>
              </div>
            ) : (
              <div className="home-card-empty" role="status">
                <h3>Uložené body zatím nejsou v přehledu dostupné</h3>
                <p>
                  Soukromý plán na tomto zařízení neodhadujeme ani neukládáme.
                  Aktuální stav zkuste otevřít přímo v agendě.
                </p>
                <Link className="home-card-link" href="/app/agenda">
                  Otevřít osobní agendu
                </Link>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
};

const PracticalOverview = ({
  api,
  event,
}: {
  readonly api?: ApiPort;
  readonly event: ParticipantHomeEvent;
}) => {
  const state = useParticipantContent(event.id, api);
  if (state.status !== 'ready') {
    return <ResourceStatus state={state} onRetry={state.retry} />;
  }

  const venue = state.data.content.venues[0];
  const practical = state.data.content.practical.pages[0];
  return (
    <>
      <section
        className="home-section"
        aria-labelledby="home-practical-heading"
      >
        <div className="home-section-heading">
          <div>
            <p className="home-section-kicker">
              {event.phase === 'ended'
                ? 'Zveřejněné informace'
                : 'Před cestou a na místě'}
            </p>
            <h2 id="home-practical-heading">
              {event.phase === 'ended'
                ? 'Praktické informace'
                : 'Praktické minimum'}
            </h2>
          </div>
          <Link className="home-section-link" href="/app/informace">
            Všechny informace
          </Link>
        </div>
        <Card className="home-card home-practical-card">
          {venue ? (
            <div>
              <p className="home-card-kicker">Místo konání</p>
              <h3>{venue.name}</h3>
              <address>
                {venue.addressLine1}
                {venue.addressLine2 ? `, ${venue.addressLine2}` : null}
                <br />
                {venue.postalCode} {venue.city}
              </address>
            </div>
          ) : null}
          {practical ? (
            <div>
              <p className="home-card-kicker">
                {event.phase === 'ended' ? 'Informace k akci' : 'Než vyrazíte'}
              </p>
              <h3>{practical.title}</h3>
              {practical.summary ? <p>{practical.summary}</p> : null}
            </div>
          ) : null}
          {!venue && !practical ? (
            <div className="home-card-empty" role="status">
              <h3>Praktické informace zatím nejsou zveřejněné</h3>
              <p>Po publikaci se objeví na tomto místě.</p>
            </div>
          ) : null}
        </Card>
      </section>
      <ParticipantPartnersFooter partners={state.data.content.partners} />
    </>
  );
};

const ParticipantHomeSections = ({
  agenda,
  contentApi,
  event,
  now,
  programApi,
}: {
  readonly agenda?: ParticipantAgendaResource;
  readonly contentApi?: ApiPort;
  readonly event: ParticipantHomeEvent;
  readonly now: string;
  readonly programApi?: ApiPort;
}) => (
  <>
    <ProgramOverview
      event={event}
      now={now}
      {...(agenda ? { agenda } : {})}
      {...(programApi ? { api: programApi } : {})}
    />
    <PracticalOverview
      event={event}
      {...(contentApi ? { api: contentApi } : {})}
    />
  </>
);

const ParticipantHomeSectionsWithAgenda = ({
  agendaApi,
  contentApi,
  event,
  now,
  programApi,
}: {
  readonly agendaApi?: ApiPort;
  readonly contentApi?: ApiPort;
  readonly event: ParticipantHomeEvent;
  readonly now: string;
  readonly programApi?: ApiPort;
}) => {
  const agenda = useParticipantAgendaResource(event.id, agendaApi);
  return (
    <ParticipantHomeSections
      agenda={agenda}
      event={event}
      now={now}
      {...(contentApi ? { contentApi } : {})}
      {...(programApi ? { programApi } : {})}
    />
  );
};

export const ParticipantHome = ({
  agendaApi,
  contentApi,
  enableAgendaJourney,
  event,
  now,
  programApi,
}: {
  readonly agendaApi?: ApiPort;
  readonly contentApi?: ApiPort;
  readonly enableAgendaJourney: boolean;
  readonly event: ParticipantHomeEvent;
  readonly now: string;
  readonly programApi?: ApiPort;
}) => (
  <div className="app-page home-page">
    <PhaseHeader event={event} />
    {event.phase === 'draft' || event.phase === 'archived' ? null : (
      <>
        {enableAgendaJourney ? (
          <ParticipantHomeSectionsWithAgenda
            event={event}
            now={now}
            {...(agendaApi ? { agendaApi } : {})}
            {...(contentApi ? { contentApi } : {})}
            {...(programApi ? { programApi } : {})}
          />
        ) : (
          <ParticipantHomeSections
            event={event}
            now={now}
            {...(contentApi ? { contentApi } : {})}
            {...(programApi ? { programApi } : {})}
          />
        )}
      </>
    )}
  </div>
);
