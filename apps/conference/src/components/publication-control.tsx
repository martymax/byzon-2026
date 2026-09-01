'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminTechnicalDetails } from '@byzon/ui';
import Link from 'next/link';

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

const timestamp = (value: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'čas není dostupný';
  }
};

const changeImpactLabels = {
  content: 'změna obsahu',
  time: 'změna času',
  location: 'změna místa',
  status: 'změna stavu',
  order: 'změna pořadí',
} as const;

const changeCountLabel = (count: number): string =>
  count === 1
    ? '1 změnu'
    : count >= 2 && count <= 4
      ? `${count} změny`
      : `${count} změn`;

const publicationChangeCount = (
  summary: AdminPublicationPreview['summary'],
): number => summary.changeCount ?? summary.changes.length;

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
  timezone,
}: {
  readonly contentRevision?: number;
  readonly draftDirty?: boolean;
  readonly eventId: string;
  readonly onSecurityFailure?: (failure: AdminContentFailure) => void;
  readonly port?: AdminContentPort;
  readonly readOnly?: boolean;
  readonly timezone: string;
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
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
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
        'Uložený obsah se změnil, ale výsledek předchozího zveřejnění stále není potvrzen. Načtěte aktuální stav ze serveru.',
      );
      return;
    }
    setPreview(null);
    setPublishedAt(null);
    setConfirming(false);
    setError(null);
    setStatus(
      'Uložený obsah se změnil. Před zveřejněním zkontrolujte nový přehled změn.',
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
    setPublishedAt(null);
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
      result.data.summary.available
        ? publicationChangeCount(result.data.summary) === 1
          ? 'Obsah má 1 změnu ke kontrole.'
          : `Obsah má ${publicationChangeCount(result.data.summary)} změn ke kontrole.`
        : 'Obsah má změny ke kontrole.',
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
          'Výsledek zveřejnění není potvrzen. Zkontrolovaný návrh zůstává uzamčený do ověření aktuálního stavu na serveru.',
        );
        acceptFailure(result.failure, true);
      } else {
        acceptFailure(result.failure);
      }
      return;
    }
    setPreview(null);
    setPublishedAt(result.data.publishedAt);
    setStatus(
      `Změny byly zveřejněné ${timestamp(result.data.publishedAt, timezone)}.`,
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
          'Aktuální stav na serveru se nepodařilo ověřit. Zveřejnění zůstává uzamčené.',
        );
        return;
      }
      setReconciliationRequired(false);
      setBlockedUntilContentRevision(true);
      setPreview(null);
      setError(result.failure);
      setStatus(
        'Server potvrdil aktuální stav bez změny ke zveřejnění. Další zveřejnění zůstává vypnuté, dokud se uložený obsah nezmění.',
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
        'Aktuální stav přesně odpovídá zkontrolovanému návrhu. Zveřejnění lze znovu samostatně potvrdit.',
      );
    } else {
      setPreview(null);
      setBlockedUntilContentRevision(true);
      setStatus(
        'Obsah na serveru se mezitím změnil. Před dalším zveřejněním uložte změnu a zkontrolujte nový přehled.',
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
          <p className={styles.eyebrow}>Poslední krok</p>
          <h2 id="admin-publication-title">Zveřejnění</h2>
        </div>
        {visiblePreview ? (
          <span className={styles.statusBadge}>Připraveno ke kontrole</span>
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
            ? 'Archivovaná akce je pouze ke čtení.'
            : 'Obsah má změny ke kontrole. Zveřejnění vždy vyžaduje samostatné potvrzení.')}
      </p>

      {publishedAt ? (
        <p className={styles.success} role="status">
          <Link href="/app/program" prefetch={false}>
            Zobrazit publikovaný obsah
          </Link>
        </p>
      ) : null}

      {reconciliationRequired ? (
        <p className={styles.warning} role="status">
          Kontrolovaný návrh zůstává uzamčený. Další zveřejnění je blokované,
          dokud server nepotvrdí aktuální stav.
        </p>
      ) : null}

      {visiblePreview ? (
        <div className={styles.publicationReview}>
          {visiblePreview.summary.previousPublication ? (
            <p className={styles.muted}>
              Naposledy zveřejněno{' '}
              {timestamp(
                visiblePreview.summary.previousPublication.publishedAt,
                timezone,
              )}
              .
            </p>
          ) : (
            <p className={styles.muted}>Půjde o první zveřejnění obsahu.</p>
          )}
          {visiblePreview.summary.available ? (
            visiblePreview.summary.changes.length ? (
              <ul className={styles.publicationChangeList}>
                {visiblePreview.summary.changes.map((change, index) => (
                  <li key={`${change.resource}:${change.title}:${index}`}>
                    <strong>{change.title}</strong>
                    <span>
                      {change.kind === 'added'
                        ? 'Přidáno'
                        : change.kind === 'updated'
                          ? 'Upraveno'
                          : change.kind === 'cancelled'
                            ? 'Zrušeno'
                            : 'Archivováno'}
                      {' · '}
                      {change.impact
                        .map((impact) => changeImpactLabels[impact])
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>V uloženém obsahu nejsou žádné nezveřejněné změny.</p>
            )
          ) : (
            <p>
              Podrobný seznam změn není dostupný. Před zveřejněním zkontrolujte
              obsah ručně.
            </p>
          )}
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>Cílová verze</dt>
              <dd>{visiblePreview.version}</dd>
              <dt>Předchozí verze</dt>
              <dd>{visiblePreview.expectedPreviousVersion}</dd>
              <dt>Kontrolní součet</dt>
              <dd className={styles.checksum}>
                <code>{visiblePreview.checksumSha256}</code>
              </dd>
              <dt>Náhled vytvořen</dt>
              <dd>{timestamp(visiblePreview.createdAt, timezone)}</dd>
              <dt>Položek v obsahu</dt>
              <dd>{visiblePreview.itemCount}</dd>
            </dl>
          </AdminTechnicalDetails>
        </div>
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
            {busy === 'preview' ? 'Načítám změny…' : 'Zkontrolovat změny'}
          </button>
          <button
            className={styles.button}
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
            {busy === 'publish' ? 'Zveřejňuji…' : 'Pokračovat ke zveřejnění'}
          </button>
          {reconciliationRequired ? (
            <button
              className={styles.button}
              disabled={busy !== null}
              onClick={() => void reconcile()}
              type="button"
            >
              {busy === 'reconcile'
                ? 'Ověřuji aktuální stav…'
                : 'Načíst aktuální stav'}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming && visiblePreview ? (
        <AdminConfirmDialog
          acknowledgement="Zkontroloval/a jsem uvedené změny a jejich dopad v aplikaci a na webu."
          confirmLabel="Zveřejnit změny"
          description="Uložené změny se současně zobrazí účastníkům v aplikaci a na webu. Pokud se obsah mezitím změnil, server operaci bezpečně odmítne."
          impact={
            <p>
              {visiblePreview.summary.available
                ? `${publicationChangeCount(visiblePreview.summary)} změn se zobrazí účastníkům.`
                : 'Změny se zobrazí účastníkům v aplikaci a na webu.'}
            </p>
          }
          onConfirm={() => void publish()}
          onDismiss={() => setConfirming(false)}
          title={
            visiblePreview.summary.available
              ? `Zveřejnit ${changeCountLabel(publicationChangeCount(visiblePreview.summary))}?`
              : 'Zveřejnit změny?'
          }
        />
      ) : null}
    </section>
  );
};
