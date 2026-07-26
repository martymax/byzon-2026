'use client';

import {
  canApplyTicketImportPreview,
  ticketImportApplyRequestSchema,
  type TicketImportApplyRequest,
  type TicketImportApplyResponse,
  type TicketImportPreviewResponse,
  type TicketImportRowStatus,
} from '@byzon/domain/contracts/ticket-import';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { requestAdminTicketImportApply } from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
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

const statusLabels: Record<TicketImportRowStatus, string> = {
  new: 'Nová',
  unchanged: 'Beze změny',
  status_changed: 'Změna stavu',
  conflict: 'Konflikt',
  unknown: 'Neznámý stav',
};

const statusClass: Record<TicketImportRowStatus, string> = {
  new: styles.statusNew!,
  unchanged: styles.statusUnchanged!,
  status_changed: styles.statusChanged!,
  conflict: styles.statusConflict!,
  unknown: styles.statusUnknown!,
};

const filterOptions = [
  ['all', 'Vše'],
  ['new', 'Nové'],
  ['unchanged', 'Beze změny'],
  ['status_changed', 'Změny stavu'],
  ['conflict', 'Konflikty'],
  ['unknown', 'Neznámé'],
] as const;

type ImportFilter = (typeof filterOptions)[number][0];
type PendingApply = Readonly<{
  body: TicketImportApplyRequest;
  idempotencyKey: string;
}>;

const safeFileNameForDisplay = (fileName: string) =>
  fileName
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '�')
    .slice(0, 180);

const fileFingerprint = (file: File): string =>
  [file.name, file.type, file.size, file.lastModified].join('\u0000');

const formatTicketState = (state: string | null): string =>
  state === null
    ? '—'
    : state === 'active'
      ? 'Aktivní'
      : state === 'blocked'
        ? 'Blokovaná'
        : 'Zrušená';

