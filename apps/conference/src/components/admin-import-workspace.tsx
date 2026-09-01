'use client';

import {
  canApplyTicketImportPreview,
  ticketImportApplyRequestSchema,
  type TicketImportApplyRequest,
  type TicketImportApplyResponse,
  type TicketImportIdentitySource,
  type TicketImportPreviewResponse,
  type TicketImportRowStatus,
} from '@byzon/domain/contracts/ticket-import';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  requestAdminTicketImportApply,
  requestAdminTicketImportPreview,
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

const formatTicketState = (state: string | null): string =>
  state === null
    ? '—'
    : state === 'active'
      ? 'Aktivní'
      : state === 'blocked'
        ? 'Blokovaná'
        : state === 'refunded'
          ? 'Refundovaná'
          : 'Zrušená';

const sourceStatusLabels = {
  paid: 'Uhrazeno',
  unpaid: 'Neuhrazeno',
  cancelled: 'Storno',
  refunded: 'Refund',
  unknown: 'Neznámý',
} as const;

const identitySourceLabels: Record<TicketImportIdentitySource, string> = {
  named_participant: 'Účastník z „prodeje na jméno“',
  single_paid_ticket_buyer: 'Kupující = účastník (1 uhrazená vstupenka)',
  manual_review: 'Kontakt kupujícího · vyžaduje ruční přiřazení',
};

const companyAndPosition = (row: {
  readonly contactCompany: string | null;
  readonly contactPosition: string | null;
}): string | null => {
  const values = [row.contactCompany, row.contactPosition].filter(
    (value): value is string => value !== null,
  );
  return values.length > 0 ? values.join(' · ') : null;
};

const purchaseDateFormatter = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeZone: 'Europe/Prague',
});

const formatPurchaseDate = (value: string): string =>
  purchaseDateFormatter.format(new Date(`${value}T12:00:00Z`));

