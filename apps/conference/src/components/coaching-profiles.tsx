'use client';

import type { ApiPort } from '@/lib/api';

import { SpeakerPortrait } from './content-directory';
import { ResourceStatus, useParticipantContent } from './content-state';

export const CoachingProfiles = ({
  eventId,
  speakerIds,
  api,
}: {
  readonly eventId: string;
  readonly speakerIds: readonly string[];
  readonly api?: ApiPort;
}) => {
  const state = useParticipantContent(eventId, api);
  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo="/app/program"
        state={state}
        onRetry={state.retry}
      />
    );
  }
  const coaches = state.data.content.speakers.filter(({ id }) =>
    speakerIds.includes(id),
  );
  if (!coaches.length) return null;

  return (
    <section
      className="coaching-profiles"
      aria-labelledby="coaching-profiles-title"
    >
      <h2 id="coaching-profiles-title">Kouči</h2>
      {coaches.map((coach) => (
        <article className="speaker-detail-card" key={coach.id}>
          <SpeakerPortrait detail speaker={coach} />
          <div className="speaker-detail-card__content">
            <h3>
              {coach.firstName} {coach.lastName}
            </h3>
            {coach.jobTitle ? <p className="lead">{coach.jobTitle}</p> : null}
            <div className="prose">
              {coach.bioMarkdown?.split('\n\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
};
