'use client';

import { Card } from '@byzon/ui';

import { useParticipantAccountResource } from '@/components/participant-account-resource';
import { ParticipantAccountBoundary } from '@/components/participant-account-state';
import { SessionExitControls } from '@/components/session-exit-controls';
import type { ApiPort } from '@/lib/api';
import { browserIdentityApi } from '@/lib/identity-api';

export const ParticipantAccountSettings = ({
  api = browserIdentityApi,
}: {
  readonly api?: ApiPort;
}) => {
  const resource = useParticipantAccountResource();
  return (
    <section className="app-page participant-account-page account-settings-page">
      <header className="participant-account-heading">
        <p className="eyebrow">Účet</p>
        <h1 data-route-heading tabIndex={-1}>
          Nastavení účtu
        </h1>
        <p className="lead">
          Ověřte aktuální kontext a bezpečně ukončete jedno nebo všechna
          přihlášení, případně přepněte účet.
        </p>
      </header>

      <ParticipantAccountBoundary loginReturnTo="/app/nastaveni">
        {(identity) => (
          <div className="participant-account-stack">
            <Card className="participant-account-summary">
              <p className="activation-kicker">Aktuální kontext</p>
              <h2>{identity.event.name}</h2>
              <dl className="participant-account-details">
                <div>
                  <dt>Přihlášený účet</dt>
                  <dd>{identity.user.email}</dd>
                </div>
                <div>
                  <dt>Přístup</dt>
                  <dd>Aktivní účastník</dd>
                </div>
              </dl>
            </Card>
            <Card className="participant-support-card">
              <p className="activation-kicker">Podpora</p>
              <h2>Problém s účtem nebo přihlášením?</h2>
              <p>
                Podpoře nikdy neposílejte heslo, jednorázový odkaz, aktivační
                kód ani obsah vstupenky.
              </p>
              <a className="text-link" href={`mailto:${identity.supportEmail}`}>
                Napsat podpoře na {identity.supportEmail}
              </a>
            </Card>
          </div>
        )}
      </ParticipantAccountBoundary>

      <SessionExitControls
        api={api}
        clearPrivateData={resource.clearPrivateData}
        loginReturnTo="/app/nastaveni"
      />
    </section>
  );
};
