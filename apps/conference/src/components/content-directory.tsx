'use client';

import Link from 'next/link';

import type {
  ParticipantProgramResponse,
  ParticipantSessionType,
  PublishedContent,
} from '@byzon/domain/contracts';
import { useState } from 'react';

import type { ApiPort } from '@/lib/api';

import {
  EmptyContent,
  ResourceStatus,
  useParticipantContent,
  useParticipantProgram,
} from './content-state';

interface ContentProps {
  readonly eventId: string;
  readonly api?: ApiPort;
}

type PublishedPartner = PublishedContent['partners'][number];
type PublishedSpeaker = PublishedContent['speakers'][number];

const sessionTypeLabels = {
  talk: 'Přednáška',
  panel: 'Panelová diskuse',
  workshop: 'Workshop',
  mastermind: 'Mastermind',
  coaching: 'Koučink',
  networking: 'Networking',
  break: 'Přestávka',
  meal: 'Občerstvení',
  gala: 'Galavečer',
  other: 'Program',
} satisfies Record<ParticipantSessionType, string>;

const speakerSessionTime = (value: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'čas bude upřesněn';
  }
};

const speakerSessionDay = (value: string, timezone: string): string => {
  try {
    const label = new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'long',
      timeZone: timezone,
    }).format(new Date(value));
    return `${label.charAt(0).toLocaleUpperCase('cs-CZ')}${label.slice(1)}`;
  } catch {
    return 'Termín bude upřesněn';
  }
};

