'use client';

import {
  adminExportJobListResponseSchema,
  adminExportRequestSchema,
  type AdminExportJob,
  type AdminExportJobListQuery,
  type AdminExportJobListResponse,
  type AdminExportReport,
  type AdminExportRequest,
} from '@byzon/domain/contracts/admin';
import { AdminConfirmDialog, AdminTechnicalDetails } from '@byzon/ui';
import { useEffect, useMemo, useState } from 'react';

import { requestAdminExport, requestAdminExportJobs } from '@/lib/admin-api';

import { zonedLocalToIso } from './admin-content-console';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isAmbiguousAdminMutationFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

export interface AdminExportJobsPort {
  readonly loadJobs: (
    query: AdminExportJobListQuery,
    signal: AbortSignal,
  ) => Promise<AdminExportJobListResponse>;
}

type PendingExport = Readonly<{
  body: AdminExportRequest;
  idempotencyKey: string;
}>;

class AdminReportsReadError extends Error {
  constructor(
    readonly securityFailure: boolean,
    message: string,
  ) {
    super(message);
  }
}

const reportLabels: Record<AdminExportReport, string> = {
  participant_summary: 'Souhrn účastníků',
  checkin_summary: 'Souhrn odbavení',
  reservation_summary: 'Souhrn rezervací',
  audit_log: 'Historie změn',
};

const reportDescriptions: Record<AdminExportReport, string> = {
  participant_summary:
    'Agregovaný provozní přehled účastníků; může obsahovat osobní data.',
  checkin_summary: 'Souhrn průběhu odbavení bez vydávání nových oprávnění.',
  reservation_summary: 'Obsazenost a rezervace aktivit pro provozní kontrolu.',
  audit_log: 'Historie změn provedených oprávněnými uživateli.',
};

const jobStateLabels: Record<AdminExportJob['state'], string> = {
  queued: 'Připravuje se',
  ready: 'Připraven ke stažení',
  failed: 'Nepodařilo se',
  expired: 'Odkaz vypršel',
};

const formatMoment = (value: string, timeZone: string): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));

const formatRange = (
  range: AdminExportJob['range'],
  timeZone: string,
): string =>
  range
    ? `${formatMoment(range.from, timeZone)} – ${formatMoment(range.to, timeZone)}`
    : 'Celá akce';

