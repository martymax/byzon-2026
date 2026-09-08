'use client';

import { useId, useState } from 'react';

import { AdminModal } from './admin-modal';
import styles from './admin-workspace.module.css';

export function AdminSessionQr({
  eventId,
  sessionId,
  title,
  target,
}: {
  readonly eventId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly target: 'program' | 'questions' | 'rating';
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const headingId = useId();
  const href = `/api/v1/admin/events/${eventId}/session-qr/${sessionId}?target=${target}`;
  const label =
    target === 'questions'
      ? 'Q&A QR'
      : target === 'rating'
        ? 'QR hodnocení'
        : 'QR programu';
  const qrImage = (large: boolean) => (
    // The authenticated SVG endpoint must bypass the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      alt={large ? `${label}: ${title}` : ''}
      className={large ? styles.sessionQrPreview : styles.sessionQrThumbnail}
      height={large ? 320 : 72}
      loading={large ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      src={href}
      width={large ? 320 : 72}
    />
  );

  return (
    <div className={styles.sessionQr}>
      <button
        aria-label={`Zobrazit ${label}: ${title}`}
        className={styles.sessionQrButton}
        onClick={() => setOpen(true)}
        type="button"
      >
        {failed ? <span>Náhled není dostupný</span> : qrImage(false)}
        <span>{label}</span>
      </button>
      {open ? (
        <AdminModal labelledBy={headingId} onDismiss={() => setOpen(false)}>
          <h2 id={headingId} tabIndex={-1}>
            {title}
          </h2>
          <p>
            {target === 'questions'
              ? 'QR pro položení dotazu k přednášce.'
              : target === 'rating'
                ? 'QR pro hodnocení přednášky. Hodnocení se otevře po jejím skončení. PNG můžete vložit na poslední slide prezentace.'
                : 'QR pro otevření detailu programu.'}
          </p>
          {failed ? (
            <div role="status">
              <p>
                QR se nepodařilo načíst. Ověřte přihlášení a zveřejnění bodu
                programu.
              </p>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
                type="button"
              >
                Zkusit znovu
              </button>
            </div>
          ) : (
            qrImage(true)
          )}
          <div className={styles.dialogActions}>
            {(['svg', 'png'] as const).map((format) => (
              <a
                key={format}
                aria-label={`Stáhnout ${format.toUpperCase()}`}
                title={`Stáhnout ${format.toUpperCase()}`}
                className={styles.sessionQrDownload}
                download
                href={`${href}&format=${format}`}
              >
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M12 11v7m-3-3 3 3 3-3" />
                </svg>
                <span>{format.toUpperCase()}</span>
              </a>
            ))}
            <button
              className={styles.secondaryButton}
              onClick={() => setOpen(false)}
              type="button"
            >
              Zavřít
            </button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
