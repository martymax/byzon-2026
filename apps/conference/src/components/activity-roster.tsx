import type { ActivityRosterResponse } from '@byzon/domain/contracts';
import { Card, StatePanel, StatusBadge } from '@byzon/ui';
import Link from 'next/link';

export const ActivityRoster = ({
  data,
}: {
  readonly data: ActivityRosterResponse;
}) => (
  <main className="app-page">
    <header>
      <nav className="activity-context-switch" aria-label="Režim aplikace">
        <Link href="/app">Účastnická aplikace</Link>
        <span aria-current="page">Správa aktivit</span>
      </nav>
      <p className="eyebrow">Řečník a vedoucí aktivity</p>
      <h1 data-route-heading tabIndex={-1}>
        Moje aktivity
      </h1>
      <p className="lead">
        Vlastní body programu a přihlášení účastníci u aktivit s rezervací.
      </p>
    </header>
    {data.sessions.length === 0 ? (
      <StatePanel kind="empty" title="Nemáte přiřazenou aktivitu">
        <p>Organizátor zatím vašemu účtu nepřiřadil žádný bod programu.</p>
      </StatePanel>
    ) : (
      data.sessions.map((session) => (
        <Card key={session.sessionId}>
          <p className="activation-kicker">
            {session.capacity === null
              ? 'Bez registrace účastníků'
              : `Kapacita ${session.capacity}`}
          </p>
          <h2>{session.title}</h2>
          <time dateTime={session.startsAt}>
            {new Intl.DateTimeFormat('cs-CZ', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Europe/Prague',
            }).format(new Date(session.startsAt))}
          </time>
          {session.capacity === null ? (
            <p className="activity-roster-note">
              Tento bod programu nevyžaduje rezervaci.
            </p>
          ) : session.participants.length === 0 ? (
            <p className="activity-roster-note">Zatím není nikdo přihlášen.</p>
          ) : (
            <ul>
              {session.participants.map((participant) => (
                <li key={participant.reservationId}>
                  <strong>{participant.displayName}</strong>{' '}
                  <span>{participant.company ?? 'Firma neuvedena'}</span>{' '}
                  <StatusBadge
                    tone={participant.state === 'reserved' ? 'success' : 'info'}
                  >
                    {participant.state === 'reserved'
                      ? 'Rezervováno'
                      : 'Čekací listina'}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))
    )}
  </main>
);
