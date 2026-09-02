'use client';

import type { AdminContentResource } from '@/lib/admin-content-api';

import { AdminContentWorkspace } from './admin-content-workspace';
import { useAdminWorkspace } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

export const AdminContentProductionWorkspace = ({
  initialResource,
}: {
  readonly initialResource: AdminContentResource;
}) => {
  const { context, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const readOnly =
    context.event.phase === 'archived' ||
    !permissions.includes('program:manage');

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Obsah akce</p>
        <h1>Program a obsah</h1>
        <p>
          Nejdřív vyberte oblast a existující položku. Uložené změny pak
          samostatně zkontrolujte a zveřejněte.
        </p>
      </header>
      <AdminContentWorkspace
        eventId={eventId}
        initialResource={initialResource}
        onSecurityFailure={(failure) => invalidateSensitive(failure.message)}
        readOnly={readOnly}
        timezone={eventTimezone}
      />
    </div>
  );
};
