'use client';

import {
  Alert,
  Button,
  ErrorSummary,
  FormField,
  Input,
  StatePanel,
} from '@byzon/ui';
import { activationEmailSchema } from '@byzon/domain/contracts';
import { useRef, useState } from 'react';

import type { AuthReturnTo } from '../lib/auth-return';

type LoginFailure = 'offline' | 'rate_limited' | 'unavailable';

export const MagicLinkLogin = ({
  fetch = globalThis.fetch,
  returnTo = '/app',
}: {
  readonly fetch?: typeof globalThis.fetch;
  readonly returnTo?: AuthReturnTo;
}) => {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<LoginFailure>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLocked = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);

  const focusFeedback = () => {
    requestAnimationFrame(() => {
      feedback.current
        ?.querySelector<HTMLElement>('[data-login-feedback], a[href]')
        ?.focus();
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLocked.current) return;
    const parsed = activationEmailSchema.safeParse(email);
    if (!parsed.success) {
      setFieldError('Zadejte platnou e-mailovou adresu bez úprav navíc.');
      focusFeedback();
      return;
    }

    submitLocked.current = true;
    const normalizedEmail = parsed.data.toLowerCase();
    setFieldError(undefined);
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          callbackURL: returnTo,
          errorCallbackURL: `/prihlaseni?returnTo=${encodeURIComponent(returnTo)}`,
        }),
        cache: 'no-store',
      });
      if (response.ok) {
        setEmail('');
        setSent(true);
        requestAnimationFrame(() =>
          feedback.current
            ?.querySelector<HTMLElement>('[data-login-feedback]')
            ?.focus(),
        );
      } else {
        setFailure(response.status === 429 ? 'rate_limited' : 'unavailable');
        focusFeedback();
      }
    } catch {
      setFailure(navigator.onLine ? 'unavailable' : 'offline');
      focusFeedback();
    } finally {
      submitLocked.current = false;
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Přihlášení</p>
        <h1 data-route-heading tabIndex={-1}>
          Zkontrolujte e-mail
        </h1>
        <div ref={feedback}>
          <StatePanel
            kind="empty"
            title="Pokud je účet připravený, odkaz byl odeslán"
          >
            <p data-login-feedback tabIndex={-1}>
              Jednorázový odkaz platí 5 minut. Odpověď je stejná pro existující
              i neexistující účet.
            </p>
          </StatePanel>
        </div>
      </section>
    );
  }

  return (
    <section className="activation-form-page">
      <header>
        <p className="eyebrow">Konferenční aplikace</p>
        <h1 data-route-heading tabIndex={-1}>
          Přihlaste se do BYZON
        </h1>
        <p className="lead">
          Pošleme vám jednorázový přihlašovací odkaz. Heslo nepotřebujete.
        </p>
      </header>

      <div ref={feedback}>
        <ErrorSummary
          errors={
            fieldError ? [{ fieldId: 'login-email', message: fieldError }] : []
          }
        />
        {failure ? (
          <div data-login-feedback tabIndex={-1}>
            <Alert
              title={
                failure === 'rate_limited'
                  ? 'Příliš mnoho pokusů'
                  : failure === 'offline'
                    ? 'Jste offline'
                    : 'Odkaz se nepodařilo odeslat'
              }
              tone={failure === 'unavailable' ? 'danger' : 'warning'}
            >
              <p>
                {failure === 'rate_limited'
                  ? 'Počkejte jednu minutu a potom požadavek zopakujte.'
                  : failure === 'offline'
                    ? 'Přihlášení vyžaduje připojení k internetu.'
                    : 'Zkontrolujte e-mailovou službu a požadavek potom zopakujte.'}
              </p>
            </Alert>
          </div>
        ) : null}
      </div>

      <form className="activation-code-card" noValidate onSubmit={submit}>
        <FormField
          {...(fieldError ? { error: fieldError } : {})}
          helperText="Použijte e-mail, na který vám pořadatel přidělil přístup."
          label="E-mail"
          required
        >
          <Input
            autoCapitalize="none"
            autoComplete="email"
            id="login-email"
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
          <Button loading={submitting} loadingLabel="Odesílám…" type="submit">
            Poslat přihlašovací odkaz
          </Button>
        </div>
      </form>
    </section>
  );
};
