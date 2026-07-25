'use client';

import { ActionLink, Button, Skeleton, StatePanel } from '@byzon/ui';
import {
  activationLinkRequestSchema,
  type ActivationLinkProblem,
  type ActivationLinkResponse,
  type ApiFailure,
  type RequestId,
} from '@byzon/domain/contracts';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  consumeActivationLink,
} from '@/lib/activation-api';
import { SessionExitControls } from '@/components/session-exit-controls';
import { useTransitionFocus } from '@/components/use-transition-focus';

type LinkFailure =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

type LinkState =
  | { readonly status: 'capturing' }
  | { readonly status: 'ready' }
  | { readonly status: 'submitting' }
  | { readonly status: 'missing' }
  | { readonly status: 'failure'; readonly failure: LinkFailure }
  | {
      readonly status: 'success';
      readonly outcome: ActivationLinkResponse;
    };

const mapLinkFailure = (
  failure: ApiFailure<ActivationLinkProblem>,
): LinkFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      if (
        failure.problem.code === 'ACTIVATION_LINK_REJECTED' ||
        failure.problem.code === 'ACTIVATION_FLOW_EXPIRED'
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

const defaultIdempotencyKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `link-consume-${suffix}`;
};

export const ActivationLinkConsumer = ({
  api = browserActivationApi,
  createIdempotencyKey = defaultIdempotencyKey,
}: {
  readonly api?: ApiPort;
  readonly createIdempotencyKey?: () => string;
}) => {
  const [state, setState] = useState<LinkState>({ status: 'capturing' });
  const token = useRef<string | undefined>(undefined);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const successHeading = useTransitionFocus(state.status === 'success');

  useEffect(() => {
    mounted.current = true;
    let captured = token.current;
    if (captured === undefined) {
      try {
        const url = new URL(window.location.href);
        const fragment = url.hash.startsWith('#')
          ? new URLSearchParams(url.hash.slice(1))
          : new URLSearchParams();
        const values = fragment.getAll('token');
        captured = values.length === 1 ? values[0] : '';
      } catch {
        captured = '';
      }
      try {
        window.history.replaceState(
          window.history.state,
          '',
          '/aktivace/odkaz',
        );
      } catch {
        captured = '';
        window.location.replace('/aktivace/odkaz');
      }
      token.current = captured;
      captured = '';
    }
    const parsed = activationLinkRequestSchema.safeParse({
      token: token.current,
    });
    setState(parsed.success ? { status: 'ready' } : { status: 'missing' });
    return () => {
      mounted.current = false;
    };
  }, []);

  const consume = async () => {
    if (submitting.current || !token.current) return;
    submitting.current = true;
    setState({ status: 'submitting' });
    idempotencyKey.current ??= createIdempotencyKey();
    try {
      const result = await consumeActivationLink(
        api,
        token.current,
        idempotencyKey.current,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        token.current = undefined;
        idempotencyKey.current = undefined;
        setState({ status: 'success', outcome: result.data });
        return;
      }
      if (!result.ok) {
        if (
          result.failure.kind === 'problem' &&
          result.failure.problem.code === 'IDEMPOTENCY_KEY_REUSED'
        ) {
          idempotencyKey.current = undefined;
        }
        const failure = mapLinkFailure(result.failure);
        if (failure) {
          if (
            failure.kind === 'rejected' ||
            failure.kind === 'session_expired'
          ) {
            token.current = undefined;
            idempotencyKey.current = undefined;
          }
          setState({ status: 'failure', failure });
        }
      } else {
        setState({ status: 'failure', failure: { kind: 'error' } });
      }
    } catch {
      if (mounted.current) {
        setState({ status: 'failure', failure: { kind: 'error' } });
      }
    } finally {
      submitting.current = false;
    }
  };

  if (state.status === 'capturing') {
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Jednorázový odkaz</p>
        <h1 data-route-heading tabIndex={-1}>
          Připravuji bezpečné pokračování
        </h1>
        <Skeleton label="Odstraňuji token z adresy" lines={4} />
      </section>
    );
  }

  if (state.status === 'success') {
    const onboarding = state.outcome.state === 'onboarding_required';
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Jednorázový odkaz</p>
        <h1 data-route-heading ref={successHeading} tabIndex={-1}>
          {onboarding ? 'Dokončete profil' : 'Přístup je připravený'}
        </h1>
        <StatePanel
          action={
            <ActionLink href={state.outcome.continueTo}>
              {onboarding ? 'Pokračovat na onboarding' : 'Otevřít aplikaci'}
            </ActionLink>
          }
          kind="empty"
          title="Syntetický odkaz byl bezpečně spotřebován"
        >
          <p>
            Token už není v adrese ani v paměti komponenty. Mock nevytvořil
            skutečné přihlášení ani účast na akci.
          </p>
        </StatePanel>
        {!onboarding ? <SessionExitControls /> : null}
      </section>
    );
  }

  if (state.status === 'missing') {
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Jednorázový odkaz</p>
        <h1 data-route-heading tabIndex={-1}>
          Odkaz nelze použít
        </h1>
        <StatePanel
          action={
            <ActionLink
              href="/prihlaseni?mode=recovery&returnTo=%2Fapp"
              variant="secondary"
            >
              Vyžádat nový odkaz
            </ActionLink>
          }
          kind="session-expired"
          title="Odkaz chybí nebo už není platný"
        >
          <p>
            Z bezpečnostních důvodů nerozlišujeme důvod. Ticket kód ani e-mail
            se z adresy neobnovují.
          </p>
        </StatePanel>
      </section>
    );
  }

  if (state.status === 'failure') {
    const { failure } = state;
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Jednorázový odkaz</p>
        <h1 data-route-heading tabIndex={-1}>
          Odkaz nelze dokončit
        </h1>
        <StatePanel
          action={
            failure.kind === 'offline' || failure.kind === 'error' ? (
              <Button onClick={() => void consume()}>Zkusit znovu</Button>
            ) : (
              <ActionLink
                href="/prihlaseni?mode=recovery&returnTo=%2Fapp"
                variant="secondary"
              >
                Vyžádat nový odkaz
              </ActionLink>
            )
          }
          kind={
            failure.kind === 'offline'
              ? 'offline'
              : failure.kind === 'session_expired' ||
                  failure.kind === 'rejected'
                ? 'session-expired'
                : 'error'
          }
          title={
            failure.kind === 'offline'
              ? 'Dokončení vyžaduje připojení'
              : failure.kind === 'session_expired'
                ? 'Přihlášení vypršelo'
                : failure.kind === 'rejected'
                  ? 'Odkaz chybí nebo už není platný'
                  : 'Odkaz se nepodařilo dokončit'
          }
        >
          <p>
            {failure.kind === 'offline'
              ? 'Odkaz neukládáme do offline fronty. Po připojení bezpečně zopakujeme stejný pokus.'
              : failure.kind === 'error' && failure.requestId
                ? `Výsledek předchozího pokusu není jistý. Zopakujte jej se stejným odkazem; podpoře předejte referenci ${failure.requestId}.`
                : failure.kind === 'error'
                  ? 'Výsledek předchozího pokusu není jistý. Bezpečně zopakujte stejný odkaz.'
                  : 'Vyžádejte si nový odkaz; původní token už nelze použít.'}
          </p>
        </StatePanel>
      </section>
    );
  }

  return (
    <section className="activation-form-page">
      <p className="eyebrow">Jednorázový odkaz</p>
      <h1 data-route-heading tabIndex={-1}>
        Potvrďte bezpečné pokračování
      </h1>
      <StatePanel
        action={
          <Button
            loading={state.status === 'submitting'}
            loadingLabel="Spotřebovávám odkaz…"
            onClick={() => void consume()}
          >
            Pokračovat
          </Button>
        }
        kind="empty"
        title="Token byl odstraněn z adresy"
      >
        <p>
          Pokračováním odkaz jednou bezpečně ověříte bez ukládání. Opakované
          rychlé kliknutí nevytvoří druhý požadavek.
        </p>
      </StatePanel>
    </section>
  );
};
