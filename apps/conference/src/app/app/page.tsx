import { ParticipantHome } from '@/components/participant-home';
import { loadCurrentEvent } from '@/server/current-event';

export const dynamic = 'force-dynamic';

export default async function ParticipantHomePage() {
  const event = await loadCurrentEvent();
  if (!event) {
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

  return (
    <ParticipantHome
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
