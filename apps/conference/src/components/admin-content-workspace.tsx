'use client';

import { useCallback, useState } from 'react';

import type {
  AdminContentFailure,
  AdminContentPort,
  AdminContentResource,
} from '@/lib/admin-content-api';

import type { AdminContentAssetPort } from './admin-content-asset-field';
import { AdminContentConsole } from './admin-content-console';
import styles from './admin-workspace.module.css';
import { PublicationControl } from './publication-control';

export const AdminContentWorkspace = ({
  assetPort,
  eventId,
  initialResource,
  showAreaNavigation = true,
  onDirtyChange,
  onSecurityFailure,
  port,
  readOnly = false,
  timezone,
}: {
  readonly assetPort?: AdminContentAssetPort;
  readonly eventId: string;
  readonly initialResource?: AdminContentResource;
  readonly showAreaNavigation?: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onSecurityFailure?: (failure: AdminContentFailure) => void;
  readonly port?: AdminContentPort;
  readonly readOnly?: boolean;
  readonly timezone: string;
}) => {
  const [contentRevision, setContentRevision] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [securityGeneration, setSecurityGeneration] = useState(0);
  const [securityFailure, setSecurityFailure] =
    useState<AdminContentFailure | null>(null);

  const handleSecurityFailure = useCallback(
    (failure: AdminContentFailure) => {
      setSecurityFailure(failure);
      onSecurityFailure?.(failure);
    },
    [onSecurityFailure],
  );
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      setEditorDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );

  if (securityFailure) {
    return (
      <section
        aria-labelledby="admin-content-blocked-title"
        className={`${styles.contentWorkspace} ${styles.forbidden}`}
        data-admin-root=""
        role="alert"
      >
        <p className={styles.eyebrow}>Přístup k obsahu uzavřen</p>
        <h2 id="admin-content-blocked-title">Obsah nelze bezpečně zobrazit</h2>
        <p>{securityFailure.message}</p>
        {securityFailure.kind === 'session_expired' ? (
          <a
            className={styles.secondaryButton}
            href="/prihlaseni?mode=recovery&amp;returnTo=%2Fadmin%2Fobsah"
          >
            Přihlásit se znovu
          </a>
        ) : (
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setSecurityFailure(null);
              setSecurityGeneration((value) => value + 1);
            }}
            type="button"
          >
            Ověřit a načíst znovu
          </button>
        )}
      </section>
    );
  }

  return (
    <div
      className={styles.contentWorkspace}
      data-admin-root=""
      key={securityGeneration}
    >
      <AdminContentConsole
        {...(assetPort ? { assetPort } : {})}
        eventId={eventId}
        {...(initialResource ? { initialResource } : {})}
        showAreaNavigation={showAreaNavigation}
        onContentChanged={() => setContentRevision((value) => value + 1)}
        onDirtyChange={handleDirtyChange}
        onSecurityFailure={handleSecurityFailure}
        {...(port ? { port } : {})}
        readOnly={readOnly}
        timezone={timezone}
      />
      <PublicationControl
        contentRevision={contentRevision}
        draftDirty={editorDirty}
        eventId={eventId}
        onSecurityFailure={handleSecurityFailure}
        {...(port ? { port } : {})}
        readOnly={readOnly}
        timezone={timezone}
      />
    </div>
  );
};
