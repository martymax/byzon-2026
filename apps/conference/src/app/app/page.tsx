import { ParticipantHome } from '@/components/participant-home';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadParticipantCurrentEvent } from '@/server/current-event';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ParticipantHomePage() {
  const currentEvent = await loadParticipantCurrentEvent();
  const previewAvailable = isFrontendPreviewAvailable();
  if (currentEvent.kind === 'archived') {
    return (
      <section className="app-page">
        <p className="eyebrow">Přehled</p>
        <h1 data-route-heading tabIndex={-1}>
          Akce byla archivována
        </h1>
        <p>
          {previewAvailable
            ? 'Obsah akce už není dostupný. Své údaje a přihlášená zařízení můžete dál spravovat v účtu.'
            : 'Obsah akce už není dostupný.'}
        </p>
        {previewAvailable ? (
          <nav aria-label="Možnosti archivovaného účtu">
            <ul className="settings-list">
              <li>
                <Link href="/app/soukromi">Správa soukromí</Link>
              </li>
              <li>
                <Link href="/app/nastaveni">Nastavení účtu</Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </section>
    );
  }

  if (currentEvent.kind === 'unavailable') {
    return (
      <section className="app-page">
        <p className="eyebrow">Přehled</p>
        <h1 data-route-heading tabIndex={-1}>
          Akce není dostupná
        </h1>
        <p role="alert">
          Přehled se nepodařilo otevřít. Zkuste to prosím později.
        </p>
      </section>
    );
  }

  const { event } = currentEvent;
  return (
    <ParticipantHome
      enableAgendaJourney={previewAvailable}
      event={{
        endsAt: event.endsAt.toISOString(),
        id: event.id,
        phase: event.status,
        startsAt: event.startsAt.toISOString(),
        timezone: event.timezone,
      }}
      now={new Date().toISOString()}
    />
  );
}
