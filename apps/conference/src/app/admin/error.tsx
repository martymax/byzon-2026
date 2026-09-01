'use client';

import { AdminPageHeader, Button } from '@byzon/ui';
import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Next.js captures the original exception; never render its message because
    // an upstream response may contain private or technical detail.
    void error;
  }, [error]);

  return (
    <section role="alert">
      <AdminPageHeader
        action={<Button onClick={reset}>Zkusit znovu</Button>}
        description="Obsah této části se nepodařilo bezpečně načíst. Ostatní části administrace zůstávají dostupné."
        title="Tuto část teď nelze zobrazit"
      />
    </section>
  );
}
