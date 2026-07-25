'use client';

import {
  supportMutationRequestSchema,
  supportSearchQuerySchema,
  type SupportAction,
  type SupportMutationRequest,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import { useState } from 'react';

import {
  requestAdminSupportMutation,
  requestAdminSupportSearch,
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

const actionLabels: Record<SupportAction, string> = {
  resend: 'Znovu odeslat aktivační výzvu',
  reassign: 'Přiřadit jinou vstupenku',
  block: 'Zablokovat vstupenku',
  reactivate: 'Znovu aktivovat vstupenku',
  transfer: 'Převést vstupenku',
};

type PendingMutation = Readonly<{
  body: SupportMutationRequest;
  idempotencyKey: string;
}>;

export const AdminSupportWorkspace = () => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<readonly SupportRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<SupportRecord | null>(null);
  const [action, setAction] = useState<SupportAction>('resend');
  const [targetTicketId, setTargetTicketId] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState<'search' | 'mutation' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const requestCandidate = selected
    ? supportMutationRequestSchema.safeParse({
        participantId: selected.participantId,
        ticketId: selected.ticketId,
        action,
        expectedVersion: selected.version,
        reason,
        targetTicketId:
          action === 'reassign' || action === 'transfer'
            ? targetTicketId
            : null,
      })
    : null;

  const search = async (staleMessage?: string) => {
    const validated = supportSearchQuerySchema.safeParse({
      query,
      limit: 5,
    });
    if (!validated.success) {
      setError('Zadejte 2 až 80 bezpečných znaků.');
      return;
    }
    setBusy('search');
    setError(null);
    setSuccess(null);
    setSelected(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    const result = await requestAdminSupportSearch(
      api,
      eventId,
      validated.data.query,
    );
    setBusy(null);
    setSearched(true);
    if (!result.ok) {
      setRecords([]);
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
    if (result.kind === 'success') {
      setRecords(result.data.matches);
      if (staleMessage) setError(staleMessage);
    }
  };

  const selectRecord = (record: SupportRecord) => {
    setSelected(record);
    setAction(record.availableActions[0] ?? 'resend');
    setTargetTicketId('');
    setReason('');
    setAttempted(false);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setError(null);
    setSuccess(null);
  };

  const prepare = () => {
    setAttempted(true);
    if (!requestCandidate?.success) return;
    const attempt = {
      body: requestCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('support'),
    };
    setPending(attempt);
    setConfirming(true);
    setAmbiguous(false);
  };

  const mutate = async (attempt: PendingMutation) => {
    setBusy('mutation');
    setConfirming(false);
    setError(null);
    const result = await requestAdminSupportMutation(
      api,
      eventId,
      attempt.body,
      attempt.idempotencyKey,
    );
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result.failure)) {
        setRecords([]);
        setSelected(null);
        setPending(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        await search(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
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
      setRecords((current) =>
        current.map((record) =>
          record.participantId === result.data.record.participantId
            ? result.data.record
            : record,
        ),
      );
      setSelected(result.data.record);
      setPending(null);
      setAmbiguous(false);
      setAttempted(false);
      setReason('');
      setTargetTicketId('');
      setSuccess(
        result.data.outcome === 'already_applied'
          ? `Server potvrdil dříve dokončenou operaci · audit ${result.data.audit.auditId}`
          : `Změna byla provedena · audit ${result.data.audit.auditId}`,
      );
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · omezená podpora</p>
        <h1>Podpora účastníků a vstupenek</h1>
        <p>
          Vyhledávání vrací jen maskované minimum. Každá změna používá
          očekávanou verzi, auditní důvod a samostatný idempotency klíč.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="support-search-title">
        <h2 id="support-search-title">1. Najít záznam</h2>
        <form
          className={styles.toolbar}
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
          role="search"
        >
          <label className={styles.field}>
            <span>Reference nebo jméno</span>
            <input
              autoComplete="off"
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              value={query}
            />
            <span className={styles.helper}>
              V mocked režimu zkuste „single“, „ambiguous“, „none“ nebo
              „error“.
            </span>
          </label>
          <button
            className={styles.button}
            disabled={busy !== null}
            type="submit"
          >
            {busy === 'search' ? 'Hledám…' : 'Vyhledat'}
          </button>
        </form>
        {error ? (
          <p className={styles.warning} role="alert">
            {error}
          </p>
        ) : null}
        {searched && records.length === 0 && !error ? (
          <p role="status">Nenalezen žádný odpovídající záznam.</p>
        ) : null}
        <ul className={styles.cardList}>
          {records.map((record) => (
            <li className={styles.dataCard} key={record.participantId}>
              <div className={styles.panelHeader}>
                <strong>{record.displayName}</strong>
                <span className={styles.statusBadge}>{record.ticketState}</span>
              </div>
              <dl>
                <dt>Kontakt</dt>
                <dd>{record.maskedContact}</dd>
                <dt>Reference</dt>
                <dd>••{record.referenceSuffix}</dd>
                <dt>Přístup</dt>
                <dd>{record.accessState}</dd>
                <dt>Verze</dt>
                <dd>{record.version}</dd>
              </dl>
              <button
                className={styles.secondaryButton}
                onClick={() => selectRecord(record)}
                type="button"
              >
                Připravit podporu
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <section className={styles.panel} aria-labelledby="support-action-title">
          <h2 id="support-action-title">2. Zkontrolovat změnu</h2>
          <p>
            {selected.displayName} · vstupenka ••{selected.referenceSuffix} ·
            snapshot v{selected.version}
          </p>
          <label className={styles.field}>
            <span>Akce</span>
            <select
              onChange={(event) => {
                setAction(event.target.value as SupportAction);
                setPending(null);
                setAmbiguous(false);
              }}
              value={action}
            >
              {selected.availableActions.map((availableAction) => (
                <option key={availableAction} value={availableAction}>
                  {actionLabels[availableAction]}
                </option>
              ))}
            </select>
          </label>
          {action === 'reassign' || action === 'transfer' ? (
            <label className={styles.field}>
              <span>ID cílové vstupenky</span>
              <input
                autoComplete="off"
                onChange={(event) => setTargetTicketId(event.target.value)}
                value={targetTicketId}
              />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>Auditní důvod</span>
            <textarea
              aria-invalid={attempted && requestCandidate?.success === false}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper}>
              Nejméně 8 znaků. Pro mocked chybové scénáře lze do důvodu přidat
              „stale“, „timeout“ nebo „collision“.
            </span>
          </label>
          {attempted && requestCandidate?.success === false ? (
            <p className={styles.warning} role="alert">
              Zkontrolujte důvod, povolenou akci a případné ID cílové
              vstupenky.
            </p>
          ) : null}
          <div className={styles.actionRow}>
            <button
              className={styles.dangerButton}
              disabled={busy !== null}
              onClick={prepare}
              type="button"
            >
              Zkontrolovat a potvrdit
            </button>
            {ambiguous && pending ? (
              <button
                className={styles.secondaryButton}
                disabled={busy !== null}
                onClick={() => void mutate(pending)}
                type="button"
              >
                Zopakovat přesně stejný pokus
              </button>
            ) : null}
          </div>
          {success ? (
            <p className={styles.success} role="status">
              {success}
            </p>
          ) : null}
        </section>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem maskovaný záznam, akci, verzi a auditní důvod."
          confirmLabel={actionLabels[pending.body.action]}
          danger={pending.body.action !== 'resend'}
          description="Server znovu ověří oprávnění, dostupnou akci i očekávanou verzi."
          impact={
            <p>
              {selected?.displayName} · snapshot v
              {pending.body.expectedVersion}
            </p>
          }
          onConfirm={() => void mutate(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title="Provést podporu nad vstupenkou?"
        />
      ) : null}
    </div>
  );
};
