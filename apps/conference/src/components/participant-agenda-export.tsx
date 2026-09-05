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
      <h2 id="agenda-calendar-heading">Přidat celou agendu do kalendáře</h2>
      <p>
        Stáhněte si všechny vybrané body jako soubor .ics pro Google Kalendář,
        Apple Kalendář nebo Outlook.
      </p>
    </div>
    {calendarExport.state === 'available' ? (
      <ActionLink
        download="byzon-2026-moje-agenda.ics"
        href={calendarExport.href}
      >
        Přidat celou agendu
      </ActionLink>
    ) : (
      <p role="status">
        {calendarExport.reason === 'empty'
          ? 'Export bude dostupný, jakmile si do osobní agendy přidáte první bod.'
          : 'Export osobní agendy bude zpřístupněný v dalším kroku.'}
      </p>
    )}
  </section>
);
