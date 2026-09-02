'use client';

import {
  adminEventSettingsUpdateRequestSchema,
  type AdminEventSettings,
  type AdminEventSettingsUpdateRequest,
} from '@byzon/domain/contracts/admin';
import {
  AdminConfirmDialog,
  AdminTechnicalDetails,
  AdminUnsavedBar,
} from '@byzon/ui';
import { useEffect, useRef, useState } from 'react';

import {
  requestAdminEventSettings,
  requestAdminEventSettingsUpdate,
} from '@/lib/admin-api';

import { AdminFormErrorSummary } from './admin-form-error-summary';
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

type CoreSettingsDraft = Readonly<{
  registrationMode: AdminEventSettings['registrationMode'];
  reservationChangesAllowed: boolean;
}>;

type PendingSettings = Readonly<{
  body: AdminEventSettingsUpdateRequest;
  idempotencyKey: string;
}>;

const registrationLabels: Record<
  AdminEventSettings['registrationMode'],
  string
> = {
  open: 'Registrace je otevřená',
  invite_only: 'Pouze pro pozvané',
  closed: 'Registrace je uzavřená',
};

const registrationDescriptions: Record<
  AdminEventSettings['registrationMode'],
  string
> = {
  open: 'Způsobilí účastníci mohou dokončit běžný registrační průchod.',
  invite_only: 'Pokračovat mohou pouze lidé s platnou pozvánkou.',
  closed: 'Nové registrace se nepřijímají.',
};

const coreDraft = (settings: AdminEventSettings): CoreSettingsDraft => ({
  registrationMode: settings.registrationMode,
  reservationChangesAllowed: settings.reservationChangesAllowed,
});

