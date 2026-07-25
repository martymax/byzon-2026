'use client';

import { useState } from 'react';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  adminReasonSchema,
  announcementDraftSchema,
  announcementSendRequestSchema,
  createAnnouncementPreview,
  sendAnnouncementPreview,
  type AnnouncementDraft,
  type AnnouncementPreview,
  type AnnouncementSendResponse,
} from './admin-workspace-contracts';
import { useAdminWorkspaceScope } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

type DraftFields = {
  readonly title: string;
  readonly bodyText: string;
  readonly severity: AnnouncementDraft['severity'];
  readonly audienceKind: AnnouncementDraft['audience']['kind'];
  readonly sessionId: string;
};

const initialDraft: DraftFields = {
  title: '',
  bodyText: '',
  severity: 'important',
  audienceKind: 'event',
  sessionId: 'session-growth-2026',
};

export const AdminAnnouncementWorkspace = () => {
  const scope = useAdminWorkspaceScope();
  const [fields, setFields] = useState<DraftFields>(initialDraft);
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [reason, setReason] = useState('');
  const [sendAttempted, setSendAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AnnouncementSendResponse | null>(null);

  const draftCandidate = {
    title: fields.title,
    bodyText: fields.bodyText,
    severity: fields.severity,
    audience:
      fields.audienceKind === 'event'
        ? { kind: 'event' as const }
        : {
            kind: 'session' as const,
            sessionId: fields.sessionId,
          },
  };
  const draftResult = announcementDraftSchema.safeParse(draftCandidate);
  const titleInvalid = previewAttempted && fields.title.trim().length < 1;
  const bodyInvalid = previewAttempted && fields.bodyText.trim().length < 1;
  const reasonInvalid =
    sendAttempted && !adminReasonSchema.safeParse(reason).success;

  const updateField = <Key extends keyof DraftFields>(
    key: Key,
    value: DraftFields[Key],
  ) => {
    setFields((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setResult(null);
    setConfirming(false);
  };

  const buildPreview = () => {
    setPreviewAttempted(true);
    if (!draftResult.success) return;
    setPreview(createAnnouncementPreview(scope.eventId, draftResult.data));
    setResult(null);
    setReason('');
    setSendAttempted(false);
  };

  const requestSend = () => {
    setSendAttempted(true);
    if (!preview || !adminReasonSchema.safeParse(reason).success) return;
    setConfirming(true);
  };

  const confirmSend = () => {
    if (!preview) return;
    const request = announcementSendRequestSchema.parse({
      eventId: scope.eventId,
      previewId: preview.previewId,
      previewVersion: preview.previewVersion,
      reason,
      idempotencyKey: `mock-ann-send-${preview.previewId}`,
    });
    setResult(sendAnnouncementPreview(preview, request));
    setConfirming(false);
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · Priority A</p>
        <h1>In-app oznámení</h1>
        <p>
          Vytvořte textovou zprávu, zkontrolujte agregovaný rozsah publika a
          potvrďte přesnou immutable verzi. E-mail a pokročilé cílení nejsou
          součástí tohoto mock řezu.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="announcement-draft">
        <div className={styles.panelHeader}>
          <h2 id="announcement-draft">1. Návrh zprávy</h2>
          <span className={styles.badge}>Pouze in-app · mock</span>
        </div>
        {previewAttempted && !draftResult.success ? (
          <section
            aria-labelledby="announcement-errors"
            className={styles.errorSummary}
            role="alert"
          >
            <h2 id="announcement-errors">Návrh není připravený</h2>
            <ul>
              {titleInvalid ? (
                <li>
                  <a href="#announcement-title">Doplňte název zprávy.</a>
                </li>
              ) : null}
              {bodyInvalid ? (
                <li>
                  <a href="#announcement-body">Doplňte text zprávy.</a>
                </li>
              ) : null}
              {!titleInvalid && !bodyInvalid ? (
                <li>
                  Text obsahuje nepodporovaný znak nebo překročil bezpečný
                  limit.
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Název</span>
            <input
              aria-invalid={titleInvalid}
              id="announcement-title"
              maxLength={160}
              onChange={(event) => updateField('title', event.target.value)}
              value={fields.title}
            />
          </label>
          <label className={styles.field}>
            <span>Závažnost</span>
            <select
              onChange={(event) =>
                updateField(
                  'severity',
                  event.target.value as AnnouncementDraft['severity'],
                )
              }
              value={fields.severity}
            >
              <option value="info">Informace</option>
              <option value="important">Důležité</option>
              <option value="critical">Kritické</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>Text zprávy</span>
          <textarea
            aria-describedby="announcement-body-help"
            aria-invalid={bodyInvalid}
            id="announcement-body"
            maxLength={4_000}
            onChange={(event) => updateField('bodyText', event.target.value)}
            value={fields.bodyText}
          />
          <span className={styles.helper} id="announcement-body-help">
            Prostý text bez HTML; nevkládejte seznam adresátů ani osobní údaje.
          </span>
        </label>
        <fieldset className={styles.fieldGroup}>
          <legend className={styles.legend}>Publikum</legend>
          <label className={styles.checkRow}>
            <input
              checked={fields.audienceKind === 'event'}
              name="audience"
              onChange={() => updateField('audienceKind', 'event')}
              type="radio"
            />
            <span>Všichni oprávnění účastníci akce</span>
          </label>
          <label className={styles.checkRow}>
            <input
              checked={fields.audienceKind === 'session'}
              name="audience"
              onChange={() => updateField('audienceKind', 'session')}
              type="radio"
            />
            <span>Účastníci přímo dotčené session</span>
          </label>
          {fields.audienceKind === 'session' ? (
            <label className={styles.field}>
              <span>Session</span>
              <select
                onChange={(event) =>
                  updateField('sessionId', event.target.value)
                }
                value={fields.sessionId}
              >
                <option value="session-growth-2026">Růst bez zkratek</option>
                <option value="session-panel-2026">
                  Panel: firmy v pohybu
                </option>
              </select>
            </label>
          ) : null}
        </fieldset>
        <button className={styles.button} onClick={buildPreview} type="button">
          Vytvořit audience preview
        </button>
      </section>

      {preview ? (
        <section
          className={styles.panel}
          aria-labelledby="announcement-preview"
        >
          <div className={styles.panelHeader}>
            <div>
              <h2 id="announcement-preview">2. Immutable audience preview</h2>
              <p className={styles.muted}>
                Verze: <code>{preview.previewVersion}</code>
              </p>
            </div>
            <span className={styles.badge}>
              {preview.draft.severity === 'critical'
                ? 'Kritické'
                : preview.draft.severity === 'important'
                  ? 'Důležité'
                  : 'Informace'}
            </span>
          </div>
          <div className={styles.twoColumn}>
            <div className={styles.metric}>
              <small>Zahrnutí příjemci</small>
              <strong>{preview.recipientCount}</strong>
              <span>Agregovaný počet, bez seznamu identit.</span>
            </div>
            <div className={styles.metric}>
              <small>Vyloučení</small>
              <strong>{preview.excludedCount}</strong>
              <span>Bez aktivního oprávnění nebo mimo rozsah.</span>
            </div>
          </div>
          <article className={styles.callout}>
            <h3>{preview.draft.title}</h3>
            <p>{preview.draft.bodyText}</p>
          </article>
          <p className={styles.warning}>
            Jakákoli úprava návrhu toto preview okamžitě zneplatní a vyžádá nové
            potvrzení.
          </p>
          {reasonInvalid ? (
            <section
              aria-labelledby="announcement-send-errors"
              className={styles.errorSummary}
              role="alert"
            >
              <h2 id="announcement-send-errors">Doplňte důvod odeslání</h2>
              <a href="#announcement-reason">Uveďte stručný provozní důvod.</a>
            </section>
          ) : null}
          <label className={styles.field}>
            <span>Provozní důvod</span>
            <textarea
              aria-invalid={reasonInvalid}
              id="announcement-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <button
            className={styles.button}
            disabled={result !== null}
            onClick={requestSend}
            type="button"
          >
            Zkontrolovat odeslání
          </button>
          {result ? (
            <section
              aria-live="polite"
              className={`${styles.success} ${styles.result}`}
            >
              <h3>Odesláno pouze v in-app mocku</h3>
              <p>
                Příjemců: {result.recipientCount}. Audit:{' '}
                <code>{result.audit.auditId}</code>. Žádný e-mail ani produkční
                job nebyl vytvořen.
              </p>
            </section>
          ) : null}
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="announcement-later">
        <h2 id="announcement-later">Mimo Priority A</h2>
        <p className={styles.muted}>
          Pokročilé segmenty, e-mailové kanály a reporting zůstanou neaktivní,
          dokud nebudou mít vlastní kontrakt, provider a bezpečnostní review.
        </p>
        <button className={styles.secondaryButton} disabled type="button">
          E-mailový kanál není dostupný
        </button>
      </section>

      {confirming && preview ? (
        <AdminConfirmDialog
          acknowledgement={`Potvrzuji odeslání přesné mock verze ${preview.previewVersion} pouze do in-app ukázky.`}
          confirmLabel="Odeslat v in-app mocku"
          danger={preview.draft.severity === 'critical'}
          description="Publikum je agregované, neměnné a svázané s aktuální akcí. Odeslání nevytvoří produkční zprávy."
          impact={
            <dl className={styles.detailList}>
              <dt>Název</dt>
              <dd>{preview.draft.title}</dd>
              <dt>Příjemců</dt>
              <dd>{preview.recipientCount}</dd>
              <dt>Vyloučeno</dt>
              <dd>{preview.excludedCount}</dd>
              <dt>Verze</dt>
              <dd>{preview.previewVersion}</dd>
            </dl>
          }
          onConfirm={confirmSend}
          onDismiss={() => setConfirming(false)}
          title="Potvrdit in-app oznámení?"
        />
      ) : null}
    </div>
  );
};
