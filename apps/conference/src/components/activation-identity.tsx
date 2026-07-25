'use client';

import {
  ActionLink,
  Alert,
  Button,
  ErrorSummary,
  FormField,
  Input,
  Skeleton,
  StatePanel,
} from '@byzon/ui';
import {
  activationIdentityRequestSchema,
  type ActivationIdentityProblem,
  type ActivationLandingResponse,
  type ApiFailure,
  type RequestId,
} from '@byzon/domain/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useActivationEntry } from '@/components/activation-entry';
import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  submitActivationIdentity,
} from '@/lib/activation-api';

type PendingActivationFlow = Extract<
  ActivationLandingResponse['flow'],
  { readonly state: 'claim_in_progress' }
>;

type IdentityFailure =
  | { readonly kind: 'expired' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

type SentState = {
  readonly mockLink: string;
  readonly resendAfterSeconds: number;
};

const mapIdentityFailure = (
  failure: ApiFailure<ActivationIdentityProblem>,
): IdentityFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      if (failure.problem.code === 'ACTIVATION_FLOW_EXPIRED') {
        return { kind: 'expired' };
      }
      if (failure.problem.code === 'CLAIM_RATE_LIMITED') {
        return { kind: 'rate_limited' };
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

const runtimeSecret = (prefix: string): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
};

const IdentityGate = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <section className="activation-form-page">
    <p className="eyebrow">Bezpečné ověření</p>
    <h1 data-route-heading tabIndex={-1}>
      {title}
    </h1>
    {children}
  </section>
);

