'use client';

import {
  adminExportRequestSchema,
  adminExportResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  type AdminAssignmentRole,
  type AdminExportRequest,
  type AdminExportResponse,
  type AdminOperationsOverviewResponse,
  type AdminRoleAssignmentMutationRequest,
  type AdminRoleAssignmentMutationResponse,
} from '@byzon/domain/contracts/admin';
import { useEffect, useMemo, useState } from 'react';

import {
  requestAdminExport,
  requestAdminOperationsOverview,
  requestAdminRoleAssignment,
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

const roleLabels: Record<AdminAssignmentRole, string> = {
  checkin_operator: 'Operátor check-inu',
  moderator: 'Moderátor',
  room_operator: 'Operátor sálu',
};

type PendingOperation =
  | Readonly<{
      kind: 'role';
      body: Extract<
        AdminRoleAssignmentMutationRequest,
        { readonly action: 'grant' }
      >;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'export';
      body: AdminExportRequest;
      idempotencyKey: string;
    }>;

export const AdminOperationsWorkspace = () => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const [overview, setOverview] =
    useState<AdminOperationsOverviewResponse | null>(null);
  const [operatorId, setOperatorId] = useState('');
  const [operatorLabel, setOperatorLabel] = useState('');
  const [assignmentRole, setAssignmentRole] =
    useState<AdminAssignmentRole>('room_operator');
  const [scopeLabel, setScopeLabel] = useState('Celá akce');
  const [report, setReport] =
    useState<AdminExportRequest['report']>('reservation_summary');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState<'read' | 'mutation' | null>('read');
  const [error, setError] = useState<string | null>(null);
  const [roleResult, setRoleResult] =
    useState<AdminRoleAssignmentMutationResponse | null>(null);
  const [exportResult, setExportResult] =
    useState<AdminExportResponse | null>(null);
  const [reload, setReload] = useState(0);

  const canReadOperations = permissions.includes('operations:read');
  const canManageRoles = permissions.includes('role:manage');
  const canExport = permissions.includes('personal-data:operational:export');

  useEffect(() => {
    if (!canReadOperations) return;
    const controller = new AbortController();
    void requestAdminOperationsOverview(api, eventId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setBusy(null);
        if (!result.ok) {
          setOverview(null);
          if (isAdminSecurityFailure(result.failure)) {
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        if (result.kind === 'success') setOverview(result.data);
      },
    );
    return () => controller.abort();
  }, [api, canReadOperations, eventId, invalidateSensitive, reload]);

  const queueTotals = useMemo(
    () =>
      overview?.queues.reduce(
        (total, queue) => ({
          ready: total.ready + queue.ready,
          processing: total.processing + queue.processing,
          failed: total.failed + queue.failed,
        }),
        { ready: 0, processing: 0, failed: 0 },
      ) ?? { ready: 0, processing: 0, failed: 0 },
    [overview],
  );

  const roleCandidate = adminRoleAssignmentMutationRequestSchema.safeParse({
    action: 'grant',
    operatorId,
    role: assignmentRole,
    scope: { kind: 'event', label: scopeLabel },
    expectedVersion: overview?.version ?? 1,
    reason,
  });

  const exportCandidate = adminExportRequestSchema.safeParse({
    report,
    format: 'csv',
    range: null,
    reason,
  });

  const prepareRole = () => {
    setAttempted(true);
    if (
      !canManageRoles ||
      !roleCandidate.success ||
      roleCandidate.data.action !== 'grant' ||
      !operatorLabel.trim()
    ) {
      return;
    }
    setPending({
      kind: 'role',
      body: roleCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('role-assignment'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const prepareExport = () => {
    setAttempted(true);
    if (!canExport || !exportCandidate.success) return;
    setPending({
      kind: 'export',
      body: exportCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('export'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingOperation) => {
    setBusy('mutation');
    setConfirming(false);
    setError(null);
    const result =
      attempt.kind === 'role'
        ? await requestAdminRoleAssignment(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
          )
        : await requestAdminExport(
            api,
            eventId,
            attempt.body,
            attempt.idempotencyKey,
          );
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result.failure)) {
        setPending(null);
        setOverview(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        setError(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        setBusy('read');
        setReload((value) => value + 1);
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
      if (attempt.kind === 'role') {
        setRoleResult(
          adminRoleAssignmentMutationResponseSchema.parse(result.data),
        );
        setOperatorId('');
        setOperatorLabel('');
      } else {
        setExportResult(adminExportResponseSchema.parse(result.data));
      }
      setPending(null);
      setAmbiguous(false);
      setReason('');
      setAttempted(false);
      setReload((value) => value + 1);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · role a provoz</p>
        <h1>Operátoři, fronty a export</h1>
        <p>
          Autorita vychází pouze z eventového kontextu. Přehled front neobsahuje
          payloady a každá změna je online-only, auditovaná a idempotentní.
        </p>
      </header>

      {canReadOperations ? (
        <section
          aria-busy={busy === 'read'}
          aria-labelledby="queue-title"
          className={styles.panel}
        >
          <div className={styles.panelHeader}>
            <div>
              <h2 id="queue-title">Bezpečný queue a DLQ souhrn</h2>
              <p className={styles.muted}>
                Bez adresátů, tokenů, payloadů a raw chyb.
              </p>
            </div>
            {overview ? (
              <span
                className={`${styles.statusBadge} ${
                  queueTotals.failed > 0
                    ? styles.statusAttention
                    : styles.statusHealthy
                }`}
              >
                {queueTotals.failed > 0
                  ? `${queueTotals.failed} v DLQ`
                  : 'Bez DLQ'}
              </span>
            ) : null}
          </div>
          {!overview ? (
            <p role="status">
              {busy === 'read' ? 'Načítám provozní snapshot…' : 'Bez snapshotu.'}
            </p>
          ) : overview.queues.length === 0 ? (
            <p className={styles.empty}>
              Žádná fronta nyní nehlásí čekající ani chybovou úlohu.
            </p>
          ) : (
            <>
              <div className={styles.summaryGrid}>
                <div className={styles.metric}>
                  <small>Připraveno</small>
                  <strong>{queueTotals.ready}</strong>
                </div>
                <div className={styles.metric}>
                  <small>Zpracovává se</small>
                  <strong>{queueTotals.processing}</strong>
                </div>
                <div className={styles.metric}>
                  <small>DLQ</small>
                  <strong>{queueTotals.failed}</strong>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption>Agregované počty podle bezpečné kategorie.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fronta</th>
                      <th scope="col">Připraveno</th>
                      <th scope="col">Zpracování</th>
                      <th scope="col">DLQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.queues.map((queue) => (
                      <tr key={queue.queue}>
                        <th scope="row">{queue.queue}</th>
                        <td>{queue.ready}</td>
                        <td>{queue.processing}</td>
                        <td>{queue.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.cards}>
                <ul className={styles.cardList} aria-label="Souhrn front">
                  {overview.queues.map((queue) => (
                    <li className={styles.dataCard} key={queue.queue}>
                      <strong>{queue.queue}</strong>
                      <dl>
                        <dt>Připraveno</dt>
                        <dd>{queue.ready}</dd>
                        <dt>Zpracování</dt>
                        <dd>{queue.processing}</dd>
                        <dt>DLQ</dt>
                        <dd>{queue.failed}</dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      ) : null}

      {error ? (
        <section className={styles.errorSummary} role="alert">
          <p>{error}</p>
          {ambiguous && pending ? (
            <button
              className={styles.secondaryButton}
              disabled={busy !== null}
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
                setBusy('read');
                setReload((value) => value + 1);
              }}
              type="button"
            >
              Obnovit provozní snapshot
            </button>
          )}
        </section>
      ) : null}

      {canManageRoles ? (
        <section className={styles.panel} aria-labelledby="assignment-title">
          <h2 id="assignment-title">Scopeované přiřazení operátora</h2>
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span>ID operátora</span>
              <input
                autoComplete="off"
                onChange={(event) => setOperatorId(event.target.value)}
                value={operatorId}
              />
            </label>
            <label className={styles.field}>
              <span>Zobrazovaný štítek pro kontrolu</span>
              <input
                autoComplete="off"
                maxLength={120}
                onChange={(event) => setOperatorLabel(event.target.value)}
                value={operatorLabel}
              />
            </label>
            <label className={styles.field}>
              <span>Role</span>
              <select
                onChange={(event) =>
                  setAssignmentRole(event.target.value as AdminAssignmentRole)
                }
                value={assignmentRole}
              >
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Popis rozsahu</span>
              <input
                maxLength={120}
                onChange={(event) => setScopeLabel(event.target.value)}
                value={scopeLabel}
              />
            </label>
          </div>
          {roleResult ? (
            <p className={styles.success} role="status">
              {roleResult.outcome === 'already_applied'
                ? 'Server potvrdil dřívější přiřazení.'
                : `Role byla přiřazena (${roleResult.assignment?.assignmentId ?? 'bez aktivního přiřazení'}).`}
            </p>
          ) : null}
          <button
            className={styles.button}
            disabled={busy !== null || !overview}
            onClick={prepareRole}
            type="button"
          >
            Zkontrolovat přiřazení
          </button>
        </section>
      ) : null}

      {canExport ? (
        <section className={styles.panel} aria-labelledby="export-title">
          <h2 id="export-title">Asynchronní export</h2>
          <label className={styles.field}>
            <span>Report</span>
            <select
              onChange={(event) =>
                setReport(event.target.value as AdminExportRequest['report'])
              }
              value={report}
            >
              <option value="participant_summary">Souhrn účastníků</option>
              <option value="checkin_summary">Souhrn check-inu</option>
              <option value="reservation_summary">Souhrn rezervací</option>
              <option value="audit_log">Auditní log</option>
            </select>
          </label>
          {exportResult ? (
            <p className={styles.success} role="status">
              Export {exportResult.exportId} je ve frontě (
              {exportResult.outcome === 'already_queued'
                ? 'dříve zařazen'
                : 'nově zařazen'}
              ).
            </p>
          ) : null}
          <button
            className={styles.secondaryButton}
            disabled={busy !== null}
            onClick={prepareExport}
            type="button"
          >
            Zkontrolovat export
          </button>
        </section>
      ) : null}

      {(canManageRoles || canExport) ? (
        <label className={styles.field}>
          <span>Auditní důvod pro další operaci</span>
          <textarea
            aria-invalid={
              attempted &&
              ((pending?.kind === 'role' && !roleCandidate.success) ||
                (pending?.kind === 'export' && !exportCandidate.success))
            }
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
          <span className={styles.helper}>
            Nejméně 8 znaků. Mocked scénáře: „stale“, „timeout“,
            „collision“.
          </span>
        </label>
      ) : null}

      {attempted &&
      ((!roleCandidate.success && canManageRoles) ||
        (!exportCandidate.success && canExport)) ? (
        <p className={styles.warning} role="alert">
          Zkontrolujte ID, popis rozsahu a auditní důvod.
        </p>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem rozsah, očekávanou verzi a auditní důvod."
          confirmLabel={
            pending.kind === 'role' ? 'Přiřadit roli' : 'Zařadit export'
          }
          danger={pending.kind === 'role'}
          description={
            pending.kind === 'role'
              ? `Přiřadíte roli ${roleLabels[pending.body.role]} v rozsahu této akce.`
              : `Do fronty bude zařazen report ${pending.body.report}.`
          }
          onConfirm={() => void execute(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={
            pending.kind === 'role'
              ? 'Potvrdit přiřazení role?'
              : 'Potvrdit export?'
          }
        />
      ) : null}
    </div>
  );
};
