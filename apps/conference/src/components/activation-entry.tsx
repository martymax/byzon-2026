'use client';

import { ActionLink, Card, Skeleton, StatePanel, StatusBadge } from '@byzon/ui';
import type {
  ActivationLandingProblem,
  ActivationLandingResponse,
  ApiFailure,
  RequestId,
} from '@byzon/domain/contracts';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { ApiPort, ApiResult } from '@/lib/api';
import {
  browserActivationApi,
  requestActivationLanding,
} from '@/lib/activation-api';
import { SessionExitControls } from '@/components/session-exit-controls';

export type ActivationEntryState =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'closed' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'error'; readonly requestId?: RequestId }
  | {
      readonly status: 'ready';
      readonly data: ActivationLandingResponse;
    };

const AUTOMATIC_SAFE_READ_RETRY_MS = 1_000;

const waitForSafeReadRetry = (
  signal: AbortSignal,
  delayMs = AUTOMATIC_SAFE_READ_RETRY_MS,
): Promise<boolean> => {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const cancel = () => {
      globalThis.clearTimeout(timeout);
      resolve(false);
    };
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve(true);
    }, delayMs);
    signal.addEventListener('abort', cancel, { once: true });
  });
};

const mapFailure = (
  failure: ApiFailure<ActivationLandingProblem>,
): Exclude<ActivationEntryState, { readonly status: 'ready' }> | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
      return { status: 'session_expired' };
    case 'problem':
      return failure.problem.code === 'ACTIVATION_CLOSED'
        ? { status: 'closed' }
        : { status: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        status: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { status: 'error' };
  }
};

export const useActivationEntry = (
  api: ApiPort = browserActivationApi,
): ActivationEntryState & { readonly retry: () => void } => {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    ActivationEntryState & { readonly attempt: number }
  >({ status: 'loading', attempt: 0 });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      let result: ApiResult<
        ActivationLandingResponse,
        ActivationLandingProblem
      > = await requestActivationLanding(api, controller.signal);
      if (
        !result.ok &&
        result.failure.kind === 'invalid_response' &&
        (await waitForSafeReadRetry(controller.signal))
      ) {
        result = await requestActivationLanding(api, controller.signal);
      }
      if (controller.signal.aborted) return;
      if (result.ok) {
        setState(
          result.kind === 'success'
            ? { status: 'ready', data: result.data, attempt }
            : { status: 'error', attempt },
        );
        return;
      }
      const failure = mapFailure(result.failure);
      if (failure) setState({ ...failure, attempt });
    };

    void load().catch(() => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', attempt });
      }
    });
    return () => controller.abort();
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current: ActivationEntryState =
    state.attempt === attempt ? state : { status: 'loading' };
  return { ...current, retry };
};

const ActivationIcon = ({ children }: { readonly children: ReactNode }) => (
  <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
  >
    {children}
  </svg>
);

const activationClosedCopy = {
  not_open_yet: {
    title: 'Aktivace ještě není otevřená',
    detail:
      'Až pořadatel aktivaci spustí, budete tady moci použít kód nebo kameru.',
  },
  event_ended: {
    title: 'Aktivace už skončila',
    detail:
      'Akce už proběhla. Pokud potřebujete obnovit existující přístup, použijte přihlášení.',
  },
  event_archived: {
    title: 'Ročník je archivovaný',
    detail:
      'Nový přístup už nelze aktivovat. Stávající účet lze spravovat přes přihlášení.',
  },
} as const;