export const ActivationIdentity = ({
  api = browserActivationApi,
  returnTo = '/onboarding',
  now,
  createIdempotencyKey = () => runtimeSecret('identity'),
  createMockLinkToken = () => runtimeSecret('link'),
}: {
  readonly api?: ApiPort;
  readonly returnTo?: '/app' | '/onboarding';
  readonly now?: (() => number) | undefined;
  readonly createIdempotencyKey?: () => string;
  readonly createMockLinkToken?: () => string;
}) => {
  const landing = useActivationEntry(api);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<IdentityFailure>();
  const [sent, setSent] = useState<SentState>();
  const [submitting, setSubmitting] = useState(false);
  const submitLocked = useRef(false);
  const requestAttempt = useRef<
    | {
        readonly fingerprint: string;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);
  const mounted = useRef(true);
  const errorContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focusErrors = () => {
    requestAnimationFrame(() => {
      errorContainer.current
        ?.querySelector<HTMLElement>('.ui-error-summary')
        ?.focus();
    });
  };

  const submitIdentity = async (
    event: React.FormEvent<HTMLFormElement>,
    flow: PendingActivationFlow,
  ) => {
    event.preventDefault();
    if (submitLocked.current) return;
    submitLocked.current = true;
    setFailure(undefined);
    const parsed = activationIdentityRequestSchema.safeParse({
      flowId: flow.flowId,
      email,
      returnTo,
    });
    if (!parsed.success) {
      setFieldError('Zadejte platnou e-mailovou adresu bez úprav navíc.');
      focusErrors();
      submitLocked.current = false;
      return;
    }

    setFieldError(undefined);
    setSubmitting(true);
    const fingerprint = JSON.stringify(parsed.data);
    if (requestAttempt.current?.fingerprint !== fingerprint) {
      requestAttempt.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    try {
      const result = await submitActivationIdentity(
        api,
        parsed.data,
        requestAttempt.current.idempotencyKey,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        if (result.data.flowId !== flow.flowId) {
          requestAttempt.current = undefined;
          setFailure({
            kind: 'error',
            requestId: result.metadata.requestId,
          });
          focusErrors();
          return;
        }
        setEmail('');
        requestAttempt.current = undefined;
        setSent({
          mockLink: `/aktivace/odkaz?token=${encodeURIComponent(
            createMockLinkToken(),
          )}`,
          resendAfterSeconds: result.data.resendAfterSeconds,
        });
        return;
      }
      if (!result.ok) {
        if (
          result.failure.kind === 'problem' ||
          result.failure.kind === 'session_expired'
        ) {
          requestAttempt.current = undefined;
        }
        const mapped = mapIdentityFailure(result.failure);
        if (mapped) {
          setFailure(mapped);
          focusErrors();
        }
      }
    } catch {
      if (mounted.current) {
        setFailure({ kind: 'error' });
        focusErrors();
      }
    } finally {
      submitLocked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <IdentityGate title="Zkontrolujte e-mail">
        <StatePanel
          action={
            <ActionLink href={sent.mockLink}>
              Otevřít syntetický jednorázový odkaz
            </ActionLink>
          }
          kind="empty"
          title="Pokud lze průchod dokončit, odkaz byl odeslán"
        >
          <p>
            Stejnou zprávu ukazujeme bez ohledu na existenci účtu. V mock režimu
            můžete použít syntetický odkaz výše; nevznikla skutečná session ani
            membership.
          </p>
          <p>
            Další odeslání je dostupné nejdříve za {sent.resendAfterSeconds}{' '}
            sekund.
          </p>
        </StatePanel>
      </IdentityGate>
    );
  }

  if (landing.status === 'loading') {
    return (
      <IdentityGate title="Navazuji na aktivaci">
        <Skeleton label="Načítám serverový stav aktivace" lines={4} />
      </IdentityGate>
    );
  }

  if (
    landing.status === 'offline' ||
    landing.status === 'error' ||
    landing.status === 'session_expired'
  ) {
    const offline = landing.status === 'offline';
    const sessionExpired = landing.status === 'session_expired';
    return (
      <IdentityGate title="Aktivaci se nepodařilo obnovit">
        <StatePanel
          action={
            sessionExpired ? (
              <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fapp">
                Obnovit přihlášení
              </ActionLink>
            ) : (
              <Button onClick={landing.retry}>Zkusit znovu</Button>
            )
          }
          kind={
            offline ? 'offline' : sessionExpired ? 'session-expired' : 'error'
          }
          title={
            offline
              ? 'Ověření identity vyžaduje připojení'
              : sessionExpired
                ? 'Přihlášení vypršelo'
                : 'Serverový stav aktivace není dostupný'
          }
        >
          <p>
            Flow ID, e-mail ani ticket kód neobnovujeme z browser storage.
            {landing.status === 'error' && landing.requestId ? (
              <>
                {' '}
                Reference: <code>{landing.requestId}</code>
              </>
            ) : null}
          </p>
        </StatePanel>
      </IdentityGate>
    );
  }

  const flow =
    landing.status === 'ready' &&
    landing.data.availability.state === 'open' &&
    landing.data.flow.state === 'claim_in_progress'
      ? landing.data.flow
      : null;
  const clientExpired =
    flow && now ? Date.parse(flow.expiresAt) <= now() : false;
  if (!flow || clientExpired || failure?.kind === 'expired') {
    return (
      <IdentityGate
        title={
          clientExpired || failure?.kind === 'expired'
            ? 'Aktivace vypršela'
            : 'Začněte bezpečnou aktivací'
        }
      >
        <StatePanel
          action={<ActionLink href="/aktivace">Přejít k aktivaci</ActionLink>}
          kind={
            clientExpired || failure?.kind === 'expired'
              ? 'session-expired'
              : 'empty'
          }
          title={
            clientExpired || failure?.kind === 'expired'
              ? 'Rozpracovaný průchod už není platný'
              : 'Chybí rozpracovaný aktivační průchod'
          }
        >
          <p>
            Aktuální flow musí znovu potvrdit server. Ticket kód, flow ID ani
            e-mail se nečtou z URL, historie nebo browser storage.
          </p>
        </StatePanel>
      </IdentityGate>
    );
  }

  return (
    <section className="activation-form-page">
      <header>
        <p className="eyebrow">Aktivace · identita</p>
        <h1 data-route-heading tabIndex={-1}>
          Ověřte svůj e-mail
        </h1>
        <p className="lead">
          E-mail použijeme pouze pro jednorázový odkaz. Neprozradíme, zda už
          účet existuje.
        </p>
      </header>

      <div ref={errorContainer}>
        <ErrorSummary
          errors={
            fieldError
              ? [{ fieldId: 'activation-email', message: fieldError }]
              : failure
                ? [
                    {
                      fieldId: 'activation-email',
                      message:
                        failure.kind === 'rate_limited'
                          ? 'Příliš mnoho pokusů. Chvíli počkejte.'
                          : failure.kind === 'offline'
                            ? 'Ověření identity vyžaduje připojení.'
                            : failure.kind === 'session_expired'
                              ? 'Přihlášení vypršelo.'
                              : 'Odkaz se nepodařilo odeslat.',
                    },
                  ]
                : []
          }
        />
      </div>

      {failure ? (
        <Alert
          title={
            failure.kind === 'rate_limited'
              ? 'Příliš mnoho pokusů'
              : failure.kind === 'offline'
                ? 'Jste offline'
                : failure.kind === 'session_expired'
                  ? 'Přihlášení vypršelo'
                  : 'Odkaz se nepodařilo odeslat'
          }
          tone={failure.kind === 'error' ? 'danger' : 'warning'}
        >
          {failure.kind === 'rate_limited'
            ? 'Chvíli počkejte a potom odešlete nový vědomý pokus.'
            : failure.kind === 'offline'
              ? 'E-mail ani rozpracovanou aktivaci bez spojení neodesíláme.'
              : failure.kind === 'session_expired'
                ? 'Začněte znovu bez přenosu ticket kódu.'
                : `Zkuste to znovu.${
                    failure.requestId
                      ? ` Podpoře předejte referenci ${failure.requestId}.`
                      : ''
                  }`}
        </Alert>
      ) : null}

      <form
        className="activation-code-card"
        noValidate
        onSubmit={(event) => void submitIdentity(event, flow)}
      >
        <FormField
          helperText="Pošleme jednorázový odkaz. Odpověď je stejná pro nový i dřívější účet."
          label="E-mail"
          required
          {...(fieldError ? { error: fieldError } : {})}
        >
          <Input
            autoComplete="email"
            id="activation-email"
            inputMode="email"
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              if (fieldError) setFieldError(undefined);
              if (failure) setFailure(undefined);
            }}
            spellCheck={false}
            type="email"
            value={email}
          />
        </FormField>
        <div className="activation-form-actions">
          <ActionLink href="/aktivace" variant="quiet">
            Zrušit
          </ActionLink>
          <Button
            disabled={email.length === 0}
            loading={submitting}
            loadingLabel="Odesílám bezpečný odkaz…"
            type="submit"
          >
            Poslat jednorázový odkaz
          </Button>
        </div>
      </form>

      <aside className="preview-disclaimer" aria-label="Omezení mock identity">
        Mock ověřuje pouze průchod komponentami a kontrakty. Nevytváří účet,
        membership ani Better Auth session.
      </aside>
    </section>
  );
};
