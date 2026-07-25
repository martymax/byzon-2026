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
    title: 'Oprávnění k akci už nejsou dostupná',
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
  supportReference,
}: {
  readonly kind?: AccessProblemKind;
  readonly sessionApi?: ApiPort;
  readonly supportReference?: string;
}) => {
  const state = copy[kind];
  const reference =
    supportReference ??
    (kind === 'revoked' ? 'MOCK-REVOKED-2026' : 'MOCK-SUSPENDED-2026');
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
            Bezpečná reference: <code>{reference}</code>
          </p>
        ) : null}
      </StatePanel>
      <aside className="preview-disclaimer" aria-label="Omezení ukázky">
        Jde o syntetický stav přístupu. Produkční oprávnění ani osobní data
        nejsou načtené.
      </aside>
      <nav aria-label="Náhled dalších stavů přístupu">
        <p className="activation-kicker">Vyzkoušet bezpečné varianty</p>
        <div className="session-controls-actions">
          <ActionLink href="/chyba-pristupu">Pozastavený přístup</ActionLink>
          <ActionLink href="/chyba-pristupu/zrusen" variant="secondary">
            Zrušený přístup
          </ActionLink>
          <ActionLink href="/chyba-pristupu/zakazano" variant="secondary">
            Chybějící oprávnění
          </ActionLink>
          <ActionLink
            href="/chyba-pristupu/vyprsele-prihlaseni"
            variant="secondary"
          >
            Vypršelé přihlášení
          </ActionLink>
        </div>
      </nav>
      {kind === 'session_expired' ? null : (
        <SessionExitControls {...(sessionApi ? { api: sessionApi } : {})} />
      )}
    </section>
  );
};
