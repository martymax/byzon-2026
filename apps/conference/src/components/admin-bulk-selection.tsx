'use client';

import { useId, useRef, useEffect, useState } from 'react';
import styles from './admin-bulk.module.css';

export interface AdminBulkSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
}

export const useAdminBulkSelection = (scope: string): AdminBulkSelection => {
  const [state, setState] = useState<{
    scope: string;
    ids: ReadonlySet<string>;
  }>({ scope, ids: new Set() });
  if (state.scope !== scope) setState({ scope, ids: new Set() });
  return {
    selectedIds: state.scope === scope ? state.ids : new Set<string>(),
    onSelectionChange: (ids) => setState({ scope, ids }),
  };
};

export const AdminBulkCheckbox = ({
  selection,
  id,
  label,
  disabled = false,
}: {
  readonly selection: AdminBulkSelection;
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}) => (
  <label className={styles.checkbox}>
    <input
      type="checkbox"
      checked={selection.selectedIds.has(id)}
      disabled={disabled}
      aria-label={`Vybrat: ${label}`}
      onChange={(event) => {
        const next = new Set(selection.selectedIds);
        if (event.target.checked) next.add(id);
        else next.delete(id);
        selection.onSelectionChange(next);
      }}
    />
  </label>
);

export const AdminBulkSelectAll = ({
  selection,
  ids,
  disabled = false,
  label = 'Vybrat vše',
}: {
  readonly selection: AdminBulkSelection;
  readonly ids: readonly string[];
  readonly disabled?: boolean;
  readonly label?: string;
}) => {
  const count = ids.filter((id) => selection.selectedIds.has(id)).length;
  const ref = useRef<HTMLInputElement>(null);
  const description = useId();
  useEffect(() => {
    if (ref.current)
      ref.current.indeterminate = count > 0 && count < ids.length;
  }, [count, ids.length]);
  return (
    <div className={styles.selectionHeader}>
      <label className={styles.selectAll}>
        <input
          ref={ref}
          type="checkbox"
          aria-describedby={description}
          disabled={disabled || ids.length === 0}
          checked={ids.length > 0 && count === ids.length}
          onChange={(event) =>
            selection.onSelectionChange(
              new Set(event.target.checked ? ids : []),
            )
          }
        />
        <span>{label}</span>
      </label>
      <span id={description} className={styles.scopeNote}>
        Položky v přehledu: {ids.length}
      </span>
    </div>
  );
};
