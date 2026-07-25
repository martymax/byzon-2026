'use client';

import { ActionLink, StatePanel } from '@byzon/ui';

import { SessionExitControls } from '@/components/session-exit-controls';
import type { ApiPort } from '@/lib/api';

export type AccessProblemKind =
  'suspended' | 'revoked' | 'forbidden' | 'session_expired';

const copy: Record<
  AccessProblemKind,
  {
    readonly title: string;
    readonly heading: string;
    readonly kind: 'permission' | 'session-expired';
  }
> = {
  suspended: {
    heading: 'Přístup je pozastavený',
    title: 'Aktivace jej sama neobnoví',
    kind: 'permission',
  },
  revoked: {
    heading: 'Přístup byl zrušený',
    title: 'Eventová oprávnění už nejsou dostupná',
    kind: 'permission',
  },
  forbidden: {
    heading: 'Tudy nelze pokračovat',
    title: 'K této části nemáte oprávnění',
    kind: 'permission',
  },
  session_expired: {
    heading: 'Přihlášení vypršelo',
    title: 'Obnovte přístup bezpečným odkazem',
    kind: 'session-expired',
  },
};

export const AccessProblem = ({
  kind = 'suspended',
  sessionApi,
  supportReference = 'MOCK-SUSPENDED-2026',
}: {
  readonly kind?: AccessProblemKind;
  readonly sessionApi?: ApiPort;
  readonly supportReference?: string;
}) => {
  const state = copy[kind];
  return (
    <section className="access-problem-page">
      <header>
        <p className="eyebrow">Bezpečný stav přístupu</p>
        <h1 data-route-heading tabIndex={-1}>
          {state.heading}
        </h1>
        <p className="lead">
          Nezobrazujeme jméno, e-mail, ticket ani stav jiného účtu.
        </p>
      </header>
      <StatePanel
        action={
          kind === 'session_expired' ? (
            <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fapp">
              Obnovit přihlášení
            </ActionLink>
          ) : (
            <ActionLink href="#session-controls-title">
              Bezpečně změnit účet
            </ActionLink>
          )
        }
        kind={state.kind}
        title={state.title}
      >
        <p>
          {kind === 'suspended' || kind === 'revoked'
            ? 'Kontaktujte podporu. Přístup se nesmí automaticky znovu aktivovat.'
            : kind === 'forbidden'
              ? 'Vraťte se na úvod nebo použijte účet s vlastním oprávněním.'
              : 'Ticket kód ani jednorázový token do návratové adresy nepřenášíme.'}
        </p>
        {kind === 'suspended' || kind === 'revoked' ? (
          <p>
            Bezpečná reference: <code>{supportReference}</code>
          </p>
        ) : null}
      </StatePanel>
      <aside className="preview-disclaimer" aria-label="Omezení ukázky">
        Jde o syntetický access-error stav. Produkční membership ani osobní data
        nejsou načtené.
      </aside>
      <SessionExitControls {...(sessionApi ? { api: sessionApi } : {})} />
    </section>
  );
};