export const AdminImportWorkspace = () => {
  const { api, eventId, invalidateSensitive, uploadPort } = useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const selectedFileFingerprintRef = useRef<string | null>(null);
  const applyErrorSummaryRef = useRef<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TicketImportPreviewResponse | null>(
    null,
  );
  const [report, setReport] = useState<TicketImportApplyResponse | null>(null);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'upload' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<'upload' | 'apply' | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PendingApply | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [uploadState, setUploadState] = useState<
    'idle' | 'selected' | 'uploading' | 'validated' | 'error'
  >('idle');

  const visibleRows = useMemo(
    () =>
      preview?.rows.filter(
        ({ status }) => filter === 'all' || status === filter,
      ) ?? [],
    [filter, preview],
  );

  const requestCandidate = preview
    ? ticketImportApplyRequestSchema.safeParse({
        eventId,
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        expectedImpact: preview.summary,
        reason,
      })
    : null;
  const canPrepareApply =
    preview !== null && canApplyTicketImportPreview(preview);
  const applyValidationFailed =
    attempted && requestCandidate?.success === false;

  useEffect(() => {
    if (applyValidationFailed || (error && errorScope === 'apply')) {
      applyErrorSummaryRef.current?.focus();
    }
  }, [applyValidationFailed, error, errorScope]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    requestFence.cancel('import-upload');
    selectedFileFingerprintRef.current = selectedFile
      ? fileFingerprint(selectedFile)
      : null;
    setBusy((current) => (current === 'upload' ? null : current));
    setFile(selectedFile);
    setUploadState(selectedFile ? 'selected' : 'idle');
    setPreview(null);
    setReport(null);
    setPending(null);
    setAmbiguous(false);
    setError(null);
    setErrorScope(null);
    setAttempted(false);
    setFilter('all');
  };

  const upload = async (staleMessage?: string) => {
    if (!file) return;
    const selectedFile = file;
    const fingerprint = fileFingerprint(selectedFile);
    const request = requestFence.begin('import-upload');
    setBusy('upload');
    setUploadState('uploading');
    setError(null);
    setErrorScope(null);
    setPreview(null);
    setReport(null);
    setPending(null);
    setAmbiguous(false);
    try {
      const result = await uploadPort.preview(
        eventId,
        selectedFile,
        request.signal,
      );
      if (
        !request.isCurrent() ||
        selectedFileFingerprintRef.current !== fingerprint
      ) {
        return;
      }
      if (!result.ok) {
        if (isAdminSecurityFailure(result)) {
          invalidateSensitive(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        setError(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        setErrorScope('upload');
        setUploadState('error');
        return;
      }
      if (result.kind === 'success') {
        setPreview(result.data);
        setUploadState('validated');
        setFilter('all');
        setReason('');
        setAttempted(false);
        if (staleMessage) {
          setErrorScope('apply');
          setError(staleMessage);
        }
      }
    } catch {
      if (
        !request.isCurrent() ||
        selectedFileFingerprintRef.current !== fingerprint
      ) {
        return;
      }
      setError(
        'Soubor musí být neprázdný CSV nebo XLSX, mít odpovídající MIME typ a velikost nejvýše 10 MB.',
      );
      setErrorScope('upload');
      setUploadState('error');
    } finally {
      if (
        request.isCurrent() &&
        selectedFileFingerprintRef.current === fingerprint
      ) {
        request.finish();
        setBusy(null);
      }
    }
  };

  const prepareApply = () => {
    setAttempted(true);
    if (!requestCandidate?.success || !canApplyTicketImportPreview(preview!)) {
      return;
    }
    setPending({
      body: requestCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('ticket-import'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const submitPending = async (attempt: PendingApply) => {
    const request = requestFence.begin('import-apply');
    setBusy('apply');
    setConfirming(false);
    setError(null);
    setErrorScope(null);
    const result = await requestAdminTicketImportApply(
      api,
      eventId,
      attempt.body,
      attempt.idempotencyKey,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setPending(null);
        setPreview(null);
        setFile(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        await upload(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      setErrorScope('apply');
      return;
    }
    if (result.kind === 'success') {
      setReport(result.data);
      setPending(null);
      setAmbiguous(false);
      setReason('');
      setAttempted(false);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · bezpečný import</p>
        <h1>Import vstupenek</h1>
        <p>
          Nahrajte CSV nebo XLSX, ověřte immutable staging diff a až poté
          potvrďte dopad. Typ i obsah autoritativně ověřuje server.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="import-upload-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="import-upload-title">1. Soubor a serverová validace</h2>
            <p className={styles.muted}>
              Soubor jde jako multipart; klient jej nepřevádí do base64.
            </p>
          </div>
          <span className={styles.badge}>CSV / XLSX · max. 10 MB</span>
        </div>
        <label className={styles.field} htmlFor="admin-import-file">
          <span>Zdrojový soubor</span>
          <input
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby="admin-import-file-help"
            disabled={busy === 'apply' || pending !== null}
            id="admin-import-file"
            onChange={selectFile}
            type="file"
          />
          <span className={styles.helper} id="admin-import-file-help">
            V mocked režimu lze scénář měnit názvem souboru: běžný, „conflict“,
            „unknown“, „stale“ nebo „collision“.
          </span>
        </label>
        {file ? (
          <p>
            Vybráno: <strong>{safeFileNameForDisplay(file.name)}</strong> ·{' '}
            {file.size.toLocaleString('cs-CZ')} B
          </p>
        ) : null}
        <div className={styles.actionRow}>
          <button
            className={styles.button}
            disabled={!file || busy !== null}
            onClick={() => void upload()}
            type="button"
          >
            {busy === 'upload'
              ? 'Server validuje…'
              : 'Vytvořit validované preview'}
          </button>
        </div>
        <div
          aria-busy={uploadState === 'uploading'}
          aria-live="polite"
          className={styles.progress}
          role="status"
        >
          {uploadState === 'uploading' ? (
            <>
              <progress aria-label="Nahrávání a serverová validace souboru" />
              <span>Soubor se odesílá a server vytváří bezpečné preview…</span>
            </>
          ) : uploadState === 'validated' ? (
            <span>Soubor byl nahrán a serverové preview je připravené.</span>
          ) : uploadState === 'error' ? (
            <span>Nahrání nebo validace souboru selhaly.</span>
          ) : uploadState === 'selected' ? (
            <span>Soubor je vybraný a čeká na nahrání.</span>
          ) : (
            <span>Vyberte soubor k nahrání.</span>
          )}
        </div>
        {error && errorScope === 'upload' ? (
          <p className={styles.warning} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {preview ? (
        <section
          className={styles.panel}
          aria-labelledby="import-preview-title"
        >
          <div className={styles.summaryHeader}>
            <div>
              <h2 id="import-preview-title">2. Staging diff preview</h2>
              <p className={styles.muted}>
                Preview {preview.previewId} · verze {preview.previewVersion}
              </p>
            </div>
            <span className={styles.badge}>{preview.summary.total} řádků</span>
          </div>
          <div className={styles.summaryGrid} aria-label="Souhrn změn">
            <div className={styles.metric}>
              <small>Nové</small>
              <strong>{preview.summary.new}</strong>
            </div>
            <div className={styles.metric}>
              <small>Beze změny</small>
              <strong>{preview.summary.unchanged}</strong>
            </div>
            <div className={styles.metric}>
              <small>Změna stavu</small>
              <strong>{preview.summary.statusChanged}</strong>
            </div>
            <div className={styles.metric}>
              <small>Konflikt / neznámé</small>
              <strong>
                {preview.summary.conflict} / {preview.summary.unknown}
              </strong>
            </div>
          </div>
          <label className={styles.field}>
            <span>Filtrovat řádky</span>
            <select
              onChange={(event) =>
                setFilter(event.target.value as ImportFilter)
              }
              value={filter}
            >
              {filterOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>Maskovaný immutable rozdíl importu.</caption>
              <thead>
                <tr>
                  <th scope="col">Řádek</th>
                  <th scope="col">Účastník</th>
                  <th scope="col">Stav</th>
                  <th scope="col">Původní → nový</th>
                  <th scope="col">Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>{row.sourceRowNumber}</td>
                    <td>
                      {row.displayName}
                      <br />
                      <small>
                        {row.maskedContact} · •{row.referenceSuffix}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${statusClass[row.status]}`}
                      >
                        {statusLabels[row.status]}
                      </span>
                    </td>
                    <td>
                      {formatTicketState(row.currentState)} →{' '}
                      {formatTicketState(row.incomingState)}
                    </td>
                    <td>
                      {row.issues.map(({ message }) => message).join('; ') ||
                        'Bez problému'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.cards}>
            <ul className={styles.cardList} aria-label="Řádky importu">
              {visibleRows.map((row) => (
                <li className={styles.dataCard} key={row.rowId}>
                  <div className={styles.panelHeader}>
                    <strong>
                      Řádek {row.sourceRowNumber} · {row.displayName}
                    </strong>
                    <span
                      className={`${styles.statusBadge} ${statusClass[row.status]}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  </div>
                  <dl>
                    <dt>Kontakt</dt>
                    <dd>
                      {row.maskedContact} · •{row.referenceSuffix}
                    </dd>
                    <dt>Stav</dt>
                    <dd>
                      {formatTicketState(row.currentState)} →{' '}
                      {formatTicketState(row.incomingState)}
                    </dd>
                    <dt>Poznámka</dt>
                    <dd>
                      {row.issues.map(({ message }) => message).join('; ') ||
                        'Bez problému'}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </div>
          {!canApplyTicketImportPreview(preview) ? (
            <p className={styles.warning} role="alert">
              Preview obsahuje konflikt nebo neznámý stav. Opravte zdroj a
              nahrajte nový soubor; apply je fail-closed.
            </p>
          ) : null}
          {applyValidationFailed || (error && errorScope === 'apply') ? (
            <section
              className={styles.errorSummary}
              ref={applyErrorSummaryRef}
              role="alert"
              tabIndex={-1}
            >
              <h2>Apply zatím nelze potvrdit</h2>
              <p id="admin-import-apply-error">
                {error && errorScope === 'apply'
                  ? error
                  : 'Doplňte auditní důvod o nejméně 8 viditelných znaků.'}
              </p>
            </section>
          ) : null}
          <label className={styles.field} htmlFor="admin-import-reason">
            <span>Auditní důvod</span>
            <textarea
              aria-describedby={
                applyValidationFailed || errorScope === 'apply'
                  ? 'admin-import-apply-error'
                  : 'admin-import-reason-help'
              }
              aria-invalid={applyValidationFailed}
              disabled={pending !== null}
              id="admin-import-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper} id="admin-import-reason-help">
              Nejméně 8 viditelných znaků; důvod bude součástí auditu.
            </span>
          </label>
          <button
            className={styles.dangerButton}
            disabled={!canPrepareApply || busy !== null || pending !== null}
            onClick={prepareApply}
            type="button"
          >
            Zkontrolovat a potvrdit apply
          </button>
          {ambiguous && pending ? (
            <button
              className={styles.secondaryButton}
              disabled={busy !== null}
              onClick={() => void submitPending(pending)}
              type="button"
            >
              Zopakovat přesně stejný pokus
            </button>
          ) : null}
        </section>
      ) : null}

      {report ? (
        <section className={styles.success} role="status">
          <h2>
            {report.outcome === 'already_applied'
              ? 'Server potvrdil dříve dokončený import'
              : 'Import byl aplikován'}
          </h2>
          <p>
            Vytvořeno {report.result.created}, změněno{' '}
            {report.result.statusChanged}, beze změny {report.result.unchanged}.
            Audit: <code>{report.audit.auditId}</code>
          </p>
        </section>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem immutable preview, jeho verzi a uvedený dopad."
          confirmLabel="Aplikovat import"
          danger
          description="Server aplikuje přesně tuto verzi preview. Opakování stejného pokusu používá stejný idempotency klíč."
          impact={
            <p>
              {pending.body.expectedImpact.new} nových ·{' '}
              {pending.body.expectedImpact.statusChanged} změn stavu
            </p>
          }
          onConfirm={() => void submitPending(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title="Aplikovat import vstupenek?"
        />
      ) : null}
    </div>
  );
};