const SpeakerProgram = ({
  program,
  speaker,
  timezone,
}: {
  readonly program: ParticipantProgramResponse['program'];
  readonly speaker: PublishedSpeaker;
  readonly timezone: string;
}) => {
  const sessions = program.sessions
    .filter((session) => session.speakerIds?.includes(speaker.id))
    .sort(
      (first, second) =>
        Date.parse(first.startsAt) - Date.parse(second.startsAt) ||
        first.sortOrder - second.sortOrder,
    );
  if (sessions.length === 0) return null;

  const roomById = new Map(program.rooms.map((room) => [room.id, room]));
  const headingId = `speaker-program-${speaker.id}`;

  return (
    <section className="speaker-program" aria-labelledby={headingId}>
      <div className="speaker-program__head">
        <p className="eyebrow">Kde se potkáme</p>
        <h2 id={headingId}>V programu</h2>
      </div>
      <ul className="speaker-program__list">
        {sessions.map((session) => {
          const room = session.roomId ? roomById.get(session.roomId) : null;
          const detailLabel =
            session.type === 'talk'
              ? 'Detail přednášky'
              : 'Detail bodu programu';
          return (
            <li key={session.id}>
              <Link
                aria-label={`${detailLabel}: ${session.title}`}
                className="speaker-session-card"
                href={`/app/program/${session.id}`}
              >
                <p className="speaker-session-card__meta">
                  <span className="speaker-session-card__kind">
                    {sessionTypeLabels[session.type]}
                  </span>
                  <span>
                    {speakerSessionDay(session.startsAt, timezone)} ·{' '}
                    {speakerSessionTime(session.startsAt, timezone)}–
                    {speakerSessionTime(session.endsAt, timezone)}
                    {room ? ` · ${room.name}` : ''}
                    {session.status === 'cancelled' ? ' · Zrušeno' : ''}
                  </span>
                </p>
                <h3>{session.title}</h3>
                {session.summary ? (
                  <p className="speaker-session-card__annotation">
                    {session.summary}
                  </p>
                ) : null}
                <span className="speaker-session-card__action">
                  {detailLabel}
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="20"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.4"
                    viewBox="0 0 24 24"
                    width="20"
                  >
                    <line x1="5" x2="19" y1="12" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const SpeakerPortrait = ({
  speaker,
  detail = false,
}: {
  readonly speaker: PublishedSpeaker;
  readonly detail?: boolean;
}) => {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const name = `${speaker.firstName} ${speaker.lastName}`;
  const imageVisible = Boolean(speaker.photoAssetId) && !imageUnavailable;

  return (
    <div
      className={
        detail
          ? 'speaker-portrait speaker-portrait--detail'
          : 'speaker-portrait'
      }
    >
      {imageVisible ? (
        // Public content assets are pre-sized WebP files resolved through an
        // allowlisted route; intrinsic dimensions reserve space before load.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={detail ? `Portrét – ${name}` : ''}
          decoding="async"
          fetchPriority={detail ? 'high' : 'auto'}
          height="900"
          loading={detail ? 'eager' : 'lazy'}
          onError={() => setImageUnavailable(true)}
          src={`/api/v1/public/assets/${speaker.photoAssetId}`}
          width="720"
        />
      ) : (
        <span aria-hidden="true" className="speaker-portrait__fallback">
          {speaker.firstName.charAt(0)}
          {speaker.lastName.charAt(0)}
        </span>
      )}
    </div>
  );
};

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
    <ul className="card-grid speaker-grid">
      {state.data.content.speakers.map((speaker) => (
        <li key={speaker.id}>
          <Link className="speaker-card" href={`/app/recnici/${speaker.slug}`}>
            <SpeakerPortrait speaker={speaker} />
            <span className="speaker-card__body">
              <strong>
                {speaker.firstName} {speaker.lastName}
              </strong>
              <span>{speaker.jobTitle || 'Profil řečníka'}</span>
              {speaker.company ? <span>{speaker.company}</span> : null}
            </span>
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
  const programState = useParticipantProgram(eventId, api);
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
    <article className="detail-card speaker-detail-card">
      <SpeakerPortrait detail speaker={speaker} />
      <div className="speaker-detail-card__content">
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
        {programState.status === 'ready' ? (
          <SpeakerProgram
            program={programState.data.program}
            speaker={speaker}
            timezone={state.data.content.event.timezone}
          />
        ) : null}
        <Link className="text-link" href="/app/recnici">
          ← Zpět na řečníky
        </Link>
      </div>
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
  return <PartnerLogoGrid partners={state.data.content.partners} />;
};

const PartnerLogo = ({ partner }: { readonly partner: PublishedPartner }) => {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const logoVisible = Boolean(partner.logoAssetId) && !logoUnavailable;
  const content = (
    <>
      {logoVisible ? (
        // Public content assets are resolved through an allowlisted server route.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={partner.name}
          loading="lazy"
          onError={() => setLogoUnavailable(true)}
          src={`/api/v1/public/assets/${partner.logoAssetId}`}
        />
      ) : (
        <span className="participant-partner-fallback">{partner.name}</span>
      )}
    </>
  );

  return partner.websiteUrl ? (
    <a
      aria-label={`${partner.name} – web partnera (otevře se v novém panelu)`}
      className="participant-partner-logo"
      href={partner.websiteUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      {content}
    </a>
  ) : (
    <div className="participant-partner-logo">{content}</div>
  );
};

export const PartnerLogoGrid = ({
  partners,
}: {
  readonly partners: readonly PublishedPartner[];
}) => (
  <ul className="participant-partners-grid">
    {partners.map((partner) => (
      <li key={partner.id}>
        <PartnerLogo partner={partner} />
      </li>
    ))}
  </ul>
);

export const ParticipantPartnersFooter = ({
  partners,
}: {
  readonly partners: readonly PublishedPartner[];
}) => {
  if (partners.length === 0) return null;
  return (
    <footer
      aria-labelledby="participant-partners-heading"
      className="home-partners-footer"
      data-testid="participant-partners-footer"
      id="partneri"
    >
      <div className="home-partners-heading">
        <p className="home-section-kicker">Spolupracujeme</p>
        <h2 id="participant-partners-heading">Naši partneři</h2>
      </div>
      <PartnerLogoGrid partners={partners} />
    </footer>
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
