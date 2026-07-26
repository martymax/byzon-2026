'use client';

import { useEffect, useRef, useState } from 'react';

import {
  browserAdminContentPort,
  isAdminContentSecurityFailure,
  type AdminContentFailure,
  type AdminContentPort,
  type AdminPublicationPreview,
} from '@/lib/admin-content-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import styles from './admin-workspace.module.css';

const timestamp = (value: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'čas není dostupný';
  }
};

const requiresPublicationReconciliation = (
  failure: AdminContentFailure,
): boolean =>
  failure.kind === 'transport' ||
  failure.kind === 'server' ||
  failure.kind === 'invalid_response';

export const PublicationControl = ({
  contentRevision = 0,
  draftDirty = false,
  eventId,
  onSecurityFailure,
  port = browserAdminContentPort,
  readOnly = false,
}: {
  readonly contentRevision?: number;
  readonly draftDirty?: boolean;
  readonly eventId: string;
  readonly onSecurityFailure?: (failure: AdminContentFailure) => void;
  readonly port?: AdminContentPort;
  readonly readOnly?: boolean;
}) => {
  const [preview, setPreview] = useState<AdminPublicationPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'publish' | 'reconcile' | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<AdminContentFailure | null>(null);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [blockedUntilContentRevision, setBlockedUntilContentRevision] =
    useState(false);
  const [status, setStatus] = useState('');
  const locked = useRef(false);
  const mountedRevision = useRef(contentRevision);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      locked.current = false;
    },
    [eventId, port],
  );

  useEffect(() => {
    if (mountedRevision.current === contentRevision) return;
    mountedRevision.current = contentRevision;
    setBlockedUntilContentRevision(false);
    activeRequest.current?.abort();
    activeRequest.current = null;
    locked.current = false;
    setBusy(null);
    if (reconciliationRequired) {
      // Preserve the frozen candidate while reflecting an external draft
      // revision; only explicit reconciliation may unlock publication.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(
        'Draft se změnil, ale výsledek předchozí publikace stále není potvrzen. Ověřte kanonický stav.',
      );
      return;
    }
    setPreview(null);
    setConfirming(false);
    setError(null);
    setStatus(
      'Draft se změnil. Před publikací sestavte nový immutable náhled.',
    );
  }, [contentRevision, reconciliationRequired]);

  useEffect(() => {
    if (!draftDirty) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    locked.current = false;
    // Dirty state is an external workspace signal and must invalidate the
    // publication controls in the same render turn.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(null);
    if (reconciliationRequired) return;
    setPreview(null);
    setConfirming(false);
    setError(null);
    setStatus(
      'Formulář obsahuje neuložené změny. Před sestavením náhledu je uložte nebo zahoďte.',
    );
  }, [draftDirty, reconciliationRequired]);

  const acceptFailure = (
    failure: AdminContentFailure,
    preservePreview = false,
  ) => {
    if (failure.kind === 'aborted') return;
    if (!preservePreview) setPreview(null);
    setConfirming(false);
    if (isAdminContentSecurityFailure(failure)) {
      setStatus('');
      setError(null);
      onSecurityFailure?.(failure);
      return;
    }
    setError(failure);
  };

  const createPreview = async () => {
    if (
      locked.current ||
      readOnly ||
      draftDirty ||
      reconciliationRequired ||
      blockedUntilContentRevision
    )
      return;
    locked.current = true;
    setBusy('preview');
    setError(null);
    setStatus('');
    const controller = new AbortController();
    activeRequest.current = controller;
    const result = await port.previewPublication(eventId, controller.signal);
    if (controller.signal.aborted || activeRequest.current !== controller) {
      return;
    }
    activeRequest.current = null;
    locked.current = false;
    setBusy(null);
    if (!result.ok) {
      acceptFailure(result.failure);
      return;
    }
    setPreview(result.data);
    setStatus(
      `Immutable náhled verze ${result.data.version} je připravený k samostatnému potvrzení.`,
    );
  };

  const publish = async () => {
    const candidate = preview;
    if (
      !candidate ||
      locked.current ||
      readOnly ||
      draftDirty ||
      reconciliationRequired ||
      blockedUntilContentRevision
    )
      return;
    locked.current = true;
    setBusy('publish');
    setConfirming(false);
    setError(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    const result = await port.publish(eventId, candidate, controller.signal);
    if (controller.signal.aborted || activeRequest.current !== controller) {
      return;
    }
    activeRequest.current = null;
    locked.current = false;
    setBusy(null);
    if (!result.ok) {
      if (requiresPublicationReconciliation(result.failure)) {
        setReconciliationRequired(true);
        setStatus(
          'Výsledek publikace není potvrzen. Frozen náhled zůstává uzamčený do ověření kanonického stavu.',
        );
        acceptFailure(result.failure, true);
      } else {
        acceptFailure(result.failure);
      }
      return;
    }
    setPreview(null);
    setStatus(
      `Verze ${result.data.version} byla atomicky publikována. Kontrolní součet ${result.data.checksumSha256.slice(0, 12)}…`,
    );
  };

  const reconcile = async () => {
    const frozenPreview = preview;
    if (locked.current || readOnly || !reconciliationRequired || !frozenPreview)
      return;
    locked.current = true;
    setBusy('reconcile');
    const controller = new AbortController();
    activeRequest.current = controller;
    const result = await port.previewPublication(eventId, controller.signal);
    if (controller.signal.aborted || activeRequest.current !== controller) {
      return;
    }
    activeRequest.current = null;
    locked.current = false;
    setBusy(null);
    if (!result.ok) {
      if (isAdminContentSecurityFailure(result.failure)) {
        acceptFailure(result.failure);
        return;
      }
      if (requiresPublicationReconciliation(result.failure)) {
        setError(result.failure);
        setStatus(
          'Kanonický stav se nepodařilo ověřit. Publikace zůstává uzamčená.',
        );
        return;
      }
      setReconciliationRequired(false);
      setBlockedUntilContentRevision(true);
      setPreview(null);
      setError(result.failure);
      setStatus(
        'Server potvrdil kanonický stav bez publikovatelné změny. Další publikace zůstává vypnutá, dokud se draft nezmění.',
      );
      return;
    }
    setReconciliationRequired(false);
    setError(null);
    if (
      result.data.version === frozenPreview.version &&
      result.data.expectedPreviousVersion ===
        frozenPreview.expectedPreviousVersion &&
      result.data.checksumSha256 === frozenPreview.checksumSha256
    ) {
      setPreview(result.data);
      setBlockedUntilContentRevision(false);
      setStatus(
        `Kanonický stav přesně odpovídá frozen náhledu verze ${result.data.version}. Publikaci lze znovu samostatně potvrdit.`,
      );
    } else {
      setPreview(null);
      setBlockedUntilContentRevision(true);
      setStatus(
        'Kanonický stav se posunul nebo změnil. Frozen náhled byl zneplatněn; další publikace vyžaduje skutečnou změnu draftu a nový ručně sestavený náhled.',
      );
    }
  };

  const visiblePreview = draftDirty && !reconciliationRequired ? null : preview;

  return (
    <section
      aria-labelledby="admin-publication-title"
      className={styles.publicationControl}
    >
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Publikační gate</p>
          <h2 id="admin-publication-title">Immutable náhled a publikace</h2>
        </div>
        {visiblePreview ? (
          <span className={styles.statusBadge}>
            Preview v{visiblePreview.version}
          </span>
        ) : null}
      </div>

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-publication-error"
          details={Object.values(error.fieldErrors ?? {})}
          heading={
            reconciliationRequired
              ? 'Výsledek publikace není potvrzen'
              : error.kind === 'stale'
                ? 'Publikační náhled už není aktuální'
                : 'Publikaci nelze dokončit'
          }
          message={
            error.requestId
              ? `${error.message} Reference požadavku: ${error.requestId}.`
              : error.message
          }
        />
      ) : null}

      <p aria-live="polite" className={status ? styles.callout : styles.muted}>
        {status ||
          (readOnly
            ? 'Archivovaný event je pouze ke čtení.'
            : 'Nejprve sestavte náhled aktuálního draftu. Publikace vyžaduje další výslovné potvrzení.')}
      </p>

      {reconciliationRequired ? (
        <p className={styles.warning} role="status">
          Frozen preview, cílová verze i očekávaná předchozí verze zůstávají
          zachované. Opakovaný publish je blokovaný, dokud server nepotvrdí
          kanonický stav.
        </p>
      ) : null}

      {visiblePreview ? (
        <dl className={styles.detailList}>
          <dt>Cílová verze</dt>
          <dd>{visiblePreview.version}</dd>
          <dt>Předchozí verze</dt>
          <dd>{visiblePreview.expectedPreviousVersion}</dd>
          <dt>Kontrolní součet</dt>
          <dd className={styles.checksum}>
            <code>{visiblePreview.checksumSha256}</code>
          </dd>
          <dt>Vytvořeno</dt>
          <dd>{timestamp(visiblePreview.createdAt)}</dd>
          <dt>Položek</dt>
          <dd>{visiblePreview.itemCount}</dd>
          <dt>Významně změněné body programu</dt>
          <dd>
            {visiblePreview.significantSessionIds.length ? (
              <ul className={styles.compactList}>
                {visiblePreview.significantSessionIds.map((sessionId) => (
                  <li key={sessionId}>
                    <code>{sessionId}</code>
                  </li>
                ))}
              </ul>
            ) : (
              'Žádné'
            )}
          </dd>
        </dl>
      ) : null}

      {!readOnly ? (
        <div className={styles.actionRow}>
          <button
            className={styles.secondaryButton}
            disabled={
              busy !== null ||
              draftDirty ||
              reconciliationRequired ||
              blockedUntilContentRevision
            }
            onClick={() => void createPreview()}
            type="button"
          >
            {busy === 'preview' ? 'Sestavuji náhled…' : 'Sestavit nový náhled'}
          </button>
          <button
            className={styles.dangerButton}
            disabled={
              !visiblePreview ||
              busy !== null ||
              draftDirty ||
              reconciliationRequired ||
              blockedUntilContentRevision
            }
            onClick={() => setConfirming(true)}
            type="button"
          >
            {busy === 'publish' ? 'Publikuji…' : 'Zkontrolovat a publikovat'}
          </button>
          {reconciliationRequired ? (
            <button
              className={styles.button}
              disabled={busy !== null}
              onClick={() => void reconcile()}
              type="button"
            >
              {busy === 'reconcile'
                ? 'Ověřuji kanonický stav…'
                : 'Ověřit kanonický stav'}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming && visiblePreview ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem cílovou verzi, kontrolní součet a dopad publikace."
          confirmLabel={`Publikovat verzi ${visiblePreview.version}`}
          danger
          description="Server atomicky publikuje právě tento immutable snapshot. Pokud se draft změnil, operaci odmítne."
          impact={
            <p>
              Předchozí verze {visiblePreview.expectedPreviousVersion} → nová
              verze {visiblePreview.version}. {visiblePreview.itemCount}{' '}
              položek, {visiblePreview.significantSessionIds.length} významně
              změněných bodů. Kontrolní součet{' '}
              <code className={styles.checksum}>
                {visiblePreview.checksumSha256}
              </code>
            </p>
          }
          onConfirm={() => void publish()}
          onDismiss={() => setConfirming(false)}
          title="Publikovat obsah akce?"
        />
      ) : null}
    </section>
  );
};
