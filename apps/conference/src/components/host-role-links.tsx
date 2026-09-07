'use client';
import {
  hostCapabilitiesSchema,
  type HostCapabilities,
} from '@byzon/domain/contracts';
import { ActionLink, Button } from '@byzon/ui';
import { useEffect, useState } from 'react';
import { requestPrivateJson } from '@/lib/private-json';
import { subscribeToPrivateResourceInvalidation } from '@/lib/private-resource-events';
export function HostRoleLinks({
  eventId,
  userId,
}: {
  eventId: string;
  userId: string;
}) {
  const [data, setData] = useState<HostCapabilities | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = () => {
      if (document.hidden) return;
      void requestPrivateJson(
        '/api/v1/me/host-capabilities',
        hostCapabilitiesSchema,
        { signal: controller.signal },
      ).then(
        (result) => {
          if (
            active &&
            result.eventId === eventId &&
            result.userId === userId
          ) {
            setData(result);
            setError(false);
          }
        },
        () => {
          if (active) {
            setData(null);
            setError(true);
          }
        },
      );
    };
    load();
    const timer = setInterval(load, 15000);
    const unsubscribe = subscribeToPrivateResourceInvalidation(() => {
      active = false;
      controller.abort();
      setData(null);
    });
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      unsubscribe();
    };
  }, [eventId, userId, retry]);
  if (error)
    return (
      <div>
        <p role="status">Moje role se nepodařilo načíst.</p>
        <Button onClick={() => setRetry((value) => value + 1)}>
          Načíst role znovu
        </Button>
      </div>
    );
  if (!data || (!data.activities && !data.moderation && !data.followUps))
    return null;
  return (
    <section className="participant-role-section">
      <header>
        <h2>Moje role</h2>
        <p>Nástroje pro vaše zapojení do programu.</p>
      </header>
      <nav aria-label="Moje role" className="participant-more-grid">
        {data.activities ? (
          <ActionLink href="/host/aktivity" variant="secondary">
            Vedoucí aktivity
          </ActionLink>
        ) : null}
        {data.moderation ? (
          <ActionLink href="/host/moderace" variant="secondary">
            Moderování
          </ActionLink>
        ) : null}
        {data.followUps ? (
          <ActionLink href="/host/dotazy" variant="secondary">
            Dotazy k doplnění ({data.pendingAnswerCount})
          </ActionLink>
        ) : null}
      </nav>
    </section>
  );
}
