'use client';

import {
  ActionLink,
  Alert,
  Button,
  DestructiveConfirmation,
  StatePanel,
} from '@byzon/ui';
import {
  type ApiFailure,
  type IdentitySessionAction,
  type IdentitySessionActionProblem,
  type IdentitySessionActionResponse,
  type RequestId,
} from '@byzon/domain/contracts';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserIdentityApi,
  submitIdentitySessionAction,
} from '@/lib/identity-api';

type SessionActionFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

const actionCopy: Record<
  IdentitySessionAction,
  {
    readonly button: string;
    readonly title: string;
    readonly confirm: string;
    readonly description: string;
  }
> = {
  logout_current: {
    button: 'Odhlásit tento účet',
    title: 'Odhlásit tento účet?',
    confirm: 'Odhlásit',
    description:
      'V produkci by skončila pouze aktuální relace na tomto zařízení.',
  },
  logout_all: {
    button: 'Odhlásit všechna zařízení',
    title: 'Odhlásit všechna zařízení?',
    confirm: 'Odhlásit všechna',
    description: 'V produkci by byly zneplatněné všechny relace tohoto účtu.',
  },
  switch_account: {
    button: 'Použít jiný účet',
    title: 'Přepnout na jiný účet?',
    confirm: 'Pokračovat k jinému účtu',
    description:
      'Nejdřív je nutné ukončit vlastnický kontext a teprve potom zadat jiný e-mail.',
  },
};

const mapFailure = (
  failure: ApiFailure<IdentitySessionActionProblem>,
): SessionActionFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      if (
        failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
        failure.problem.code === 'AUTH_SESSION_EXPIRED'
      ) {
        return { kind: 'session_expired' };
      }
      if (
        failure.problem.code === 'SESSION_ACTION_REJECTED' ||
        failure.problem.code === 'REQUEST_ID_REUSED'
      ) {
        return { kind: 'rejected' };
      }
      return { kind: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        kind: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { kind: 'error' };
  }
};

const createRuntimeKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `session-action:${suffix}`;
};

