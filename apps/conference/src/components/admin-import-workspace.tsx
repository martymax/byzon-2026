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
import { AdminTechnicalDetails } from '@byzon/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  requestAdminTicketImportApply,
  requestAdminTicketImportPreview,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { adminCountForms, formatCzechCount } from './admin-copy';
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
  new: 'Nová vstupenka',
  unchanged: 'Beze změny',
  status_changed: 'Změněný stav',
  excluded: 'Vyžaduje opravu',
  conflict: 'Vyžaduje opravu',
  unknown: 'Nerozpoznáno',
};

const statusClass: Record<TicketImportRowStatus, string> = {
  new: styles.statusNew!,
  unchanged: styles.statusUnchanged!,
  status_changed: styles.statusChanged!,
  excluded: styles.statusAttention!,
  conflict: styles.statusConflict!,
  unknown: styles.statusUnknown!,
};

const filterOptions = [
  ['needs_attention', 'Vyžaduje opravu'],
  ['all', 'Vše'],
  ['new', 'Nové'],
  ['unchanged', 'Beze změny'],
  ['status_changed', 'Změny stavu'],
  ['excluded', 'Nebude použito'],
  ['conflict', 'Konflikt'],
  ['unknown', 'Nerozpoznáno'],
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

const checkedAtFormatter = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Prague',
});

const addedTicketLabel = (count: number): string =>
  count === 1
    ? '1 vstupenku'
    : count >= 2 && count <= 4
      ? `${count} vstupenky`
      : `${count} vstupenek`;

const unchangedTicketLabel = (count: number): string =>
  count === 1 ? '1 zůstane beze změny' : `${count} zůstane beze změny`;

const changedTicketLabel = (count: number): string =>
  count === 1 ? '1 vstupenky' : `${count} vstupenek`;

export interface AdminTicketUpdatePort {
  readonly preview: typeof requestAdminTicketImportPreview;
  readonly apply: typeof requestAdminTicketImportApply;
}

const productionTicketUpdatePort: AdminTicketUpdatePort = {
  preview: requestAdminTicketImportPreview,
  apply: requestAdminTicketImportApply,
};

