'use client';

import type { AgendaCalendarExport } from '@byzon/domain/contracts';
import { ActionLink } from '@byzon/ui';

export const ParticipantAgendaCalendarExport = ({
  calendarExport,
}: {
  readonly calendarExport: AgendaCalendarExport;
}) => (
  <section
    aria-labelledby="agenda-calendar-heading"
    className="agenda-calendar-export"
  >
    <div>
      <p className="agenda-section-kicker">Kalendář</p>
      <h2 id="agenda-calendar-heading">Vzít osobní plán s sebou</h2>
      <p>
        Soubor obsahuje jen aktuální kanonické položky této osobní agendy. Odkaz
        je stejnopůvodový a při stažení znovu ověří přihlášení.
      </p>
    </div>
    {calendarExport.state === 'available' ? (
      <ActionLink download="byzon-osobni-agenda.ics" href={calendarExport.href}>
        Stáhnout osobní agendu (.ics)
      </ActionLink>
    ) : (
      <p role="status">
        Export bude dostupný, jakmile si do osobní agendy přidáte první bod.
      </p>
    )}
  </section>
);
