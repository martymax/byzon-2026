'use client';

import { useMemo, useState, type ChangeEvent } from 'react';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminReasonSchema,
  adminUploadFileNameSchema,
  applyTicketImportPreview,
  canApplyTicketImport,
  ticketImportApplyRequestSchema,
  type ImportRowStatus,
  type TicketImportPreview,
  type TicketImportReport,
} from './admin-workspace-contracts';
import {
  demoImportPreview,
  demoImportPreviewWithConflict,
  demoImportPreviewWithUnknown,
} from './admin-workspace-demo-data';
import { useAdminWorkspaceScope } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const statusLabels: Record<ImportRowStatus, string> = {
  new: 'Nová',
  unchanged: 'Beze změny',
  status_changed: 'Změna stavu',
  conflict: 'Konflikt',
  unknown: 'Neznámý stav',
};

const statusClass: Record<ImportRowStatus, string> = {
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

const formatState = (state: string | null) => {
  if (state === 'active') return 'Aktivní';
  if (state === 'blocked') return 'Blokovaná';
  if (state === 'cancelled') return 'Zrušená';
  return '—';
};

const safeFileNameForDisplay = (fileName: string) =>
  fileName
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '�')
    .slice(0, 180);

export const AdminImportWorkspace = ({
  initialMode = 'empty',
}: {
  readonly initialMode?: 'empty' | 'known' | 'conflict' | 'unknown';
}) => {
  const scope = useAdminWorkspaceScope();
  const [preview, setPreview] = useState<TicketImportPreview | null>(() =>
    initialMode === 'known'
      ? demoImportPreview
      : initialMode === 'conflict'
        ? demoImportPreviewWithConflict
        : initialMode === 'unknown'
          ? demoImportPreviewWithUnknown
          : null,
  );
  const [fileState, setFileState] = useState<
    | { readonly kind: 'empty' }
    | {
        readonly kind: 'selected';
        readonly fileName: string;
        readonly kindLabel: 'CSV' | 'XLSX';
      }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'empty' });
  const [progress, setProgress] = useState(preview ? 100 : 0);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<TicketImportReport | null>(null);

  const visibleRows = useMemo(
    () =>
      preview?.rows.filter(
        ({ status }) => filter === 'all' || status === filter,
      ) ?? [],
    [filter, preview],
  );
  const applyAllowed = preview ? canApplyTicketImport(preview) : false;
  const reasonInvalid =
    attempted && !adminReasonSchema.safeParse(reason).success;

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setReport(null);
    setProgress(0);
    if (!file) {
      setFileState({ kind: 'empty' });
      return;
    }
    if (!adminUploadFileNameSchema.safeParse(file.name).success) {
      setFileState({
        kind: 'error',
        message:
          'Název souboru obsahuje nepovolené nebo matoucí znaky. Soubor přejmenujte.',
      });
      return;
    }
    const extension = file.name.toLowerCase().split('.').at(-1);
    if (extension !== 'csv' && extension !== 'xlsx') {
      setFileState({
        kind: 'error',
        message: 'Podporované jsou pouze soubory CSV a XLSX do 10 MB.',
      });
      return;
    }
    if (file.size < 1) {
      setFileState({
        kind: 'error',
        message: 'Prázdný soubor nelze validovat.',
      });
      return;
    }
    if (file.size > 10_000_000) {
      setFileState({
        kind: 'error',
        message: 'Soubor překračuje bezpečný limit 10 MB.',
      });
      return;
    }
    const expectedMediaTypes =
      extension === 'csv'
        ? ['text/csv', 'application/vnd.ms-excel']
        : ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (file.type && !expectedMediaTypes.includes(file.type.toLowerCase())) {
      setFileState({
        kind: 'error',
        message:
          'Přípona a typ souboru si neodpovídají. Vyberte původní CSV nebo XLSX.',
      });
      return;
    }
    setFileState({
      kind: 'selected',
      fileName: safeFileNameForDisplay(file.name),
      kindLabel: extension === 'csv' ? 'CSV' : 'XLSX',
    });
    setProgress(35);
  };

  const createPreview = (nextPreview: TicketImportPreview) => {
    setFileState({
      kind: 'selected',
      fileName: nextPreview.source.fileName,
      kindLabel: nextPreview.source.mediaType === 'text/csv' ? 'CSV' : 'XLSX',
    });
    setProgress(100);
    setPreview(nextPreview);
    setFilter('all');
    setReason('');
    setAttempted(false);
    setConfirming(false);
    setReport(null);
  };

  const requestConfirmation = () => {
    setAttempted(true);
    if (
      !preview ||
      !applyAllowed ||
      !adminReasonSchema.safeParse(reason).success
    )
      return;
    setConfirming(true);
  };

  const confirmApply = () => {
    if (!preview) return;
    const request = ticketImportApplyRequestSchema.parse({
      eventId: scope.eventId,
      previewId: preview.previewId,
      previewVersion: preview.previewVersion,
      expectedImpact: preview.summary,
      reason,
      idempotencyKey: `mock-import-${preview.previewId}`,
    });
    setReport(applyTicketImportPreview(preview, request));
    setConfirming(false);
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · bezpečný import</p>
        <h1>Import vstupenek</h1>
        <p>
          Nahrajte CSV nebo XLSX, ověřte staging diff a teprve nad neměnnou
          verzí potvrďte dopad. Demo adaptér nezná žádné vendorové názvy
          sloupců.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="import-upload-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="import-upload-title">1. Soubor a validace</h2>
            <p className={styles.muted}>
              Obsah souboru se v tomto režimu neposílá mimo prohlížeč.
            </p>
          </div>
          <span className={styles.badge}>CSV / XLSX · max. 10 MB</span>
        </div>
        <label className={styles.field}>
          <span>Zdrojový soubor</span>
          <input
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={selectFile}
            type="file"
          />
          <span className={styles.helper}>
            Prohlížeč předběžně porovná příponu a dostupný MIME typ. Skutečný
            typ, obsah i checksum musí autoritativně ověřit server v karanténě.
          </span>
        </label>
        {fileState.kind === 'error' ? (
          <p className={styles.warning} role="alert">
            {fileState.message}
          </p>
        ) : null}
        {fileState.kind === 'selected' ? (
          <p>
            Vybráno: <strong>{fileState.fileName}</strong> · rozpoznáno jako{' '}
            {fileState.kindLabel}
          </p>
        ) : null}
        <div className={styles.progress}>
          <label htmlFor="admin-import-progress">Průběh staging validace</label>
          <progress id="admin-import-progress" max={100} value={progress} />
          <span aria-live="polite">
            {progress === 0
              ? 'Čeká na soubor.'
              : progress < 100
                ? 'Předběžná kontrola prošla; čeká serverová validace typu a obsahu.'
                : 'Validace dokončena, immutable preview je připravené.'}
          </span>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.button}
            disabled={fileState.kind !== 'selected' || progress === 100}
            onClick={() =>
              createPreview(
                fileState.kind === 'selected' &&
                  fileState.fileName.toLowerCase().includes('unknown')
                  ? demoImportPreviewWithUnknown
                  : fileState.kind === 'selected' &&
                      fileState.fileName.toLowerCase().includes('conflict')
                    ? demoImportPreviewWithConflict
                    : demoImportPreview,
              )
            }
            type="button"
          >
            Vytvořit validované preview
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => createPreview(demoImportPreview)}
            type="button"
          >
            Načíst syntetický CSV scénář
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => createPreview(demoImportPreviewWithConflict)}
            type="button"
          >
            Simulovat konflikt
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => createPreview(demoImportPreviewWithUnknown)}
            type="button"
          >
            Simulovat neznámý stav
          </button>
        </div>
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
                Neměnná verze: <code>{preview.previewVersion}</code>
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
              <small>Změny stavu</small>
              <strong>{preview.summary.statusChanged}</strong>
            </div>
            <div className={styles.metric}>
              <small>Konflikty</small>
              <strong>{preview.summary.conflict}</strong>
            </div>
            <div className={styles.metric}>
              <small>Neznámé</small>
              <strong>{preview.summary.unknown}</strong>
            </div>
          </div>
          <div
            aria-label="Filtr staging diffu"
            className={styles.filters}
            role="group"
          >
            {filterOptions.map(([value, label]) => (
              <button
                aria-pressed={filter === value}
                className={styles.filterButton}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>
                Validované změny; kontakty jsou maskované a konflikt zablokuje
                celý apply.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Účastník</th>
                  <th scope="col">Výsledek diffu</th>
                  <th scope="col">Původní → nový stav</th>
                  <th scope="col">Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>{row.sourceReference}</td>
                    <td>
                      {row.displayName}
                      <br />
                      <span className={styles.muted}>{row.maskedContact}</span>
                    </td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${statusClass[row.status]}`}
                      >
                        {statusLabels[row.status]}
                      </span>
                    </td>
                    <td>
                      {formatState(row.currentState)} →{' '}
                      {formatState(row.incomingState)}
                    </td>
                    <td>{row.issues.join(' ') || 'Bez upozornění.'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.cards}>
            <ul className={styles.cardList} aria-label="Změny importu">
              {visibleRows.map((row) => (
                <li className={styles.dataCard} key={row.rowId}>
                  <div className={styles.panelHeader}>
                    <strong>{row.sourceReference}</strong>
                    <span
                      className={`${styles.statusBadge} ${statusClass[row.status]}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  </div>
                  <dl>
                    <dt>Účastník</dt>
                    <dd>
                      {row.displayName} · {row.maskedContact}
                    </dd>
                    <dt>Změna</dt>
                    <dd>
                      {formatState(row.currentState)} →{' '}
                      {formatState(row.incomingState)}
                    </dd>
                    <dt>Poznámka</dt>
                    <dd>{row.issues.join(' ') || 'Bez upozornění.'}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </div>
          {visibleRows.length === 0 ? (
            <p className={styles.empty}>Filtru neodpovídá žádný řádek.</p>
          ) : null}
        </section>
      ) : null}

      {preview ? (
        <section className={styles.panel} aria-labelledby="import-apply-title">
          <h2 id="import-apply-title">3. Potvrzení a report</h2>
          <p className={styles.warning}>
            Toto je neprodukční mock apply. Konflikt i neznámý status zablokují
            celý apply a nic se nezmění.
          </p>
          {!applyAllowed ? (
            <p className={styles.errorSummary} role="alert">
              Apply je zakázán: preview obsahuje konflikt nebo neznámý stav.
              Opravte zdroj a vytvořte novou immutable verzi.
            </p>
          ) : null}
          {reasonInvalid ? (
            <section
              aria-labelledby="import-errors-title"
              className={styles.errorSummary}
              role="alert"
            >
              <h2 id="import-errors-title">Doplňte povinné údaje</h2>
              <a href="#import-reason">Uveďte důvod mock apply.</a>
            </section>
          ) : null}
          <label className={styles.field}>
            <span>Důvod změny</span>
            <textarea
              aria-describedby="import-reason-help"
              aria-invalid={reasonInvalid}
              id="import-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper} id="import-reason-help">
              Důvod je součástí výsledného auditu; nevkládejte osobní údaje.
            </span>
          </label>
          <button
            className={styles.button}
            disabled={!applyAllowed || report !== null}
            onClick={requestConfirmation}
            type="button"
          >
            Zkontrolovat dopad mock apply
          </button>
          {report ? (
            <section
              aria-live="polite"
              className={`${styles.success} ${styles.result}`}
            >
              <h3>Mock report je hotový</h3>
              <p>
                Aplikováno {report.applied}, beze změny {report.unchanged},
                přeskočené konflikty {report.skippedConflicts}. Audit:{' '}
                <code>{report.auditId}</code>.
              </p>
              <p>
                Preview <code>{report.previewVersion}</code> nebylo po potvrzení
                změněno.
              </p>
            </section>
          ) : null}
        </section>
      ) : null}

      {confirming && preview ? (
        <AdminConfirmDialog
          acknowledgement={`Potvrzuji neprodukční mock apply verze ${preview.previewVersion}.`}
          confirmLabel="Použít pouze v mock režimu"
          description="Potvrzujete přesný dopad neměnného staging preview. Tato ukázka nemění produkční vstupenky."
          impact={
            <dl className={styles.detailList}>
              <dt>Nové</dt>
              <dd>{preview.summary.new}</dd>
              <dt>Změny stavu</dt>
              <dd>{preview.summary.statusChanged}</dd>
              <dt>Přeskočené konflikty</dt>
              <dd>{preview.summary.conflict}</dd>
              <dt>Verze</dt>
              <dd>{preview.previewVersion}</dd>
            </dl>
          }
          onConfirm={confirmApply}
          onDismiss={() => setConfirming(false)}
          title="Potvrdit neměnný dopad importu?"
        />
      ) : null}
    </div>
  );
};
