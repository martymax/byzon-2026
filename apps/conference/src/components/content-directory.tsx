'use client';

import Link from 'next/link';
import {
  ResourceStatus,
  useJsonResource,
  type ParticipantContentResponse,
} from './content-state';

export const SpeakerDirectory = ({ eventId }: { eventId: string }) => {
  const state = useJsonResource<ParticipantContentResponse>(
    `/api/v1/events/${eventId}/content`,
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  return (
    <ul className="card-grid">
      {state.data.content.speakers.map((speaker) => (
        <li key={speaker.id}>
          <Link href={`/app/recnici/${speaker.slug}`}>
            <strong>
              {speaker.firstName} {speaker.lastName}
            </strong>
            <span>{speaker.jobTitle || 'Profil řečníka'}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
};

export const SpeakerDetail = ({
  eventId,
  slug,
}: {
  eventId: string;
  slug: string;
}) => {
  const state = useJsonResource<ParticipantContentResponse>(
    `/api/v1/events/${eventId}/content`,
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  const speaker = state.data.content.speakers.find(
    (item) => item.slug === slug,
  );
  if (!speaker)
    return (
      <div className="resource-status" role="alert">
        Řečník nebyl nalezen.
      </div>
    );
  return (
    <article className="detail-card">
      <p className="eyebrow">Řečník</p>
      <h1>
        {speaker.firstName} {speaker.lastName}
      </h1>
      {speaker.jobTitle && <p className="lead">{speaker.jobTitle}</p>}
      <div className="prose">
        {speaker.bioMarkdown?.split('\n\n').map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="link-row">
        {speaker.linkedinUrl && (
          <a href={speaker.linkedinUrl} rel="noreferrer">
            LinkedIn
          </a>
        )}
        {speaker.websiteUrl && (
          <a href={speaker.websiteUrl} rel="noreferrer">
            Web
          </a>
        )}
      </div>
    </article>
  );
};

export const PartnerDirectory = ({ eventId }: { eventId: string }) => {
  const state = useJsonResource<ParticipantContentResponse>(
    `/api/v1/events/${eventId}/content`,
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  return (
    <ul className="card-grid">
      {state.data.content.partners.map((partner) => (
        <li key={partner.id}>
          <article>
            <strong>{partner.name}</strong>
            {partner.descriptionMarkdown && (
              <span>{partner.descriptionMarkdown}</span>
            )}
            {partner.websiteUrl && (
              <a href={partner.websiteUrl} rel="noreferrer">
                Navštívit web
              </a>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
};

export const PracticalContent = ({ eventId }: { eventId: string }) => {
  const state = useJsonResource<ParticipantContentResponse>(
    `/api/v1/events/${eventId}/content`,
  );
  if (state.status !== 'ready') return <ResourceStatus status={state.status} />;
  return (
    <div className="content-stack">
      {state.data.content.practical.pages.map((page) => (
        <article className="detail-card compact" key={page.id}>
          <h2>{page.title}</h2>
          <div className="prose">
            {page.bodyMarkdown.split('\n\n').map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </article>
      ))}
      {state.data.content.venues.map((venue) => (
        <article className="detail-card compact" key={venue.id}>
          <h2>{venue.name}</h2>
          {venue.navigationMarkdown && <p>{venue.navigationMarkdown}</p>}
          {venue.mapQuery && (
            <a
              className="text-link"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.mapQuery)}`}
              rel="noreferrer"
            >
              Otevřít mapu
            </a>
          )}
        </article>
      ))}
      {state.data.content.practical.faqs.length > 0 && (
        <section>
          <h2>Časté otázky</h2>
          {state.data.content.practical.faqs.map((faq) => (
            <details key={faq.id}>
              <summary>{faq.question}</summary>
              <p>{faq.answerMarkdown}</p>
            </details>
          ))}
        </section>
      )}
    </div>
  );
};