export const AdminImportWorkspace = ({
  port = productionTicketUpdatePort,
}: {
  readonly port?: AdminTicketUpdatePort;
} = {}) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const applyErrorSummaryRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<TicketImportPreviewResponse | null>(
    null,
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
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
        ({ status }) =>
          filter === 'all' ||
          (filter === 'needs_attention'
            ? ['excluded', 'conflict', 'unknown'].includes(status)
            : status === filter),
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
      const result = await port.preview(api, eventId, request.signal);
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
        setLastCheckedAt(result.data.createdAt);
        setPreviewState('validated');
        setFilter(
          result.data.summary.excluded +
            result.data.summary.conflict +
            result.data.summary.unknown >
            0
            ? 'needs_attention'
            : 'all',
        );
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
        'Změny ze SimpleShopu se nepodařilo bezpečně načíst. Zkuste akci zopakovat.',
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
    const result = await port.apply(
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

  const backToSource = () => {
    setPreview(null);
    setReport(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setReason('');
    setAttempted(false);
    setError(null);
    setErrorScope(null);
    setFilter('all');
    setPreviewState('idle');
  };

  const currentStep = report
    ? 4
    : preview?.source.kind === 'file'
      ? 3
      : preview
        ? 2
        : 1;
  const blockingCount = preview
    ? preview.summary.excluded +
      preview.summary.conflict +
      preview.summary.unknown
    : 0;
  const noChanges = preview
    ? preview.summary.new === 0 && preview.summary.statusChanged === 0
    : false;
  const impactText = preview
    ? `Přidá ${addedTicketLabel(preview.summary.new)}, změní stav u ${changedTicketLabel(preview.summary.statusChanged)}, ${unchangedTicketLabel(preview.summary.unchanged)}.`
    : '';

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Účastníci a vstupenky</p>
        <h1>Aktualizace vstupenek</h1>
        <p>
          Načtěte změny ze SimpleShopu, zkontrolujte jejich dopad a použijte jen
          přesně ověřenou dávku. Samotné načtení nic nemění.
        </p>
      </header>

      <nav aria-label="Postup aktualizace vstupenek">
        <ol className={styles.importSteps}>
          {[
            'Načíst ze SimpleShopu',
            'Zkontrolovat změny',
            'Potvrdit změny',
            'Výsledek',
          ].map((label, index) => {
            const step = index + 1;
            const state =
              step === currentStep
                ? 'current'
                : step < currentStep
                  ? 'complete'
                  : 'pending';
            return (
              <li
                aria-current={state === 'current' ? 'step' : undefined}
                data-state={state}
                key={label}
              >
                <span>{step}</span>
                <strong>{label}</strong>
                <small>
                  {state === 'complete'
                    ? 'Dokončeno'
                    : state === 'current'
                      ? 'Právě řešíte'
                      : 'Následuje'}
                </small>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className={styles.panel} aria-labelledby="ticket-source-title">
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Krok 1</p>
            <h2 id="ticket-source-title">Zdroj vstupenek</h2>
            <p className={styles.muted}>
              Připojený zdroj: <strong>SimpleShop</strong>. Přístupové údaje
              zůstávají bezpečně na serveru.
            </p>
            <p className={styles.muted}>
              {lastCheckedAt
                ? `Poslední kontrola ${checkedAtFormatter.format(new Date(lastCheckedAt))}.`
                : 'V této relaci zatím neproběhla žádná kontrola.'}
            </p>
          </div>
          <span className={styles.badge}>Načtení pouze pro kontrolu</span>
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
              : previewState === 'error'
                ? 'Zkusit načíst znovu'
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
              <progress aria-label="Načítání změn ze SimpleShopu" />
              <span>Server načítá a bezpečně kontroluje změny…</span>
            </>
          ) : previewState === 'validated' ? (
            <span>Změny jsou načtené a připravené ke kontrole.</span>
          ) : previewState === 'error' ? (
            <span>Změny se nepodařilo načíst nebo ověřit.</span>
          ) : (
            <span>Načtení začne až po stisknutí tlačítka.</span>
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
              <p className={styles.eyebrow}>Krok 2</p>
              <h2 id="import-preview-title">Zkontrolovat změny</h2>
            </div>
            <span className={styles.badge}>
              {formatCzechCount(preview.summary.total, adminCountForms.record)}
            </span>
          </div>

          {blockingCount > 0 ? (
            <div className={styles.warning} role="alert">
              <strong>
                Opravu ve zdroji prodeje vyžaduje:{' '}
                {formatCzechCount(blockingCount, adminCountForms.record)}.
              </strong>{' '}
              Dokud je neopravíte a změny znovu nenačtete, dávku nelze použít.
            </div>
          ) : noChanges ? (
            <p className={styles.callout} role="status">
              Od poslední kontroly nejsou žádné nové změny.
            </p>
          ) : (
            <p className={styles.callout} role="status">
              Kontrola je hotová. Před pokračováním projděte souhrn i jednotlivé
              záznamy.
            </p>
          )}

          <div className={styles.summaryGrid} aria-label="Souhrn změn">
            <div className={styles.metric}>
              <small>Nové vstupenky</small>
              <strong>{preview.summary.new}</strong>
            </div>
            <div className={styles.metric}>
              <small>Beze změny</small>
              <strong>{preview.summary.unchanged}</strong>
            </div>
            <div className={styles.metric}>
              <small>Změněný stav</small>
              <strong>{preview.summary.statusChanged}</strong>
            </div>
            <div className={styles.metric}>
              <small>Vyžaduje opravu</small>
              <strong>{preview.summary.excluded}</strong>
            </div>
            <div className={styles.metric}>
              <small>Konflikt / nerozpoznáno</small>
              <strong>
                {preview.summary.conflict} / {preview.summary.unknown}
              </strong>
            </div>
          </div>

          <label className={styles.field}>
            <span>Filtrovat záznamy</span>
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
            Údaje slouží pouze ke kontrole oprávněným administrátorem.
            Neukládají se do cache prohlížeče a načtení se zapisuje do historie
            změn.
          </p>
          <div
            aria-label="Tabulka kontroly změn vstupenek"
            className={styles.tableWrap}
            tabIndex={0}
          >
            <table className={`${styles.table} ${styles.importTable}`}>
              <caption>Záznamy načtené ze SimpleShopu ke kontrole.</caption>
              <thead>
                <tr>
                  <th scope="col">Záznam</th>
                  <th scope="col">Účastník</th>
                  <th scope="col">Co se změní</th>
                  <th scope="col">Výsledek kontroly</th>
                  <th scope="col">Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      #{row.sourceRowNumber} · •{row.referenceSuffix}
                    </td>
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
                    <td>
                      {formatTicketState(row.currentState)} →{' '}
                      {formatTicketState(row.incomingState)}
                    </td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${statusClass[row.status]}`}
                      >
                        {statusLabels[row.status]}
                      </span>
                      <small>{sourceStatusLabels[row.sourceStatus]}</small>
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
            <ul className={styles.cardList} aria-label="Záznamy změn vstupenek">
              {visibleRows.map((row) => (
                <li className={styles.dataCard} key={row.rowId}>
                  <div className={styles.panelHeader}>
                    <strong>
                      Záznam #{row.sourceRowNumber} ·{' '}
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
                    <dt>Reference</dt>
                    <dd>•{row.referenceSuffix}</dd>
                    <dt>Datum nákupu</dt>
                    <dd>
                      <time dateTime={row.purchasedOn}>
                        {formatPurchaseDate(row.purchasedOn)}
                      </time>
                    </dd>
                    <dt>Co se změní</dt>
                    <dd>
                      {formatTicketState(row.currentState)} →{' '}
                      {formatTicketState(row.incomingState)}
                    </dd>
                    <dt>Výsledek kontroly</dt>
                    <dd>
                      {statusLabels[row.status]} ·{' '}
                      {sourceStatusLabels[row.sourceStatus]}
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

          <div className={styles.actionRow}>
            <button
              className={styles.secondaryButton}
              disabled={busy !== null || pending !== null}
              onClick={backToSource}
              type="button"
            >
              Zpět ke zdroji
            </button>
            <button
              className={styles.secondaryButton}
              disabled={busy !== null || pending !== null}
              onClick={() => void loadPreview()}
              type="button"
            >
              Načíst změny znovu
            </button>
          </div>

          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID kontroly</dt>
              <dd>{preview.previewId}</dd>
              <dt>Verze kontroly</dt>
              <dd>{preview.previewVersion}</dd>
              <dt>Vytvořeno</dt>
              <dd>{checkedAtFormatter.format(new Date(preview.createdAt))}</dd>
              {preview.source.kind === 'simpleshop_api' ? (
                <>
                  <dt>Zdrojových / účastnických záznamů</dt>
                  <dd>
                    {preview.source.sourceRows} / {preview.source.ticketRows}
                  </dd>
                  <dt>Přeskočených souhrnných záznamů</dt>
                  <dd>{preview.source.ignoredSummaryRows}</dd>
                </>
              ) : null}
            </dl>
          </AdminTechnicalDetails>

          {!canApplyTicketImportPreview(preview) ? (
            <p className={styles.warning} role="alert">
              {preview.source.kind === 'simpleshop_api'
                ? 'Kontrola ze SimpleShopu je bezpečně dostupná. Použití změn se zobrazí až po dokončení navazujícího serverového propojení.'
                : 'Dávka obsahuje záznam, který vyžaduje opravu. Opravte jej ve zdroji a změny znovu načtěte.'}
            </p>
          ) : null}
          {preview.source.kind === 'file' && !report ? (
            <section
              aria-labelledby="ticket-confirm-title"
              className={styles.importConfirmSection}
            >
              <p className={styles.eyebrow}>Krok 3</p>
              <h2 id="ticket-confirm-title">Potvrdit změny</h2>
              <p>{impactText}</p>
              {applyValidationFailed || (error && errorScope === 'apply') ? (
                <section
                  className={styles.errorSummary}
                  ref={applyErrorSummaryRef}
                  role="alert"
                  tabIndex={-1}
                >
                  <h3>Změny zatím nelze potvrdit</h3>
                  <p id="admin-import-apply-error">
                    {error && errorScope === 'apply'
                      ? error
                      : 'Doplňte důvod změny o nejméně 8 viditelných znaků.'}
                  </p>
                </section>
              ) : null}
              <label className={styles.field} htmlFor="admin-import-reason">
                <span>Důvod aktualizace</span>
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
                  Uloží se do historie změn. Napište alespoň 8 znaků.
                </span>
              </label>
              <button
                className={styles.button}
                disabled={!canPrepareApply || busy !== null || pending !== null}
                onClick={prepareApply}
                type="button"
              >
                Použít změny
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
        </section>
      ) : null}

      {report && preview?.source.kind === 'file' ? (
        <section className={styles.success} role="status">
          <p className={styles.eyebrow}>Krok 4</p>
          <h2>
            {report.outcome === 'already_applied'
              ? 'Server potvrdil dříve dokončenou aktualizaci'
              : 'Změny vstupenek byly použity'}
          </h2>
          <p>
            Přidáno {report.result.created}, změněn stav{' '}
            {report.result.statusChanged}, beze změny {report.result.unchanged}.
          </p>
          <Link href="/admin/ucastnici" prefetch={false}>
            Zobrazit účastníky
          </Link>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>Reference historie změn</dt>
              <dd>{report.audit.auditId}</dd>
              <dt>Verze kontroly</dt>
              <dd>{report.previewVersion}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      {confirming && pending && preview?.source.kind === 'file' ? (
        <AdminConfirmDialog
          acknowledgement="Zkontroloval/a jsem uvedený dopad a správnost změn."
          confirmLabel="Použít změny"
          description="Server použije právě zkontrolovanou verzi změn. Pokud už není aktuální, operaci bezpečně odmítne."
          impact={<p>{impactText}</p>}
          onConfirm={() => void submitPending(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title="Použít tyto změny vstupenek?"
        />
      ) : null}
    </div>
  );
};
