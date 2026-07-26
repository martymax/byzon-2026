'use client';

import { useEffect, useRef } from 'react';

import styles from './admin-workspace.module.css';

export const AdminFormErrorSummary = ({
  descriptionId,
  details,
  heading,
  message,
}: {
  readonly descriptionId: string;
  readonly details?: readonly string[];
  readonly heading: string;
  readonly message: string;
}) => {
  const summaryRef = useRef<HTMLElement | null>(null);
  const detailSignature = details?.join('\u0000') ?? '';

  useEffect(() => {
    summaryRef.current?.focus();
  }, [detailSignature, message]);

  return (
    <section
      className={styles.errorSummary}
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
    >
      <h2>{heading}</h2>
      <p id={descriptionId}>{message}</p>
      {details?.length ? (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
