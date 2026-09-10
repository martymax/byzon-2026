'use client';

import { useState } from 'react';
import type { AdminReservationSessionItem } from '@byzon/domain/contracts/admin';
import {
  AdminBulkCheckbox,
  AdminBulkSelectAll,
  useAdminBulkSelection,
} from './admin-bulk-selection';
import { AdminReservationCancellationBulk } from './admin-reservations-bulk';
import styles from './admin-workspace.module.css';

/** The reservation view shares the activity filters and supports selections across activities. */
export const AdminReservationBulkList = ({
  sessions,
  scope,
  disabled,
  onBusyChange,
  onCompleted,
}: {
  readonly sessions: readonly AdminReservationSessionItem[];
  readonly scope: string;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const selection = useAdminBulkSelection(JSON.stringify([scope, query]));
  const normalized = query.trim().toLocaleLowerCase('cs');
  const reservations = sessions.flatMap((session) =>
    session.reservations.map((record) => ({
      ...record,
      sessionTitle: session.sessionTitle,
    })),
  );
  const visible = reservations.filter((record) =>
    `${record.participantName} ${record.contactEmail} ${record.sessionTitle}`
      .toLocaleLowerCase('cs')
      .includes(normalized),
  );
  const selectable = visible.filter(
    (record) =>
      record.state === 'reserved' &&
      record.availableActions.includes('cancel_reservation'),
  );
  return (
    <div>
      <label className={styles.field}>
        <span>Hledat rezervaci</span>
        <input
          type="search"
          value={query}
          placeholder="Účastník, e-mail nebo aktivita"
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(30);
          }}
        />
      </label>
      <AdminBulkSelectAll
        selection={selection}
        ids={selectable.map((record) => record.reservationId)}
        disabled={disabled}
        label="Vybrat aktivní rezervace"
      />
      <AdminReservationCancellationBulk
        {...selection}
        inlineEditor={false}
        reservations={visible}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onCompleted={onCompleted}
      />
      <ul className={styles.cardList}>
        {visible.slice(0, limit).map((record) => (
          <li
            key={record.reservationId}
            className={styles.dataCard}
            data-bulk-selected={selection.selectedIds.has(record.reservationId)}
          >
            <div className={styles.panelHeader}>
              <div className={styles.bulkCardHeading}>
                <AdminBulkCheckbox
                  selection={selection}
                  id={record.reservationId}
                  label={`${record.participantName} · ${record.sessionTitle}`}
                  disabled={
                    disabled ||
                    !selectable.some(
                      (item) => item.reservationId === record.reservationId,
                    )
                  }
                />
                <div className={styles.identityCell}>
                  <strong>{record.participantName}</strong>
                  <small>{record.contactEmail}</small>
                </div>
              </div>
              <span className={styles.statusBadge}>
                {record.state === 'reserved'
                  ? 'Aktivní rezervace'
                  : 'Zrušená rezervace'}
              </span>
            </div>
            <p className={styles.muted}>{record.sessionTitle}</p>
          </li>
        ))}
      </ul>
      {visible.length === 0 ? (
        <p className={styles.empty}>
          Žádné rezervace neodpovídají zvoleným filtrům.
        </p>
      ) : null}
      {visible.length > limit ? (
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setLimit((current) => current + 30)}
        >
          Zobrazit další rezervace ({visible.length - limit})
        </button>
      ) : null}
    </div>
  );
};
