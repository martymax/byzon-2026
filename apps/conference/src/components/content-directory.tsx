'use client';

import Link from 'next/link';

import type { ApiPort } from '@/lib/api';

import {
  EmptyContent,
  ResourceStatus,
  useParticipantContent,
} from './content-state';

interface ContentProps {
  readonly eventId: string;
  readonly api?: ApiPort;
}

export const SpeakerDirectory = ({ eventId, api }: ContentProps) => {
  const state = useParticipantContent(eventId, api);
  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo="/app/recnici"
        state={state}
        onRetry={state.retry}
      />
    );
  }
  if (state.data.content.speakers.length === 0) {
    return (
      <EmptyContent
        title="Řečníci zatím nejsou zveřejnění"
        detail="Profily se tady objeví po další publikaci obsahu."
      />
    );
  }
  return (
    <ul className="card-grid">
      {state.data.content.speakers.map((speaker) => (
        <li key={speaker.id}>
          <Link href={`/app/recnici/${speaker.slug}`}>
            <strong>
              {speaker.firstName} {speaker.lastName}
            </strong>
            <span>{speaker.jobTitle || 'Profil řečníka'}</span>
            {speaker.company ? <span>{speaker.company}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
};

export const SpeakerDetail = ({
  eventId,
  slug,
  api,
}: ContentProps & { slug: string }) => {
  const state = useParticipantContent(eventId, api);
  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo={`/app/recnici/${encodeURIComponent(slug)}`}
        state={state}
        onRetry={state.retry}
      />
    );
  }
  const speaker = state.data.content.speakers.find(
    (item) => item.slug === slug,
  );
  if (!speaker) {
    return (
      <EmptyContent
        title="Řečník nebyl nalezen"
        detail="Profil mohl být odebraný v novější publikaci obsahu."
      />
    );
  }
  return (
    <article className="detail-card">
      <p className="eyebrow">Řečník</p>
      <h1 data-route-heading tabIndex={-1}>
        {speaker.firstName} {speaker.lastName}
      </h1>
      {speaker.jobTitle ? <p className="lead">{speaker.jobTitle}</p> : null}
      {speaker.company ? <p>{speaker.company}</p> : null}
      {speaker.bioMarkdown ? (
        <div className="prose">
          {speaker.bioMarkdown.split('\n\n').map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p>Podrobnosti o řečníkovi zatím nejsou zveřejněné.</p>
      )}
      <div className="link-row">
        {speaker.linkedinUrl ? (
          <a href={speaker.linkedinUrl} rel="noreferrer">
            LinkedIn
          </a>
        ) : null}
        {speaker.instagramUrl ? (
          <a href={speaker.instagramUrl} rel="noreferrer">
            Instagram
          </a>
        ) : null}
        {speaker.facebookUrl ? (
          <a href={speaker.facebookUrl} rel="noreferrer">
            Facebook
          </a>
        ) : null}
        {speaker.websiteUrl ? (
          <a href={speaker.websiteUrl} rel="noreferrer">
            Web
          </a>
        ) : null}
      </div>
      <Link className="text-link" href="/app/recnici">
        ← Zpět na řečníky
      </Link>
    </article>
  );
};

export const PartnerDirectory = ({ eventId, api }: ContentProps) => {
  const state = useParticipantContent(eventId, api);
  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo="/app/partneri"
        state={state}
        onRetry={state.retry}
      />
    );
  }
  if (state.data.content.partners.length === 0) {
    return (
      <EmptyContent
        title="Partneři zatím nejsou zveřejnění"
        detail="Seznam se tady objeví po další publikaci obsahu."
      />
    );
  }
  return (
    <ul className="card-grid">
      {state.data.content.partners.map((partner) => (
        <li key={partner.id}>
          <article>
            <strong>{partner.name}</strong>
            {partner.category ? <span>{partner.category}</span> : null}
            {partner.descriptionMarkdown ? (
              <span>{partner.descriptionMarkdown}</span>
            ) : null}
            {partner.websiteUrl ? (
              <a href={partner.websiteUrl} rel="noreferrer">
                Navštívit web
              </a>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
};

export const PracticalContent = ({ eventId, api }: ContentProps) => {
  const state = useParticipantContent(eventId, api);
  if (state.status !== 'ready') {
    return (
      <ResourceStatus
        loginReturnTo="/app/informace"
        state={state}
        onRetry={state.retry}
      />
    );
  }
  const { practical, venues } = state.data.content;
  if (
    practical.pages.length === 0 &&
    practical.faqs.length === 0 &&
    venues.length === 0
  ) {
    return (
      <EmptyContent
        title="Praktické informace zatím nejsou zveřejněné"
        detail="Pokyny k příjezdu a pobytu se tady objeví po další publikaci."
      />
    );
  }
  return (
    <div className="content-stack">
      {practical.pages.map((page) => (
        <article className="detail-card compact" key={page.id}>
          <h2>{page.title}</h2>
          {page.summary ? <p className="lead">{page.summary}</p> : null}
          <div className="prose">
            {page.bodyMarkdown.split('\n\n').map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>
        </article>
      ))}
      {venues.map((venue) => (
        <article className="detail-card compact" key={venue.id}>
          <h2>{venue.name}</h2>
          {[
            venue.addressLine1,
            venue.addressLine2,
            venue.city,
            venue.postalCode,
          ]
            .filter(Boolean)
            .join(', ') ? (
            <p>
              {[
                venue.addressLine1,
                venue.addressLine2,
                venue.city,
                venue.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          ) : null}
          {venue.navigationMarkdown ? <p>{venue.navigationMarkdown}</p> : null}
          {venue.accessibilityMarkdown ? (
            <p>
              <strong>Přístupnost:</strong> {venue.accessibilityMarkdown}
            </p>
          ) : null}
          {venue.mapQuery ? (
            <a
              className="text-link"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.mapQuery)}`}
              rel="noreferrer"
            >
              Otevřít mapu
            </a>
          ) : null}
        </article>
      ))}
      {practical.faqs.length > 0 ? (
        <section className="faq-section">
          <h2>Časté otázky</h2>
          {practical.faqs.map((faq) => (
            <details key={faq.id}>
              <summary>{faq.question}</summary>
              <div className="prose">
                {faq.answerMarkdown.split('\n\n').map((paragraph, index) => (
                  <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
};
