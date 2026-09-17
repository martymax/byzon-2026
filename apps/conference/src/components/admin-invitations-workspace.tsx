'use client';

import { useEffect, useRef, useState } from 'react';
import { guidePath, guidesForRoles } from '@byzon/mail/guides';
import {
  adminInvitationRecipientsSchema,
  invitationBatchCreatedSchema,
  invitationBatchesSchema,
  type InvitationBatch,
  type AdminInvitationRecipients,
  type AdminInvitationRecipient,
  type AdminInvitationRole,
} from '@byzon/domain/contracts';
import { requestPrivateJson, PrivateApiError } from '@/lib/private-json';
import { AdminBulkCheckbox } from './admin-bulk-selection';
import { AdminModal } from './admin-modal';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';
import {
  filterInvitationRecipients,
  invitationRoleLabels,
  invitationStatusLabels,
  selectVisibleRecipients,
} from './admin-invitations-model';
import styles from './admin-workspace.module.css';
import invitationStyles from './admin-invitations.module.css';

export function AdminInvitationsWorkspace() {
  const { eventId, securityEpoch } = useAdminWorkspace();
  return <Invitations key={`${eventId}:${securityEpoch}`} />;
}

function Invitations() {
  const { eventId, context, permissions, invalidateSensitive } =
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
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<InvitationBatch[]>([]);
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<string>>(new Set());
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [notice, setNotice] = useState('');
  const keys = useRef(new Map<string, string>());
  const submitting = useRef(false);
  const deliveredCount = useRef<number | null>(null);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const allowed = [
    'role:manage',
    'participant:operational:read',
    'ticket:any:manage',
  ].every((permission) => permissions.some((value) => value === permission));
  const writable = allowed && context.event.phase !== 'archived';
  const visible = filterInvitationRecipients(items, roles, query, status);
  const selectable = visible.filter(
    (item) => item.delivery !== null && !queuedIds.has(item.userId),
  );
  const selectedVisible = selectable.filter((item) =>
    selected.has(item.userId),
  ).length;
  const chosen = items.filter(
    (item) =>
      selected.has(item.userId) &&
      item.delivery !== null &&
      !queuedIds.has(item.userId),
  );
  const hiddenCount = chosen.filter((item) => !visible.includes(item)).length;

  useEffect(() => {
    if (allCheckbox.current)
      allCheckbox.current.indeterminate =
        selectedVisible > 0 && selectedVisible < selectable.length;
  }, [selectedVisible, selectable.length]);
  useEffect(() => {
    if (!allowed) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await requestPrivateJson(
          `/api/v1/admin/events/${eventId}/invitations/batches`,
          invitationBatchesSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (data.eventId !== eventId) throw new Error('Invalid batch event');
        setBatches(data.batches);
        setQueuedIds(new Set(data.queuedUserIds));
        setQueueLoading(false);
        setQueueError('');
        const count = data.batches.reduce(
          (sum, batch) => sum + batch.delivered,
          0,
        );
        if (deliveredCount.current !== null && deliveredCount.current !== count)
          setReload((value) => value + 1);
        deliveredCount.current = count;
      } catch (caught) {
        if (abort.signal.aborted) return;
        if (
          caught instanceof PrivateApiError &&
          [401, 403].includes(caught.status)
        ) {
          invalidateSensitive('Přístup se změnil. Přihlaste se znovu.');
          return;
        }
        setQueueError(
          'Průběh se nepodařilo aktualizovat. Rozesílání na serveru pokračuje; načtení zkusíme znovu.',
        );
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [allowed, eventId, invalidateSensitive, reload]);
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
    if (!review || submitting.current || !writable) return;
    submitting.current = true;
    const batch = review;
    const userIds = batch.map((item) => item.userId).sort();
    const fingerprint = userIds.join(',');
    const key =
      keys.current.get(fingerprint) ??
      createAdminIdempotencyKey('invitation-batch');
    keys.current.set(fingerprint, key);
    setReview(null);
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await requestPrivateJson(
        `/api/v1/admin/events/${eventId}/invitations/batches`,
        invitationBatchCreatedSchema,
        { body: { userIds }, key },
      );
      if (result.eventId !== eventId) throw new Error('Invalid batch event');
      keys.current.delete(fingerprint);
      setQueuedIds((current) => new Set([...current, ...userIds]));
      setSelected(
        (current) =>
          new Set([...current].filter((id) => !userIds.includes(id))),
      );
      setNotice(
        result.queued > 0
          ? `Zařazeno do fronty: ${result.queued}. Stránku můžete zavřít, pozvánky se odešlou na pozadí.${result.alreadyQueued ? ` Již ve frontě: ${result.alreadyQueued}.` : ''}`
          : 'Vybraní příjemci už jsou ve frontě. Stránku můžete zavřít.',
      );
      setReload((value) => value + 1);
    } catch (caught) {
      if (
        caught instanceof PrivateApiError &&
        [401, 403].includes(caught.status)
      )
        invalidateSensitive('Přístup se změnil. Přihlaste se znovu.');
      else
        setError(
          caught instanceof PrivateApiError
            ? caught.message
            : 'Server nepotvrdil zařazení. Zkontrolujte průběh dávky nebo znovu odešlete stejný výběr; opakovaný požadavek nevytvoří další dávku.',
        );
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Pozvánky</h1>
        <p>
          Vyberte role a konkrétní příjemce. Všem zaškrtnutým odešlete pozvánku
          do aplikace najednou.
        </p>
        <p>
          Každá pozvánka obsahuje veřejné návody podle aktuálních rolí příjemce.{' '}
          <a href="/navody" target="_blank" rel="noreferrer">
            Prohlédnout všechny návody
          </a>
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
          {notice ? (
            <p className={styles.helper} role="status">
              {notice}
            </p>
          ) : null}
          {busy ? <p role="status">Ukládám dávku do fronty…</p> : null}
          {queueLoading && !queueError ? (
            <p role="status">Načítám stav fronty…</p>
          ) : null}
          {queueError ? (
            <p className={styles.warning} role="alert">
              {queueError}
            </p>
          ) : null}
          {batches.length > 0 ? (
            <section
              className={styles.panel}
              aria-labelledby="invitation-queue-title"
            >
              <h2 id="invitation-queue-title">Průběh rozesílání</h2>
              <p className={styles.helper}>
                Dávky se zpracovávají i po zavření stránky. Dočasné chyby se
                opakují automaticky. Zde najdete průběh i po návratu.
              </p>
              <ul className={invitationStyles.batches}>
                {batches.map((batch) => {
                  const active = batch.pending + batch.processing;
                  return (
                    <li key={batch.id}>
                      <div className={invitationStyles.batchHeading}>
                        <strong>
                          {active
                            ? 'Probíhá rozesílání'
                            : batch.failed || batch.skipped
                              ? 'Dokončeno s neodeslanými pozvánkami'
                              : 'Rozesílání dokončeno'}
                        </strong>
                        <time dateTime={batch.createdAt}>
                          {new Date(batch.createdAt).toLocaleString('cs-CZ', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: 'Europe/Prague',
                          })}
                        </time>
                      </div>
                      <p>
                        Odesláno:{' '}
                        <strong>
                          {batch.delivered} z {batch.total}
                        </strong>
                        {active
                          ? ` · Ve frontě: ${batch.pending} · Odesílá se: ${batch.processing}`
                          : ''}
                        {batch.failed ? ` · Nezdařilo se: ${batch.failed}` : ''}
                        {batch.skipped ? ` · Přeskočeno: ${batch.skipped}` : ''}
                      </p>
                      {active ? (
                        <progress
                          value={batch.delivered + batch.failed + batch.skipped}
                          max={batch.total}
                          aria-label="Průběh dávky"
                        />
                      ) : null}
                      {batch.skipped ? (
                        <p className={styles.helper}>
                          Přeskočení příjemci už nemají odpovídající přístup,
                          změnili e-mail nebo byl jejich odkaz použit.
                        </p>
                      ) : null}
                      {batch.failedUserIds.length > 0 ? (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={!writable || busy || loading}
                          onClick={() => {
                            setSelected(new Set(batch.failedUserIds));
                            setNotice(
                              'Vybrány pouze neúspěšné pozvánky z této dávky. Zkontrolujte příjemce a potvrďte nové odeslání.',
                            );
                          }}
                        >
                          Vybrat neúspěšné ({batch.failedUserIds.length})
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
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
                      disabled={
                        !writable ||
                        busy ||
                        item.delivery === null ||
                        queuedIds.has(item.userId)
                      }
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
                      {guidesForRoles(item.roles).map((guide, index) => (
                        <span key={guide.role}>
                          {index > 0 ? ', ' : ''}
                          <a
                            href={guidePath(guide.slug)}
                            target="_blank"
                            rel="noreferrer"
                            title={`Veřejný návod: ${guide.title}`}
                          >
                            {invitationRoleLabels[guide.role]}
                          </a>
                        </span>
                      ))}
                    </div>
                    <div className={invitationStyles.status}>
                      <span className={styles.statusBadge}>
                        {queuedIds.has(item.userId)
                          ? 'Ve frontě'
                          : invitationStatusLabels[item.invitation.status]}
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
                disabled={
                  !writable ||
                  loading ||
                  queueLoading ||
                  busy ||
                  chosen.length === 0
                }
                onClick={() => setReview(chosen)}
              >
                Odeslat pozvánky ({chosen.length})
              </button>
            </div>
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
              e-maily. Po potvrzení se rozesílání uloží do fronty a poběží na
              pozadí. Celkem příjemců: <strong>{review.length}</strong>.
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