export const SessionExitControls = ({
  api = browserIdentityApi,
  clearPrivateData = async () => 'none_present',
  createIdempotencyKey = createRuntimeKey,
}: {
  readonly api?: ApiPort;
  readonly clearPrivateData?: () => Promise<'cleared' | 'none_present'>;
  readonly createIdempotencyKey?: () => string;
}) => {
  const [pendingAction, setPendingAction] = useState<IdentitySessionAction>();
  const [outcome, setOutcome] = useState<{
    readonly response: IdentitySessionActionResponse;
    readonly localDisposition: 'cleared' | 'none_present';
  }>();
  const [failure, setFailure] = useState<SessionActionFailure>();
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const failureAlert = useRef<HTMLDivElement>(null);
  const attempt = useRef<
    | {
        readonly action: IdentitySessionAction;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focusFailure = () => {
    requestAnimationFrame(() => failureAlert.current?.focus());
  };

  const runAction = async () => {
    const action = pendingAction;
    if (!action || locked.current) return;
    locked.current = true;
    setWorking(true);
    setFailure(undefined);
    attempt.current =
      attempt.current?.action === action
        ? attempt.current
        : { action, idempotencyKey: createIdempotencyKey() };
    try {
      const result = await submitIdentitySessionAction(
        api,
        action,
        attempt.current.idempotencyKey,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        if (result.data.action !== action) {
          attempt.current = undefined;
          setPendingAction(undefined);
          setFailure({
            kind: 'error',
            requestId: result.metadata.requestId,
          });
          focusFailure();
          return;
        }
        const localDisposition = await clearPrivateData();
        if (!mounted.current) return;
        attempt.current = undefined;
        setPendingAction(undefined);
        setOutcome({ response: result.data, localDisposition });
        return;
      }
      if (!result.ok) {
        if (
          result.failure.kind === 'problem' ||
          result.failure.kind === 'session_expired'
        ) {
          attempt.current = undefined;
        }
        const mapped = mapFailure(result.failure);
        if (mapped) {
          setFailure(mapped);
          setPendingAction(undefined);
          focusFailure();
        }
      }
    } catch {
      if (mounted.current) {
        setFailure({ kind: 'error' });
        setPendingAction(undefined);
        focusFailure();
      }
    } finally {
      locked.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  if (outcome) {
    const { response } = outcome;
    return (
      <section className="session-controls" aria-label="Správa relace">
        <StatePanel
          action={
            <ActionLink href={response.continueTo}>
              {response.action === 'switch_account'
                ? 'Přejít k jinému účtu'
                : 'Pokračovat na úvod'}
            </ActionLink>
          }
          kind="empty"
          title={
            response.action === 'logout_all'
              ? 'Všechny relace byly v náhledu odpojené'
              : response.action === 'switch_account'
                ? 'Náhled je připravený pro jiný účet'
                : 'Aktuální relace byla v náhledu odpojená'
          }
        >
          <p>
            {response.effect === 'synthetic_preview'
              ? 'Jde pouze o syntetický výsledek: skutečná session se nezměnila.'
              : 'Server potvrdil změnu relace.'}{' '}
            {outcome.localDisposition === 'none_present'
              ? 'Lokální wipe seam potvrdil, že owner-scoped cache nebyla přítomná.'
              : 'Lokální wipe seam odstranil owner-scoped data z tohoto zařízení.'}{' '}
            Server hlásí stav {response.personalData.disposition}.
          </p>
        </StatePanel>
      </section>
    );
  }

  return (
    <section
      className="session-controls"
      aria-labelledby="session-controls-title"
    >
      <header>
        <p className="activation-kicker">Relace a účet</p>
        <h2 id="session-controls-title">Bezpečně změnit účet</h2>
        <p>
          Žádná akce nehledá ani nepotvrzuje cizí účet. V mock režimu pouze
          ověříte uživatelský průchod.
        </p>
      </header>

      {failure ? (
        <div ref={failureAlert} tabIndex={-1}>
          <Alert
            title={
              failure.kind === 'offline'
                ? 'Změna relace vyžaduje připojení'
                : failure.kind === 'session_expired'
                  ? 'Přihlášení už vypršelo'
                  : failure.kind === 'rejected'
                    ? 'Akci nelze bezpečně dokončit'
                    : 'Změna relace se nepodařila'
            }
            tone={failure.kind === 'error' ? 'danger' : 'warning'}
          >
            <p>
              {failure.kind === 'error' && failure.requestId
                ? `Podpoře předejte pouze referenci ${failure.requestId}.`
                : 'Žádný cizí účet ani jeho stav nebyl zobrazen.'}
            </p>
          </Alert>
        </div>
      ) : null}

      <div className="session-controls-actions">
        {(Object.keys(actionCopy) as IdentitySessionAction[]).map((action) => (
          <Button
            disabled={working}
            key={action}
            onClick={() => {
              setFailure(undefined);
              setPendingAction(action);
            }}
            variant={action === 'logout_all' ? 'danger' : 'secondary'}
          >
            {actionCopy[action].button}
          </Button>
        ))}
      </div>

      <DestructiveConfirmation
        actionLabel={
          pendingAction ? actionCopy[pendingAction].confirm : 'Pokračovat'
        }
        onCancel={() => {
          if (!working) setPendingAction(undefined);
        }}
        onConfirm={() => void runAction()}
        open={pendingAction !== undefined}
        title={
          pendingAction ? actionCopy[pendingAction].title : 'Změnit relaci?'
        }
        working={working}
      >
        <p>
          {pendingAction
            ? actionCopy[pendingAction].description
            : 'Nejdřív vyberte konkrétní akci.'}
        </p>
        <p className="preview-disclaimer">
          V této ukázce nevznikla skutečná session, takže se pouze simuluje
          bezpečný canonical výsledek.
        </p>
      </DestructiveConfirmation>
    </section>
  );
};
