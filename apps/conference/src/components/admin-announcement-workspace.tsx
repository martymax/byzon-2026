'use client';

import {
  adminAnnouncementDraftContentSchema,
  type AdminAnnouncementSavedDraft,
  type AdminAnnouncementDraftMutationRequest,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  requestAdminAnnouncementDraft,
  requestAdminAnnouncementDraftMutation,
  requestAdminAnnouncementPreview,
  requestAdminAnnouncementSend,
  requestAdminAnnouncementTargets,
} from '@/lib/admin-api';

import { AdminAnnouncementDrafts } from './admin-announcement-drafts';
import { AdminAnnouncementHistory } from './admin-announcement-history';
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

type PendingDraftMutation = Readonly<{
  body: AdminAnnouncementDraftMutationRequest;
  idempotencyKey: string;
}>;

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
  targets,
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
  const [busy, setBusy] = useState<
    'preview' | 'send' | 'save' | 'load' | 'delete' | null
  >(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<AdminAnnouncementSendResponse | null>(null);
  const [loadedTargets, setLoadedTargets] = useState<
    readonly AdminAnnouncementTarget[]
  >([]);
  const [targetsLoading, setTargetsLoading] = useState(targets === undefined);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [targetsReload, setTargetsReload] = useState(0);
  const availableTargets = targets ?? loadedTargets;
  const titleRef = useRef<HTMLInputElement>(null);
  const [savedDraft, setSavedDraft] =
    useState<AdminAnnouncementSavedDraft | null>(null);
  const [draftsRevision, setDraftsRevision] = useState(0);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [pendingDraftMutation, setPendingDraftMutation] =
    useState<PendingDraftMutation | null>(null);
  const [deleteDraft, setDeleteDraft] =
    useState<AdminAnnouncementSavedDraft | null>(null);
  const [switchDraft, setSwitchDraft] = useState<{ id: string | null } | null>(
    null,
  );
  const editingLocked =
    busy !== null || pending !== null || pendingDraftMutation !== null;

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
  const selectedTarget = availableTargets.find(
    (target) => target.sessionId === sessionId,
  );
  const draftContent: AdminAnnouncementDraft = {
    title,
    bodyText,
    severity,
    audience:
      audienceKind === 'event'
        ? { kind: 'event' }
        : { kind: 'session', sessionId },
  };
  const contentDirty = savedDraft
    ? JSON.stringify(draftContent) !== JSON.stringify(savedDraft.draft)
    : title.length > 0 || bodyText.length > 0 || audienceKind === 'session';
  const dirty = contentDirty || reason.length > 0;

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
    setDraftMessage(null);
    setReason('');
    setPreview(null);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setSent(null);
    setSendError(null);
    setRecoveryMessage(null);
  };

  const wipe = useCallback(() => {
    setSavedDraft(null);
    setPendingDraftMutation(null);
    setDraftMessage(null);
    setDraftError(null);
    setSendError(null);
    setSwitchDraft(null);
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
  }, []);

  useEffect(() => {
    if (targets !== undefined) return;
    const request = requestFence.begin('announcement-targets');
    void requestAdminAnnouncementTargets(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setTargetsLoading(false);
        if (!result.ok) {
          setLoadedTargets([]);
          if (isAdminSecurityFailure(result)) {
            wipe();
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setTargetsError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        if (result.kind === 'success') setLoadedTargets(result.data.options);
      },
    );
    return () => requestFence.cancel('announcement-targets');
  }, [
    api,
    eventId,
    invalidateSensitive,
    requestFence,
    targets,
    targetsReload,
    wipe,
  ]);

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
    if (savedDraft && contentDirty) {
      setDraftError('Před kontrolou uložte změny konceptu.');
      return;
    }
    void createPreview({
      ...draftCandidate.data,
      ...(savedDraft
        ? { sourceDraft: { id: savedDraft.id, version: savedDraft.version } }
        : {}),
    });
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
            {
              draft: currentDraft,
              ...(preview?.sourceDraft
                ? { sourceDraft: preview.sourceDraft }
                : {}),
            },
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
      setDraftsRevision((value) => value + 1);
    }
  };

  const openDraft = async (id: string | null) => {
    setSwitchDraft(null);
    if (id === null) {
      wipe();
      titleRef.current?.focus();
      return;
    }
    const request = requestFence.begin('announcement-draft-open');
    setBusy('load');
    setDraftError(null);
    const result = await requestAdminAnnouncementDraft(
      api,
      eventId,
      id,
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
      setDraftError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      setDraftsRevision((value) => value + 1);
      return;
    }
    if (result.kind === 'success') {
      const item = result.data.item;
      wipe();
      setSavedDraft(item);
      setTitle(item.draft.title);
      setBodyText(item.draft.bodyText);
      setAudienceKind(item.draft.audience.kind);
      setSessionId(
        item.draft.audience.kind === 'session'
          ? item.draft.audience.sessionId
          : '',
      );
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  };
  const chooseDraft = (id: string | null) => {
    if (dirty) {
      setSwitchDraft({ id });
      titleRef.current?.focus();
    } else void openDraft(id);
  };
  const mutateDraft = async (attempt: PendingDraftMutation) => {
    const request = requestFence.begin('announcement-draft-mutation');
    setPendingDraftMutation(attempt);
    setDeleteDraft(null);
    setBusy(attempt.body.action);
    setDraftError(null);
    setDraftMessage(null);
    const result = await requestAdminAnnouncementDraftMutation(
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
      if (!isAmbiguousAdminMutationFailure(result))
        setPendingDraftMutation(null);
      setDraftError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    setPendingDraftMutation(null);
    if (result.kind === 'success') {
      resetImmutablePreview();
      setAttempted(false);
      if (result.data.outcome === 'saved') {
        setSavedDraft(result.data.item);
        setDraftMessage(
          'Koncept je uložený. Později ho můžete otevřít vy nebo jiný oprávněný správce.',
        );
      } else {
        if (savedDraft?.id === result.data.draftId) wipe();
        setDraftMessage('Koncept byl smazán.');
      }
      setDraftsRevision((value) => value + 1);
    }
  };
  const saveDraft = () => {
    const content = adminAnnouncementDraftContentSchema.safeParse(draftContent);
    setAttempted(false);
    if (!content.success) {
      setDraftError(
        'Vyplňte alespoň nadpis nebo zprávu a zvolte platné publikum. Text nesmí obsahovat HTML značky.',
      );
      return;
    }
    void mutateDraft({
      body: {
        action: 'save',
        draftId: savedDraft?.id ?? crypto.randomUUID(),
        expectedVersion: savedDraft?.version ?? 0,
        draft: content.data,
      },
      idempotencyKey: createAdminIdempotencyKey('announcement-draft'),
    });
  };

  const previewSessionId =
    preview?.draft.audience.kind === 'session'
      ? preview.draft.audience.sessionId
      : null;
  const previewTarget = previewSessionId
    ? availableTargets.find((target) => target.sessionId === previewSessionId)
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
          potom ji odešlete. Rozepsané oznámení můžete uložit jako koncept na
          později.
        </p>
        <a className={styles.secondaryButton} href="#announcement-drafts">
          Přejít na koncepty
        </a>
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
          Máte neuložené změny. Před odchodem je uložte jako koncept.
        </p>
      ) : null}
      {recoveryMessage ? (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {targetsLoading ? (
        <p className={styles.muted} role="status">
          Načítám aktivity pro přesné publikum…
        </p>
      ) : null}
      {targetsError ? (
        <section className={styles.warning} role="alert">
          <p>{targetsError}</p>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setTargetsLoading(true);
              setTargetsError(null);
              setTargetsReload((value) => value + 1);
            }}
            type="button"
          >
            Načíst aktivity znovu
          </button>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="announcement-draft">
        <div className={styles.panelHeader}>
          <h2 id="announcement-draft">
            {savedDraft ? 'Úprava konceptu' : 'Text a publikum'}
          </h2>
          <button
            className={styles.secondaryButton}
            disabled={editingLocked}
            onClick={() => chooseDraft(null)}
            type="button"
          >
            Nové oznámení
          </button>
        </div>
        {savedDraft ? (
          <p className={styles.muted}>
            Koncept uložen{' '}
            {targetDateFormatter.format(new Date(savedDraft.updatedAt))}. Před
            odesláním znovu zkontrolujte aktuální příjemce.
          </p>
        ) : null}
        {draftMessage ? (
          <p className={styles.success} role="status">
            {draftMessage}
          </p>
        ) : null}
        {busy === 'load' ? <p role="status">Otevírám koncept…</p> : null}
        {switchDraft ? (
          <section className={styles.warning} role="alert">
            <p>
              Ve formuláři máte neuložené změny. Chcete je zahodit a pokračovat?
            </p>
            <div className={styles.actionRow}>
              <button
                className={styles.secondaryButton}
                onClick={() => setSwitchDraft(null)}
                type="button"
              >
                Pokračovat v úpravách
              </button>
              <button
                className={styles.dangerButton}
                onClick={() => void openDraft(switchDraft.id)}
                type="button"
              >
                Zahodit změny a pokračovat
              </button>
            </div>
          </section>
        ) : null}
        {draftValidationFailed || draftError ? (
          <section
            className={styles.errorSummary}
            ref={draftErrorSummaryRef}
            role="alert"
            tabIndex={-1}
          >
            <h2>Oznámení vyžaduje pozornost</h2>
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
              disabled={editingLocked}
              maxLength={160}
              ref={titleRef}
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
            disabled={editingLocked}
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
              disabled={editingLocked}
              onChange={(event) => {
                const nextKind = event.target.value as 'event' | 'session';
                setAudienceKind(nextKind);
                setSessionId(
                  nextKind === 'session'
                    ? (availableTargets[0]?.sessionId ?? '')
                    : '',
                );
                resetImmutablePreview();
              }}
              value={audienceKind}
            >
              <option value="event">Všem účastníkům akce</option>
              {availableTargets.length > 0 || audienceKind === 'session' ? (
                <option value="session">Účastníkům jedné aktivity</option>
              ) : null}
            </select>
          </label>
          {audienceKind === 'session' ? (
            <label className={styles.field}>
              <span>Aktivita</span>
              <select
                aria-invalid={draftValidationFailed}
                disabled={editingLocked}
                onChange={(event) => {
                  setSessionId(event.target.value);
                  resetImmutablePreview();
                }}
                value={sessionId}
              >
                {!selectedTarget ? (
                  <option value={sessionId} disabled>
                    Aktivita není dostupná – vyberte jinou
                  </option>
                ) : null}
                {availableTargets.map((target) => (
                  <option key={target.sessionId} value={target.sessionId}>
                    {targetLabel(target)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className={styles.helper}>
              {targetsLoading
                ? 'Načítáme pojmenovaný seznam aktivit pro tuto akci.'
                : targetsError
                  ? 'Seznam aktivit teď není dostupný; eventové publikum zůstává bezpečně dostupné.'
                  : availableTargets.length === 0
                    ? 'Pro tuto akci nejsou dostupné žádné aktivity.'
                    : 'Můžete zvolit všechny účastníky, nebo právě jednu pojmenovanou aktivitu.'}
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

        <div className={styles.actionRow}>
          <button
            className={styles.secondaryButton}
            disabled={editingLocked || (savedDraft !== null && !contentDirty)}
            onClick={saveDraft}
            type="button"
          >
            {busy === 'save' ? 'Ukládám koncept…' : 'Uložit koncept'}
          </button>
          <button
            className={styles.button}
            disabled={editingLocked}
            onClick={previewDraft}
            type="button"
          >
            {busy === 'preview' ? 'Počítám publikum…' : 'Zkontrolovat oznámení'}
          </button>
          {pendingDraftMutation && busy === null ? (
            <button
              className={styles.secondaryButton}
              onClick={() => void mutateDraft(pendingDraftMutation)}
              type="button"
            >
              {pendingDraftMutation.body.action === 'save'
                ? 'Zopakovat uložení konceptu'
                : 'Zopakovat smazání konceptu'}
            </button>
          ) : null}
        </div>
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
          {preview.audience.sample.length > 0 ? (
            <section aria-labelledby="announcement-recipient-sample">
              <h3 id="announcement-recipient-sample">Ukázka příjemců</h3>
              <ul className={styles.cardList}>
                {preview.audience.sample.map((participant) => (
                  <li
                    className={`${styles.dataCard} ${styles.identityCell}`}
                    key={participant.contactEmail}
                  >
                    <strong>{participant.participantName}</strong>
                    <small>{participant.contactEmail}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
              disabled={editingLocked}
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
              disabled={editingLocked || preview.audience.recipientCount === 0}
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

      <AdminAnnouncementDrafts
        revision={draftsRevision}
        disabled={editingLocked}
        activeId={savedDraft?.id}
        onOpen={chooseDraft}
        onDelete={setDeleteDraft}
      />
      <AdminAnnouncementHistory revision={sent?.announcementId} />
      {deleteDraft ? (
        <AdminConfirmDialog
          title="Smazat koncept oznámení?"
          description="Koncept už nebude dostupný ani ostatním správcům. Žádné oznámení se neodešle."
          impact={<p>{deleteDraft.draft.title || 'Koncept bez nadpisu'}</p>}
          acknowledgement="Chci tento koncept smazat."
          confirmLabel="Potvrdit smazání konceptu"
          danger
          onDismiss={() => setDeleteDraft(null)}
          onConfirm={() =>
            void mutateDraft({
              body: {
                action: 'delete',
                draftId: deleteDraft.id,
                expectedVersion: deleteDraft.version,
              },
              idempotencyKey: createAdminIdempotencyKey(
                'announcement-draft-delete',
              ),
            })
          }
        />
      ) : null}

      {confirming && pending && preview ? (
        <AdminConfirmDialog
          acknowledgement="Text, publikum a počet příjemců jsou zkontrolované."
          confirmLabel="Odeslat oznámení"
          danger
          description="Oznámení se zobrazí v aplikaci a příjemcům s aktivním účtem odešleme také e-mail. Po odeslání už text nelze upravit. Smazání z aplikace neodvolá doručený e-mail."
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
          title="Odeslat oznámení do aplikace a e-mailem?"
        />
      ) : null}
    </div>
  );
};
