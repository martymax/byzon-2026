'use client';

import {
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementSendRequestSchema,
  type AdminAnnouncementDraft,
  type AdminAnnouncementPreviewRequest,
  type AdminAnnouncementPreviewResponse,
  type AdminAnnouncementSendRequest,
  type AdminAnnouncementSendResponse,
  type AnnouncementSeverity,
} from '@byzon/domain/contracts';
import { useState } from 'react';

import {
  requestAdminAnnouncementPreview,
  requestAdminAnnouncementSend,
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

type PendingSend = Readonly<{
  body: AdminAnnouncementSendRequest;
  idempotencyKey: string;
}>;

const severityLabels: Record<AnnouncementSeverity, string> = {
  info: 'Informace',
  important: 'Důležité',
  critical: 'Kritické',
};

export const AdminAnnouncementWorkspace = () => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
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
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] =
    useState<AdminAnnouncementSendResponse | null>(null);

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

  const resetImmutablePreview = () => {
    setPreview(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setSent(null);
  };

  const createPreview = async (
    body: AdminAnnouncementPreviewRequest,
    staleMessage?: string,
  ) => {
    setBusy('preview');
    setError(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    const result = await requestAdminAnnouncementPreview(api, eventId, body);
    setBusy(null);
    if (!result.ok) {
      setPreview(null);
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
      setPreview(result.data);
      setReason('');
      setAttempted(false);
      if (staleMessage) setError(staleMessage);
    }
  };

  const previewDraft = () => {
    setAttempted(true);
    if (!draftCandidate.success) {
      setError(
        'Doplňte bezpečný název, text a platné publikum bez HTML značek.',
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
    setBusy('send');
    setConfirming(false);
    setError(null);
    const result = await requestAdminAnnouncementSend(
      api,
      eventId,
      attempt.body,
      attempt.idempotencyKey,
    );
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result.failure)) {
        setPreview(null);
        setPending(null);
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
      const retryable = isAmbiguousAdminMutationFailure(result.failure);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      setSent(result.data);
      setPending(null);
      setAmbiguous(false);
      setReason('');
      setAttempted(false);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · oznámení v aplikaci</p>
        <h1>Oznámení účastníkům</h1>
        <p>
          Náhled uzamkne text, publikum i verzi. Odeslání používá pouze in-app
          kanál, vyžaduje důvod a je bezpečně idempotentní.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="announcement-draft">
        <h2 id="announcement-draft">1. Návrh</h2>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Název</span>
            <input
              maxLength={160}
              onChange={(event) => {
                setTitle(event.target.value);
                resetImmutablePreview();
              }}
              value={title}
            />
          </label>
          <label className={styles.field}>
            <span>Závažnost</span>
            <select
              onChange={(event) => {
                setSeverity(event.target.value as AnnouncementSeverity);
                resetImmutablePreview();
              }}
              value={severity}
            >
              {Object.entries(severityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>Text oznámení</span>
          <textarea
            maxLength={4000}
            onChange={(event) => {
              setBodyText(event.target.value);
              resetImmutablePreview();
            }}
            value={bodyText}
          />
          <span className={styles.helper}>
            Prostý text; HTML značky ani nebezpečné řídicí znaky nejsou
            povolené.
          </span>
        </label>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Publikum</span>
            <select
              onChange={(event) => {
                setAudienceKind(event.target.value as 'event' | 'session');
                resetImmutablePreview();
              }}
              value={audienceKind}
            >
              <option value="event">Celá akce</option>
              <option value="session">Konkrétní session</option>
            </select>
          </label>
          {audienceKind === 'session' ? (
            <label className={styles.field}>
              <span>ID session</span>
              <input
                onChange={(event) => {
                  setSessionId(event.target.value);
                  resetImmutablePreview();
                }}
                value={sessionId}
              />
            </label>
          ) : null}
        </div>
        <button
          className={styles.button}
          disabled={busy !== null}
          onClick={previewDraft}
          type="button"
        >
          {busy === 'preview' ? 'Počítám publikum…' : 'Vytvořit preview'}
        </button>
        {error ? (
          <p className={styles.warning} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {preview ? (
        <section className={styles.panel} aria-labelledby="announcement-preview">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="announcement-preview">2. Immutable preview</h2>
              <p className={styles.muted}>
                {preview.previewId} · verze {preview.previewVersion}
              </p>
            </div>
            <span className={styles.badge}>
              {preview.audience.recipientCount} příjemců
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
            Vyloučeno: {preview.audience.excludedCount}. Maskovaný vzorek:{' '}
            {preview.audience.sample
              .map(({ participantReference }) => participantReference)
              .join(', ') || 'bez vzorku'}
          </p>
          {preview.audience.recipientCount === 0 ? (
            <p className={styles.warning} role="alert">
              Prázdné publikum nelze odeslat.
            </p>
          ) : null}
          <label className={styles.field}>
            <span>Auditní důvod odeslání</span>
            <textarea
              aria-invalid={attempted && sendCandidate?.success === false}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper}>
              Pro mocked scénáře lze přidat „stale“, „expired“, „timeout“ nebo
              „collision“.
            </span>
          </label>
          <div className={styles.actionRow}>
            <button
              className={styles.dangerButton}
              disabled={busy !== null || preview.audience.recipientCount === 0}
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
              ? 'Server potvrdil dřívější odeslání'
              : 'Oznámení bylo odesláno'}
          </h2>
          <p>
            {sent.recipientCount} příjemců · audit{' '}
            <code>{sent.audit.auditId}</code>
          </p>
        </section>
      ) : null}

      {confirming && pending && preview ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem text, závažnost, immutable verzi a počet příjemců."
          confirmLabel="Odeslat oznámení"
          danger={preview.draft.severity === 'critical'}
          description="Po odeslání nelze oznámení upravit. Server znovu ověří preview i oprávnění."
          impact={
            <p>
              {preview.audience.recipientCount} příjemců ·{' '}
              {severityLabels[preview.draft.severity]}
            </p>
          }
          onConfirm={() => void send(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title="Odeslat oznámení do aplikace?"
        />
      ) : null}
    </div>
  );
};
