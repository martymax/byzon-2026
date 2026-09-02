'use client';

import {
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementSendRequestSchema,
  type AdminAnnouncementDraft,
  type AdminAnnouncementPreviewRequest,
  type AdminAnnouncementPreviewResponse,
  type AdminAnnouncementSendRequest,
  type AdminAnnouncementSendResponse,
  type AdminAnnouncementTarget,
  type AnnouncementSeverity,
} from '@byzon/domain/contracts';
import { AdminTechnicalDetails } from '@byzon/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  requestAdminAnnouncementPreview,
  requestAdminAnnouncementSend,
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

type PendingSend = Readonly<{
  body: AdminAnnouncementSendRequest;
  idempotencyKey: string;
}>;

type AdminAnnouncementWorkspaceProps = Readonly<{
  targets?: readonly AdminAnnouncementTarget[];
}>;

const severityLabels: Record<AnnouncementSeverity, string> = {
  critical: 'Kritické',
};

export const AdminAnnouncementWorkspace = ({
  targets = [],
}: AdminAnnouncementWorkspaceProps) => {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const draftErrorSummaryRef = useRef<HTMLElement | null>(null);
  const sendErrorSummaryRef = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const severity: AnnouncementSeverity = 'critical';
  const [audienceKind, setAudienceKind] = useState<'event' | 'session'>(
    'event',
  );
  const [sessionId, setSessionId] = useState('');
  const [preview, setPreview] =
    useState<AdminAnnouncementPreviewResponse | null>(null);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<AdminAnnouncementSendResponse | null>(null);

  const targetDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: eventTimezone,
      }),
    [eventTimezone],
  );
  const targetLabel = (target: AdminAnnouncementTarget) =>
    `${target.title} · ${targetDateFormatter.format(new Date(target.startsAt))}${
      target.roomLabel ? ` · ${target.roomLabel}` : ''
    }`;
  const selectedTarget = targets.find(
    (target) => target.sessionId === sessionId,
  );
  const dirty =
    title.length > 0 ||
    bodyText.length > 0 ||
    reason.length > 0 ||
    audienceKind === 'session';

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  const draftCandidate = adminAnnouncementPreviewRequestSchema.safeParse({
    draft: {
      title,
      bodyText,
      severity,
      audience:
        audienceKind === 'event'
          ? { kind: 'event' }
          : { kind: 'session', sessionId },
    },
  });
  const draftValidationFailed = attempted && !draftCandidate.success;

  const resetImmutablePreview = () => {
    setPreview(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setSent(null);
    setSendError(null);
    setRecoveryMessage(null);
  };

  const wipe = () => {
    setTitle('');
    setBodyText('');
    setAudienceKind('event');
    setSessionId('');
    setPreview(null);
    setReason('');
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setAttempted(false);
    setSent(null);
    setRecoveryMessage(null);
  };

  const createPreview = async (
    body: AdminAnnouncementPreviewRequest,
    staleMessage?: string,
  ) => {
    const request = requestFence.begin('announcement-preview');
    setBusy('preview');
    setDraftError(null);
    setSendError(null);
    setRecoveryMessage(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    const result = await requestAdminAnnouncementPreview(
      api,
      eventId,
      body,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      setPreview(null);
      if (isAdminSecurityFailure(result)) {
        wipe();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setDraftError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      setPreview(result.data);
      setReason('');
      setAttempted(false);
      if (staleMessage) {
        setRecoveryMessage(
          `${staleMessage} Načetli jsme novou kontrolu; před odesláním ji znovu potvrďte.`,
        );
      }
    }
  };

  const previewDraft = () => {
    setAttempted(true);
    if (!draftCandidate.success) {
      setDraftError(
        'Doplňte nadpis, zprávu a platné publikum bez HTML značek.',
      );
      return;
    }
    void createPreview(draftCandidate.data);
  };

  const sendCandidate = preview
    ? adminAnnouncementSendRequestSchema.safeParse({
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        reason,
      })
    : null;
  const sendValidationFailed = attempted && sendCandidate?.success === false;

  useEffect(() => {
    if (draftValidationFailed || draftError) {
      draftErrorSummaryRef.current?.focus();
    } else if (sendValidationFailed || sendError) {
      sendErrorSummaryRef.current?.focus();
    }
  }, [draftError, draftValidationFailed, sendError, sendValidationFailed]);

  const prepareSend = () => {
    setAttempted(true);
    if (!sendCandidate?.success || preview?.audience.recipientCount === 0) {
      return;
    }
    setPending({
      body: sendCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('announcement'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const send = async (attempt: PendingSend) => {
    const request = requestFence.begin('announcement-send');
    setBusy('send');
    setConfirming(false);
    setSendError(null);
    const result = await requestAdminAnnouncementSend(
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
        wipe();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        const currentDraft: AdminAnnouncementDraft | undefined = preview?.draft;
        setPreview(null);
        setPending(null);
        setAmbiguous(false);
        if (currentDraft) {
          await createPreview(
            { draft: currentDraft },
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
        }
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setSendError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      const receipt = result.data;
      wipe();
      setSent(receipt);
    }
  };

  const previewSessionId =
    preview?.draft.audience.kind === 'session'
      ? preview.draft.audience.sessionId
      : null;
  const previewTarget = previewSessionId
    ? targets.find((target) => target.sessionId === previewSessionId)
    : undefined;
  const previewAudienceLabel = preview
    ? preview.draft.audience.kind === 'event'
      ? 'Všichni účastníci akce'
      : previewTarget
        ? targetLabel(previewTarget)
        : 'Účastníci vybrané aktivity'
    : '';

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Oznámení účastníkům</h1>
        <p>
          Připravte kritickou provozní zprávu, zkontrolujte její publikum a až
          potom ji odešlete do aplikace.
        </p>
      </header>

      <ol className={styles.importSteps} aria-label="Postup odeslání oznámení">
        {[
          ['Text', title.trim() && bodyText.trim() ? 'complete' : 'current'],
          [
            'Komu',
            preview
              ? 'complete'
              : title.trim() && bodyText.trim()
                ? 'current'
                : undefined,
          ],
          ['Kontrola', preview ? 'current' : undefined],
          ['Odeslání', sent ? 'complete' : undefined],
        ].map(([label, state], index) => (
          <li data-state={state} key={label}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {dirty && !sent ? (
        <p className={styles.warning} role="status">
          Máte rozpracované změny. Před odchodem je dokončete nebo smažte.
        </p>
      ) : null}
      {recoveryMessage ? (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      ) : null}

      <section className={styles.panel} aria-labelledby="announcement-draft">
        <h2 id="announcement-draft">Text a publikum</h2>
        {draftValidationFailed || draftError ? (
          <section
            className={styles.errorSummary}
            ref={draftErrorSummaryRef}
            role="alert"
            tabIndex={-1}
          >
            <h2>Oznámení zatím nelze zkontrolovat</h2>
            <p id="admin-announcement-draft-error">
              {draftError ??
                'Doplňte nadpis, zprávu a platné publikum bez HTML značek.'}
            </p>
          </section>
        ) : null}
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Nadpis</span>
            <input
              aria-describedby="admin-announcement-title-count"
              aria-invalid={draftValidationFailed}
              disabled={pending !== null}
              maxLength={160}
              onChange={(event) => {
                setTitle(event.target.value);
                resetImmutablePreview();
              }}
              value={title}
            />
            <span className={styles.helper} id="admin-announcement-title-count">
              {title.length}/160 znaků
            </span>
          </label>
          <div className={styles.field}>
            <span>Závažnost</span>
            <strong>{severityLabels.critical}</strong>
            <small>Povolena jsou pouze kritická provozní oznámení.</small>
          </div>
        </div>
        <label className={styles.field}>
          <span>Zpráva</span>
          <textarea
            aria-describedby="admin-announcement-body-help"
            aria-invalid={draftValidationFailed}
            disabled={pending !== null}
            maxLength={4000}
            onChange={(event) => {
              setBodyText(event.target.value);
              resetImmutablePreview();
            }}
            value={bodyText}
          />
          <span className={styles.helper} id="admin-announcement-body-help">
            {bodyText.length}/4000 znaků · prostý text bez HTML
          </span>
        </label>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Komu</span>
            <select
              disabled={pending !== null}
              onChange={(event) => {
                const nextKind = event.target.value as 'event' | 'session';
                setAudienceKind(nextKind);
                setSessionId(
                  nextKind === 'session' ? (targets[0]?.sessionId ?? '') : '',
                );
                resetImmutablePreview();
              }}
              value={audienceKind}
            >
              <option value="event">Všem účastníkům akce</option>
              {targets.length > 0 ? (
                <option value="session">Účastníkům jedné aktivity</option>
              ) : null}
            </select>
          </label>
          {audienceKind === 'session' ? (
            <label className={styles.field}>
              <span>Aktivita</span>
              <select
                aria-invalid={draftValidationFailed}
                disabled={pending !== null}
                onChange={(event) => {
                  setSessionId(event.target.value);
                  resetImmutablePreview();
                }}
                value={sessionId}
              >
                {targets.map((target) => (
                  <option key={target.sessionId} value={target.sessionId}>
                    {targetLabel(target)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className={styles.helper}>
              Volba jedné aktivity se zobrazí, až server nabídne pojmenovaný
              seznam aktivit pro tuto akci.
            </p>
          )}
        </div>

        <article className={styles.dataCard} aria-label="Náhled pro účastníka">
          <span className={styles.statusBadge}>Kritické oznámení</span>
          <h3>{title.trim() || 'Nadpis oznámení'}</h3>
          <p>{bodyText.trim() || 'Zpráva se zobrazí účastníkům zde.'}</p>
          <small>
            {audienceKind === 'event'
              ? 'Všichni účastníci akce'
              : selectedTarget
                ? targetLabel(selectedTarget)
                : 'Vyberte aktivitu'}
          </small>
        </article>

        <button
          className={styles.button}
          disabled={busy !== null || pending !== null}
          onClick={previewDraft}
          type="button"
        >
          {busy === 'preview' ? 'Počítám publikum…' : 'Zkontrolovat oznámení'}
        </button>
      </section>

      {preview ? (
        <section
          className={styles.panel}
          aria-labelledby="announcement-preview"
        >
          <div className={styles.panelHeader}>
            <div>
              <h2 id="announcement-preview">Kontrola</h2>
              <p className={styles.muted}>{previewAudienceLabel}</p>
            </div>
            <span className={styles.badge}>
              {formatCzechCount(
                preview.audience.recipientCount,
                adminCountForms.recipient,
              )}
            </span>
          </div>
          <article className={styles.dataCard}>
            <span className={styles.statusBadge}>
              {severityLabels[preview.draft.severity]}
            </span>
            <h3>{preview.draft.title}</h3>
            <p>{preview.draft.bodyText}</p>
          </article>
          <p>
            Oznámení uvidí{' '}
            <strong>
              {formatCzechCount(
                preview.audience.recipientCount,
                adminCountForms.attendee,
              )}
            </strong>
            .
          </p>
          <p className={styles.muted}>
            Mimo vybrané publikum:{' '}
            {formatCzechCount(
              preview.audience.excludedCount,
              adminCountForms.attendee,
            )}
            . Současný přehled neuvádí jednotlivé důvody.
          </p>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID kontroly</dt>
              <dd>{preview.previewId}</dd>
              <dt>Verze kontroly</dt>
              <dd>{preview.previewVersion}</dd>
            </dl>
          </AdminTechnicalDetails>
          {sendValidationFailed || sendError ? (
            <section
              className={styles.errorSummary}
              ref={sendErrorSummaryRef}
              role="alert"
              tabIndex={-1}
            >
              <h2>Odeslání zatím nelze potvrdit</h2>
              <p id="admin-announcement-send-error">
                {sendError ??
                  'Doplňte důvod odeslání o nejméně 8 viditelných znaků.'}
              </p>
            </section>
          ) : null}
          {preview.audience.recipientCount === 0 ? (
            <p className={styles.warning} role="alert">
              Publikum je prázdné. Oznámení nelze odeslat.
            </p>
          ) : null}
          <label className={styles.field}>
            <span>Důvod odeslání</span>
            <textarea
              aria-describedby="admin-announcement-reason-help"
              aria-invalid={sendValidationFailed}
              disabled={pending !== null}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper} id="admin-announcement-reason-help">
              Důvod se uloží do historie změn pro pozdější dohledání.
            </span>
          </label>
          <div className={styles.actionRow}>
            <button
              className={styles.dangerButton}
              disabled={
                busy !== null ||
                pending !== null ||
                preview.audience.recipientCount === 0
              }
              onClick={prepareSend}
              type="button"
            >
              Zkontrolovat odeslání
            </button>
            {ambiguous && pending ? (
              <button
                className={styles.secondaryButton}
                disabled={busy !== null}
                onClick={() => void send(pending)}
                type="button"
              >
                Zopakovat přesně stejný pokus
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {sent ? (
        <section className={styles.success} role="status">
          <h2>
            {sent.outcome === 'already_sent'
              ? `Toto oznámení už bylo odesláno. Počet příjemců: ${sent.recipientCount}. Další kopie nevznikla.`
              : `Oznámení bylo odesláno. Počet příjemců: ${sent.recipientCount}.`}
          </h2>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID auditu</dt>
              <dd>{sent.audit.auditId}</dd>
              <dt>Verze kontroly</dt>
              <dd>{sent.previewVersion}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      {confirming && pending && preview ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem text, publikum a počet příjemců."
          confirmLabel="Odeslat oznámení"
          danger
          description="Po odeslání už oznámení nelze upravit. Server znovu ověří kontrolu i vaše oprávnění."
          impact={
            <p>
              {formatCzechCount(
                preview.audience.recipientCount,
                adminCountForms.recipient,
              )}{' '}
              · {severityLabels[preview.draft.severity]}
            </p>
          }
          onConfirm={() => void send(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title="Odeslat kritické oznámení do aplikace?"
        />
      ) : null}
    </div>
  );
};
