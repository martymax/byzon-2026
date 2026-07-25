'use client';

import {
  adminEventSettingsUpdateRequestSchema,
  adminEventSettingsUpdateResponseSchema,
  adminReservationMutationRequestSchema,
  adminReservationMutationResponseSchema,
  type AdminAuditEntry,
  type AdminEventSettings,
  type AdminEventSettingsUpdateRequest,
  type AdminReservationAction,
  type AdminReservationMutationRequest,
  type AdminReservationRecord,
} from '@byzon/domain/contracts/admin';
import { useEffect, useMemo, useState } from 'react';

import {
  requestAdminAudit,
  requestAdminEventSettings,
  requestAdminEventSettingsUpdate,
  requestAdminReservationMutation,
  requestAdminReservations,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isAmbiguousAdminMutationFailure,
  isStaleAdminFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const reservationActionLabels: Record<AdminReservationAction, string> = {
  capacity_override: 'Změnit kapacitu',
  mark_attended: 'Označit účast',
  undo_attendance: 'Vrátit označení účasti',
  cancel_reservation: 'Zrušit rezervaci',
};

const stateLabels: Record<AdminReservationRecord['state'], string> = {
  reserved: 'Rezervováno',
  cancelled: 'Zrušeno',
  attended: 'Účast potvrzena',
};

type PendingChange =
  | Readonly<{
      kind: 'reservation';
      body: AdminReservationMutationRequest;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'settings';
      body: AdminEventSettingsUpdateRequest;
      idempotencyKey: string;
    }>;

const formatTimestamp = (value: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export const AdminReservationWorkspace = () => {
  const {
    api,
    eventId,
    eventTimezone,
    invalidateSensitive,
    permissions,
  } = useAdminWorkspace();
  const [records, setRecords] = useState<readonly AdminReservationRecord[]>([]);
  const [audits, setAudits] = useState<readonly AdminAuditEntry[]>([]);
  const [settings, setSettings] = useState<AdminEventSettings | null>(null);
  const [selected, setSelected] = useState<AdminReservationRecord | null>(null);
  const [action, setAction] =
    useState<AdminReservationAction>('mark_attended');
  const [capacity, setCapacity] = useState(1);
  const [reason, setReason] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<{
    registrationMode: AdminEventSettings['registrationMode'];
    reservationChangesAllowed: boolean;
    supportMessage: string;
  } | null>(null);
  const [settingsReason, setSettingsReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [auditCategory, setAuditCategory] = useState('all');
  const [reloadReservations, setReloadReservations] = useState(0);
  const [reloadSettings, setReloadSettings] = useState(0);

  const canReadReservations =
    permissions.includes('reservation:any:read') ||
    permissions.includes('attendance:assigned:write');
  const canOverride = permissions.includes('reservation:any:read');
  const canAttend = permissions.includes('attendance:assigned:write');
  const canReadAudit = permissions.includes('audit:read');
  const canManageSettings = permissions.includes('event:settings:manage');

  const handleReadFailure = (
    failure: Parameters<typeof adminFailureMessage>[0],
    requestId?: string,
  ) => {
    if (isAdminSecurityFailure(failure)) {
      setRecords([]);
      setAudits([]);
      setSettings(null);
      setSelected(null);
      setPending(null);
      invalidateSensitive(adminFailureMessage(failure, requestId));
      return;
    }
    setError(adminFailureMessage(failure, requestId));
  };

  useEffect(() => {
    if (!canReadReservations) return;
    const controller = new AbortController();
    void requestAdminReservations(api, eventId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        if (!result.ok) {
          setRecords([]);
          handleReadFailure(result.failure, result.metadata?.requestId);
          return;
        }
        if (result.kind === 'success') {
          setRecords(result.data.items);
          setSelected((current) =>
            current
              ? result.data.items.find(
                  ({ reservationId }) =>
                    reservationId === current.reservationId,
                ) ?? null
              : null,
          );
        }
      },
    );
    return () => controller.abort();
    // `handleReadFailure` intentionally resolves against the current shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canReadReservations, eventId, reloadReservations]);

  useEffect(() => {
    if (!canReadAudit) return;
    const controller = new AbortController();
    void requestAdminAudit(api, eventId, {}, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setAudits([]);
          handleReadFailure(result.failure, result.metadata?.requestId);
          return;
        }
        if (result.kind === 'success') setAudits(result.data.items);
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canReadAudit, eventId, reloadReservations, reloadSettings]);

  useEffect(() => {
    if (!canManageSettings) return;
    const controller = new AbortController();
    void requestAdminEventSettings(api, eventId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setSettings(null);
          setSettingsDraft(null);
          handleReadFailure(result.failure, result.metadata?.requestId);
          return;
        }
        if (result.kind === 'success') {
          setSettings(result.data);
          setSettingsDraft({
            registrationMode: result.data.registrationMode,
            reservationChangesAllowed:
              result.data.reservationChangesAllowed,
            supportMessage: result.data.supportMessage,
          });
        }
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canManageSettings, eventId, reloadSettings]);

  const filteredRecords = useMemo(
    () =>
      records.filter(
        ({ sessionId, state }) =>
          (sessionFilter === 'all' || sessionId === sessionFilter) &&
          (stateFilter === 'all' || state === stateFilter),
      ),
    [records, sessionFilter, stateFilter],
  );

  const visibleAudits = useMemo(
    () =>
      audits.filter(
        ({ category }) =>
          auditCategory === 'all' || category === auditCategory,
      ),
    [auditCategory, audits],
  );

  const reservationCandidate = selected
    ? adminReservationMutationRequestSchema.safeParse({
        reservationId: selected.reservationId,
        action,
        ...(action === 'capacity_override' ? { capacity } : {}),
        expectedVersion: selected.version,
        reason,
      })
    : null;

  const settingsCandidate =
    settings && settingsDraft
      ? adminEventSettingsUpdateRequestSchema.safeParse({
          expectedVersion: settings.version,
          settings: settingsDraft,
          reason: settingsReason,
        })
      : null;

  const beginReservation = (record: AdminReservationRecord) => {
    const available = record.availableActions.filter(
      (candidate) =>
        (candidate === 'mark_attended' ||
          candidate === 'undo_attendance') &&
        canAttend
          ? true
          : canOverride,
    );
    setSelected(record);
    setAction(available[0] ?? record.availableActions[0] ?? 'mark_attended');
    setCapacity(record.capacity);
    setReason('');
    setAttempted(false);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setError(null);
    setSuccess(null);
  };

  const prepareReservation = () => {
    setAttempted(true);
    if (!reservationCandidate?.success) return;
    const isAttendance =
      reservationCandidate.data.action === 'mark_attended' ||
      reservationCandidate.data.action === 'undo_attendance';
    if ((isAttendance && !canAttend && !canOverride) || (!isAttendance && !canOverride)) {
      return;
    }
    setPending({
      kind: 'reservation',
      body: reservationCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('reservation'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const prepareSettings = () => {
    setAttempted(true);
    if (!canManageSettings || !settingsCandidate?.success) return;
    setPending({
      kind: 'settings',
      body: settingsCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('settings'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingChange) => {
    setBusy(true);
    setConfirming(false);
    setError(null);
    setSuccess(null);
    const result =
      attempt.kind === 'reservation'
        ? await requestAdminReservationMutation(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
          )
        : await requestAdminEventSettingsUpdate(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
          );
    setBusy(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result.failure)) {
        setPending(null);
        setSelected(null);
        setRecords([]);
        setAudits([]);
        setSettings(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setConfirming(false);
        setAmbiguous(false);
        setError(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        if (attempt.kind === 'reservation') {
          setBusy(true);
          setReloadReservations((value) => value + 1);
        } else {
          setReloadSettings((value) => value + 1);
        }
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result.failure);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      if (attempt.kind === 'reservation') {
        const response = adminReservationMutationResponseSchema.parse(
          result.data,
        );
        setRecords((current) =>
          current.map((record) =>
            record.reservationId === response.record.reservationId
              ? response.record
              : record,
          ),
        );
        setSelected(response.record);
        setSuccess(
          `${response.outcome === 'already_applied' ? 'Server potvrdil dřívější změnu' : 'Rezervace byla změněna'} · audit ${response.audit.auditId}`,
        );
        setReloadReservations((value) => value + 1);
      } else {
        const response = adminEventSettingsUpdateResponseSchema.parse(
          result.data,
        );
        setSettings(response.settings);
        setSettingsDraft({
          registrationMode: response.settings.registrationMode,
          reservationChangesAllowed:
            response.settings.reservationChangesAllowed,
          supportMessage: response.settings.supportMessage,
        });
        setSuccess(
          `${response.outcome === 'already_applied' ? 'Server potvrdil dřívější změnu' : 'Nastavení bylo změněno'} · audit ${response.audit.auditId}`,
        );
        setReloadSettings((value) => value + 1);
      }
      setPending(null);
      setAmbiguous(false);
      setAttempted(false);
      setReason('');
      setSettingsReason('');
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · řízené provozní změny</p>
        <h1>Rezervace, účast, audit a nastavení</h1>
        <p>
          Viditelnost i mutace respektují autoritativní event scope. Stale
          snapshot se nejprve obnoví a vyžádá nové potvrzení.
        </p>
      </header>

      {error ? (
        <section className={styles.errorSummary} role="alert">
          <p>{error}</p>
          {ambiguous && pending ? (
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => void execute(pending)}
              type="button"
            >
              Zopakovat přesně stejný pokus
            </button>
          ) : (
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setError(null);
                setBusy(true);
                setReloadReservations((value) => value + 1);
                setReloadSettings((value) => value + 1);
              }}
              type="button"
            >
              Obnovit bezpečné snapshoty
            </button>
          )}
        </section>
      ) : null}
      {success ? (
        <p className={styles.success} role="status">
          {success}
        </p>
      ) : null}

      {canReadReservations ? (
        <section className={styles.panel} aria-labelledby="reservation-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="reservation-title">Rezervace a room attendance</h2>
              <p className={styles.muted}>
                Server už v odpovědi omezuje záznamy na povolený scope.
              </p>
            </div>
            <span className={styles.badge}>{records.length} záznamů</span>
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
                    records.map((record) => [
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
          {busy && records.length === 0 ? (
            <p role="status">Načítám rezervace…</p>
          ) : records.length === 0 ? (
            <p className={styles.empty}>
              V oprávněném rozsahu nejsou žádné rezervace. Vyberte jinou
              session nebo zkontrolujte nastavení registrace.
            </p>
          ) : null}
          <ul className={styles.cardList}>
            {filteredRecords.map((record) => (
              <li className={styles.dataCard} key={record.reservationId}>
                <div className={styles.panelHeader}>
                  <strong>{record.sessionTitle}</strong>
                  <span className={styles.statusBadge}>
                    {stateLabels[record.state]}
                  </span>
                </div>
                <dl>
                  <dt>Účastník</dt>
                  <dd>{record.participantReference}</dd>
                  <dt>Kapacita</dt>
                  <dd>
                    {record.reservedCount} / {record.capacity}
                  </dd>
                  <dt>Verze</dt>
                  <dd>{record.version}</dd>
                </dl>
                <button
                  className={styles.secondaryButton}
                  onClick={() => beginReservation(record)}
                  type="button"
                >
                  Připravit změnu
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className={styles.stack}>
              <h3>Změna nad snapshotem v{selected.version}</h3>
              <label className={styles.field}>
                <span>Akce</span>
                <select
                  onChange={(event) =>
                    setAction(event.target.value as AdminReservationAction)
                  }
                  value={action}
                >
                  {selected.availableActions
                    .filter((candidate) => {
                      const attendance =
                        candidate === 'mark_attended' ||
                        candidate === 'undo_attendance';
                      return attendance
                        ? canAttend || canOverride
                        : canOverride;
                    })
                    .map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {reservationActionLabels[candidate]}
                      </option>
                    ))}
                </select>
              </label>
              {action === 'capacity_override' ? (
                <label className={styles.field}>
                  <span>Nová kapacita</span>
                  <input
                    min={selected.reservedCount}
                    onChange={(event) =>
                      setCapacity(Number(event.target.value))
                    }
                    type="number"
                    value={capacity}
                  />
                </label>
              ) : null}
              <label className={styles.field}>
                <span>Auditní důvod</span>
                <textarea
                  aria-invalid={
                    attempted && reservationCandidate?.success === false
                  }
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
              </label>
              <button
                className={styles.dangerButton}
                disabled={busy}
                onClick={prepareReservation}
                type="button"
              >
                Zkontrolovat změnu rezervace
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canReadAudit ? (
        <section className={styles.panel} aria-labelledby="audit-title">
          <div className={styles.panelHeader}>
            <h2 id="audit-title">Auditní stopa</h2>
            <span className={styles.badge}>{visibleAudits.length} položek</span>
          </div>
          <label className={styles.field}>
            <span>Kategorie</span>
            <select
              onChange={(event) => setAuditCategory(event.target.value)}
              value={auditCategory}
            >
              <option value="all">Všechny</option>
              <option value="support">Podpora</option>
              <option value="import">Import</option>
              <option value="announcement">Oznámení</option>
              <option value="reservation">Rezervace</option>
              <option value="attendance">Účast</option>
              <option value="settings">Nastavení</option>
              <option value="export">Export</option>
            </select>
          </label>
          <ul className={styles.cardList}>
            {visibleAudits.map((entry) => (
              <li className={styles.dataCard} key={entry.auditId}>
                <div className={styles.panelHeader}>
                  <strong>{entry.action}</strong>
                  <span className={styles.statusBadge}>{entry.outcome}</span>
                </div>
                <p>
                  {entry.actorLabel} · {entry.targetReference}
                </p>
                <p>{entry.reason}</p>
                <small>
                  {formatTimestamp(entry.createdAt, eventTimezone)} ·{' '}
                  {entry.redacted ? 'redigováno' : 'bez redakce'}
                </small>
              </li>
            ))}
          </ul>
          {visibleAudits.length === 0 ? (
            <p className={styles.empty}>
              Zvolenému bezpečnému filtru neodpovídá žádná auditní položka.
            </p>
          ) : null}
        </section>
      ) : null}

      {canManageSettings && settings && settingsDraft ? (
        <section className={styles.panel} aria-labelledby="settings-title">
          <div className={styles.panelHeader}>
            <h2 id="settings-title">Nastavení akce</h2>
            <span className={styles.badge}>Snapshot v{settings.version}</span>
          </div>
          <label className={styles.field}>
            <span>Režim registrace</span>
            <select
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  registrationMode: event.target
                    .value as AdminEventSettings['registrationMode'],
                })
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
                setSettingsDraft({
                  ...settingsDraft,
                  reservationChangesAllowed: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>Účastníci mohou měnit rezervace</span>
          </label>
          <label className={styles.field}>
            <span>Provozní zpráva podpory</span>
            <textarea
              maxLength={240}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  supportMessage: event.target.value,
                })
              }
              value={settingsDraft.supportMessage}
            />
          </label>
          <label className={styles.field}>
            <span>Auditní důvod změny</span>
            <textarea
              aria-invalid={attempted && settingsCandidate?.success === false}
              onChange={(event) => setSettingsReason(event.target.value)}
              value={settingsReason}
            />
          </label>
          <button
            className={styles.dangerButton}
            disabled={busy}
            onClick={prepareSettings}
            type="button"
          >
            Zkontrolovat změnu nastavení
          </button>
        </section>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem aktuální snapshot, dopad změny a auditní důvod."
          confirmLabel={
            pending.kind === 'reservation'
              ? reservationActionLabels[pending.body.action]
              : 'Uložit nastavení'
          }
          danger
          description="Server znovu ověří oprávnění, event scope a očekávanou verzi."
          onConfirm={() => void execute(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={
            pending.kind === 'reservation'
              ? 'Potvrdit změnu rezervace?'
              : 'Potvrdit změnu nastavení?'
          }
        />
      ) : null}
    </div>
  );
};
