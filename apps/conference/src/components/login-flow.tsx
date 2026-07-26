'use client';

import { ActionLink, Button, Skeleton, StatePanel } from '@byzon/ui';
import type { ReactNode } from 'react';

import { AccessProblem } from '@/components/access-problem';
import { ActivationIdentity } from '@/components/activation-identity';
import { useActivationEntry } from '@/components/activation-entry';
import { RecoveryForm } from '@/components/recovery-form';
import type { ApiPort } from '@/lib/api';
import { browserActivationApi } from '@/lib/activation-api';
import type { ActivationReturnTo } from '@/lib/activation-return';
import type { LoginMode } from '@/lib/login-mode';

const LoginGate = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <section className="activation-form-page">
    <p className="eyebrow">Bezpečné přihlášení</p>
    <h1 data-route-heading tabIndex={-1}>
      {title}
    </h1>
    {children}
  </section>
);

export const LoginFlow = ({
  api = browserActivationApi,
  mode,
  presentation = 'recovery',
  returnTo,
}: {
  readonly api?: ApiPort;
  readonly mode: Extract<LoginMode, 'recovery' | 'switch'>;
  readonly presentation?: 'login' | 'recovery';
  readonly returnTo: ActivationReturnTo;
}) => {
  const entry = useActivationEntry(api);

  if (entry.status === 'loading') {
    return (
      <LoginGate title="Ověřuji bezpečný stav">
        <Skeleton label="Ověřuji rozpracovanou aktivaci" lines={4} />
      </LoginGate>
    );
  }

  if (entry.status === 'offline' || entry.status === 'error') {
    return (
      <LoginGate title="Přihlášení teď nelze otevřít">
        <StatePanel
          action={<Button onClick={entry.retry}>Zkusit znovu</Button>}
          kind={entry.status === 'offline' ? 'offline' : 'error'}
          title={
            entry.status === 'offline'
              ? 'Ověření vyžaduje připojení'
              : 'Serverový stav není dostupný'
          }
        >
          <p>
            Než zobrazíme obnovu účtu, musíme bezpečně ověřit, zda nepokračuje
            rozpracovaná aktivace.
          </p>
        </StatePanel>
      </LoginGate>
    );
  }

  if (
    entry.status === 'ready' &&
    entry.data.flow.state === 'claim_in_progress'
  ) {
    if (entry.data.flow.nextStep === 'onboarding') {
      return (
        <LoginGate title="Pokračujte k nastavení účasti">
          <StatePanel
            action={
              <ActionLink href="/onboarding">Otevřít onboarding</ActionLink>
            }
            kind="empty"
            title="Ověření identity už je dokončené"
          >
            <p>Server potvrdil další krok bez opakovaného zadávání e-mailu.</p>
          </StatePanel>
        </LoginGate>
      );
    }
    return <ActivationIdentity api={api} returnTo={returnTo} />;
  }

  if (entry.status === 'ready' && entry.data.flow.state === 'suspended') {
    return (
      <AccessProblem
        kind="suspended"
        supportReference={entry.data.flow.supportReference}
      />
    );
  }

  return (
    <RecoveryForm
      api={api}
      mode={mode}
      presentation={presentation}
      returnTo={returnTo}
    />
  );
};
