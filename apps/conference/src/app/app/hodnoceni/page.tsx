import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EventRating } from '@/components/event-survey';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { auth } from '@/server/auth';
import { loadParticipantCurrentEvent } from '@/server/current-event';
import { participantFeedbackLink } from '@/server/participant-feedback-link';

export const dynamic = 'force-dynamic';
export default async function EventRatingPage() {
  let userId: string | undefined;
  if (!isFrontendPreviewAvailable()) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      redirect('/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fhodnoceni');
    userId = session.user.id;
  }
  const current = await loadParticipantCurrentEvent();
  if (userId && current.kind === 'available') {
    const link = await participantFeedbackLink(current.event.id, userId);
    if (link) redirect(link);
  }
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
