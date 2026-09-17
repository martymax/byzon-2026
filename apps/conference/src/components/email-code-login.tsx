'use client';

import { activationEmailSchema } from '@byzon/domain/contracts';
import { Alert, Button, FormField, Input } from '@byzon/ui';
import { useRef, useState } from 'react';

import type { AuthReturnTo } from '../lib/auth-return';
import styles from './magic-link-login.module.css';

export const EmailCodeLogin = ({
  fetch,
  navigate,
  returnTo,
  onUseLink,
}: {
  readonly fetch: typeof globalThis.fetch;
  readonly navigate: (destination: AuthReturnTo) => void;
  readonly returnTo: AuthReturnTo;
  readonly onUseLink: () => void;
}) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const locked = useRef(false);

  const submit = async (verify: boolean) => {
    if (locked.current) return;
    const parsed = activationEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Zadejte platnou e-mailovou adresu.');
      return;
    }
    const otp = code.replace(/\s/g, '');
    if (verify && !/^\d{6}$/.test(otp)) {
      setError('Zadejte šestimístný kód z e-mailu.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setSending(!verify);
    setError(undefined);
    try {
      const response = await fetch(
        verify
          ? '/api/auth/sign-in/email-otp'
          : '/api/auth/email-otp/send-verification-otp',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(
            verify
              ? { email: parsed.data.toLowerCase(), otp }
              : { email: parsed.data.toLowerCase(), type: 'sign-in' },
          ),
        },
      );
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Příliš mnoho pokusů. Počkejte jednu minutu a zkuste to znovu.'
            : verify && response.status >= 400 && response.status < 500
              ? 'Kód není platný nebo už vypršel. Zkontrolujte ho nebo si pošlete nový.'
              : 'Požadavek se nepodařilo dokončit. Zkuste to prosím znovu.',
        );
        return;
      }
      if (verify) {
        setCode('');
        navigate(returnTo);
        return;
      }
      setSent(true);
      setCode('');
      requestAnimationFrame(() =>
        document.getElementById('login-code')?.focus(),
      );
    } catch {
      setError(
        navigator.onLine
          ? 'Požadavek se nepodařilo dokončit. Zkuste to prosím znovu.'
          : 'Přihlášení vyžaduje připojení k internetu.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="activation-form-page">
      <header>
        <p className="eyebrow">Konferenční aplikace</p>
        <h1 data-route-heading tabIndex={-1}>
          {sent ? 'Zadejte kód z e-mailu' : 'Přihlaste se do BYZON'}
        </h1>
        <p className="lead">
          {sent
            ? 'Pokud je účet připravený, poslali jsme vám šestimístný kód. Platí 10 minut. Zkontrolujte také složku se spamem.'
            : 'Pošleme vám jednorázový kód. Zadejte ho tady v aplikaci a zůstanete přihlášeni 48 hodin.'}
        </p>
        <p>
          Po přečtení e-mailu se vraťte do tohoto okna. Aplikaci z plochy nebo
          Docku otevřete jejím zástupcem.
        </p>
      </header>
      {error ? (
        <Alert title="Přihlášení se nepodařilo" tone="warning">
          <p>{error}</p>
        </Alert>
      ) : null}
      <form
        className="activation-code-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(sent);
        }}
      >
        {sent ? (
          <FormField
            label="Kód z e-mailu"
            required
            helperText="Zadejte šest číslic z nejnovějšího e-mailu."
          >
            <Input
              id="login-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              type="text"
              maxLength={12}
              value={code}
              readOnly={busy}
              onChange={(event) => {
                setCode(event.currentTarget.value);
                setError(undefined);
              }}
            />
          </FormField>
        ) : (
          <FormField
            label="E-mail"
            required
            helperText="Použijte e-mail, na který vám pořadatel přidělil přístup."
          >
            <Input
              id="code-login-email"
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              type="email"
              maxLength={320}
              spellCheck={false}
              value={email}
              readOnly={busy}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
                setError(undefined);
              }}
            />
          </FormField>
        )}
        <div className="activation-form-actions">
          <Button
            type="submit"
            loading={busy}
            loadingLabel={sending ? 'Odesíláme kód…' : 'Ověřuji kód…'}
          >
            {sent ? 'Přihlásit se' : 'Poslat přihlašovací kód'}
          </Button>
          {sent ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              Poslat nový kód
            </Button>
          ) : null}
        </div>
        <p className={styles.status} role="status" aria-atomic="true">
          {busy
            ? sending
              ? 'Odesíláme kód na váš e-mail. Může to trvat několik sekund.'
              : 'Ověřujeme přihlášení. Chvíli prosím počkejte.'
            : sent
              ? 'Kód funguje jen jednou.'
              : 'Odeslání e-mailu může trvat několik sekund.'}
        </p>
      </form>
      <div className="activation-form-actions">
        {sent ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode('');
              setError(undefined);
            }}
          >
            Změnit e-mail
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={onUseLink}>
          Přihlásit se odkazem
        </Button>
      </div>
    </section>
  );
};
