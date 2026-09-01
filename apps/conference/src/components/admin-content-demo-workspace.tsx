'use client';

import { useState } from 'react';

import {
  ADMIN_CONTENT_PREVIEW_BOUNDARY_MARKER,
  createAdminContentPreviewPort,
  isAdminContentPreviewReadOnly,
  type AdminContentPreviewMode,
} from '@/lib/admin-content-preview-port';
import { mayLeaveAdminContentDraft } from '@/lib/admin-content-dirty-guard';

import { createAdminContentAssetPreviewPort } from './admin-content-asset-field';
import { AdminContentWorkspace } from './admin-content-workspace';
import { useAdminWorkspace } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const previewModes: readonly {
  readonly label: string;
  readonly value: AdminContentPreviewMode;
}[] = [
  { value: 'ready', label: 'Běžný stateful průchod' },
  { value: 'empty', label: 'Prázdné seznamy' },
  { value: 'archived', label: 'Archivovaná akce · pouze čtení' },
  { value: 'stale', label: 'Stale verze při zápisu' },
  { value: 'conflict', label: 'Kolize programu při zápisu' },
  { value: 'offline', label: 'Offline · bezpečný wipe' },
  { value: 'permission', label: 'Odebrané oprávnění · bezpečný wipe' },
  { value: 'session_expired', label: 'Vypršelá relace · bezpečný wipe' },
] as const;

export const AdminContentDemoWorkspace = () => {
  const { context, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const [port] = useState(() => createAdminContentPreviewPort({ eventId }));
  const [assetPort] = useState(() => createAdminContentAssetPreviewPort());
  const [mode, setMode] = useState<AdminContentPreviewMode>('ready');
  const [generation, setGeneration] = useState(0);
  const archived = context.event.phase === 'archived';

  return (
    <div
      className={styles.stack}
      data-preview-boundary={ADMIN_CONTENT_PREVIEW_BOUNDARY_MARKER}
    >
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Obsah akce · bezpečný preview</p>
        <h1>Program a obsah</h1>
        <p>
          Stejný editor a publikační gate jako v produkčním adapteru, napájený
          pouze stateful syntetickými daty. Žádná akce nemění produkční obsah.
        </p>
      </header>

      <section
        aria-labelledby="content-preview-scenario-title"
        className={styles.callout}
      >
        <h2 id="content-preview-scenario-title">Syntetický datový scénář</h2>
        <label className={styles.field}>
          <span>Stav následujícího průchodu</span>
          <select
            onChange={(event) => {
              if (!mayLeaveAdminContentDraft()) return;
              const next = event.target.value as AdminContentPreviewMode;
              port.setMode(next);
              setMode(next);
              setGeneration((value) => value + 1);
            }}
            value={mode}
          >
            {previewModes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.helper}>
          Offline, odebrané oprávnění a vypršelá relace záměrně odstraní načtený
          P3 obsah a uzavřou workspace.
        </p>
      </section>

      <AdminContentWorkspace
        assetPort={assetPort}
        eventId={eventId}
        key={generation}
        onSecurityFailure={(failure) => invalidateSensitive(failure.message)}
        port={port}
        readOnly={
          archived ||
          isAdminContentPreviewReadOnly(mode) ||
          !permissions.includes('program:manage')
        }
        timezone={eventTimezone}
      />
    </div>
  );
};
