'use client';

import { Button, Card } from '@byzon/ui';
import { useRef, useState } from 'react';
import { invalidateParticipantPrivateResources } from '@/lib/private-resource-events';
import { useParticipantSessionContext } from './participant-session-context';

const reloadPage = () => window.location.reload();

export const TimelessTestSettings = ({
  onApplied = reloadPage,
}: {
  onApplied?: () => void;
}) => {
  const session = useParticipantSessionContext();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!session?.isAdmin) return null;
  const enabled = session.timelessTestMode === true;
  const change = async () => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/v1/me/test-mode', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!response.ok) throw new Error('Test mode update failed');
      await invalidateParticipantPrivateResources(
        'permission',
        'user_request',
      ).catch(() => undefined);
      onApplied();
    } catch {
      setError(
        'Změna se nepodařila. Ověřte připojení a přihlášení administrátora a zkuste to znovu.',
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  };
  return (
    <Card className="participant-account-summary">
      <h2>Testování časově omezených funkcí</h2>
      <p>
        Otevře hodnocení konference a přednášek, časová okna rezervací a dotazů.
        Platí jen pro vás v tomto přihlášení, nejdéle 8 hodin.
      </p>
      <p>
        <strong>Odeslané odpovědi a rezervace se skutečně ukládají.</strong>{' '}
        Kapacity, přiřazení rolí a vypnuté funkce zůstávají v platnosti.
      </p>
      <p role="status">
        {enabled
          ? 'Testovací režim je zapnutý.'
          : 'Testovací režim je vypnutý.'}
      </p>
      <Button
        type="button"
        aria-pressed={enabled}
        disabled={working}
        onClick={() => void change()}
      >
        {working
          ? 'Ukládám…'
          : enabled
            ? 'Vypnout testovací režim'
            : 'Zapnout testovací režim'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
};
