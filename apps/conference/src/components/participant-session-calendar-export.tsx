'use client';

import type { PublishedProgramSession } from '@byzon/domain/contracts';
import { ActionLink } from '@byzon/ui';

const CalendarIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="20"
    viewBox="0 0 24 24"
    width="20"
  >
    <path
      d="M7 3v3m10-3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);

export const ParticipantSessionCalendarExport = ({
  eventId,
  session,
}: {
  readonly eventId: string;
  readonly session: Pick<PublishedProgramSession, 'id' | 'slug'>;
}) => {
  const href = `/api/v1/events/${encodeURIComponent(eventId)}/program/${encodeURIComponent(session.id)}/calendar.ics`;

  return (
    <section
      aria-labelledby="session-calendar-heading"
      className="session-calendar-export"
    >
      <div>
        <h2 id="session-calendar-heading">Přidat do kalendáře</h2>
        <p>
          Soubor .ics otevřete v Google Kalendáři, Apple Kalendáři nebo
          Outlooku.
        </p>
      </div>
      <ActionLink
        download={`byzon-2026-${session.slug}.ics`}
        href={href}
        leadingIcon={<CalendarIcon />}
        variant="secondary"
      >
        Přidat tento bod
      </ActionLink>
    </section>
  );
};