export const AdminImportWorkspace = () => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const applyErrorSummaryRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<TicketImportPreviewResponse | null>(
    null,
  );
  const [report, setReport] = useState<TicketImportApplyResponse | null>(null);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<'upload' | 'apply' | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PendingApply | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [previewState, setPreviewState] = useState<
    'idle' | 'loading' | 'validated' | 'error'
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

  const loadPreview = async (staleMessage?: string) => {
    const request = requestFence.begin('import-preview');
    setBusy('preview');
    setPreviewState('loading');
    setError(null);
    setErrorScope(null);
    setPreview(null);
    setReport(null);
    setPending(null);
    setAmbiguous(false);
    try {
      const result = await requestAdminTicketImportPreview(
        api,
        eventId,
        request.signal,
      );
      if (!request.isCurrent()) return;
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
        setPreviewState('error');
        return;
      }
      if (result.kind === 'success') {
        setPreview(result.data);
        setPreviewState('validated');
        setFilter('all');
        setReason('');
        setAttempted(false);
        if (staleMessage) {
          setErrorScope('apply');
          setError(staleMessage);
        }
      }
    } catch {
      if (!request.isCurrent()) return;
      setError(
        'SimpleShop preview se nepodařilo bezpečně načíst. Zkuste akci zopakovat.',
      );
      setErrorScope('upload');
      setPreviewState('error');
    } finally {
      if (request.isCurrent()) {
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
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        await loadPreview(
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
        <h1>Import účastníků</h1>
        <p>
          Načtěte účastníky serverovým read-only API spojením se SimpleShopem.
          Chráněné provozní preview zobrazuje organizátorovi identifikační a
          kontaktní údaje, ale v tomto kroku nevytváří účty, přístupy ani
          e-mailové pozvánky.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="import-upload-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="import-upload-title">1. Read-only načtení a validace</h2>
            <p className={styles.muted}>
              Přístupové údaje zůstávají na serveru. SimpleShop obdrží pouze
              allowlistované GET požadavky na produkt a export Kdo koupil.
            </p>
          </div>
          <span className={styles.badge}>SimpleShop · pouze GET</span>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.button}
            disabled={busy !== null || pending !== null}
            onClick={() => void loadPreview()}
            type="button"
          >
            {busy === 'preview'
              ? 'SimpleShop se načítá…'
              : 'Načíst ze SimpleShopu'}
          </button>
        </div>
        <div
          aria-busy={previewState === 'loading'}
          aria-live="polite"
          className={styles.progress}
          role="status"
        >
          {previewState === 'loading' ? (
            <>
              <progress aria-label="Read-only načítání SimpleShop preview" />
              <span>Server načítá a sanitizuje SimpleShop preview…</span>
            </>
          ) : previewState === 'validated' ? (
            <span>Sanitizované serverové preview je připravené.</span>
          ) : previewState === 'error' ? (
            <span>Načtení nebo validace SimpleShop dat selhaly.</span>
          ) : (
            <span>Načtení proběhne až po výslovném stisknutí tlačítka.</span>
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
          {preview.source.kind === 'simpleshop_api' ? (
            <div
              className={styles.summaryGrid}
              aria-label="Sanitizovaný souhrn SimpleShop zdroje"
            >
              <div className={styles.metric}>
                <small>Zdroj / účastnické řádky</small>
                <strong>
                  {preview.source.sourceRows} / {preview.source.ticketRows}
                </strong>
              </div>
              <div className={styles.metric}>
                <small>Souhrnné řádky / množství &gt; 1</small>
                <strong>
                  {preview.source.ignoredSummaryRows} /{' '}
                  {preview.source.multipleQuantitySummaryRows}
                </strong>
              </div>
              <div className={styles.metric}>
                <small>Uhrazeno / neuhrazeno</small>
                <strong>
                  {preview.source.observedStatuses.paid} /{' '}
                  {preview.source.observedStatuses.unpaid}
                </strong>
              </div>
              <div className={styles.metric}>
                <small>Storno / refund / neznámé</small>
                <strong>
                  {preview.source.observedStatuses.cancelled} /{' '}
                  {preview.source.observedStatuses.refunded} /{' '}
                  {preview.source.observedStatuses.unknown}
                </strong>
              </div>
            </div>
          ) : null}
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
          <p className={styles.callout}>
            Preview obsahuje osobní údaje pro troubleshooting. Je dostupné jen
            oprávněnému administrátorovi, neposílá se do cache ani browserového
            úložiště a jeho načtení se zapisuje do auditu.
          </p>
          <div
            aria-label="Tabulka chráněného preview importu; vodorovně posouvatelná"
            className={styles.tableWrap}
            tabIndex={0}
          >
            <table className={`${styles.table} ${styles.importTable}`}>
              <caption>
                Chráněný immutable rozdíl importu se jmény a kontakty.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Řádek</th>
                  <th scope="col">Účastník</th>
                  <th scope="col">SimpleShop reference</th>
                  <th scope="col">Nákup</th>
                  <th scope="col">Zdrojový stav</th>
                  <th scope="col">Stav</th>
                  <th scope="col">Původní → nový</th>
                  <th scope="col">Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>{row.sourceRowNumber}</td>
                    <td className={styles.identityCell}>
                      <strong>{row.contactName ?? 'Jméno neuvedeno'}</strong>
                      <span>{row.contactEmail ?? 'E-mail neuveden'}</span>
                      <small>{identitySourceLabels[row.identitySource]}</small>
                      {companyAndPosition(row) ? (
                        <small>{companyAndPosition(row)}</small>
                      ) : null}
                      {row.contactPhone ? (
                        <small>{row.contactPhone}</small>
                      ) : null}
                    </td>
                    <td className={styles.referenceCell}>
                      <span>Vstupenka {row.sourceTicketId}</span>
                      <small>Doklad {row.sourceOrderId}</small>
                      <small>Preview •{row.referenceSuffix}</small>
                    </td>
                    <td className={styles.purchaseCell}>
                      <strong>
                        <time dateTime={row.purchasedOn}>
                          {formatPurchaseDate(row.purchasedOn)}
                        </time>
                      </strong>
                      <small>
                        {row.discountCoupon
                          ? `Kupón ${row.discountCoupon}`
                          : 'Bez slevového kupónu'}
                      </small>
                    </td>
                    <td>{sourceStatusLabels[row.sourceStatus]}</td>
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
                      Řádek {row.sourceRowNumber} ·{' '}
                      {row.contactName ?? 'Jméno neuvedeno'}
                    </strong>
                    <span
                      className={`${styles.statusBadge} ${statusClass[row.status]}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  </div>
                  <dl>
                    <dt>E-mail</dt>
                    <dd>{row.contactEmail ?? 'Neuveden'}</dd>
                    <dt>Zdroj identity</dt>
                    <dd>{identitySourceLabels[row.identitySource]}</dd>
                    {companyAndPosition(row) ? (
                      <>
                        <dt>Firma / pozice</dt>
                        <dd>{companyAndPosition(row)}</dd>
                      </>
                    ) : null}
                    {row.contactPhone ? (
                      <>
                        <dt>Telefon</dt>
                        <dd>{row.contactPhone}</dd>
                      </>
                    ) : null}
                    <dt>SimpleShop reference</dt>
                    <dd>
                      Vstupenka {row.sourceTicketId} · doklad{' '}
                      {row.sourceOrderId} · preview •{row.referenceSuffix}
                    </dd>
                    <dt>Datum nákupu</dt>
                    <dd>
                      <time dateTime={row.purchasedOn}>
                        {formatPurchaseDate(row.purchasedOn)}
                      </time>
                    </dd>
                    <dt>Slevový kupón</dt>
                    <dd>{row.discountCoupon ?? 'Bez slevového kupónu'}</dd>
                    <dt>Stav</dt>
                    <dd>
                      {formatTicketState(row.currentState)} →{' '}
                      {formatTicketState(row.incomingState)}
                    </dd>
                    <dt>Zdrojový stav</dt>
                    <dd>{sourceStatusLabels[row.sourceStatus]}</dd>
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
              {preview.source.kind === 'simpleshop_api'
                ? 'Toto je výhradně read-only SimpleShop preview. Apply není součástí P4-02 a server jej nenabízí.'
                : 'Preview obsahuje konflikt nebo neznámý stav. Opravte zdroj; apply je fail-closed.'}
            </p>
          ) : null}
          {preview.source.kind === 'file' ? (
            <>
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
            </>
          ) : null}
        </section>
      ) : null}

      {report && preview?.source.kind === 'file' ? (
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

      {confirming && pending && preview?.source.kind === 'file' ? (
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