const ActivationFlow = ({
  response,
}: {
  readonly response: ActivationLandingResponse;
}) => {
  if (response.availability.state === 'closed') {
    const copy = activationClosedCopy[response.availability.reason];
    return (
      <StatePanel
        action={
          <ActionLink
            href="/prihlaseni?mode=recovery&returnTo=%2Fapp"
            variant="secondary"
          >
            Přejít k přihlášení
          </ActionLink>
        }
        kind="empty"
        title={copy.title}
      >
        <p>{copy.detail}</p>
      </StatePanel>
    );
  }

  if (response.flow.state === 'claim_in_progress') {
    const nextHref =
      response.flow.nextStep === 'identity' ? '/prihlaseni' : '/onboarding';
    return (
      <StatePanel
        action={<ActionLink href={nextHref}>Pokračovat v aktivaci</ActionLink>}
        kind="stale"
        title="Aktivace je rozpracovaná"
      >
        <p>
          Bezpečně navážeme dalším krokem. Kód se neukládá do adresy ani do
          historie prohlížeče.
        </p>
      </StatePanel>
    );
  }

  if (response.flow.state === 'activated') {
    return (
      <StatePanel
        action={
          <ActionLink href={response.flow.continueTo}>
            Otevřít aplikaci
          </ActionLink>
        }
        kind="empty"
        title="Přístup už je aktivovaný"
      >
        <p>Pokračujte rovnou do účastnické aplikace.</p>
        <SessionExitControls />
      </StatePanel>
    );
  }

  if (response.flow.state === 'suspended') {
    return (
      <StatePanel
        action={
          <ActionLink href="/chyba-pristupu" variant="secondary">
            Zobrazit bezpečnou nápovědu
          </ActionLink>
        }
        kind="permission"
        title="Přístup je pozastavený"
      >
        <p>
          Aktivace jej sama neobnoví. Podpora může pracovat s referencí{' '}
          <code>{response.flow.supportReference}</code>.
        </p>
      </StatePanel>
    );
  }

  const manualAvailable =
    response.availability.state === 'open' &&
    response.availability.methods.includes('manual_code');
  const cameraAvailable =
    response.availability.state === 'open' &&
    response.availability.methods.includes('camera_scan');

  return (
    <>
      <div className="activation-section-heading">
        <div>
          <p className="activation-kicker">Zvolte bezpečný vstup</p>
          <h2>Jak chcete pokračovat?</h2>
        </div>
        <StatusBadge tone="warning">Mock data</StatusBadge>
      </div>
      <div className="activation-method-grid">
        {manualAvailable ? (
          <Card className="activation-method-card">
            <span className="activation-method-icon" aria-hidden="true">
              <ActivationIcon>
                <rect height="14" rx="2" width="18" x="3" y="5" />
                <path d="M7 9h10M7 13h6M7 17h3" />
              </ActivationIcon>
            </span>
            <h3>Zadat kód ručně</h3>
            <p>
              Nejspolehlivější cesta. Kód zůstane pouze v tomto bezpečném kroku.
            </p>
            <ActionLink block href="/aktivace/kod">
              Zadat kód
            </ActionLink>
          </Card>
        ) : null}
        {cameraAvailable ? (
          <Card className="activation-method-card">
            <span className="activation-method-icon" aria-hidden="true">
              <ActivationIcon>
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
                <path d="M8 9h8v6H8z" />
              </ActivationIcon>
            </span>
            <h3>Načíst kamerou</h3>
            <p>
              Oprávnění ke kameře si vyžádáme až po vysvětlení a vždy ponecháme
              ruční možnost.
            </p>
            <ActionLink block href="/aktivace/skenovat" variant="secondary">
              Použít kameru
            </ActionLink>
          </Card>
        ) : null}
      </div>
      <p className="activation-recovery">
        Už jste přístup aktivovali?{' '}
        <a href="/prihlaseni?mode=recovery&returnTo=%2Fapp">
          Obnovit přihlášení
        </a>
      </p>
      <aside className="preview-disclaimer" aria-label="Omezení ukázky">
        Tato vývojová ukázka používá výhradně syntetická data. Nevytvoří účet,
        účast na akci ani skutečné přihlášení.
      </aside>
    </>
  );
};

export const ActivationEntry = ({
  api = browserActivationApi,
}: {
  readonly api?: ApiPort;
}) => {
  const state = useActivationEntry(api);

  return (
    <section className="activation-page">
      <header className="activation-hero">
        <p className="eyebrow">Vstup do aplikace</p>
        <h1 data-route-heading tabIndex={-1}>
          Aktivujte si BYZON
        </h1>
        <p className="lead">
          Jeden bezpečný průchod od vstupenky až k vašemu programu.
        </p>
      </header>

      {state.status === 'loading' ? (
        <Skeleton
          className="activation-loading"
          label="Načítám možnosti aktivace"
          lines={5}
        />
      ) : null}
      {state.status === 'ready' ? (
        <section className="activation-panel" aria-label="Možnosti aktivace">
          <div className="activation-event-summary">
            <div>
              <span>{state.data.event.dateLabel}</span>
              <strong>{state.data.event.name}</strong>
            </div>
            <span>{state.data.event.locationLabel}</span>
          </div>
          <ActivationFlow response={state.data} />
        </section>
      ) : null}
      {state.status === 'offline' ? (
        <StatePanel
          action={
            <button
              className="resource-action"
              onClick={state.retry}
              type="button"
            >
              Zkusit znovu
            </button>
          }
          kind="offline"
          title="Aktivace vyžaduje připojení"
        >
          <p>Kód ani identitu nelze bezpečně ověřit offline.</p>
        </StatePanel>
      ) : null}
      {state.status === 'closed' ? (
        <StatePanel
          action={
            <ActionLink
              href="/prihlaseni?mode=recovery&returnTo=%2Fapp"
              variant="secondary"
            >
              Přejít k přihlášení
            </ActionLink>
          }
          kind="empty"
          title="Aktivace teď není dostupná"
        >
          <p>Zkuste obnovit dříve aktivovaný přístup nebo se vraťte později.</p>
        </StatePanel>
      ) : null}
      {state.status === 'session_expired' ? (
        <StatePanel
          action={
            <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fapp">
              Obnovit přihlášení
            </ActionLink>
          }
          kind="session-expired"
          title="Přihlášení vypršelo"
        >
          <p>Po přihlášení se bezpečně vrátíte na začátek aktivace.</p>
        </StatePanel>
      ) : null}
      {state.status === 'error' ? (
        <StatePanel
          action={
            <button
              className="resource-action"
              onClick={state.retry}
              type="button"
            >
              Zkusit znovu
            </button>
          }
          kind="error"
          title="Možnosti aktivace se nepodařilo načíst"
        >
          <p>
            Zkontrolujte připojení a opakujte požadavek.
            {state.requestId ? (
              <>
                {' '}
                Reference: <code>{state.requestId}</code>
              </>
            ) : null}
          </p>
        </StatePanel>
      ) : null}
    </section>
  );
};
