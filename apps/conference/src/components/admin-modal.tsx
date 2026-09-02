'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import styles from './admin-workspace.module.css';

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const AdminModal = ({
  children,
  describedBy,
  dismissDisabled = false,
  labelledBy,
  onDismiss,
  size = 'standard',
}: {
  readonly children: ReactNode;
  readonly describedBy?: string;
  readonly dismissDisabled?: boolean;
  readonly labelledBy: string;
  readonly onDismiss: () => void;
  readonly size?: 'standard' | 'wide';
}) => {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      const initialFocus =
        dialogRef.current?.querySelector<HTMLElement>(
          '[data-modal-initial-focus="true"]',
        ) ?? dialogRef.current?.querySelector<HTMLElement>('[tabindex="-1"]');
      initialFocus?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  return (
    <div
      className={styles.scrim}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!dismissDisabled) onDismiss();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
            [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !focusable.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onMouseDown={(event) => {
        if (!dismissDisabled && event.target === event.currentTarget) {
          onDismiss();
        }
      }}
    >
      <section
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`${styles.dialog} ${
          size === 'wide' ? styles.dialogWide : ''
        }`}
        ref={dialogRef}
        role="dialog"
      >
        {children}
      </section>
    </div>
  );
};
