'use client';

import { useEffect, useRef } from 'react';

import styles from './admin-workspace.module.css';

export const AdminFormErrorSummary = ({
  descriptionId,
  heading,
  message,
}: {
  readonly descriptionId: string;
  readonly heading: string;
  readonly message: string;
}) => {
  const summaryRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    summaryRef.current?.focus();
  }, [message]);

  return (
    <section
      className={styles.errorSummary}
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
    >
      <h2>{heading}</h2>
      <p id={descriptionId}>{message}</p>
    </section>
  );
};
