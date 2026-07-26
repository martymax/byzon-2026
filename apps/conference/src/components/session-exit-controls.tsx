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
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
} from '@/lib/private-resource-events';
import { useTransitionFocus } from '@/components/use-transition-focus';

type SessionActionFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'in_progress' }
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
      'V produkci by skončilo pouze aktuální přihlášení na tomto zařízení.',
  },
  logout_all: {
    button: 'Odhlásit všechna zařízení',
    title: 'Odhlásit všechna zařízení?',
    confirm: 'Odhlásit všechna',
    description: 'V produkci by byla ukončena všechna přihlášení tohoto účtu.',
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
        failure.problem.code === 'REQUEST_ID_REUSED' ||
        failure.problem.code === 'IDEMPOTENCY_KEY_REUSED'
      ) {
        return { kind: 'rejected' };
      }
      if (failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS') {
        return { kind: 'in_progress' };
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

type SessionCleanupReason = 'logout' | 'switch_account';

const cleanupReasonForAction = (
  action: IdentitySessionAction,
): SessionCleanupReason =>
  action === 'switch_account' ? 'switch_account' : 'logout';

const clearPersistedPrivateData = async (
  reason: SessionCleanupReason,
): Promise<'none_present'> => {
  await invalidateParticipantPrivateResources('session_expired', reason);
  return 'none_present';
};

export const SessionExitControls = ({
  api = browserIdentityApi,
  clearPrivateData = clearPersistedPrivateData,
  createIdempotencyKey = createRuntimeKey,
  loginReturnTo = '/app',
}: {
  readonly api?: ApiPort;
  readonly clearPrivateData?: (
    reason: SessionCleanupReason,
  ) => Promise<'cleared' | 'none_present'>;
  readonly createIdempotencyKey?: () => string;
  readonly loginReturnTo?: '/app' | '/app/nastaveni';
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
  const outcomeHeading = useTransitionFocus(outcome !== undefined);
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
      if (result.ok && result.kind === 'success') {
        const cleanupReason = cleanupReasonForAction(action);
        if (result.data.action !== action) {
          await clearPrivateData(cleanupReason);
          if (mounted.current) {
            setPendingAction(undefined);
            setFailure({
              kind: 'error',
              requestId: result.metadata.requestId,
            });
            focusFailure();
          }
          return;
        }
        const localDisposition = await clearPrivateData(cleanupReason);
        if (!mounted.current) return;
        attempt.current = undefined;
        setPendingAction(undefined);
        setOutcome({ response: result.data, localDisposition });
        return;
      }
      if (!result.ok) {
        if (!shouldRetainMutationKey(result.failure)) {
          attempt.current = undefined;
        }
        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          await clearPrivateData(cleanupReasonForAction(action));
        }
        const mapped =
          invalidation === 'session_expired'
            ? ({ kind: 'session_expired' } as const)
            : mapFailure(result.failure);
        if (mapped) {
          if (mapped.kind === 'session_expired' && invalidation === null) {
            await clearPrivateData(cleanupReasonForAction(action));
          }
          if (!mounted.current) return;
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
      <section className="session-controls" aria-label="Správa přihlášení">
        <h2 ref={outcomeHeading} tabIndex={-1}>
          Správa přihlášení
        </h2>
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
              ? 'Všechna přihlášení byla v náhledu ukončena'
              : response.action === 'switch_account'
                ? 'Náhled je připravený pro jiný účet'
                : 'Aktuální přihlášení bylo v náhledu ukončeno'
          }
        >
          <p>
            {response.effect === 'synthetic_preview'
              ? 'Jde pouze o syntetický výsledek: skutečné přihlášení se nezměnilo.'
              : 'Server potvrdil změnu přihlášení.'}{' '}
            {outcome.localDisposition === 'none_present'
              ? 'V zařízení nebyla nalezena žádná osobní data tohoto účtu.'
              : 'Osobní data tohoto účtu byla ze zařízení odstraněna.'}
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
        <p className="activation-kicker">Přihlášení a účet</p>
        <h2 id="session-controls-title">Bezpečně změnit účet</h2>
        <p>
          Žádná akce nehledá ani nepotvrzuje cizí účet. V mock režimu pouze
          ověříte uživatelský průchod.
        </p>
      </header>

      {failure ? (
        <div ref={failureAlert} tabIndex={-1}>
          <Alert
            action={
              failure.kind === 'session_expired' ? (
                <ActionLink
                  href={`/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
                    loginReturnTo,
                  )}`}
                >
                  Přihlásit se znovu
                </ActionLink>
              ) : undefined
            }
            title={
              failure.kind === 'offline'
                ? 'Změna přihlášení vyžaduje připojení'
                : failure.kind === 'session_expired'
                  ? 'Přihlášení už vypršelo'
                  : failure.kind === 'in_progress'
                    ? 'Akce se ještě zpracovává'
                    : failure.kind === 'rejected'
                      ? 'Akci nelze bezpečně dokončit'
                      : 'Změna přihlášení se nepodařila'
            }
            tone={failure.kind === 'error' ? 'danger' : 'warning'}
          >
            <p>
              {failure.kind === 'in_progress'
                ? 'Chvíli počkejte a potom bezpečně zopakujte stejnou akci.'
                : failure.kind === 'error' && failure.requestId
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
          pendingAction ? actionCopy[pendingAction].title : 'Změnit přihlášení?'
        }
        working={working}
      >
        <p>
          {pendingAction
            ? actionCopy[pendingAction].description
            : 'Nejdřív vyberte konkrétní akci.'}
        </p>
        <p className="preview-disclaimer">
          V této ukázce nevzniklo skutečné přihlášení, proto pouze ověřujeme
          bezpečný uživatelský průchod.
        </p>
      </DestructiveConfirmation>
    </section>
  );
};
