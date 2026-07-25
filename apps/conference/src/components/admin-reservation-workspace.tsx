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
import { AdminFormErrorSummary } from './admin-form-error-summary';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isAmbiguousAdminMutationFailure,
  isStaleAdminFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
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
  const { api, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const [records, setRecords] = useState<readonly AdminReservationRecord[]>([]);
  const [audits, setAudits] = useState<readonly AdminAuditEntry[]>([]);
  const [settings, setSettings] = useState<AdminEventSettings | null>(null);
  const [selected, setSelected] = useState<AdminReservationRecord | null>(null);
  const [action, setAction] = useState<AdminReservationAction>('mark_attended');
  const [capacity, setCapacity] = useState(1);
  const [reason, setReason] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<{
    registrationMode: AdminEventSettings['registrationMode'];
    reservationChangesAllowed: boolean;
    supportMessage: string;
  } | null>(null);
  const [settingsReason, setSettingsReason] = useState('');
  const [attemptedKind, setAttemptedKind] = useState<
    'reservation' | 'settings' | null
  >(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<
    'read' | 'reservation' | 'settings' | null
  >(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [auditCategory, setAuditCategory] = useState('all');
  const [reloadReservations, setReloadReservations] = useState(0);
  const [reloadSettings, setReloadSettings] = useState(0);

  const canReadReservations =
    permissions.includes('reservation:any:read') ||
    permissions.includes('attendance:assigned:write');
  const canOverride = permissions.includes('agenda:any:override');
  const canAttend = permissions.includes('attendance:assigned:write');
  const canReadAudit = permissions.includes('audit:read');
  const canManageSettings = permissions.includes('event:settings:manage');
  const canPerformReservationAction = (
    candidate: AdminReservationAction,
  ): boolean => {
    const isAttendance =
      candidate === 'mark_attended' || candidate === 'undo_attendance';
    return isAttendance ? canAttend : canOverride;
  };

  const handleReadFailure = (
    result: Readonly<{
      failure: Parameters<typeof adminFailureMessage>[0];
      status?: number;
      metadata?: { readonly requestId: string };
    }>,
  ) => {
    if (isAdminSecurityFailure(result)) {
      setRecords([]);
      setAudits([]);
      setSettings(null);
      setSelected(null);
      setPending(null);
      invalidateSensitive(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    setErrorScope('read');
    setError(adminFailureMessage(result.failure, result.metadata?.requestId));
  };

  useEffect(() => {
    if (!canReadReservations) return;
    const request = requestFence.begin('reservation-list');
    void requestAdminReservations(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(false);
        if (!result.ok) {
          setRecords([]);
          handleReadFailure(result);
          return;
        }
        if (result.kind === 'success') {
          setRecords(result.data.items);
          setSelected((current) =>
            current
              ? (result.data.items.find(
                  ({ reservationId }) =>
                    reservationId === current.reservationId,
                ) ?? null)
              : null,
          );
        }
      },
    );
    return () => requestFence.cancel('reservation-list');
    // `handleReadFailure` intentionally resolves against the current shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canReadReservations, eventId, reloadReservations, requestFence]);

  useEffect(() => {
    if (!canReadAudit) return;
    const request = requestFence.begin('reservation-audit');
    void requestAdminAudit(api, eventId, {}, request.signal).then((result) => {
      if (!request.isCurrent()) return;
      request.finish();
      if (!result.ok) {
        setAudits([]);
        handleReadFailure(result);
        return;
      }
      if (result.kind === 'success') setAudits(result.data.items);
    });
    return () => requestFence.cancel('reservation-audit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    canReadAudit,
    eventId,
    reloadReservations,
    reloadSettings,
    requestFence,
  ]);

  useEffect(() => {
    if (!canManageSettings) return;
    const request = requestFence.begin('reservation-settings');
    void requestAdminEventSettings(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        if (!result.ok) {
          setSettings(null);
          setSettingsDraft(null);
          handleReadFailure(result);
          return;
        }
        if (result.kind === 'success') {
          setSettings(result.data);
          setSettingsDraft({
            registrationMode: result.data.registrationMode,
            reservationChangesAllowed: result.data.reservationChangesAllowed,
            supportMessage: result.data.supportMessage,
          });
        }
      },
    );
    return () => requestFence.cancel('reservation-settings');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canManageSettings, eventId, reloadSettings, requestFence]);

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
        ({ category }) => auditCategory === 'all' || category === auditCategory,
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
  const reservationValidationFailed =
    attemptedKind === 'reservation' && reservationCandidate?.success === false;
  const settingsValidationFailed =
    attemptedKind === 'settings' && settingsCandidate?.success === false;

  const beginReservation = (record: AdminReservationRecord) => {
    const available = record.availableActions.filter(
      canPerformReservationAction,
    );
    const firstAvailable = available[0];
    if (!firstAvailable) return;
    setSelected(record);
    setAction(firstAvailable);
    setCapacity(record.capacity);
    setReason('');
    setAttemptedKind(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setError(null);
    setErrorScope(null);
    setSuccess(null);
  };

  const prepareReservation = () => {
    setAttemptedKind('reservation');
    if (!reservationCandidate?.success) return;
    if (!canPerformReservationAction(reservationCandidate.data.action)) return;
    setPending({
      kind: 'reservation',
      body: reservationCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('reservation'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const prepareSettings = () => {
    setAttemptedKind('settings');
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
    const request = requestFence.begin('reservation-mutation');
    setBusy(true);
    setConfirming(false);
    setError(null);
    setErrorScope(null);
    setSuccess(null);
    const result =
      attempt.kind === 'reservation'
        ? await requestAdminReservationMutation(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
            request.signal,
          )
        : await requestAdminEventSettingsUpdate(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
            request.signal,
          );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
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
        setErrorScope(attempt.kind);
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
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setErrorScope(attempt.kind);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
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
      setAttemptedKind(null);
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

      {error && errorScope === 'read' ? (
        <section className={styles.stack}>
          <AdminFormErrorSummary
            descriptionId="admin-reservation-read-error"
            heading="Bezpečný snapshot se nepodařilo načíst"
            message={error}
          />
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setError(null);
              setErrorScope(null);
              setBusy(true);
              setReloadReservations((value) => value + 1);
              setReloadSettings((value) => value + 1);
            }}
            type="button"
          >
            Obnovit bezpečné snapshoty
          </button>
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
              V oprávněném rozsahu nejsou žádné rezervace. Vyberte jinou session
              nebo zkontrolujte nastavení registrace.
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
                {record.availableActions.some(canPerformReservationAction) ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={pending !== null}
                    onClick={() => beginReservation(record)}
                    type="button"
                  >
                    Připravit změnu
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {selected ? (
            <div className={styles.stack}>
              <h3>Změna nad snapshotem v{selected.version}</h3>
              {reservationValidationFailed ||
              (error && errorScope === 'reservation') ? (
                <>
                  <AdminFormErrorSummary
                    descriptionId="admin-reservation-form-error"
                    heading="Změnu rezervace zatím nelze potvrdit"
                    message={
                      error && errorScope === 'reservation'
                        ? error
                        : 'Zkontrolujte povolenou akci, kapacitu a auditní důvod.'
                    }
                  />
                  {ambiguous && pending?.kind === 'reservation' ? (
                    <button
                      className={styles.secondaryButton}
                      disabled={busy}
                      onClick={() => void execute(pending)}
                      type="button"
                    >
                      Zopakovat přesně stejný pokus
                    </button>
                  ) : null}
                </>
              ) : null}
              <label className={styles.field}>
                <span>Akce</span>
                <select
                  aria-describedby={
                    reservationValidationFailed
                      ? 'admin-reservation-form-error'
                      : undefined
                  }
                  disabled={pending !== null}
                  onChange={(event) =>
                    setAction(event.target.value as AdminReservationAction)
                  }
                  value={action}
                >
                  {selected.availableActions
                    .filter(canPerformReservationAction)
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
                    aria-describedby={
                      reservationValidationFailed
                        ? 'admin-reservation-form-error'
                        : undefined
                    }
                    aria-invalid={reservationValidationFailed}
                    disabled={pending !== null}
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
                  aria-describedby={
                    reservationValidationFailed
                      ? 'admin-reservation-form-error'
                      : undefined
                  }
                  aria-invalid={reservationValidationFailed}
                  disabled={pending !== null}
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
              </label>
              <button
                className={styles.dangerButton}
                disabled={busy || pending !== null}
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
              disabled={pending !== null}
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
          {settingsValidationFailed || (error && errorScope === 'settings') ? (
            <>
              <AdminFormErrorSummary
                descriptionId="admin-settings-form-error"
                heading="Nastavení zatím nelze potvrdit"
                message={
                  error && errorScope === 'settings'
                    ? error
                    : 'Zkontrolujte provozní zprávu a auditní důvod.'
                }
              />
              {ambiguous && pending?.kind === 'settings' ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => void execute(pending)}
                  type="button"
                >
                  Zopakovat přesně stejný pokus
                </button>
              ) : null}
            </>
          ) : null}
          <label className={styles.field}>
            <span>Režim registrace</span>
            <select
              aria-describedby={
                settingsValidationFailed
                  ? 'admin-settings-form-error'
                  : undefined
              }
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
              disabled={pending !== null}
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
              aria-describedby={
                settingsValidationFailed
                  ? 'admin-settings-form-error'
                  : undefined
              }
              aria-invalid={settingsValidationFailed}
              disabled={pending !== null}
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
              aria-describedby={
                settingsValidationFailed
                  ? 'admin-settings-form-error'
                  : undefined
              }
              aria-invalid={settingsValidationFailed}
              disabled={pending !== null}
              onChange={(event) => setSettingsReason(event.target.value)}
              value={settingsReason}
            />
          </label>
          <button
            className={styles.dangerButton}
            disabled={busy || pending !== null}
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
