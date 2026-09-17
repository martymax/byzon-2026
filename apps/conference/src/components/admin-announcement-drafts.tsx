'use client';

import type { AdminAnnouncementSavedDraft } from '@byzon/domain/contracts';
import { useCallback, useEffect, useState } from 'react';
import { requestAdminAnnouncementDraftList } from '@/lib/admin-api';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

export const AdminAnnouncementDrafts = ({
  revision,
  disabled,
  activeId,
  onOpen,
  onDelete,
}: {
  readonly revision: number;
  readonly disabled: boolean;
  readonly activeId: string | undefined;
  readonly onOpen: (id: string) => void;
  readonly onDelete: (item: AdminAnnouncementSavedDraft) => void;
}) => {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const fence = useAdminRequestFence();
  const [items, setItems] = useState<AdminAnnouncementSavedDraft[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (nextCursor?: string) => {
      const request = fence.begin('announcement-drafts');
      setLoading(true);
      setError(null);
      const result = await requestAdminAnnouncementDraftList(
        api,
        eventId,
        nextCursor,
        request.signal,
      );
      if (!request.isCurrent()) return;
      request.finish();
      setLoading(false);
      if (!result.ok) {
        const message = adminFailureMessage(
          result.failure,
          result.metadata?.requestId,
        );
        if (isAdminSecurityFailure(result)) {
          setItems([]);
          invalidateSensitive(message);
        } else setError(message);
        return;
      }
      if (result.kind === 'success') {
        setItems((current) =>
          nextCursor
            ? [
                ...current,
                ...result.data.items.filter(
                  (item) => !current.some(({ id }) => id === item.id),
                ),
              ]
            : result.data.items,
        );
        setCursor(result.data.nextCursor);
      }
    },
    [api, eventId, fence, invalidateSensitive],
  );
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
      fence.cancel('announcement-drafts');
    };
  }, [load, fence, revision]);
  const date = new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: eventTimezone,
  });
  return (
    <section className={styles.panel} aria-labelledby="announcement-drafts">
      <div className={styles.panelHeader}>
        <h2 id="announcement-drafts">Koncepty</h2>
        <button
          className={styles.secondaryButton}
          disabled={loading || disabled}
          onClick={() => void load()}
          type="button"
        >
          Obnovit koncepty
        </button>
      </div>
      <p className={styles.muted}>
        Uložené koncepty mohou upravit a odeslat i další správci s oprávněním
        odesílat oznámení. Účastníci je zatím nevidí.
      </p>
      {loading ? <p role="status">Načítám koncepty…</p> : null}
      {error ? (
        <p className={styles.errorSummary} role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p>
          Zatím nemáte uložené koncepty. Rozepsané oznámení uložíte tlačítkem
          „Uložit koncept“.
        </p>
      ) : null}
      <ul className={styles.cardList}>
        {items.map((item) => (
          <li className={styles.dataCard} key={item.id}>
            <h3>{item.draft.title || 'Koncept bez nadpisu'}</h3>
            <p>
              {item.draft.bodyText.slice(0, 200) ||
                'Zpráva zatím není dopsaná.'}
            </p>
            <p className={styles.muted}>
              Upraveno {date.format(new Date(item.updatedAt))} ·{' '}
              {item.draft.audience.kind === 'event'
                ? 'Všichni účastníci akce'
                : 'Účastníci vybrané aktivity'}
              {activeId === item.id ? ' · Otevřeno ve formuláři' : ''}
            </p>
            <div className={styles.actionRow}>
              <button
                className={styles.secondaryButton}
                disabled={disabled || loading}
                onClick={() => onOpen(item.id)}
                type="button"
                aria-label={`Otevřít koncept „${item.draft.title || 'Bez nadpisu'}“`}
              >
                Otevřít koncept
              </button>
              <button
                className={styles.dangerButton}
                disabled={disabled || loading}
                onClick={() => onDelete(item)}
                type="button"
                aria-label={`Smazat koncept „${item.draft.title || 'Bez nadpisu'}“`}
              >
                Smazat koncept
              </button>
            </div>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button
          className={styles.secondaryButton}
          disabled={disabled || loading}
          onClick={() => void load(cursor)}
          type="button"
        >
          Načíst další koncepty
        </button>
      ) : null}
    </section>
  );
};
