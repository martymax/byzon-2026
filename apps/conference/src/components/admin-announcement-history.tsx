'use client';

import type { AdminAnnouncementListItem } from '@byzon/domain/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestAdminAnnouncementDelete,
  requestAdminAnnouncementList,
} from '@/lib/admin-api';
import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

export const AdminAnnouncementHistory = ({
  revision,
}: {
  readonly revision?: string | undefined;
}) => {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const fence = useAdminRequestFence();
  const [items, setItems] = useState<AdminAnnouncementListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAnnouncementListItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const deleteKeys = useRef(new Map<string, string>());
  const statusRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(
    async (nextCursor?: string) => {
      const request = fence.begin('announcement-history');
      setLoading(true);
      setError(null);
      const result = await requestAdminAnnouncementList(
        api,
        eventId,
        nextCursor,
        request.signal,
      );
      if (!request.isCurrent()) return;
      request.finish();
      setLoading(false);
      if (!result.ok) {
        if (isAdminSecurityFailure(result)) {
          setItems([]);
          invalidateSensitive(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
        } else
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
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
      fence.cancel('announcement-history');
    };
  }, [load, fence, revision]);

  const remove = async (item: AdminAnnouncementListItem) => {
    if (deleting) return;
    setDeleting(true);
    setSelected(null);
    setError(null);
    setMessage(null);
    fence.cancel('announcement-history');
    setLoading(false);
    const request = fence.begin('announcement-delete');
    const key =
      deleteKeys.current.get(item.id) ??
      createAdminIdempotencyKey('announcement-delete');
    deleteKeys.current.set(item.id, key);
    const result = await requestAdminAnnouncementDelete(
      api,
      eventId,
      item.id,
      key,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setDeleting(false);
    if (
      !result.ok &&
      !(
        result.failure.kind === 'problem' &&
        result.failure.problem.code === 'ANNOUNCEMENT_NOT_FOUND'
      )
    ) {
      if (isAdminSecurityFailure(result)) {
        setItems([]);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
      } else
        setError(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
      return;
    }
    deleteKeys.current.delete(item.id);
    setItems((current) => current.filter(({ id }) => id !== item.id));
    setMessage(
      `Oznámení „${item.title}“ bylo smazáno a už není dostupné příjemcům.`,
    );
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  return (
    <section className={styles.panel} aria-labelledby="announcement-history">
      <div className={styles.panelHeader}>
        <h2 id="announcement-history">Odeslaná oznámení</h2>
        <button
          className={styles.secondaryButton}
          disabled={loading || deleting}
          onClick={() => void load()}
          type="button"
        >
          Obnovit přehled
        </button>
      </div>
      <p className={styles.muted}>
        Smazané oznámení zmizí všem příjemcům z aplikace.
      </p>
      {message ? (
        <p
          className={styles.success}
          role="status"
          ref={statusRef}
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.errorSummary} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">Načítám odeslaná oznámení…</p> : null}
      {deleting ? <p role="status">Mažu oznámení všem příjemcům…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p>Zatím tu nejsou žádná odeslaná oznámení.</p>
      ) : null}
      <ul className={styles.cardList}>
        {items.map((item) => (
          <li className={styles.dataCard} key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <p className={styles.muted}>
              {new Intl.DateTimeFormat('cs-CZ', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: eventTimezone,
              }).format(new Date(item.publishedAt))}
              {' · '}
              {item.context.kind === 'event'
                ? 'Všichni účastníci akce'
                : item.context.session.title}
              {' · '}Počet příjemců: {item.recipientCount}
            </p>
            <details>
              <summary>Celá zpráva</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{item.bodyText}</p>
            </details>
            <button
              className={styles.dangerButton}
              disabled={deleting || loading}
              onClick={() => setSelected(item)}
              type="button"
              aria-label={`Smazat oznámení „${item.title}“`}
            >
              Smazat
            </button>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button
          className={styles.secondaryButton}
          disabled={loading || deleting}
          onClick={() => void load(cursor)}
          type="button"
        >
          Načíst starší oznámení
        </button>
      ) : null}
      {selected ? (
        <AdminConfirmDialog
          title="Smazat oznámení všem příjemcům?"
          description="Oznámení se trvale odstraní ze seznamu i detailu u všech příjemců, včetně těch, kteří ho už přečetli. Tuto akci nelze vrátit."
          impact={
            <p>
              <strong>{selected.title}</strong> · Počet příjemců:{' '}
              {selected.recipientCount}
            </p>
          }
          acknowledgement="Rozumím, že oznámení zmizí všem příjemcům."
          confirmLabel="Smazat všem příjemcům"
          danger
          onConfirm={() => void remove(selected)}
          onDismiss={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
};
