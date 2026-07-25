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
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  submitActivationClaim,
} from '@/lib/activation-api';

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
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<ClaimFailure>();
  const [outcome, setOutcome] = useState<ActivationClaimResponse>();
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const errorContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focusErrorSummary = () => {
    requestAnimationFrame(() => {
      errorContainer.current
        ?.querySelector<HTMLElement>('.ui-error-summary')
        ?.focus();
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setFailure(undefined);
    setOutcome(undefined);
    const parsed = activationClaimRequestSchema.safeParse({
      code,
      method: 'manual_code',
    });
    if (!parsed.success) {
      setFieldError('Zadejte celý kód přesně tak, jak jste jej obdrželi.');
      focusErrorSummary();
      return;
    }

    setFieldError(undefined);
    setSubmitting(true);
    try {
      const result = await submitActivationClaim(
        api,
        parsed.data,
        createIdempotencyKey(),
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        setCode('');
        setOutcome(result.data);
        return;
      }
      if (!result.ok) {
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
      if (mounted.current) setSubmitting(false);
    }
  };

  if (outcome) {
    const recovery = outcome.state === 'recovery_required';
    return (
      <section className="activation-form-page">
        <header>
          <p className="eyebrow">Aktivace · další krok</p>
          <h1 data-route-heading tabIndex={-1}>
            {recovery ? 'Obnovte svůj přístup' : 'Ověřte svou identitu'}
          </h1>
        </header>
        <StatePanel
          action={
            <ActionLink href="/prihlaseni">
              {recovery ? 'Pokračovat k obnově' : 'Pokračovat k ověření'}
            </ActionLink>
          }
          kind="empty"
          title="Kód byl přijat v mock režimu"
        >
          <p>
            Ukázka nyní přejde k bezpečnému ověření identity. Nevznikl skutečný
            účet, membership ani přihlášená relace.
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
            <ActionLink href="/prihlaseni" variant="secondary">
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
              : failure
                ? [
                    {
                      fieldId: 'activation-code',
                      message:
                        failure.kind === 'rate_limited'
                          ? 'Příliš mnoho pokusů. Chvíli počkejte.'
                          : failure.kind === 'offline'
                            ? 'Aktivace vyžaduje připojení.'
                            : 'Aktivaci se nepodařilo dokončit.',
                    },
                  ]
                : []
          }
        />
      </div>

      {failure?.kind === 'rate_limited' ? (
        <Alert title="Příliš mnoho pokusů" tone="warning">
          Chvíli počkejte. Další odeslání teď nepomůže a tlačítko zůstává
          dostupné až pro nový vědomý pokus.
        </Alert>
      ) : null}
      {failure?.kind === 'offline' ? (
        <Alert title="Jste offline" tone="warning">
          Kód se nesmí ověřovat ani ukládat bez spojení se serverem.
        </Alert>
      ) : null}
      {failure?.kind === 'error' ? (
        <Alert title="Aktivaci se nepodařilo dokončit" tone="danger">
          Zkuste to znovu. Pokud potíže trvají, podpoře předejte pouze
          {failure.requestId ? (
            <>
              {' '}
              referenci <code>{failure.requestId}</code>
            </>
          ) : (
            ' obecný popis potíží'
          )}
          , nikdy ne ticket kód.
        </Alert>
      ) : null}

      <form className="activation-code-card" noValidate onSubmit={submit}>
        <FormField
          helperText="Kód se neukládá do adresy, historie ani návrhu formuláře. Pro mock průchod použijte TST-OPAQUE-2026."
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
