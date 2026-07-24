import { PartnerDirectory } from '@/components/content-directory';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function PartnersPage() {
  const eventId = await loadCurrentEventId();
  return (
    <section className="app-page">
      <p className="eyebrow">Děkujeme</p>
      <h1 data-route-heading tabIndex={-1}>
        Partneři
      </h1>
      {eventId ? (
        <PartnerDirectory eventId={eventId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
