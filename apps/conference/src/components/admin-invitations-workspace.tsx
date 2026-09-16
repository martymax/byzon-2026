'use client';

import { useEffect, useRef, useState } from 'react';
import {
  adminInvitationRecipientsSchema,
  type AdminInvitationRecipients,
  type AdminInvitationRecipient,
  type AdminInvitationRole,
} from '@byzon/domain/contracts';
import { requestPrivateJson, PrivateApiError } from '@/lib/private-json';
import {
  requestAdminParticipantInvite,
  requestAdminTeamInvitation,
} from '@/lib/admin-api';
import { AdminBulkCheckbox } from './admin-bulk-selection';
import { adminBulkApiResult } from './admin-bulk-api';
import type { AdminBulkOutcome } from './admin-bulk';
import { AdminModal } from './admin-modal';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';
import {
  filterInvitationRecipients,
  invitationRoleLabels,
  invitationStatusLabels,
  selectVisibleRecipients,
  sendInvitationBatch,
} from './admin-invitations-model';
import styles from './admin-workspace.module.css';
import invitationStyles from './admin-invitations.module.css';

export function AdminInvitationsWorkspace() {
  const { eventId, securityEpoch } = useAdminWorkspace();
  return <Invitations key={`${eventId}:${securityEpoch}`} />;
}

