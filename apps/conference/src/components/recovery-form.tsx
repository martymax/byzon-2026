'use client';

import {
  ActionLink,
  Alert,
  Button,
  ErrorSummary,
  FormField,
  Input,
  StatePanel,
} from '@byzon/ui';
import {
  activationRecoveryRequestSchema,
  type ActivationRecoveryProblem,
  type ApiFailure,
  type RequestId,
} from '@byzon/domain/contracts';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  submitActivationRecovery,
} from '@/lib/activation-api';
import type { ActivationReturnTo } from '@/lib/activation-return';
import type { LoginMode } from '@/lib/login-mode';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import { useTransitionFocus } from '@/components/use-transition-focus';

type RecoveryFailure =
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

export interface RecoverySentPreview {
  readonly href: string;
  readonly actionLabel: string;
  readonly description: string;
}

const mapRecoveryFailure = (
  failure: ApiFailure<ActivationRecoveryProblem>,
): RecoveryFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'error', requestId: failure.problem.requestId };
    case 'problem':
      return failure.problem.code === 'CLAIM_RATE_LIMITED'
        ? { kind: 'rate_limited' }
        : { kind: 'error', requestId: failure.problem.requestId };
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

export const RecoveryForm = ({
  api = browserActivationApi,
  mode = 'recovery',
  presentation = 'recovery',
  returnTo = '/app',
  createIdempotencyKey = () => runtimeSecret('recovery-request'),
}: {
  readonly api?: ApiPort;
  readonly mode?: Extract<LoginMode, 'recovery' | 'switch'>;
  readonly presentation?: 'login' | 'recovery';
  readonly returnTo?: ActivationReturnTo;
  readonly createIdempotencyKey?: () => string;
}) => {
  const isLogin = mode === 'recovery' && presentation === 'login';
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<RecoveryFailure>();
  const [sent, setSent] = useState<{
    readonly resendAfterSeconds: number;
    readonly preview?: RecoverySentPreview;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const submitLocked = useRef(false);
  const mounted = useRef(true);
  const errorContainer = useRef<HTMLDivElement>(null);
  const requestAttempt = useRef<
    | {
        readonly fingerprint: string;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);
  const sentHeading = useTransitionFocus(sent !== undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focusErrors = () => {
    requestAnimationFrame(() => {
      errorContainer.current
        ?.querySelector<HTMLElement>('.ui-error-summary, [data-form-failure]')
        ?.focus();
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLocked.current) return;
    submitLocked.current = true;
    setFailure(undefined);
    const parsed = activationRecoveryRequestSchema.safeParse({
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
      const result = await submitActivationRecovery(
        api,
        parsed.data,
        requestAttempt.current.idempotencyKey,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        requestAttempt.current = undefined;
        setEmail('');
        let preview: RecoverySentPreview | undefined;
        if (
          process.env.NODE_ENV === 'development' ||
          process.env.NODE_ENV === 'test'
        ) {
          const { createRecoverySentPreview } =
            await import('../test/mocks/recovery-preview');
          preview = createRecoverySentPreview(returnTo, isLogin);
        }
        setSent({
          resendAfterSeconds: result.data.resendAfterSeconds,
          ...(preview ? { preview } : {}),
        });
        return;
      }
      if (!result.ok) {
        if (!shouldRetainMutationKey(result.failure)) {
          requestAttempt.current = undefined;
        }
        const mapped = mapRecoveryFailure(result.failure);
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
      <section className="activation-form-page">
        <p className="eyebrow">{isLogin ? 'Přihlášení' : 'Obnova přístupu'}</p>
        <h1 data-route-heading ref={sentHeading} tabIndex={-1}>
          Zkontrolujte e-mail
        </h1>
        <StatePanel
          action={
            sent.preview ? (
              <ActionLink href={sent.preview.href}>
                {sent.preview.actionLabel}
              </ActionLink>
            ) : undefined
          }
          kind="empty"
          title={
            isLogin
              ? 'Pokud lze účet přihlásit, odkaz byl odeslán'
              : 'Pokud lze přístup obnovit, odkaz byl odeslán'
          }
        >
          <p>
            {sent.preview?.description ??
              'Odpověď je stejná pro existující i neexistující účet. Pokud účet existuje, pokračujte podle jednorázového odkazu doručeného e-mailem.'}
          </p>
          <p>
            Další odeslání je dostupné nejdříve za {sent.resendAfterSeconds}{' '}
            sekund.
          </p>
        </StatePanel>
      </section>
    );
  }

  return (
    <section className="activation-form-page">
      <header>
        <p className="eyebrow">
          {mode === 'switch'
            ? 'Jiný účet'
            : isLogin
              ? 'Konferenční aplikace'
              : 'Obnova přístupu'}
        </p>
        <h1 data-route-heading tabIndex={-1}>
          {mode === 'switch'
            ? 'Přihlaste se jiným účtem'
            : isLogin
              ? 'Přihlaste se do BYZON'
              : 'Obnovte bezpečný přístup'}
        </h1>
        <p className="lead">
          {isLogin
            ? 'Pošleme vám jednorázový přihlašovací odkaz na e-mail. Heslo nepotřebujete.'
            : 'Pošleme jednorázový odkaz. Nikdy nepotvrdíme, zda zadaný účet existuje.'}
        </p>
      </header>

      {mode === 'switch' ? (
        <Alert title="Přepnutí účtu je v náhledu syntetické" tone="warning">
          Skutečné přihlášení se v náhledu nemění. Osobní data uložená v
          zařízení nejsou přítomná, proto nejde o produkční odhlášení.
        </Alert>
      ) : null}

      <div ref={errorContainer}>
        <ErrorSummary
          errors={
            fieldError
              ? [{ fieldId: 'recovery-email', message: fieldError }]
              : []
          }
        />
        {failure ? (
          <div data-form-failure tabIndex={-1}>
            <Alert
              title={
                failure.kind === 'rate_limited'
                  ? 'Příliš mnoho pokusů'
                  : failure.kind === 'offline'
                    ? 'Jste offline'
                    : 'Odkaz se nepodařilo odeslat'
              }
              tone={failure.kind === 'error' ? 'danger' : 'warning'}
            >
              <p>
                {failure.kind === 'rate_limited'
                  ? 'Počkejte a pak proveďte nový vědomý pokus.'
                  : failure.kind === 'offline'
                    ? 'E-mail ani požadavek neukládáme do offline fronty.'
                    : failure.requestId
                      ? `Zopakujte stejný požadavek. Podpoře předejte pouze referenci ${failure.requestId}.`
                      : 'Zopakujte stejný požadavek; existenci účtu z chyby nelze odvodit.'}
              </p>
            </Alert>
          </div>
        ) : null}
      </div>

      <form className="activation-code-card" noValidate onSubmit={submit}>
        <FormField
          {...(fieldError ? { error: fieldError } : {})}
          helperText="E-mail zůstává pouze v paměti tohoto formuláře a neposílá se v URL."
          label="E-mail"
          required
        >
          <Input
            autoCapitalize="none"
            autoComplete="email"
            id="recovery-email"
            inputMode="email"
            maxLength={320}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setFieldError(undefined);
              setFailure(undefined);
            }}
            spellCheck={false}
            type="email"
            value={email}
          />
        </FormField>
        <div className="activation-form-actions">
          <ActionLink href="/aktivace" variant="quiet">
            {isLogin ? 'Aktivovat vstupenku' : 'Zpět na aktivaci'}
          </ActionLink>
          <Button loading={submitting} loadingLabel="Odesílám…" type="submit">
            {isLogin ? 'Poslat přihlašovací odkaz' : 'Poslat jednorázový odkaz'}
          </Button>
        </div>
      </form>
    </section>
  );
};
