'use client';

import { useMemo, useState } from 'react';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminReasonSchema,
  auditEntrySchema,
  eventSettingsSchema,
  reservationRecordSchema,
  type AuditEntry,
  type EventSettings,
  type ReservationRecord,
} from './admin-workspace-contracts';
import {
  demoAuditEntries,
  demoEventSettings,
  demoReservations,
} from './admin-workspace-demo-data';
import { useAdminWorkspaceScope } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

type ReservationAction =
  'increase_capacity' | 'cancel_reservation' | 'mark_attended';
type PendingChange =
  | {
      readonly kind: 'reservation';
      readonly record: ReservationRecord;
      readonly action: ReservationAction;
    }
  | { readonly kind: 'settings' }
  | null;

const reservationActionLabels: Record<ReservationAction, string> = {
  increase_capacity: 'Navýšit kapacitu o 1',
  cancel_reservation: 'Zrušit rezervaci',
  mark_attended: 'Označit účast v místnosti',
};

const stateLabels: Record<ReservationRecord['state'], string> = {
  reserved: 'Rezervováno',
  cancelled: 'Zrušeno',
  attended: 'Účast potvrzena',
};

export const AdminReservationWorkspace = () => {
  const scope = useAdminWorkspaceScope();
  const isAdmin = scope.role === 'organizer_admin';
  const [records, setRecords] =
    useState<readonly ReservationRecord[]>(demoReservations);
  const [audits, setAudits] = useState<readonly AuditEntry[]>(demoAuditEntries);
  const [settings, setSettings] = useState<EventSettings>(demoEventSettings);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [auditCategory, setAuditCategory] = useState('all');
  const [auditOutcome, setAuditOutcome] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<ReservationAction>('mark_attended');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingChange>(null);
  const [lastAudit, setLastAudit] = useState<AuditEntry | null>(null);
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [settingsReason, setSettingsReason] = useState('');
  const [settingsAttempted, setSettingsAttempted] = useState(false);

  const roleScopedRecords = useMemo(
    () =>
      isAdmin
        ? records
        : records.filter(({ sessionId }) =>
            scope.assignedSessionIds.includes(sessionId),
          ),
    [isAdmin, records, scope.assignedSessionIds],
  );
  const filteredRecords = useMemo(
    () =>
      roleScopedRecords.filter(
        ({ sessionId, state }) =>
          (sessionFilter === 'all' || sessionId === sessionFilter) &&
          (stateFilter === 'all' || state === stateFilter),
      ),
    [roleScopedRecords, sessionFilter, stateFilter],
  );
  const selected =
    roleScopedRecords.find(
      ({ reservationId }) => reservationId === selectedId,
    ) ?? null;
  const visibleAudits = useMemo(
    () =>
      audits.filter(
        ({ category, outcome }) =>
          (auditCategory === 'all' || category === auditCategory) &&
          (auditOutcome === 'all' || outcome === auditOutcome),
      ),
    [auditCategory, auditOutcome, audits],
  );
  const reasonInvalid =
    attempted && !adminReasonSchema.safeParse(reason).success;
  const settingsReasonInvalid =
    settingsAttempted && !adminReasonSchema.safeParse(settingsReason).success;
  const settingsCandidate = eventSettingsSchema.safeParse({
    ...settingsDraft,
    eventId: scope.eventId,
    version: settings.version + 1,
  });
  const settingsContentInvalid =
    settingsAttempted && !settingsCandidate.success;
  const transitionInvalid =
    selected !== null &&
    ((action === 'cancel_reservation' && selected.state === 'cancelled') ||
      (action === 'mark_attended' && selected.state !== 'reserved'));
  const actionForbidden = !isAdmin && action !== 'mark_attended';

  const beginRecordAction = (record: ReservationRecord) => {
    setSelectedId(record.reservationId);
    setAction(
      !isAdmin
        ? 'mark_attended'
        : record.state === 'reserved'
          ? 'mark_attended'
          : 'increase_capacity',
    );
    setReason('');
    setAttempted(false);
    setLastAudit(null);
  };

  const requestReservationChange = () => {
    setAttempted(true);
    if (
      !selected ||
      !adminReasonSchema.safeParse(reason).success ||
      transitionInvalid ||
      actionForbidden
    ) {
      return;
    }
    setPending({ kind: 'reservation', record: selected, action });
  };

  const requestSettingsChange = () => {
    setSettingsAttempted(true);
    if (
      !isAdmin ||
      !adminReasonSchema.safeParse(settingsReason).success ||
      !settingsCandidate.success
    )
      return;
    setPending({ kind: 'settings' });
  };

  const confirmChange = () => {
    if (!pending) return;
    if (pending.kind === 'reservation') {
      const current = pending.record;
      const nextVersion = current.version + 1;
      const nextRecord = reservationRecordSchema.parse({
        ...current,
        state:
          pending.action === 'cancel_reservation'
            ? 'cancelled'
            : pending.action === 'mark_attended'
              ? 'attended'
              : current.state,
        capacity:
          pending.action === 'increase_capacity'
            ? current.capacity + 1
            : current.capacity,
        reservedCount:
          pending.action === 'cancel_reservation'
            ? Math.max(0, current.reservedCount - 1)
            : current.reservedCount,
        version: nextVersion,
      });
      const category =
        pending.action === 'mark_attended' ? 'attendance' : 'reservation';
      const audit = auditEntrySchema.parse({
        auditId: `mock-audit-${category}-${current.reservationId}-v${nextVersion}`,
        eventId: scope.eventId,
        actorLabel: isAdmin ? 'Demo administrátor' : 'Demo operátor sálu',
        category,
        action: pending.action,
        targetReference: current.reservationId,
        reason,
        outcome: 'succeeded',
        createdAt: '2026-07-25T13:10:00.000+02:00',
        resultingVersion: nextVersion,
      });
      setRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.reservationId === nextRecord.reservationId
            ? nextRecord
            : record,
        ),
      );
      setAudits((currentAudits) => [audit, ...currentAudits]);
      setLastAudit(audit);
      setReason('');
      setAttempted(false);
    } else {
      if (!settingsCandidate.success) return;
      const nextSettings = settingsCandidate.data;
      const audit = auditEntrySchema.parse({
        auditId: `mock-audit-settings-v${nextSettings.version}`,
        eventId: scope.eventId,
        actorLabel: 'Demo administrátor',
        category: 'settings',
        action: 'update_event_settings',
        targetReference: scope.eventId,
        reason: settingsReason,
        outcome: 'succeeded',
        createdAt: '2026-07-25T13:12:00.000+02:00',
        resultingVersion: nextSettings.version,
      });
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setAudits((currentAudits) => [audit, ...currentAudits]);
      setLastAudit(audit);
      setSettingsReason('');
      setSettingsAttempted(false);
    }
    setPending(null);
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · řízené provozní změny</p>
        <h1>Rezervace, účast, audit a nastavení</h1>
        <p>
          Každá změna je scopeovaná, potvrzená důvodem a očekávanou verzí.
          Operátor sálu vidí pouze přidělené aktivity a nemůže měnit nastavení.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="reservation-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="reservation-title">
              Rezervační override a room attendance
            </h2>
            <p className={styles.muted}>
              {isAdmin
                ? 'Administrátorský rozsah celé akce.'
                : 'Omezeno na přiřazenou session Růst bez zkratek.'}
            </p>
          </div>
          <span className={styles.badge}>
            {roleScopedRecords.length} záznamy v rozsahu
          </span>
        </div>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Session</span>
            <select
              onChange={(event) => setSessionFilter(event.target.value)}
              value={sessionFilter}
            >
              <option value="all">Všechny v oprávněném rozsahu</option>
              {[
                ...new Map(
                  roleScopedRecords.map((record) => [
                    record.sessionId,
                    record.sessionTitle,
                  ]),
                ),
              ].map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Stav</span>
            <select
              onChange={(event) => setStateFilter(event.target.value)}
              value={stateFilter}
            >
              <option value="all">Všechny stavy</option>
              <option value="reserved">Rezervováno</option>
              <option value="attended">Účast potvrzena</option>
              <option value="cancelled">Zrušeno</option>
            </select>
          </label>
        </div>
        <ul className={styles.cardList}>
          {filteredRecords.map((record) => (
            <li className={styles.dataCard} key={record.reservationId}>
              <div className={styles.panelHeader}>
                <div>
                  <strong>{record.sessionTitle}</strong>
                  <div className={styles.muted}>
                    {record.participantReference}
                  </div>
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    record.state === 'cancelled'
                      ? styles.statusConflict
                      : record.state === 'attended'
                        ? styles.statusHealthy
                        : styles.statusAttention
                  }`}
                >
                  {stateLabels[record.state]}
                </span>
              </div>
              <dl>
                <dt>Kapacita</dt>
                <dd>
                  {record.reservedCount} / {record.capacity}
                </dd>
                <dt>Canonical verze</dt>
                <dd>{record.version}</dd>
              </dl>
              <button
                className={styles.secondaryButton}
                onClick={() => beginRecordAction(record)}
                type="button"
              >
                Otevřít řízenou změnu
              </button>
            </li>
          ))}
        </ul>
        {filteredRecords.length === 0 ? (
          <p className={styles.empty}>
            Filtr nebo oprávněný rozsah neobsahuje žádný záznam.
          </p>
        ) : null}
      </section>

      {selected ? (
        <section className={styles.panel} aria-labelledby="reservation-change">
          <h2 id="reservation-change">Potvrdit canonical změnu</h2>
          {reasonInvalid ||
          (attempted && (transitionInvalid || actionForbidden)) ? (
            <section
              aria-labelledby="reservation-errors"
              className={styles.errorSummary}
              role="alert"
            >
              <h2 id="reservation-errors">Změnu nelze připravit</h2>
              <ul>
                {reasonInvalid ? <li>Doplňte auditní důvod.</li> : null}
                {transitionInvalid ? (
                  <li>Akce neodpovídá současnému stavu rezervace.</li>
                ) : null}
                {actionForbidden ? (
                  <li>Role operátora sálu nesmí provést override.</li>
                ) : null}
              </ul>
            </section>
          ) : null}
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span>Akce</span>
              <select
                onChange={(event) =>
                  setAction(event.target.value as ReservationAction)
                }
                value={action}
              >
                {isAdmin ? (
                  <>
                    <option value="increase_capacity">
                      Navýšit kapacitu o 1
                    </option>
                    <option value="cancel_reservation">Zrušit rezervaci</option>
                  </>
                ) : null}
                <option value="mark_attended">Označit účast v místnosti</option>
              </select>
            </label>
            <div className={styles.callout}>
              Cíl {selected.reservationId} · očekávaná verze {selected.version}.
            </div>
          </div>
          <label className={styles.field}>
            <span>Důvod změny</span>
            <textarea
              aria-invalid={reasonInvalid}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <button
            className={
              action === 'cancel_reservation'
                ? styles.dangerButton
                : styles.button
            }
            onClick={requestReservationChange}
            type="button"
          >
            Zkontrolovat {reservationActionLabels[action].toLowerCase()}
          </button>
          {lastAudit ? (
            <section aria-live="polite" className={styles.success}>
              <h3>Canonical mock stav aktualizován</h3>
              <p>
                Audit <code>{lastAudit.auditId}</code> · nová verze{' '}
                {lastAudit.resultingVersion}.
              </p>
            </section>
          ) : null}
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="audit-title">
        <h2 id="audit-title">Audit browser</h2>
        <p className={styles.muted}>
          Audit zobrazuje provozní reference, důvody a výsledky bez PII a raw
          payloadů.
        </p>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Kategorie</span>
            <select
              onChange={(event) => setAuditCategory(event.target.value)}
              value={auditCategory}
            >
              <option value="all">Všechny</option>
              <option value="reservation">Rezervace</option>
              <option value="attendance">Účast</option>
              <option value="settings">Nastavení</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Výsledek</span>
            <select
              onChange={(event) => setAuditOutcome(event.target.value)}
              value={auditOutcome}
            >
              <option value="all">Všechny</option>
              <option value="succeeded">Úspěch</option>
              <option value="rejected">Odmítnuto</option>
              <option value="queued">Ve frontě</option>
            </select>
          </label>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>Bezpečné auditní události v aktuálním eventu.</caption>
            <thead>
              <tr>
                <th scope="col">Čas</th>
                <th scope="col">Kategorie</th>
                <th scope="col">Akce</th>
                <th scope="col">Cíl</th>
                <th scope="col">Důvod</th>
                <th scope="col">Výsledek</th>
              </tr>
            </thead>
            <tbody>
              {visibleAudits.map((audit) => (
                <tr key={audit.auditId}>
                  <td>{new Date(audit.createdAt).toLocaleString('cs-CZ')}</td>
                  <td>{audit.category}</td>
                  <td>{audit.action}</td>
                  <td>{audit.targetReference}</td>
                  <td>{audit.reason}</td>
                  <td>{audit.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.cards}>
          <ul className={styles.cardList}>
            {visibleAudits.map((audit) => (
              <li className={styles.dataCard} key={audit.auditId}>
                <strong>{audit.action}</strong>
                <dl>
                  <dt>Kategorie</dt>
                  <dd>{audit.category}</dd>
                  <dt>Cíl</dt>
                  <dd>{audit.targetReference}</dd>
                  <dt>Důvod</dt>
                  <dd>{audit.reason}</dd>
                  <dt>Výsledek</dt>
                  <dd>{audit.outcome}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
        {visibleAudits.length === 0 ? (
          <p className={styles.empty}>Filtru neodpovídá žádný audit.</p>
        ) : null}
      </section>

      {isAdmin ? (
        <section className={styles.panel} aria-labelledby="settings-title">
          <div className={styles.panelHeader}>
            <h2 id="settings-title">Minimální nastavení akce</h2>
            <span className={styles.badge}>Verze {settings.version}</span>
          </div>
          {settingsReasonInvalid || settingsContentInvalid ? (
            <section className={styles.errorSummary} role="alert">
              {settingsReasonInvalid
                ? 'Doplňte platný auditní důvod změny nastavení. '
                : null}
              {settingsContentInvalid
                ? 'Nastavení obsahuje prázdnou hodnotu, nepodporovaný znak nebo překračuje bezpečný limit.'
                : null}
            </section>
          ) : null}
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span>Režim registrace</span>
              <select
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    registrationMode: event.target
                      .value as EventSettings['registrationMode'],
                  }))
                }
                value={settingsDraft.registrationMode}
              >
                <option value="open">Otevřená</option>
                <option value="invite_only">Pouze pozvánky</option>
                <option value="closed">Uzavřená</option>
              </select>
            </label>
            <label className={styles.checkRow}>
              <input
                checked={settingsDraft.reservationChangesAllowed}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    reservationChangesAllowed: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>Účastníci mohou měnit vlastní rezervace</span>
            </label>
          </div>
          <label className={styles.field}>
            <span>Veřejný support pokyn</span>
            <textarea
              aria-invalid={settingsContentInvalid}
              maxLength={240}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  supportMessage: event.target.value,
                }))
              }
              value={settingsDraft.supportMessage}
            />
          </label>
          <label className={styles.field}>
            <span>Důvod změny nastavení</span>
            <textarea
              aria-invalid={settingsReasonInvalid}
              onChange={(event) => setSettingsReason(event.target.value)}
              value={settingsReason}
            />
          </label>
          <button
            className={styles.button}
            onClick={requestSettingsChange}
            type="button"
          >
            Zkontrolovat změnu nastavení
          </button>
        </section>
      ) : (
        <section className={styles.callout}>
          Nastavení akce je pro roli operátora sálu pouze nedostupné; jeho
          attendance rozsah zůstává aktivní.
        </section>
      )}

      {pending ? (
        <AdminConfirmDialog
          acknowledgement={
            pending.kind === 'settings'
              ? `Potvrzuji změnu z verze ${settings.version} a pouze v mock režimu.`
              : `Potvrzuji canonical změnu rezervace z verze ${pending.record.version}.`
          }
          confirmLabel={
            pending.kind === 'settings'
              ? 'Uložit mock nastavení'
              : reservationActionLabels[pending.action]
          }
          danger={
            pending.kind === 'reservation' &&
            pending.action === 'cancel_reservation'
          }
          description="Akce používá oprávněný event scope, auditní důvod, idempotency klíč a očekávanou verzi."
          impact={
            <dl className={styles.detailList}>
              <dt>Rozsah</dt>
              <dd>{scope.eventId}</dd>
              <dt>Akce</dt>
              <dd>
                {pending.kind === 'settings'
                  ? 'Změnit nastavení akce'
                  : reservationActionLabels[pending.action]}
              </dd>
              <dt>Očekávaná verze</dt>
              <dd>
                {pending.kind === 'settings'
                  ? settings.version
                  : pending.record.version}
              </dd>
              <dt>Režim</dt>
              <dd>UI ready (mocked)</dd>
            </dl>
          }
          onConfirm={confirmChange}
          onDismiss={() => setPending(null)}
          title="Potvrdit auditovanou změnu?"
        />
      ) : null}
    </div>
  );
};
