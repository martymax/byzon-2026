'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ResourceStatus,
  useJsonResource,
  type ProgramData,
} from './content-state';

const time = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export const ProgramView = ({ eventId }: { eventId: string }) => {
  const state = useJsonResource<ProgramData>(
    `/api/v1/events/${eventId}/program`,
  );
  const [day, setDay] = useState('');
  const [type, setType] = useState('');
  const sessions = useMemo(
    () =>
      state.status === 'ready'
        ? state.data.program.sessions.filter(
            (session) =>
              (!day || session.dayId === day) &&
              (!type || session.type === type),
          )
        : [],
    [day, state, type],
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  return (
    <>
      <div className="filter-bar" aria-label="Filtry programu">
        <label>
          Den
          <select value={day} onChange={(event) => setDay(event.target.value)}>
            <option value="">Všechny dny</option>
            {state.data.program.days.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Typ
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
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
      </div>
      <p className="result-count" aria-live="polite">
        {sessions.length} bodů programu
      </p>
      <ol className="session-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link href={`/app/program/${session.id}`}>
              <time dateTime={session.startsAt}>
                {time(session.startsAt)}–{time(session.endsAt)}
              </time>
              <strong>{session.title}</strong>
              {session.summary && <span>{session.summary}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
};

export const SessionView = ({
  eventId,
  sessionId,
}: {
  eventId: string;
  sessionId: string;
}) => {
  const state = useJsonResource<ProgramData>(
    `/api/v1/events/${eventId}/program`,
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  const session = state.data.program.sessions.find(
    ({ id }) => id === sessionId,
  );
  if (!session)
    return (
      <div className="resource-status" role="alert">
        Bod programu nebyl nalezen.
      </div>
    );
  const room = state.data.program.rooms.find(({ id }) => id === session.roomId);
  return (
    <article className="detail-card">
      <p className="eyebrow">{session.type}</p>
      <h1>{session.title}</h1>
      <p className="detail-meta">
        <time dateTime={session.startsAt}>
          {time(session.startsAt)}–{time(session.endsAt)}
        </time>
        {room ? ` · ${room.name}` : ''}
      </p>
      {session.summary && <p className="lead">{session.summary}</p>}
      {session.description && <p className="prose">{session.description}</p>}
      <Link className="text-link" href="/app/program">
        ← Zpět na program
      </Link>
    </article>
  );
};