export const AdminReportsRedesign = ({
  jobsPort,
}: Readonly<{ jobsPort?: AdminExportJobsPort }>) => {
  const { api, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const canExport = permissions.includes('personal-data:operational:export');
  const liveJobsPort = useMemo<AdminExportJobsPort>(
    () =>
      jobsPort ?? {
        loadJobs: async (query, signal) => {
          const result = await requestAdminExportJobs(
            api,
            eventId,
            query,
            signal,
          );
          if (result.kind === 'failure') {
            throw new AdminReportsReadError(
              isAdminSecurityFailure(result),
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
          }
          if (!result.ok || result.kind !== 'success') {
            throw new AdminReportsReadError(
              false,
              'Neaktuální odpověď serveru.',
            );
          }
          return result.data;
        },
      },
    [api, eventId, jobsPort],
  );
  const [report, setReport] = useState<AdminExportReport>(
    'participant_summary',
  );
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [customRange, setCustomRange] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [jobs, setJobs] = useState<AdminExportJobListResponse | null>(null);
  const [pending, setPending] = useState<PendingExport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<'jobs' | 'export' | null>('jobs');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    message: string;
    exportId: string;
    auditId: string;
  } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!canExport) return;
    const request = requestFence.begin('export-jobs');
    void liveJobsPort
      .loadJobs({ limit: 25 }, request.signal)
      .then((response) => {
        if (!request.isCurrent()) return;
        const parsed = adminExportJobListResponseSchema.parse(response);
        if (parsed.eventId !== eventId) throw new Error('Event mismatch.');
        request.finish();
        setJobs(parsed);
        setBusy(null);
      })
      .catch((caught: unknown) => {
        if (!request.isCurrent()) return;
        request.finish();
        setJobs(null);
        setBusy(null);
        if (caught instanceof AdminReportsReadError && caught.securityFailure) {
          invalidateSensitive(caught.message);
          return;
        }
        setError(
          caught instanceof AdminReportsReadError
            ? caught.message
            : 'Historii reportů se nepodařilo bezpečně načíst.',
        );
      });
    return () => requestFence.cancel('export-jobs');
  }, [
    canExport,
    eventId,
    invalidateSensitive,
    liveJobsPort,
    reload,
    requestFence,
  ]);

  let range: AdminExportRequest['range'] = null;
  try {
    if (customRange && from && to) {
      range = {
        from: zonedLocalToIso(from, eventTimezone),
        to: zonedLocalToIso(to, eventTimezone),
      };
    }
  } catch {
    range = null;
  }
  const candidate = adminExportRequestSchema.safeParse({
    report,
    format,
    range: customRange ? range : null,
    reason,
  });
  const invalid = attempted && (!candidate.success || (customRange && !range));

  const prepare = () => {
    setAttempted(true);
    if (!candidate.success || (customRange && !range)) return;
    setPending({
      body: candidate.data,
      idempotencyKey: createAdminIdempotencyKey('export'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingExport) => {
    const request = requestFence.begin('export-create');
    setBusy('export');
    setConfirming(false);
    setError(null);
    const result = await requestAdminExport(
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
        setJobs(null);
        setPending(null);
        setReason('');
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setReceipt({
        message:
          result.data.outcome === 'already_queued'
            ? 'Stejný report už se připravuje. Další úloha nevznikla.'
            : 'Report připravujeme. Na této stránce můžete pokračovat v práci.',
        exportId: result.data.exportId,
        auditId: result.data.audit.auditId,
      });
      setPending(null);
      setAmbiguous(false);
      setReason('');
      setAttempted(false);
      setBusy('jobs');
      setReload((value) => value + 1);
    }
  };

  const loadMoreJobs = async () => {
    if (!jobs?.pageInfo.nextCursor) return;
    const request = requestFence.begin('export-jobs-more');
    setBusy('jobs');
    setError(null);
    try {
      const response = await liveJobsPort.loadJobs(
        { limit: 25, cursor: jobs.pageInfo.nextCursor },
        request.signal,
      );
      if (!request.isCurrent()) return;
      const parsed = adminExportJobListResponseSchema.parse(response);
      if (parsed.eventId !== eventId) throw new Error('Event mismatch.');
      const existing = new Set(jobs.items.map(({ exportId }) => exportId));
      setJobs({
        eventId,
        items: [
          ...jobs.items,
          ...parsed.items.filter(({ exportId }) => !existing.has(exportId)),
        ],
        pageInfo: parsed.pageInfo,
      });
      request.finish();
      setBusy(null);
    } catch (caught) {
      if (!request.isCurrent()) return;
      request.finish();
      setBusy(null);
      if (caught instanceof AdminReportsReadError && caught.securityFailure) {
        setJobs(null);
        invalidateSensitive(caught.message);
        return;
      }
      setError(
        caught instanceof AdminReportsReadError
          ? caught.message
          : 'Další historii reportů se nepodařilo bezpečně načíst.',
      );
    }
  };

  if (!canExport) return null;

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Reporty</h1>
        <p>
          Vyberte obsah a období reportu. Výstup může obsahovat provozní osobní
          data, proto se vytvoření i stažení zapisují do historie změn.
        </p>
      </header>

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-report-error"
          heading="Report zatím nelze připravit"
          message={error}
        />
      ) : null}
      {receipt ? (
        <section className={styles.success} role="status">
          <strong>{receipt.message}</strong>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID exportu</dt>
              <dd>{receipt.exportId}</dd>
              <dt>ID auditu</dt>
              <dd>{receipt.auditId}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="report-create-title">
        <h2 id="report-create-title">Vytvořit report</h2>
        {invalid ? (
          <AdminFormErrorSummary
            descriptionId="admin-report-validation"
            heading="Doplňte údaje reportu"
            message="Zkontrolujte období a napište důvod o nejméně 8 znacích."
          />
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend>Obsah reportu</legend>
          <div className={styles.summaryGrid}>
            {(Object.keys(reportLabels) as AdminExportReport[]).map(
              (option) => (
                <label className={styles.dataCard} key={option}>
                  <input
                    checked={report === option}
                    name="report-type"
                    onChange={() => setReport(option)}
                    type="radio"
                  />
                  <strong>{reportLabels[option]}</strong>
                  <span>{reportDescriptions[option]}</span>
                </label>
              ),
            )}
          </div>
        </fieldset>
        <label className={styles.checkRow}>
          <input
            checked={customRange}
            onChange={(event) => setCustomRange(event.target.checked)}
            type="checkbox"
          />
          <span>Omezit report na vlastní období</span>
        </label>
        {customRange ? (
          <div className={styles.twoColumn}>
            <label className={styles.field}>
              <span>Od ({eventTimezone})</span>
              <input
                onChange={(event) => setFrom(event.target.value)}
                type="datetime-local"
                value={from}
              />
            </label>
            <label className={styles.field}>
              <span>Do ({eventTimezone})</span>
              <input
                onChange={(event) => setTo(event.target.value)}
                type="datetime-local"
                value={to}
              />
            </label>
          </div>
        ) : (
          <p className={styles.helper}>Výchozí období je celá akce.</p>
        )}
        <label className={styles.field}>
          <span>Formát</span>
          <select
            onChange={(event) =>
              setFormat(event.target.value as 'csv' | 'json')
            }
            value={format}
          >
            <option value="csv">CSV · doporučeno</option>
            <option value="json">JSON · pokročilé</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Důvod vytvoření reportu</span>
          <textarea
            aria-invalid={invalid}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
          <span className={styles.helper}>
            Důvod se uloží do historie, protože report může obsahovat provozní
            osobní data.
          </span>
        </label>
        <button
          className={styles.button}
          disabled={busy !== null || pending !== null}
          onClick={prepare}
          type="button"
        >
          Vytvořit report
        </button>
        {ambiguous && pending ? (
          <button
            className={styles.secondaryButton}
            disabled={busy !== null}
            onClick={() => void execute(pending)}
            type="button"
          >
            Zopakovat přesně stejný pokus
          </button>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="report-history-title">
        <h2 id="report-history-title">Historie exportů</h2>
        {busy === 'jobs' && !jobs ? (
          <p role="status">Načítám historii reportů…</p>
        ) : jobs?.items.length === 0 ? (
          <p className={styles.empty}>Zatím nebyl vytvořen žádný report.</p>
        ) : jobs ? (
          <>
            <ul className={styles.cardList}>
              {jobs.items.map((job) => (
                <li className={styles.dataCard} key={job.exportId}>
                  <div className={styles.panelHeader}>
                    <strong>{reportLabels[job.report]}</strong>
                    <span className={styles.statusBadge}>
                      {jobStateLabels[job.state]}
                    </span>
                  </div>
                  <p>
                    {job.createdByLabel} · {job.format.toUpperCase()}
                  </p>
                  <p>Období: {formatRange(job.range, eventTimezone)}</p>
                  <p>
                    Vytvořeno {formatMoment(job.createdAt, eventTimezone)} ·
                    expiruje {formatMoment(job.expiresAt, eventTimezone)}
                  </p>
                  {job.state === 'ready' && job.downloadPath ? (
                    <a className={styles.button} href={job.downloadPath}>
                      Stáhnout
                    </a>
                  ) : null}
                  <AdminTechnicalDetails>
                    <dl className={styles.detailList}>
                      <dt>ID exportu</dt>
                      <dd>{job.exportId}</dd>
                    </dl>
                  </AdminTechnicalDetails>
                </li>
              ))}
            </ul>
            {jobs.pageInfo.hasMore ? (
              <button
                className={styles.secondaryButton}
                disabled={busy !== null}
                onClick={() => void loadMoreJobs()}
                type="button"
              >
                Načíst další reporty
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      <AdminConfirmDialog
        actionLabel="Zařadit report"
        onCancel={() => {
          setConfirming(false);
          setPending(null);
        }}
        onConfirm={() => pending && void execute(pending)}
        open={confirming && pending !== null}
        title="Vytvořit tento report?"
      >
        <p>
          {pending ? reportLabels[pending.body.report] : ''} ·{' '}
          {pending?.body.format.toUpperCase()}
        </p>
        <p>
          Report se připraví na pozadí a stažení se zapíše do historie změn.
        </p>
      </AdminConfirmDialog>
    </div>
  );
};
