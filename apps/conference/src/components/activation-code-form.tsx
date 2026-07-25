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
  activationClaimRequestSchema,
  type ActivationClaimProblem,
  type ActivationClaimResponse,
  type ApiFailure,
  type RequestId,
} from '@byzon/domain/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  submitActivationClaim,
} from '@/lib/activation-api';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import { useTransitionFocus } from '@/components/use-transition-focus';

type ClaimFailure =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

const mapClaimFailure = (
  failure: ApiFailure<ActivationClaimProblem>,
): ClaimFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'error', requestId: failure.problem.requestId };
    case 'problem':
      if (failure.problem.code === 'CLAIM_REJECTED') {
        return { kind: 'rejected' };
      }
      if (failure.problem.code === 'ACTIVATION_CLOSED') {
        return { kind: 'closed' };
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

const defaultIdempotencyKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `claim-${suffix}`;
};

export const ActivationCodeForm = ({
  api = browserActivationApi,
  createIdempotencyKey = defaultIdempotencyKey,
}: {
  readonly api?: ApiPort;
  readonly createIdempotencyKey?: () => string;
}) => {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<ClaimFailure>();
  const [outcome, setOutcome] = useState<ActivationClaimResponse>();
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
  const outcomeHeading = useTransitionFocus(outcome !== undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focusErrorSummary = () => {
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
    setOutcome(undefined);
    const parsed = activationClaimRequestSchema.safeParse({
      code,
      method: 'manual_code',
    });
    if (!parsed.success) {
      setFieldError('Zadejte celý kód přesně tak, jak jste jej obdrželi.');
      focusErrorSummary();
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
      const result = await submitActivationClaim(
        api,
        parsed.data,
        requestAttempt.current.idempotencyKey,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        requestAttempt.current = undefined;
        setCode('');
        setOutcome(result.data);
        return;
      }
      if (!result.ok) {
        if (!shouldRetainMutationKey(result.failure)) {
          requestAttempt.current = undefined;
        }
        const mapped = mapClaimFailure(result.failure);
        if (mapped) {
          setFailure(mapped);
          if (mapped.kind === 'rejected') {
            setFieldError(
              'Kód nelze použít. Zkontrolujte jej nebo zvolte obnovu přístupu.',
            );
          }
          focusErrorSummary();
        }
      }
    } catch {
      if (mounted.current) {
        setFailure({ kind: 'error' });
        focusErrorSummary();
      }
    } finally {
      submitLocked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  if (outcome) {
    const recovery = outcome.state === 'recovery_required';
    return (
      <section className="activation-form-page">
        <header>
          <p className="eyebrow">Aktivace · další krok</p>
          <h1 data-route-heading ref={outcomeHeading} tabIndex={-1}>
            {recovery ? 'Obnovte svůj přístup' : 'Ověřte svou identitu'}
          </h1>
        </header>
        <StatePanel
          action={
            <Button
              onClick={() =>
                router.push(
                  recovery
                    ? '/prihlaseni?mode=recovery&returnTo=%2Fapp'
                    : '/prihlaseni?returnTo=%2Fonboarding',
                )
              }
            >
              {recovery ? 'Pokračovat k obnově' : 'Pokračovat k ověření'}
            </Button>
          }
          kind="empty"
          title="Kód byl přijat v mock režimu"
        >
          <p>
            {recovery
              ? 'Ukázka nyní přejde k bezpečné obnově dřívějšího přístupu.'
              : 'Ukázka nyní přejde k bezpečnému ověření identity.'}{' '}
            Nevznikl skutečný účet, účast na akci ani přihlášení.
          </p>
        </StatePanel>
      </section>
    );
  }

  if (failure?.kind === 'closed') {
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Aktivace</p>
        <h1 data-route-heading tabIndex={-1}>
          Aktivace je zavřená
        </h1>
        <StatePanel
          action={
            <ActionLink
              href="/prihlaseni?mode=recovery&returnTo=%2Fapp"
              variant="secondary"
            >
              Obnovit dřívější přístup
            </ActionLink>
          }
          kind="empty"
          title="Nový kód teď nelze použít"
        >
          <p>Stávající účet můžete bezpečně obnovit přihlášením.</p>
        </StatePanel>
      </section>
    );
  }

  return (
    <section className="activation-form-page">
      <header>
        <p className="eyebrow">Aktivace · ruční kód</p>
        <h1 data-route-heading tabIndex={-1}>
          Zadejte kód
        </h1>
        <p className="lead">
          Přepište jej přesně. Mezery ani velikost písmen automaticky neměníme.
        </p>
      </header>

      <div ref={errorContainer}>
        <ErrorSummary
          errors={
            fieldError
              ? [{ fieldId: 'activation-code', message: fieldError }]
              : []
          }
        />
        {failure && failure.kind !== 'rejected' ? (
          <div data-form-failure tabIndex={-1}>
            <Alert
              title={
                failure.kind === 'rate_limited'
                  ? 'Příliš mnoho pokusů'
                  : failure.kind === 'offline'
                    ? 'Jste offline'
                    : 'Aktivaci se nepodařilo dokončit'
              }
              tone={failure.kind === 'error' ? 'danger' : 'warning'}
            >
              {failure.kind === 'rate_limited'
                ? 'Chvíli počkejte a potom proveďte nový vědomý pokus.'
                : failure.kind === 'offline'
                  ? 'Kód se bez spojení neověřuje ani neukládá.'
                  : failure.kind === 'error' && failure.requestId
                    ? `Podpoře předejte pouze referenci ${failure.requestId}, nikdy ne ticket kód.`
                    : 'Zkuste to znovu bez změny kódu.'}
            </Alert>
          </div>
        ) : null}
      </div>

      <form className="activation-code-card" noValidate onSubmit={submit}>
        <FormField
          helperText="Kód se neukládá do adresy, historie ani návrhu formuláře. Pro nový průchod použijte TST-OPAQUE-2026, pro obnovu TST-RECOVERY-2026."
          label="Ticket kód"
          required
          {...(fieldError ? { error: fieldError } : {})}
        >
          <Input
            autoCapitalize="none"
            autoComplete="off"
            id="activation-code"
            inputMode="text"
            maxLength={512}
            onChange={(event) => {
              setCode(event.currentTarget.value);
              if (fieldError) setFieldError(undefined);
              if (failure) setFailure(undefined);
            }}
            spellCheck={false}
            type="text"
            value={code}
          />
        </FormField>
        <div className="activation-form-actions">
          <ActionLink href="/aktivace" variant="quiet">
            Zpět
          </ActionLink>
          <Button
            disabled={code.length === 0}
            loading={submitting}
            loadingLabel="Ověřuji kód…"
            type="submit"
          >
            Pokračovat
          </Button>
        </div>
      </form>
    </section>
  );
};
