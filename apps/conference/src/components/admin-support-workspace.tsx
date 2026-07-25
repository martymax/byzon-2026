'use client';

import { useMemo, useRef, useState } from 'react';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  AdminMockMutationReplay,
  adminDatasetMatchesEvent,
  adminReasonSchema,
  applySupportMutation,
  supportMutationRequestSchema,
  type AuditEntry,
  type SupportAction,
  type SupportRecord,
} from './admin-workspace-contracts';
import { demoSupportRecords } from './admin-workspace-demo-data';
import { useAdminWorkspaceScope } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const actionLabels: Record<SupportAction, string> = {
  resend: 'Znovu odeslat aktivační výzvu',
  reassign: 'Přiřadit jinou vstupenku',
  block: 'Zablokovat vstupenku',
  reactivate: 'Znovu aktivovat vstupenku',
  transfer: 'Převést vstupenku',
};

const actionNeedsTarget = (action: SupportAction) =>
  action === 'reassign' || action === 'transfer';

export const AdminSupportWorkspace = ({
  initialRecords = demoSupportRecords,
}: {
  readonly initialRecords?: readonly SupportRecord[];
}) => {
  const scope = useAdminWorkspaceScope();
  const datasetScoped = adminDatasetMatchesEvent(scope.eventId, initialRecords);
  const [records, setRecords] =
    useState<readonly SupportRecord[]>(initialRecords);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<SupportAction>('resend');
  const [reason, setReason] = useState('');
  const [targetReference, setTargetReference] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [audit, setAudit] = useState<AuditEntry | null>(null);
  const replay = useRef(new AdminMockMutationReplay());

  const results = useMemo(() => {
    if (!datasetScoped || !searched || query.trim().length < 3) return [];
    const normalized = query.trim().toLocaleLowerCase('cs');
    return records.filter(
      (record) =>
        record.ticketReference.toLocaleLowerCase('cs').includes(normalized) ||
        record.displayName.toLocaleLowerCase('cs').includes(normalized),
    );
  }, [datasetScoped, query, records, searched]);
  const selected =
    records.find(({ participantId }) => participantId === selectedId) ?? null;
  const reasonInvalid =
    attempted && !adminReasonSchema.safeParse(reason).success;
  const targetInvalid =
    attempted && actionNeedsTarget(action) && targetReference.trim().length < 1;
  const transitionInvalid =
    selected !== null &&
    ((action === 'block' && selected.ticketState === 'blocked') ||
      (action === 'reactivate' && selected.ticketState === 'active'));
  const requestCandidate = selected
    ? supportMutationRequestSchema.safeParse({
        eventId: scope.eventId,
        participantId: selected.participantId,
        action,
        reason,
        targetTicketReference: actionNeedsTarget(action)
          ? targetReference
          : null,
        expectedVersion: selected.version,
        idempotencyKey: `mock-support-${selected.participantId}-${action}-v${selected.version}`,
      })
    : null;
  const requestShapeInvalid =
    attempted &&
    requestCandidate !== null &&
    !requestCandidate.success &&
    !reasonInvalid &&
    !targetInvalid;

  const beginAction = (record: SupportRecord) => {
    setSelectedId(record.participantId);
    setAction(record.ticketState === 'blocked' ? 'reactivate' : 'resend');
    setReason('');
    setTargetReference('');
    setAttempted(false);
    setConfirming(false);
    setAudit(null);
  };

  const requestConfirmation = () => {
    setAttempted(true);
    if (
      requestCandidate === null ||
      !requestCandidate.success ||
      transitionInvalid
    ) {
      return;
    }
    setConfirming(true);
  };

  const confirmAction = () => {
    if (!selected) return;
    const request = supportMutationRequestSchema.parse({
      eventId: scope.eventId,
      participantId: selected.participantId,
      action,
      reason,
      targetTicketReference: actionNeedsTarget(action) ? targetReference : null,
      expectedVersion: selected.version,
      idempotencyKey: `mock-support-${selected.participantId}-${action}-v${selected.version}`,
    });
    const response = applySupportMutation(selected, request, replay.current);
    setRecords((current) =>
      current.map((record) =>
        record.participantId === response.record.participantId
          ? response.record
          : record,
      ),
    );
    setAudit(response.audit);
    setConfirming(false);
    setAttempted(false);
    setReason('');
    setTargetReference('');
  };

  if (!datasetScoped) {
    return (
      <section className={styles.forbidden} role="alert">
        <p className={styles.eyebrow}>Bezpečnostní hranice eventu</p>
        <h1>Data podpory nelze zobrazit</h1>
        <p>
          Odpověď neodpovídá aktuálnímu eventu. Žádný účastník ani vstupenka
          nebyli zobrazeni.
        </p>
      </section>
    );
  }

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · omezená podpora</p>
        <h1>Podpora účastníků a vstupenek</h1>
        <p>
          Vyhledávání používá syntetickou referenci a zobrazuje jen minimum
          maskovaných údajů. Každá změna vyžaduje důvod, potvrzení, očekávanou
          verzi a vrací audit.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="support-search-title">
        <h2 id="support-search-title">1. Najít záznam</h2>
        <form
          className={styles.toolbar}
          onSubmit={(event) => {
            event.preventDefault();
            setSearched(true);
            setSelectedId(null);
            setAudit(null);
          }}
          role="search"
        >
          <label className={styles.field}>
            <span>Reference vstupenky nebo zkrácené jméno</span>
            <input
              autoComplete="off"
              minLength={3}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearched(false);
              }}
              required
              type="search"
              value={query}
            />
            <span className={styles.helper}>
              Zkuste bezpečnou demo referenci SYN-10001 nebo SYN-10004.
            </span>
          </label>
          <button className={styles.button} type="submit">
            Vyhledat v mock datech
          </button>
        </form>
        <p aria-live="polite">
          {searched
            ? results.length > 0
              ? `Nalezeno záznamů: ${results.length}.`
              : 'Nebyl nalezen žádný záznam. Zkontrolujte referenci.'
            : ''}
        </p>
      </section>

      {results.length > 0 ? (
        <section
          className={styles.panel}
          aria-labelledby="support-result-title"
        >
          <h2 id="support-result-title">2. Výsledek s minimem PII</h2>
          <ul className={styles.cardList}>
            {results.map((record) => (
              <li className={styles.dataCard} key={record.participantId}>
                <div className={styles.panelHeader}>
                  <div>
                    <strong>{record.displayName}</strong>
                    <div className={styles.muted}>{record.maskedContact}</div>
                  </div>
                  <span
                    className={`${styles.statusBadge} ${
                      record.ticketState === 'active'
                        ? styles.statusHealthy
                        : styles.statusConflict
                    }`}
                  >
                    {record.ticketState === 'active' ? 'Aktivní' : 'Blokovaná'}
                  </span>
                </div>
                <dl>
                  <dt>Reference</dt>
                  <dd>{record.ticketReference}</dd>
                  <dt>Přístup</dt>
                  <dd>
                    {record.accessState === 'claimed'
                      ? 'Aktivovaný'
                      : 'Neaktivovaný'}
                  </dd>
                  <dt>Verze</dt>
                  <dd>{record.version}</dd>
                </dl>
                <button
                  className={styles.secondaryButton}
                  onClick={() => beginAction(record)}
                  type="button"
                >
                  Otevřít auditovanou akci
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <section
          className={styles.panel}
          aria-labelledby="support-action-title"
        >
          <h2 id="support-action-title">3. Auditovaná support akce</h2>
          <p className={styles.callout}>
            Cíl: {selected.ticketReference} · canonical verze {selected.version}
            . Skutečná identita se v potvrzení nezobrazuje.
          </p>
          {(reasonInvalid ||
            targetInvalid ||
            requestShapeInvalid ||
            transitionInvalid) &&
          attempted ? (
            <section
              aria-labelledby="support-errors-title"
              className={styles.errorSummary}
              role="alert"
            >
              <h2 id="support-errors-title">Akci nelze potvrdit</h2>
              <ul>
                {reasonInvalid ? (
                  <li>
                    <a href="#support-reason">Doplňte důvod změny.</a>
                  </li>
                ) : null}
                {targetInvalid ? (
                  <li>
                    <a href="#support-target">
                      Doplňte cílovou referenci vstupenky.
                    </a>
                  </li>
                ) : null}
                {transitionInvalid ? (
                  <li>Vybraná změna neodpovídá současnému stavu.</li>
                ) : null}
                {requestShapeInvalid ? (
                  <li>
                    Reference nebo důvod obsahují nepodporovaný znak či
                    překračují bezpečný limit.
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span>Akce</span>
              <select
                onChange={(event) => {
                  setAction(event.target.value as SupportAction);
                  setAttempted(false);
                }}
                value={action}
              >
                {Object.entries(actionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {actionNeedsTarget(action) ? (
              <label className={styles.field}>
                <span>Cílová reference</span>
                <input
                  aria-invalid={targetInvalid}
                  id="support-target"
                  onChange={(event) => setTargetReference(event.target.value)}
                  value={targetReference}
                />
                <span className={styles.helper}>
                  Použijte jen interní opaque referenci, ne e-mail ani jméno.
                </span>
              </label>
            ) : (
              <div className={styles.callout}>
                Akce zachová současnou referenci vstupenky.
              </div>
            )}
          </div>
          <label className={styles.field}>
            <span>Důvod</span>
            <textarea
              aria-invalid={reasonInvalid}
              id="support-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper}>
              Důvod se uloží do mock auditu. Nevkládejte citlivé údaje.
            </span>
          </label>
          <button
            className={action === 'block' ? styles.dangerButton : styles.button}
            onClick={requestConfirmation}
            type="button"
          >
            Zkontrolovat a potvrdit
          </button>
          {audit ? (
            <section
              aria-live="polite"
              className={`${styles.success} ${styles.result}`}
            >
              <h3>Canonical stav byl v mocku aktualizován</h3>
              <dl className={styles.detailList}>
                <dt>Audit</dt>
                <dd>{audit.auditId}</dd>
                <dt>Výsledek</dt>
                <dd>Úspěch</dd>
                <dt>Akce</dt>
                <dd>{actionLabels[audit.action as SupportAction]}</dd>
                <dt>Nová verze</dt>
                <dd>{audit.resultingVersion}</dd>
              </dl>
            </section>
          ) : null}
        </section>
      ) : null}

      {confirming && selected ? (
        <AdminConfirmDialog
          acknowledgement="Potvrzuji, že důvod neobsahuje PII a akce je pouze syntetická."
          confirmLabel={`Potvrdit: ${actionLabels[action]}`}
          danger={action === 'block'}
          description="Změna je svázaná s eventem, očekávanou verzí a idempotency klíčem. Dialog neodhaluje plnou identitu."
          impact={
            <dl className={styles.detailList}>
              <dt>Cíl</dt>
              <dd>{selected.ticketReference}</dd>
              <dt>Akce</dt>
              <dd>{actionLabels[action]}</dd>
              <dt>Očekávaná verze</dt>
              <dd>{selected.version}</dd>
              <dt>Rozsah</dt>
              <dd>{scope.eventId}</dd>
            </dl>
          }
          onConfirm={confirmAction}
          onDismiss={() => setConfirming(false)}
          title="Potvrdit auditovanou support akci?"
        />
      ) : null}
    </div>
  );
};