export const AdminSettingsRedesign = () => {
  const {
    api,
    context,
    eventId,
    eventTimezone,
    invalidateSensitive,
    permissions,
  } = useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const canManage = permissions.includes('event:settings:manage');
  const archived = context.event.phase === 'archived';
  const [settings, setSettings] = useState<AdminEventSettings | null>(null);
  const [draft, setDraft] = useState<CoreSettingsDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingSettings | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(canManage);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    auditId: string;
  } | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const request = requestFence.begin('settings-read');
    void requestAdminEventSettings(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(false);
        if (!result.ok) {
          setSettings(null);
          setDraft(null);
          if (isAdminSecurityFailure(result)) {
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
          setSettings(result.data);
          setDraft(coreDraft(result.data));
          setError(null);
        }
      },
    );
    return () => requestFence.cancel('settings-read');
  }, [api, canManage, eventId, invalidateSensitive, requestFence]);

  useEffect(() => {
    if (editing) firstChoiceRef.current?.focus();
  }, [editing]);

  const dirty = Boolean(
    editing &&
    settings &&
    draft &&
    (draft.registrationMode !== settings.registrationMode ||
      draft.reservationChangesAllowed !== settings.reservationChangesAllowed),
  );
  const frozen = busy || pending !== null;

  useEffect(() => {
    if (!dirty && !reason) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty, reason]);

  const candidate =
    settings && draft
      ? adminEventSettingsUpdateRequestSchema.safeParse({
          expectedVersion: settings.version,
          settings: {
            ...draft,
            supportMessage: settings.supportMessage,
          },
          reason,
        })
      : null;
  const invalid = attempted && candidate?.success === false;

  const discard = () => {
    if (!settings) return;
    setDraft(coreDraft(settings));
    setReason('');
    setAttempted(false);
    setEditing(false);
    setError(null);
    setRecoveryMessage(null);
  };

  const prepare = () => {
    setAttempted(true);
    if (!dirty || !candidate?.success) return;
    setPending({
      body: candidate.data,
      idempotencyKey: createAdminIdempotencyKey('settings'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingSettings) => {
    const request = requestFence.begin('settings-update');
    setBusy(true);
    setConfirming(false);
    setError(null);
    setRecoveryMessage(null);
    const result = await requestAdminEventSettingsUpdate(
      api,
      eventId,
      attempt.body,
      attempt.idempotencyKey,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setSettings(null);
        setDraft(null);
        setReason('');
        setPending(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        const refresh = requestFence.begin('settings-stale-read');
        const current = await requestAdminEventSettings(
          api,
          eventId,
          refresh.signal,
        );
        if (!refresh.isCurrent()) return;
        refresh.finish();
        if (current.ok && current.kind === 'success') {
          setSettings(current.data);
          setRecoveryMessage(
            'Nastavení se mezitím změnilo. Váš návrh jsme zachovali; porovnejte ho s aktuálním stavem.',
          );
        } else {
          if (!current.ok && isAdminSecurityFailure(current)) {
            setSettings(null);
            setDraft(null);
            setReason('');
            invalidateSensitive(
              adminFailureMessage(current.failure, current.metadata?.requestId),
            );
            return;
          }
          setError('Aktuální nastavení se nepodařilo znovu načíst.');
        }
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setSettings(result.data.settings);
      setDraft(coreDraft(result.data.settings));
      setReason('');
      setPending(null);
      setAmbiguous(false);
      setAttempted(false);
      setEditing(false);
      setSuccess({
        message:
          result.data.outcome === 'already_applied'
            ? 'Toto nastavení už bylo uložené.'
            : 'Nastavení bylo uloženo.',
        auditId: result.data.audit.auditId,
      });
    }
  };

  if (!canManage) return null;

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Nastavení akce</h1>
        <p>
          Zkontrolujte provozní pravidla akce a před uložením si přečtěte jejich
          dopad na účastníky.
        </p>
      </header>

      {archived ? (
        <p className={styles.warning} role="status">
          Archivovaná akce je pouze ke čtení.
        </p>
      ) : null}
      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-settings-error"
          heading="Nastavení nelze dokončit"
          message={error}
        />
      ) : null}
      {recoveryMessage ? (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {success ? (
        <section className={styles.success} role="status">
          <strong>{success.message}</strong>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID auditu</dt>
              <dd>{success.auditId}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      {busy && !settings ? (
        <p role="status">Načítám nastavení akce…</p>
      ) : settings && draft ? (
        <section className={styles.panel} aria-labelledby="core-settings-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="core-settings-title">Provozní pravidla</h2>
              <p className={styles.muted}>
                Nastavení zprávy při problému zůstává beze změny do potvrzení
                jejího umístění a významu.
              </p>
            </div>
            {!editing && !archived ? (
              <button
                className={styles.button}
                onClick={() => {
                  setEditing(true);
                  setSuccess(null);
                }}
                type="button"
              >
                Upravit nastavení
              </button>
            ) : editing && !dirty ? (
              <button
                className={styles.secondaryButton}
                onClick={discard}
                type="button"
              >
                Zrušit úpravy
              </button>
            ) : null}
          </div>

          {invalid ? (
            <AdminFormErrorSummary
              descriptionId="admin-settings-validation"
              heading="Změny zatím nelze uložit"
              message="Doplňte důvod změny o nejméně 8 viditelných znaků."
            />
          ) : null}

          <fieldset className={styles.fieldset}>
            <legend>Registrace</legend>
            {editing ? (
              <div className={styles.summaryGrid}>
                {(
                  Object.keys(
                    registrationLabels,
                  ) as AdminEventSettings['registrationMode'][]
                ).map((mode, index) => (
                  <label className={styles.dataCard} key={mode}>
                    <input
                      checked={draft.registrationMode === mode}
                      disabled={frozen}
                      name="registration-mode"
                      onChange={() =>
                        setDraft({ ...draft, registrationMode: mode })
                      }
                      ref={index === 0 ? firstChoiceRef : undefined}
                      type="radio"
                    />
                    <strong>{registrationLabels[mode]}</strong>
                    <span>{registrationDescriptions[mode]}</span>
                  </label>
                ))}
              </div>
            ) : (
              <article className={styles.dataCard}>
                <strong>{registrationLabels[settings.registrationMode]}</strong>
                <p>{registrationDescriptions[settings.registrationMode]}</p>
              </article>
            )}
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend>Rezervace</legend>
            {editing ? (
              <label className={styles.checkRow}>
                <input
                  checked={draft.reservationChangesAllowed}
                  disabled={frozen}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      reservationChangesAllowed: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>
                  Účastníci mohou měnit své rezervace
                  <small>
                    Vypnutí uzamkne participant změny; administrátorské zásahy
                    zůstávají samostatně auditované.
                  </small>
                </span>
              </label>
            ) : (
              <p>
                {settings.reservationChangesAllowed
                  ? 'Účastníci mohou měnit své rezervace.'
                  : 'Účastníci své rezervace měnit nemohou.'}
              </p>
            )}
          </fieldset>

          {editing && dirty ? (
            <label className={styles.field}>
              <span>Důvod změny</span>
              <textarea
                aria-invalid={invalid}
                disabled={frozen}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
              <span className={styles.helper}>
                Důvod se uloží do historie změn.
              </span>
            </label>
          ) : null}

          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID akce</dt>
              <dd>{eventId}</dd>
              <dt>Časové pásmo</dt>
              <dd>{eventTimezone}</dd>
              <dt>Verze</dt>
              <dd>{settings.version}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      {editing && dirty && pending === null ? (
        <AdminUnsavedBar onDiscard={discard} onSave={prepare} saving={busy} />
      ) : null}
      {ambiguous && pending ? (
        <button
          className={styles.secondaryButton}
          disabled={busy}
          onClick={() => void execute(pending)}
          type="button"
        >
          Zopakovat přesně stejný pokus
        </button>
      ) : null}

      <AdminConfirmDialog
        actionLabel="Uložit nastavení"
        onCancel={() => {
          setConfirming(false);
          setPending(null);
        }}
        onConfirm={() => pending && void execute(pending)}
        open={confirming && pending !== null}
        title="Uložit změny nastavení?"
      >
        <p>
          Registrace: {draft ? registrationLabels[draft.registrationMode] : ''}
        </p>
        <p>
          Rezervace:{' '}
          {draft?.reservationChangesAllowed
            ? 'účastníci je mohou měnit'
            : 'účastníci je měnit nemohou'}
        </p>
      </AdminConfirmDialog>
    </div>
  );
};
