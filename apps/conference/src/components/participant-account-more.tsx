'use client';

import { ActionLink, Card } from '@byzon/ui';

import { ParticipantAccountBoundary } from '@/components/participant-account-state';

const SupportLink = ({ email }: { readonly email: string }) => (
  <a className="text-link" href={`mailto:${email}`}>
    Napsat podpoře na {email}
  </a>
);

export const ParticipantMoreHub = () => (
  <section className="app-page participant-account-page participant-more-page">
    <header className="participant-account-heading">
      <p className="eyebrow">Více</p>
      <h1 data-route-heading tabIndex={-1}>
        Účet a informace
      </h1>
      <p className="lead">
        Spravujte jen nezbytné údaje, právní dokumenty, soukromí a přihlášení na
        jednom místě.
      </p>
    </header>

    <ParticipantAccountBoundary loginReturnTo="/app/vice">
      {(identity) => (
        <div className="participant-account-stack">
          <Card className="participant-account-summary">
            <p className="activation-kicker">Aktuální účet</p>
            <h2>
              {identity.profile
                ? `${identity.profile.firstName} ${identity.profile.lastName}`
                : 'Profil čeká na dokončení'}
            </h2>
            <p>{identity.event.name}</p>
            <p className="participant-account-secondary">
              Přihlášení: {identity.user.email}
            </p>
          </Card>

          <nav
            aria-label="Účet a další informace"
            className="participant-more-grid"
          >
            <ActionLink block href="/app/profil">
              Profilové údaje
            </ActionLink>
            <ActionLink block href="/app/soukromi" variant="secondary">
              Soukromí a právní dokumenty
            </ActionLink>
            <ActionLink block href="/app/nastaveni" variant="secondary">
              Nastavení a přihlášení
            </ActionLink>
            <ActionLink block href="/app/vstupenka" variant="secondary">
              Vstupenka
            </ActionLink>
            <ActionLink block href="/app/informace" variant="secondary">
              Praktické informace
            </ActionLink>
            <ActionLink block href="/app/recnici" variant="secondary">
              Řečníci
            </ActionLink>
            <ActionLink block href="/app/partneri" variant="secondary">
              Partneři
            </ActionLink>
            <ActionLink block href="/app/networking" variant="secondary">
              Networkingový adresář
            </ActionLink>
          </nav>

          <Card className="participant-support-card">
            <p className="activation-kicker">Potřebujete pomoc?</p>
            <h2>Kontakt na podporu</h2>
            <p>
              Do zprávy neposílejte heslo, aktivační kód ani obsah vstupenky.
              Stačí popsat problém a případně přidat bezpečnou referenci
              požadavku.
            </p>
            <SupportLink email={identity.supportEmail} />
          </Card>
        </div>
      )}
    </ParticipantAccountBoundary>
  </section>
);
