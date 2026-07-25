'use client';

import { useMemo, useState } from 'react';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminReasonSchema,
  auditEntrySchema,
  operationsOverviewSchema,
  type AuditEntry,
  type OperationsOverview,
} from './admin-workspace-contracts';
import { demoOperationsOverview } from './admin-workspace-demo-data';
import { useAdminWorkspaceScope } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

type AssignmentRole = OperationsOverview['assignments'][number]['role'];
type PendingOperation =
  { readonly kind: 'assignment' } | { readonly kind: 'export' } | null;

const roleLabels: Record<AssignmentRole, string> = {
  checkin_operator: 'Check-in operátor',
  room_operator: 'Operátor sálu',
  moderator: 'Moderátor',
};

export const AdminOperationsWorkspace = () => {
  const scope = useAdminWorkspaceScope();
  const [overview, setOverview] = useState(demoOperationsOverview);
  const [operatorLabel, setOperatorLabel] = useState('');
  const [assignmentRole, setAssignmentRole] =
    useState<AssignmentRole>('checkin_operator');
  const [scopeLabel, setScopeLabel] = useState('Hlavní vstup');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [attemptKind, setAttemptKind] = useState<
    'assignment' | 'export' | null
  >(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [audit, setAudit] = useState<AuditEntry | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'queued'>('idle');

  const assignmentCandidate = {
    assignmentId: `mock-assignment-${overview.assignments.length + 1}`,
    operatorLabel,
    role: assignmentRole,
    scopeLabel,
    state: 'scheduled' as const,
    version: 1,
  };
  const assignmentPreview = operationsOverviewSchema.safeParse({
    ...overview,
    assignments: [...overview.assignments, assignmentCandidate],
  });
  const assignmentInvalid =
    attempted && attemptKind === 'assignment' && !assignmentPreview.success;
  const reasonInvalid =
    attempted && !adminReasonSchema.safeParse(reason).success;
  const queueTotals = useMemo(
    () =>
      overview.queues.reduce(
        (total, queue) => ({
          ready: total.ready + queue.ready,
          processing: total.processing + queue.processing,
          failed: total.failed + queue.failed,
        }),
        { ready: 0, processing: 0, failed: 0 },
      ),
    [overview.queues],
  );

  const requestAssignment = () => {
    setAttempted(true);
    setAttemptKind('assignment');
    if (
      !assignmentPreview.success ||
      !adminReasonSchema.safeParse(reason).success
    ) {
      return;
    }
    setPending({ kind: 'assignment' });
  };

  const requestExport = () => {
    setAttempted(true);
    setAttemptKind('export');
    if (!adminReasonSchema.safeParse(reason).success) return;
    setPending({ kind: 'export' });
  };

  const confirmOperation = () => {
    if (!pending) return;
    if (pending.kind === 'assignment') {
      if (!assignmentPreview.success) return;
      const nextAssignment = assignmentCandidate;
      const nextOverview = operationsOverviewSchema.parse({
        ...overview,
        assignments: [...overview.assignments, nextAssignment],
      });
      setOverview(nextOverview);
      setAudit(
        auditEntrySchema.parse({
          auditId: `mock-audit-role-${nextAssignment.assignmentId}`,
          eventId: scope.eventId,
          actorLabel: 'Demo administrátor',
          category: 'role',
          action: 'assign_scoped_operator',
          targetReference: nextAssignment.assignmentId,
          reason,
          outcome: 'succeeded',
          createdAt: '2026-07-25T13:00:00.000+02:00',
          resultingVersion: 1,
        }),
      );
      setOperatorLabel('');
    } else {
      setExportState('queued');
      setAudit(
        auditEntrySchema.parse({
          auditId: 'mock-audit-export-operations-001',
          eventId: scope.eventId,
          actorLabel: 'Demo administrátor',
          category: 'export',
          action: 'queue_operations_export',
          targetReference: 'mock-export-operations-001',
          reason,
          outcome: 'queued',
          createdAt: '2026-07-25T13:02:00.000+02:00',
          resultingVersion: null,
        }),
      );
    }
    setReason('');
    setAttempted(false);
    setAttemptKind(null);
    setPending(null);
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · role a provoz</p>
        <h1>Operátoři, fronty a export</h1>
        <p>
          Scopeované role jsou vázané na tuto akci nebo stanoviště. Queue/DLQ
          přehled ukazuje jen bezpečné počty a export probíhá asynchronně.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="queue-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="queue-title">Bezpečný queue a DLQ souhrn</h2>
            <p className={styles.muted}>
              Bez payloadu, adresátů, tokenů a raw chyb.
            </p>
          </div>
          <span
            className={`${styles.statusBadge} ${
              queueTotals.failed > 0
                ? styles.statusAttention
                : styles.statusHealthy
            }`}
          >
            {queueTotals.failed > 0
              ? `${queueTotals.failed} úloha v DLQ`
              : 'Bez DLQ'}
          </span>
        </div>
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
            <caption>Agregované počty úloh podle bezpečné kategorie.</caption>
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
          <ul className={styles.cardList}>
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
      </section>

      <section className={styles.panel} aria-labelledby="assignments-title">
        <h2 id="assignments-title">Scopeované přiřazení operátorů</h2>
        <ul className={styles.cardList}>
          {overview.assignments.map((assignment) => (
            <li className={styles.dataCard} key={assignment.assignmentId}>
              <div className={styles.panelHeader}>
                <strong>{assignment.operatorLabel}</strong>
                <span className={styles.statusBadge}>
                  {assignment.state === 'active' ? 'Aktivní' : 'Naplánováno'}
                </span>
              </div>
              <dl>
                <dt>Role</dt>
                <dd>{roleLabels[assignment.role]}</dd>
                <dt>Rozsah</dt>
                <dd>{assignment.scopeLabel}</dd>
                <dt>Verze</dt>
                <dd>{assignment.version}</dd>
              </dl>
            </li>
          ))}
        </ul>
        {(assignmentInvalid || reasonInvalid) && attempted ? (
          <section
            aria-labelledby="assignment-errors"
            className={styles.errorSummary}
            role="alert"
          >
            <h2 id="assignment-errors">Přiřazení není připravené</h2>
            <ul>
              {assignmentInvalid ? (
                <li>Doplňte opaque označení operátora a konkrétní rozsah.</li>
              ) : null}
              {reasonInvalid ? <li>Doplňte auditní důvod.</li> : null}
            </ul>
          </section>
        ) : null}
        <div className={styles.threeColumn}>
          <label className={styles.field}>
            <span>Označení operátora</span>
            <input
              autoComplete="off"
              onChange={(event) => setOperatorLabel(event.target.value)}
              placeholder="např. Operátor #31"
              value={operatorLabel}
            />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <select
              onChange={(event) =>
                setAssignmentRole(event.target.value as AssignmentRole)
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
            <span>Rozsah</span>
            <input
              onChange={(event) => setScopeLabel(event.target.value)}
              value={scopeLabel}
            />
          </label>
        </div>
        <label className={styles.field}>
          <span>Společný auditní důvod pro další akci</span>
          <textarea
            aria-invalid={reasonInvalid}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>
        <div className={styles.actionRow}>
          <button
            className={styles.button}
            onClick={requestAssignment}
            type="button"
          >
            Zkontrolovat přiřazení role
          </button>
          <button
            className={styles.secondaryButton}
            disabled={exportState === 'queued'}
            onClick={requestExport}
            type="button"
          >
            Spustit bezpečný asynchronní export
          </button>
        </div>
        {audit ? (
          <section aria-live="polite" className={styles.success}>
            <h3>
              {audit.outcome === 'queued'
                ? 'Export zařazen do fronty'
                : 'Role přiřazena v mocku'}
            </h3>
            <p>
              Audit <code>{audit.auditId}</code> · výsledek {audit.outcome}.
            </p>
          </section>
        ) : null}
      </section>

      {pending ? (
        <AdminConfirmDialog
          acknowledgement={
            pending.kind === 'assignment'
              ? 'Potvrzuji scopeovanou roli a přesný rozsah v syntetickém eventu.'
              : 'Potvrzuji export pouze agregovaných mock provozních dat.'
          }
          confirmLabel={
            pending.kind === 'assignment'
              ? 'Přiřadit roli v mocku'
              : 'Zařadit mock export'
          }
          description={
            pending.kind === 'assignment'
              ? 'Přiřazení platí jen pro aktuální event a uvedený rozsah; výsledek vytvoří audit.'
              : 'Export se pouze zařadí do syntetické fronty a neobsahuje osobní data.'
          }
          impact={
            <dl className={styles.detailList}>
              <dt>Akce</dt>
              <dd>
                {pending.kind === 'assignment'
                  ? roleLabels[assignmentRole]
                  : 'Agregovaný provozní export'}
              </dd>
              <dt>Rozsah</dt>
              <dd>
                {pending.kind === 'assignment' ? scopeLabel : scope.eventId}
              </dd>
              <dt>Režim</dt>
              <dd>UI ready (mocked)</dd>
            </dl>
          }
          onConfirm={confirmOperation}
          onDismiss={() => setPending(null)}
          title={
            pending.kind === 'assignment'
              ? 'Potvrdit scopeované přiřazení?'
              : 'Spustit asynchronní export?'
          }
        />
      ) : null}
    </div>
  );
};
