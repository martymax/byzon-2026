'use client';

import {
  adminReservationMutationRequestSchema,
  adminSessionCapacityMutationRequestSchema,
  type AdminReservationMutationRequest,
  type AdminReservationSessionItem,
  type AdminSessionCapacityMutationRequest,
} from '@byzon/domain/contracts/admin';
import { AdminTechnicalDetails } from '@byzon/ui';
import { useEffect, useMemo, useState } from 'react';

import {
  requestAdminReservationMutation,
  requestAdminReservationSessions,
  requestAdminSessionCapacityMutation,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { adminCountForms, formatCzechCount } from './admin-copy';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import { AdminModal } from './admin-modal';
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

type CapacityState = 'full' | 'nearly_full' | 'healthy' | 'not_configured';
type PendingChange =
  | Readonly<{
      kind: 'capacity';
      body: AdminSessionCapacityMutationRequest;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'reservation';
      body: AdminReservationMutationRequest;
      idempotencyKey: string;
    }>;

type ReservationItem = AdminReservationSessionItem['reservations'][number];

const capacityState = (record: AdminReservationSessionItem): CapacityState => {
  if (record.capacity === null) return 'not_configured';
  if (record.confirmedCount >= record.capacity) return 'full';
  if (record.confirmedCount / record.capacity >= 0.8) return 'nearly_full';
  return 'healthy';
};

const capacityStateLabels: Record<CapacityState, string> = {
  full: 'Plná kapacita',
  nearly_full: 'Téměř plná',
  healthy: 'Dostatek míst',
  not_configured: 'Kapacita není nastavená',
};

const stateRank: Record<CapacityState, number> = {
  full: 0,
  nearly_full: 1,
  not_configured: 2,
  healthy: 3,
};

const reservationStateLabels: Record<ReservationItem['state'], string> = {
  reserved: 'Rezervováno',
  cancelled: 'Zrušeno',
};

export const AdminReservationsRedesign = () => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const canRead = permissions.includes('reservation:any:read');
  const canManage = permissions.includes('agenda:any:override');
  const [sessions, setSessions] = useState<
    readonly AdminReservationSessionItem[]
  >([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [capacityFilter, setCapacityFilter] = useState<CapacityState | 'all'>(
    'all',
  );
  const [dayFilter, setDayFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [participantFilter, setParticipantFilter] = useState('');
  const [capacityDraft, setCapacityDraft] = useState(1);
  const [capacityReason, setCapacityReason] = useState('');
  const [selectedReservation, setSelectedReservation] =
    useState<ReservationItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [attempted, setAttempted] = useState<'capacity' | 'reservation' | null>(
    null,
  );
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    auditId: string;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const wipe = () => {
    setSessions([]);
    setNextCursor(null);
    setSelectedSessionId(null);
    setParticipantFilter('');
    setCapacityReason('');
    setCancelReason('');
    setSelectedReservation(null);
    setPending(null);
    setConfirming(false);
    setSuccess(null);
    setRecoveryMessage(null);
  };

  useEffect(() => {
    if (!canRead) return;
    const request = requestFence.begin('reservation-session-overview');
    void requestAdminReservationSessions(
      api,
      eventId,
      { limit: 25 },
      request.signal,
    ).then((result) => {
      if (!request.isCurrent()) return;
      request.finish();
      setBusy(false);
      if (!result.ok && isAdminSecurityFailure(result)) {
        wipe();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (!result.ok) {
        setSessions([]);
        setNextCursor(null);
        setError(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (result.kind === 'success') {
        setError(null);
        setSessions(result.data.items);
        setNextCursor(result.data.pageInfo.nextCursor);
        setSelectedSessionId((current) =>
          current &&
          result.data.items.some(({ sessionId }) => sessionId === current)
            ? current
            : null,
        );
      }
    });
    return () => requestFence.cancel('reservation-session-overview');
  }, [api, canRead, eventId, invalidateSensitive, reload, requestFence]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const request = requestFence.begin('reservation-session-overview');
    setLoadingMore(true);
    setError(null);
    const result = await requestAdminReservationSessions(
      api,
      eventId,
      { cursor: nextCursor, limit: 25 },
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setLoadingMore(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        wipe();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setSessions((current) => [
        ...current,
        ...result.data.items.filter(
          (item) =>
            !current.some(({ sessionId }) => sessionId === item.sessionId),
        ),
      ]);
      setNextCursor(result.data.pageInfo.nextCursor);
    }
  };

  const sortedSessions = useMemo(
    () =>
      [...sessions]
        .filter(
          (session) =>
            (capacityFilter === 'all' ||
              capacityState(session) === capacityFilter) &&
            (dayFilter === 'all' || session.localDate === dayFilter) &&
            (activityFilter === 'all' || session.sessionId === activityFilter),
        )
        .sort(
          (left, right) =>
            stateRank[capacityState(left)] - stateRank[capacityState(right)] ||
            left.sessionTitle.localeCompare(right.sessionTitle, 'cs'),
        ),
    [activityFilter, capacityFilter, dayFilter, sessions],
  );
  const availableDays = useMemo(
    () =>
      [...new Set(sessions.flatMap(({ localDate }) => localDate ?? []))].sort(),
    [sessions],
  );
  const selectedSession =
    sessions.find(({ sessionId }) => sessionId === selectedSessionId) ?? null;
  const selectedReservations = (selectedSession?.reservations ?? []).filter(
    (record) => {
      const filter = participantFilter.trim().toLocaleLowerCase('cs');
      return (
        filter === '' ||
        record.participantName.toLocaleLowerCase('cs').includes(filter) ||
        record.contactEmail.toLocaleLowerCase('cs').includes(filter)
      );
    },
  );
  const summary = sessions.reduce(
    (current, session) => {
      current[capacityState(session)] += 1;
      return current;
    },
    { full: 0, nearly_full: 0, healthy: 0, not_configured: 0 },
  );

  const capacityCandidate = selectedSession
    ? adminSessionCapacityMutationRequestSchema.safeParse({
        sessionId: selectedSession.sessionId,
        expectedVersion: selectedSession.capacityVersion,
        capacity: capacityDraft,
        reason: capacityReason,
      })
    : null;
  const reservationCandidate = selectedReservation
    ? adminReservationMutationRequestSchema.safeParse({
        action: 'cancel_reservation',
        reservationId: selectedReservation.reservationId,
        expectedVersion: selectedReservation.version,
        reason: cancelReason,
      })
    : null;

  const chooseSession = (session: AdminReservationSessionItem) => {
    setSelectedSessionId(session.sessionId);
    setCapacityDraft(session.capacity ?? Math.max(1, session.confirmedCount));
    setCapacityReason('');
    setSelectedReservation(null);
    setCancelReason('');
    setAttempted(null);
    setPending(null);
    setAmbiguous(false);
    setError(null);
    setRecoveryMessage(null);
    setSuccess(null);
  };

  const closeSessionEditor = () => {
    const hasDraft = Boolean(
      selectedSession &&
      (capacityDraft !==
        (selectedSession.capacity ??
          Math.max(1, selectedSession.confirmedCount)) ||
        capacityReason.trim() ||
        selectedReservation ||
        cancelReason.trim()),
    );
    if (
      hasDraft &&
      !window.confirm(
        'Opravdu chcete editor zavřít? Neuložené změny se zahodí.',
      )
    ) {
      return;
    }
    setSelectedSessionId(null);
    setSelectedReservation(null);
    setCapacityReason('');
    setCancelReason('');
    setAttempted(null);
    setPending(null);
    setAmbiguous(false);
  };

  const prepareCapacity = () => {
    setAttempted('capacity');
    if (
      !canManage ||
      !selectedSession ||
      capacityDraft < Math.max(1, selectedSession.confirmedCount) ||
      !capacityCandidate?.success
    ) {
      return;
    }
    setPending({
      kind: 'capacity',
      body: capacityCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('capacity'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const prepareCancellation = () => {
    setAttempted('reservation');
    if (!canManage || !reservationCandidate?.success) return;
    setPending({
      kind: 'reservation',
      body: reservationCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('reservation'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingChange) => {
    if (!canManage) return;
    const request = requestFence.begin('reservation-session-mutation');
    setBusy(true);
    setConfirming(false);
    setError(null);
    const result =
      attempt.kind === 'capacity'
        ? await requestAdminSessionCapacityMutation(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
            request.signal,
          )
        : await requestAdminReservationMutation(
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
        wipe();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      const staleCapacity =
        attempt.kind === 'capacity' &&
        result.failure.kind === 'problem' &&
        result.failure.problem.code === 'ADMIN_INVALID_TRANSITION';
      if (isStaleAdminFailure(result.failure) || staleCapacity) {
        setPending(null);
        setAmbiguous(false);
        setCapacityReason('');
        setCancelReason('');
        setSelectedSessionId(null);
        setSelectedReservation(null);
        setRecoveryMessage(
          'Data se mezitím změnila. Načetli jsme aktuální stav; změnu připravte znovu.',
        );
        setReload((value) => value + 1);
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setPending(null);
      setAmbiguous(false);
      setAttempted(null);
      setCapacityReason('');
      setCancelReason('');
      setSelectedSessionId(null);
      setSelectedReservation(null);
      setRecoveryMessage(null);
      setSuccess({
        message:
          attempt.kind === 'capacity'
            ? 'Kapacita aktivity byla změněna.'
            : 'Rezervace účastníka byla zrušena.',
        auditId: result.data.audit.auditId,
      });
      setReload((value) => value + 1);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Rezervace a kapacity</h1>
        <p>
          Nejdřív vyberte aktivitu, potom řešte její kapacitu nebo konkrétní
          rezervaci.
        </p>
      </header>

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-reservations-error"
          heading="Aktuální stav se nepodařilo použít"
          message={error}
        />
      ) : null}
      {recoveryMessage ? (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {success ? (
        <section className={styles.success} role="status">
          <p>
            <strong>{success.message}</strong>
          </p>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID auditu</dt>
              <dd>{success.auditId}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      <section className={styles.summaryGrid} aria-label="Souhrn kapacit">
        <article className={styles.metric}>
          <span>Plné</span>
          <strong>{summary.full}</strong>
        </article>
        <article className={styles.metric}>
          <span>Téměř plné</span>
          <strong>{summary.nearly_full}</strong>
        </article>
        <article className={styles.metric}>
          <span>Bez problému</span>
          <strong>{summary.healthy}</strong>
        </article>
        <article className={styles.metric}>
          <span>Bez kapacity</span>
          <strong>{summary.not_configured}</strong>
        </article>
      </section>

      <section
        className={styles.panel}
        aria-labelledby="reservation-activities-title"
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 id="reservation-activities-title">Aktivity</h2>
            <p className={styles.muted}>
              Aktivity se načítají po stránkách v pořadí programu. Souhrn
              odpovídá všem dosud načteným aktivitám.
            </p>
          </div>
          <span className={styles.badge}>
            {formatCzechCount(sessions.length, adminCountForms.activity)}
          </span>
        </div>
        <div className={styles.threeColumn}>
          <label className={styles.field}>
            <span>Den</span>
            <select
              onChange={(event) => setDayFilter(event.target.value)}
              value={dayFilter}
            >
              <option value="all">Všechny načtené dny</option>
              {availableDays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Aktivita</span>
            <select
              onChange={(event) => setActivityFilter(event.target.value)}
              value={activityFilter}
            >
              <option value="all">Všechny aktivity</option>
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.sessionTitle}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Kapacitní stav</span>
            <select
              onChange={(event) =>
                setCapacityFilter(event.target.value as CapacityState | 'all')
              }
              value={capacityFilter}
            >
              <option value="all">Všechny stavy</option>
              <option value="full">Plná kapacita</option>
              <option value="nearly_full">Téměř plná</option>
              <option value="healthy">Dostatek míst</option>
              <option value="not_configured">Kapacita není nastavená</option>
            </select>
          </label>
        </div>
        {busy && sessions.length === 0 ? (
          <p role="status">Načítám aktivity…</p>
        ) : null}
        {!busy && sessions.length === 0 ? (
          <p className={styles.empty}>
            V programu nejsou žádné rezervovatelné aktivity.
          </p>
        ) : null}
        <ul className={styles.cardList}>
          {sortedSessions.map((session) => {
            const state = capacityState(session);
            const maximum = session.capacity ?? 1;
            const current = Math.min(session.confirmedCount, maximum);
            return (
              <li className={styles.dataCard} key={session.sessionId}>
                <div className={styles.panelHeader}>
                  <strong>{session.sessionTitle}</strong>
                  <span className={styles.statusBadge}>
                    {capacityStateLabels[state]}
                  </span>
                </div>
                <p>
                  {session.capacity === null
                    ? 'Kapacita není nastavená'
                    : `${session.confirmedCount} z ${session.capacity} míst`}
                </p>
                {session.localDate || session.startsAt || session.roomLabel ? (
                  <p className={styles.muted}>
                    {[
                      session.localDate,
                      session.startsAt?.slice(11, 16),
                      session.roomLabel,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
                <progress
                  aria-label={`${session.sessionTitle}: ${session.confirmedCount} z ${session.capacity ?? 0} míst`}
                  max={maximum}
                  value={current}
                />
                <button
                  className={styles.secondaryButton}
                  onClick={() => chooseSession(session)}
                  type="button"
                >
                  Zobrazit aktivitu
                </button>
              </li>
            );
          })}
        </ul>
        {nextCursor ? (
          <button
            className={styles.secondaryButton}
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? 'Načítám další aktivity…' : 'Načíst další aktivity'}
          </button>
        ) : sessions.length > 0 ? (
          <p className={styles.muted} role="status">
            Všechny aktivity jsou načtené.
          </p>
        ) : null}
      </section>

      {selectedSession && !confirming ? (
        <AdminModal
          dismissDisabled={busy}
          labelledBy="reservation-session-detail-title"
          onDismiss={closeSessionEditor}
          size="wide"
        >
          <div className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>Detail aktivity</p>
              <h2
                data-modal-initial-focus="true"
                id="reservation-session-detail-title"
                tabIndex={-1}
              >
                {selectedSession.sessionTitle}
              </h2>
            </div>
            <div className={styles.actionRow}>
              <span className={styles.statusBadge}>
                {capacityStateLabels[capacityState(selectedSession)]}
              </span>
              <button
                className={styles.secondaryButton}
                onClick={closeSessionEditor}
                type="button"
              >
                Zavřít
              </button>
            </div>
          </div>
          <div className={styles.dialogBody}>
            <div className={styles.twoColumn}>
              <section className={styles.dataCard}>
                <h3>Kapacita</h3>
                <p>
                  <strong>
                    {selectedSession.confirmedCount} z{' '}
                    {selectedSession.capacity ?? '—'} míst
                  </strong>
                </p>
                {selectedSession.waitingCount !== null ? (
                  <p>
                    Na uvolnění místa čeká {selectedSession.waitingCount}{' '}
                    účastníků.
                  </p>
                ) : null}
                {canManage && !selectedReservation ? (
                  <div className={styles.stack}>
                    <label className={styles.field}>
                      <span>Nová kapacita</span>
                      <input
                        min={Math.max(1, selectedSession.confirmedCount)}
                        onChange={(event) =>
                          setCapacityDraft(Number(event.target.value))
                        }
                        type="number"
                        value={capacityDraft}
                      />
                      <span className={styles.helper}>
                        Minimum je {Math.max(1, selectedSession.confirmedCount)}{' '}
                        podle aktuálně potvrzených rezervací.
                      </span>
                    </label>
                    <label className={styles.field}>
                      <span>Důvod změny kapacity</span>
                      <textarea
                        onChange={(event) =>
                          setCapacityReason(event.target.value)
                        }
                        value={capacityReason}
                      />
                      <span className={styles.helper}>
                        Uloží se do historie změn.
                      </span>
                    </label>
                    {attempted === 'capacity' && !capacityCandidate?.success ? (
                      <p className={styles.errorSummary} role="alert">
                        Zkontrolujte minimální kapacitu a doplňte důvod o
                        alespoň 8 znaků.
                      </p>
                    ) : null}
                    <button
                      className={styles.button}
                      disabled={busy || pending !== null}
                      onClick={prepareCapacity}
                      type="button"
                    >
                      Upravit kapacitu
                    </button>
                  </div>
                ) : null}
              </section>

              <section className={styles.dataCard}>
                <h3>Rezervace účastníků</h3>
                <label className={styles.field}>
                  <span>Jméno nebo e-mail účastníka</span>
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setParticipantFilter(event.target.value)
                    }
                    type="search"
                    value={participantFilter}
                  />
                  <span className={styles.helper}>
                    Hledání zůstává jen v této stránce a neukládá se do URL.
                  </span>
                </label>
                <ul className={styles.cardList}>
                  {selectedReservations.map((record) => (
                    <li className={styles.dataCard} key={record.reservationId}>
                      <div className={styles.panelHeader}>
                        <div className={styles.identityCell}>
                          <strong>{record.participantName}</strong>
                          <small>{record.contactEmail}</small>
                        </div>
                        <span className={styles.statusBadge}>
                          {reservationStateLabels[record.state]}
                        </span>
                      </div>
                      {canManage &&
                      record.availableActions.includes('cancel_reservation') ? (
                        <button
                          className={styles.secondaryButton}
                          onClick={() => {
                            setSelectedReservation(record);
                            setCancelReason('');
                            setAttempted(null);
                            setPending(null);
                          }}
                          type="button"
                        >
                          Zrušit rezervaci účastníka
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {selectedReservations.length === 0 ? (
                  <p className={styles.empty}>
                    Žádná rezervace neodpovídá bezpečnému filtru.
                  </p>
                ) : null}
              </section>
            </div>

            {selectedReservation ? (
              <section className={styles.warning}>
                <h3>Zrušit rezervaci účastníka</h3>
                <p>
                  <strong>{selectedReservation.participantName}</strong> ztratí
                  rezervaci na aktivitu {selectedSession.sessionTitle}. Uvolněné
                  místo může získat další čekající.
                </p>
                <label className={styles.field}>
                  <span>Důvod zrušení</span>
                  <textarea
                    onChange={(event) => setCancelReason(event.target.value)}
                    value={cancelReason}
                  />
                  <span className={styles.helper}>
                    Uloží se do historie změn.
                  </span>
                </label>
                {attempted === 'reservation' &&
                !reservationCandidate?.success ? (
                  <p className={styles.errorSummary} role="alert">
                    Doplňte důvod zrušení o alespoň 8 znaků.
                  </p>
                ) : null}
                <button
                  className={styles.dangerButton}
                  disabled={busy || pending !== null}
                  onClick={prepareCancellation}
                  type="button"
                >
                  Zkontrolovat zrušení
                </button>
              </section>
            ) : null}

            {ambiguous && pending ? (
              <button
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => void execute(pending)}
                type="button"
              >
                Zopakovat přesně stejný pokus
              </button>
            ) : null}
          </div>
        </AdminModal>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem aktivitu, aktuální stav, dopad a důvod změny."
          confirmLabel={
            pending.kind === 'capacity' ? 'Uložit kapacitu' : 'Zrušit rezervaci'
          }
          danger={pending.kind === 'reservation'}
          description={
            pending.kind === 'capacity'
              ? `Kapacita bude změněna na ${pending.body.capacity} míst; potvrzené rezervace zůstanou zachované.`
              : 'Rezervace bude zrušena a místo se může uvolnit dalšímu čekajícímu.'
          }
          impact={
            <p>
              <strong>
                {selectedSession?.sessionTitle ?? 'Vybraná aktivita'}
              </strong>
              {pending.kind === 'reservation'
                ? ` · ${selectedReservation?.participantName ?? ''}`
                : ''}
            </p>
          }
          onConfirm={() => void execute(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={
            pending.kind === 'capacity'
              ? 'Změnit kapacitu aktivity?'
              : 'Zrušit tuto rezervaci?'
          }
        />
      ) : null}
    </div>
  );
};
