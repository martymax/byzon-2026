import { participantProgramFiltersSchema } from '@byzon/domain/contracts';

import { SessionView } from '@/components/program-view';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [eventId, { sessionId }, query] = await Promise.all([
    loadCurrentEventId(),
    params,
    searchParams,
  ]);
  const filters = participantProgramFiltersSchema.safeParse({
    ...(typeof query.day === 'string' ? { day: query.day } : {}),
    ...(typeof query.type === 'string' ? { type: query.type } : {}),
  });
  const returnParams = new URLSearchParams();
  if (filters.success) {
    if (filters.data.day) returnParams.set('day', filters.data.day);
    if (filters.data.type) returnParams.set('type', filters.data.type);
  }
  const previewAvailable = isFrontendPreviewAvailable();
  return (
    <section className="app-page">
      {eventId ? (
        <SessionView
          eventId={eventId}
          sessionId={sessionId}
          showAgendaAction={previewAvailable}
          returnQuery={returnParams.toString()}
          returnOrigin={
            previewAvailable && query.from === 'agenda' ? 'agenda' : 'program'
          }
        />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
