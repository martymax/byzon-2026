'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import styles from './admin-workspace.module.css';

export const AdminConfirmDialog = ({
  title,
  description,
  impact,
  confirmLabel,
  acknowledgement,
  danger = false,
  onConfirm,
  onDismiss,
}: {
  readonly title: string;
  readonly description: string;
  readonly impact?: ReactNode;
  readonly confirmLabel: string;
  readonly acknowledgement: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmLocked = useRef(false);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    titleRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.scrim}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            ) ?? [],
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === titleRef.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <p id={descriptionId}>{description}</p>
        {impact}
        <label className={styles.checkRow}>
          <input
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>{acknowledgement}</span>
        </label>
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            onClick={onDismiss}
            type="button"
          >
            Zrušit
          </button>
          <button
            className={danger ? styles.dangerButton : styles.button}
            disabled={!acknowledged}
            onClick={() => {
              if (confirmLocked.current) return;
              confirmLocked.current = true;
              try {
                onConfirm();
              } catch (error) {
                confirmLocked.current = false;
                throw error;
              }
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
