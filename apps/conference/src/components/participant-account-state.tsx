'use client';

import { ActionLink, Button, Skeleton, StatePanel } from '@byzon/ui';
import type { IdentityBootstrapResponse } from '@byzon/domain/contracts';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import {
  useParticipantAccountResource,
  type ParticipantAccountResourceState,
} from '@/components/participant-account-resource';
import { requestClientNavigation } from '@/lib/client-navigation-events';

const accountLoginHref = (
  mode: 'recovery' | 'switch',
  returnTo: ParticipantAccountReturnTo,
): string =>
  `/prihlaseni?mode=${mode}&returnTo=${encodeURIComponent(returnTo)}`;

const AccountFailure = ({
  loginReturnTo,
  retry,
  state,
}: {
  readonly loginReturnTo: ParticipantAccountReturnTo;
  readonly retry: () => void;
  readonly state: Exclude<
    ParticipantAccountResourceState,
    { status: 'idle' | 'loading' | 'ready' }
  >;
}) => {
  if (state.status === 'offline') {
    return (
      <StatePanel
        action={<Button onClick={retry}>Zkusit znovu</Button>}
        kind="offline"
        title="Účet bez připojení neotevřeme"
      >
        <p>
          Profil a žádosti o soukromí se do zařízení neukládají. Připojte se a
          načtěte aktuální stav ze serveru.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'session_expired') {
    return (
      <StatePanel
        action={
          <ActionLink href={accountLoginHref('recovery', loginReturnTo)}>
            Obnovit přihlášení
          </ActionLink>
        }
        kind="session-expired"
        title="Přihlášení vypršelo"
      >
        <p>
          Osobní údaje jsme odstranili z paměti stránky. Po bezpečném přihlášení
          načteme účet znovu.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'cleared') {
    return (
      <StatePanel kind="empty" title="Údaje účtu už nejsou na stránce">
        <p>
          Po potvrzené změně přihlášení jsme osobní údaje odstranili z paměti
          stránky.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'pending_activation') {
    return (
      <StatePanel
        action={<ActionLink href="/onboarding">Dokončit aktivaci</ActionLink>}
        kind="permission"
        title="Účet ještě není připravený"
      >
        <p>
          Dokončete aktivaci a povinné úvodní kroky. Do té doby profil ani
          žádosti o soukromí nezobrazujeme.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'suspended' || state.status === 'revoked') {
    return (
      <StatePanel kind="permission" title="Přístup k účtu není dostupný">
        <p>
          Profil ani další osobní údaje nezobrazujeme. Podpoře předejte pouze
          bezpečnou referenci <code>{state.supportReference}</code>.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'permission') {
    return (
      <StatePanel
        action={
          <ActionLink
            href={accountLoginHref('switch', loginReturnTo)}
            variant="secondary"
          >
            Použít jiný účet
          </ActionLink>
        }
        kind="permission"
        title="K účtu nemáte přístup"
      >
        <p>
          Nepotvrzujeme, zda jiný účet nebo profil existuje. Použijte vlastní
          účastnické přihlášení.
        </p>
      </StatePanel>
    );
  }
  return (
    <StatePanel
      action={<Button onClick={retry}>Načíst znovu</Button>}
      kind="error"
      title="Účet se nepodařilo načíst"
    >
      <p>
        Starší osobní údaje nezobrazujeme. Zopakujte bezpečné načtení ze
        serveru.
      </p>
      {'requestId' in state && state.requestId ? (
        <p className="request-reference">
          Reference pro podporu: <code>{state.requestId}</code>
        </p>
      ) : null}
    </StatePanel>
  );
};

export type ParticipantAccountReturnTo =
  '/app/vice' | '/app/profil' | '/app/soukromi' | '/app/nastaveni';

const defaultNavigate = requestClientNavigation;

export const ParticipantAccountBoundary = ({
  children,
  loginReturnTo,
  navigate = defaultNavigate,
}: {
  readonly children: (
    data: IdentityBootstrapResponse,
    resource: ReturnType<typeof useParticipantAccountResource>,
  ) => ReactNode;
  readonly loginReturnTo: ParticipantAccountReturnTo;
  readonly navigate?: (href: string) => void;
}) => {
  const resource = useParticipantAccountResource();
  const retryResource = resource.retry;
  const recoverAfterRetry = useRef(false);
  const recoveryLoginHref = accountLoginHref('recovery', loginReturnTo);
  const switchLoginHref = accountLoginHref('switch', loginReturnTo);
  const retry = useCallback(() => {
    recoverAfterRetry.current = true;
    retryResource();
  }, [retryResource]);

  useEffect(() => {
    if (
      !recoverAfterRetry.current ||
      resource.state.status === 'idle' ||
      resource.state.status === 'loading'
    ) {
      return;
    }
    recoverAfterRetry.current = false;
    if (resource.state.status === 'session_expired') {
      navigate(recoveryLoginHref);
    } else if (resource.state.status === 'permission') {
      navigate(switchLoginHref);
    }
  }, [navigate, recoveryLoginHref, resource.state.status, switchLoginHref]);

  if (resource.state.status === 'idle' || resource.state.status === 'loading') {
    return (
      <Skeleton
        className="participant-account-loading"
        label="Načítám zabezpečené údaje účtu"
        lines={5}
      />
    );
  }
  if (resource.state.status !== 'ready') {
    return (
      <AccountFailure
        loginReturnTo={loginReturnTo}
        retry={retry}
        state={resource.state}
      />
    );
  }
  return children(resource.state.data, resource);
};
