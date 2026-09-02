'use client';

import { AdminTechnicalDetails } from '@byzon/ui';
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
  const referenceMatch = message.match(
    /^(.*) Reference požadavku: ([A-Za-z0-9._:-]{8,128})\.$/,
  );
  const visibleMessage = referenceMatch?.[1] ?? message;
  const requestReference = referenceMatch?.[2];

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
      <p id={descriptionId}>{visibleMessage}</p>
      {details?.length ? (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {requestReference ? (
        <AdminTechnicalDetails>
          <dl>
            <dt>Reference požadavku</dt>
            <dd>
              <code>{requestReference}</code>
            </dd>
          </dl>
        </AdminTechnicalDetails>
      ) : null}
    </section>
  );
};
