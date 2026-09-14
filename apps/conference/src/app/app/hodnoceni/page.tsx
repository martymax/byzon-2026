import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EventRating } from '@/components/event-survey';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { auth } from '@/server/auth';
import { loadParticipantCurrentEvent } from '@/server/current-event';

export const dynamic = 'force-dynamic';
export default async function EventRatingPage() {
  if (!isFrontendPreviewAvailable()) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      redirect('/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fhodnoceni');
  }
  const current = await loadParticipantCurrentEvent();
  return (
    <section className="app-page">
      <p className="eyebrow">Vaše zkušenost</p>
      <h1 data-route-heading tabIndex={-1}>
        Jaký byl váš BYZON?
      </h1>
      <p>Děkujeme za zpětnou vazbu. Pomůže nám připravit další ročník.</p>
      {current.kind === 'available' ? (
        <EventRating endsAt={current.event.endsAt.toISOString()} />
      ) : (
        <p role="alert">Hodnocení není dostupné.</p>
      )}
    </section>
  );
}