function Invitations() {
  const { api, eventId, context, permissions, invalidateSensitive } =
    useAdminWorkspace();
  const [items, setItems] = useState<AdminInvitationRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [roles, setRoles] = useState<ReadonlySet<AdminInvitationRole>>(
    new Set(),
  );
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<
    keyof typeof invitationStatusLabels | 'all'
  >('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [review, setReview] = useState<
    readonly AdminInvitationRecipient[] | null
  >(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [paused, setPaused] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [outcomes, setOutcomes] = useState<readonly AdminBulkOutcome[]>([]);
  const batchController = useRef<AbortController | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const allowed = [
    'role:manage',
    'participant:operational:read',
    'ticket:any:manage',
  ].every((permission) => permissions.some((value) => value === permission));
  const writable = allowed && context.event.phase !== 'archived';
  const busy = progress !== null;
  const visible = filterInvitationRecipients(items, roles, query, status);
  const selectable = visible.filter((item) => item.delivery !== null);
  const selectedVisible = selectable.filter((item) =>
    selected.has(item.userId),
  ).length;
  const chosen = items.filter(
    (item) => selected.has(item.userId) && item.delivery !== null,
  );
  const hiddenCount = chosen.filter((item) => !visible.includes(item)).length;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      batchController.current?.abort();
      requestController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (allCheckbox.current)
      allCheckbox.current.indeterminate =
        selectedVisible > 0 && selectedVisible < selectable.length;
  }, [selectedVisible, selectable.length]);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy]);
  useEffect(() => {
    if (!allowed) return;
    const abort = new AbortController();
    void (async () => {
      const recipients = new Map<string, AdminInvitationRecipient>();
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const data: AdminInvitationRecipients = await requestPrivateJson(
          `/api/v1/admin/events/${eventId}/invitations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          adminInvitationRecipientsSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (
          data.eventId !== eventId ||
          (data.nextCursor && cursors.has(data.nextCursor))
        )
          throw new Error('Invalid recipient page');
        data.items.forEach((item) => recipients.set(item.userId, item));
        cursor = data.nextCursor;
        if (cursor) cursors.add(cursor);
      } while (cursor);
      setItems(
        [...recipients.values()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName, 'cs'),
        ),
      );
      setLoading(false);
    })().catch((caught: unknown) => {
      if (abort.signal.aborted) return;
      setLoading(false);
      if (
        caught instanceof PrivateApiError &&
        [401, 403].includes(caught.status)
      ) {
        invalidateSensitive('Přístup se změnil. Přihlaste se znovu.');
      } else setError('Příjemce se nepodařilo načíst. Zkuste seznam obnovit.');
    });
    return () => abort.abort();
  }, [allowed, eventId, invalidateSensitive, reload]);

  const send = async () => {
    if (!review || busy || batchController.current || !writable) return;
    const batch = review;
    const abort = new AbortController();
    const requests = new AbortController();
    batchController.current = abort;
    requestController.current = requests;
    setReview(null);
    setOutcomes([]);
    setStopping(false);
    setProgress({ completed: 0, total: batch.length });
    const results = await sendInvitationBatch({
      items: batch,
      signal: abort.signal,
      onPause: (value) => {
        if (mounted.current) setPaused(value);
      },
      onProgress: (completed) => {
        if (mounted.current) setProgress({ completed, total: batch.length });
      },
      execute: async (item) => {
        const keyId = `${item.delivery}:${item.userId}`;
        const key =
          keys.current.get(keyId) ?? createAdminIdempotencyKey('invitations');
        keys.current.set(keyId, key);
        const result =
          item.delivery === 'team'
            ? await requestAdminTeamInvitation(
                api,
                eventId,
                { memberId: item.userId },
                key,
                requests.signal,
              )
            : await requestAdminParticipantInvite(
                api,
                eventId,
                item.userId,
                { participantId: item.userId },
                key,
                requests.signal,
              );
        if (!result.ok && result.status === 429)
          return { ok: false, stop: true, rateLimited: true };
        if (result.ok && result.kind === 'success') {
          if (
            result.data.eventId !== eventId ||
            ('memberId' in result.data
              ? result.data.memberId
              : result.data.participantId) !== item.userId
          ) {
            return {
              ok: false,
              stop: true,
              message: 'Server nepotvrdil správného příjemce. Obnovte seznam.',
            };
          }
          keys.current.delete(keyId);
          if (mounted.current)
            setItems((current) =>
              current.map((recipient) =>
                recipient.userId === item.userId
                  ? { ...recipient, invitation: result.data.invitation }
                  : recipient,
              ),
            );
        }
        return adminBulkApiResult(result, invalidateSensitive);
      },
    });
    if (!mounted.current) return;
    batchController.current = null;
    requestController.current = null;
    setProgress(null);
    setPaused(false);
    setOutcomes(results);
    setSelected(
      new Set(
        results
          .filter((result) => result.status !== 'succeeded')
          .map((result) => result.id),
      ),
    );
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Pozvánky</h1>
        <p>
          Vyberte role a konkrétní příjemce. Všem zaškrtnutým odešlete pozvánku
          do aplikace najednou.
        </p>
      </header>
      {!allowed ? (
        <p className={styles.warning}>
          Pro rozesílání potřebujete oprávnění ke správě týmu a účastníků.
        </p>
      ) : (
        <>
          {!writable ? (
            <p className={styles.warning}>
              Akce je archivovaná. Pozvánky už nelze odesílat.
            </p>
          ) : null}
          {error ? (
            <p className={styles.warning} role="alert">
              {error}
            </p>
          ) : null}
          {outcomes.length > 0 ? (
            <section className={styles.panel} aria-label="Výsledek rozesílání">
              <p role="status">
                <strong>
                  Odesláno:{' '}
                  {
                    outcomes.filter((item) => item.status === 'succeeded')
                      .length
                  }{' '}
                  z {outcomes.length}.
                </strong>{' '}
                {outcomes.some((item) => item.status !== 'succeeded')
                  ? 'Nedokončení příjemci zůstali zaškrtnutí. Výběr můžete znovu odeslat.'
                  : 'Všechny vybrané pozvánky byly odeslány.'}
              </p>
              {outcomes.some((item) => item.status !== 'succeeded') ? (
                <ul className={invitationStyles.results}>
                  {outcomes
                    .filter((item) => item.status !== 'succeeded')
                    .map((item) => (
                      <li key={item.id}>
                        <strong>{item.label}</strong> —{' '}
                        {item.status === 'skipped'
                          ? 'Neodesláno'
                          : (item.message ?? 'Odeslání se nepodařilo.')}
                      </li>
                    ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          <section
            className={styles.panel}
            aria-labelledby="invitation-recipients"
          >
            <div className={styles.panelHeader}>
              <h2 id="invitation-recipients">Příjemci</h2>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy || loading}
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setItems([]);
                  setSelected(new Set());
                  setReload((value) => value + 1);
                }}
              >
                Obnovit seznam
              </button>
            </div>
            <fieldset
              className={invitationStyles.roles}
              disabled={busy || loading}
            >
              <legend>Filtrovat podle rolí</legend>
              {(
                Object.entries(invitationRoleLabels) as [
                  AdminInvitationRole,
                  string,
                ][]
              ).map(([role, label]) => (
                <label key={role} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={roles.has(role)}
                    onChange={(event) => {
                      const next = new Set(roles);
                      if (event.target.checked) next.add(role);
                      else next.delete(role);
                      setRoles(next);
                    }}
                  />
                  <span>
                    {label}{' '}
                    <span className={styles.muted}>
                      (
                      {items.filter((item) => item.roles.includes(role)).length}
                      )
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className={styles.helper}>
              Bez filtru vidíte všechny role. Při výběru více rolí stačí shoda s
              jednou z nich. Každý člověk dostane jednu pozvánku.
            </p>
            <div className={invitationStyles.filters}>
              <label className={styles.field}>
                <span>Jméno nebo e-mail</span>
                <input
                  type="search"
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Hledat příjemce"
                />
              </label>
              <label className={styles.field}>
                <span>Stav pozvánky</span>
                <select
                  disabled={busy}
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as typeof status)
                  }
                >
                  <option value="all">Všechny stavy</option>
                  {Object.entries(invitationStatusLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className={invitationStyles.selection}>
              <label className={styles.checkRow}>
                <input
                  ref={allCheckbox}
                  type="checkbox"
                  checked={
                    selectable.length > 0 &&
                    selectedVisible === selectable.length
                  }
                  disabled={
                    !writable || busy || loading || selectable.length === 0
                  }
                  onChange={(event) =>
                    setSelected(
                      selectVisibleRecipients(
                        selected,
                        selectable.map((item) => item.userId),
                        event.target.checked,
                      ),
                    )
                  }
                />
                <span>Vybrat všechny zobrazené ({selectable.length})</span>
              </label>
              <span className={styles.muted}>
                Zobrazeno {visible.length} z {items.length}
              </span>
            </div>
            {loading ? (
              <p className={styles.empty} role="status">
                Načítám příjemce…
              </p>
            ) : error ? null : visible.length === 0 ? (
              <p className={styles.empty}>
                Tomuto filtru neodpovídají žádní příjemci.
              </p>
            ) : (
              <ul
                className={invitationStyles.recipients}
                aria-label="Seznam příjemců"
              >
                {visible.map((item) => (
                  <li
                    key={item.userId}
                    className={invitationStyles.recipient}
                    data-selected={selected.has(item.userId) || undefined}
                  >
                    <AdminBulkCheckbox
                      id={item.userId}
                      label={item.displayName}
                      selection={{
                        selectedIds: selected,
                        onSelectionChange: setSelected,
                      }}
                      disabled={!writable || busy || item.delivery === null}
                    />
                    <div className={invitationStyles.person}>
                      <strong>{item.displayName}</strong>
                      <span>{item.email}</span>
                      {item.delivery === null ? (
                        <small>
                          Chybí aktivní účastnický přístup. Opravte jej ve
                          správě účastníků.
                        </small>
                      ) : null}
                    </div>
                    <div className={invitationStyles.roleList}>
                      {item.roles
                        .map((role) => invitationRoleLabels[role])
                        .join(', ')}
                    </div>
                    <div className={invitationStyles.status}>
                      <span className={styles.statusBadge}>
                        {invitationStatusLabels[item.invitation.status]}
                      </span>
                      {item.invitation.lastSentAt ? (
                        <time dateTime={item.invitation.lastSentAt}>
                          Poslední odeslání{' '}
                          {new Date(item.invitation.lastSentAt).toLocaleString(
                            'cs-CZ',
                            {
                              dateStyle: 'short',
                              timeStyle: 'short',
                              timeZone: 'Europe/Prague',
                            },
                          )}
                        </time>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            className={invitationStyles.sendBar}
            aria-label="Odeslání pozvánek"
          >
            <div>
              <strong>Vybráno příjemců: {chosen.length}</strong>
              <p>
                {hiddenCount > 0
                  ? `Z toho ${hiddenCount} mimo aktuální filtr. Výběr zůstává zachovaný i při změně role.`
                  : 'Pozvánku obdrží pouze zaškrtnutí příjemci.'}
              </p>
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy || selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Zrušit výběr
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!writable || loading || busy || chosen.length === 0}
                onClick={() => setReview(chosen)}
              >
                Odeslat pozvánky ({chosen.length})
              </button>
            </div>
            {progress ? (
              <div className={invitationStyles.progress}>
                <p role="status">
                  {stopping
                    ? 'Zastavuji po dokončení aktuální pozvánky…'
                    : paused
                      ? 'Krátká pauza před další dávkou. Rozesílání bude automaticky pokračovat.'
                      : 'Odesílám pozvánky…'}{' '}
                  {progress.completed} / {progress.total}
                </p>
                <progress
                  value={progress.completed}
                  max={progress.total}
                  aria-label="Průběh rozesílání"
                />
                <p className={styles.helper}>
                  Stránku nechte otevřenou, dokud se rozesílání nedokončí.
                </p>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={stopping}
                  onClick={() => {
                    setStopping(true);
                    batchController.current?.abort();
                  }}
                >
                  Zastavit rozesílání
                </button>
              </div>
            ) : null}
          </section>
        </>
      )}
      {review ? (
        <AdminModal
          labelledBy="invitation-review-title"
          onDismiss={() => setReview(null)}
          size="wide"
        >
          <div className={styles.dialogHeader}>
            <h2
              id="invitation-review-title"
              tabIndex={-1}
              data-modal-initial-focus="true"
            >
              Odeslat vybrané pozvánky?
            </h2>
          </div>
          <div className={styles.dialogBody}>
            <p>
              Pozvánka s osobním přihlašovacím odkazem přijde na uvedené
              e-maily. Celkem příjemců: <strong>{review.length}</strong>.
            </p>
            {review.some((item) => item.invitation.status !== 'not_sent') ? (
              <p className={styles.warning}>
                Výběr obsahuje již pozvané nebo aktivované účty. Těmto lidem
                přijde nový přihlašovací odkaz.
              </p>
            ) : null}
            <ul className={invitationStyles.review}>
              {review.map((item) => (
                <li key={item.userId}>
                  <strong>{item.displayName}</strong>
                  <span>{item.email}</span>
                </li>
              ))}
            </ul>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setReview(null)}
              >
                Zpět k výběru
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void send()}
              >
                Potvrdit a odeslat ({review.length})
              </button>
            </div>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
