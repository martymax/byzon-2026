'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  runAdminBulk,
  type AdminBulkOutcome,
  type AdminBulkResult,
} from './admin-bulk';
import { AdminConfirmDialog } from './admin-confirm-dialog';
import styles from './admin-workspace.module.css';

export type BulkValues = Readonly<Record<string, string>>;
export interface BulkField {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'number';
  readonly options?: readonly { value: string; label: string }[];
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
}
export interface AdminBulkAction<Item> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly danger?: boolean;
  readonly reasonRequired?: boolean;
  readonly fields?: readonly BulkField[];
  readonly eligible?: (item: Item, values: BulkValues) => boolean;
  readonly validate?: (
    items: readonly Item[],
    values: BulkValues,
  ) => string | null;
  readonly order?: (
    items: readonly Item[],
    values: BulkValues,
  ) => readonly Item[];
  readonly execute: (
    item: Item,
    values: BulkValues,
    signal: AbortSignal,
    index: number,
  ) => Promise<AdminBulkResult>;
}

export const AdminBulkPanel = <Item,>({
  items,
  identify,
  actions,
  disabled = false,
  onBusyChange,
  onCompleted,
  title = 'Hromadné úpravy',
  selectedIds,
  onSelectionChange,
  onOpen,
  selectionMode = 'list',
}: {
  readonly items: readonly Item[];
  readonly identify: (item: Item) => {
    id: string;
    label: string;
    detail?: string;
  };
  readonly actions: readonly AdminBulkAction<Item>[];
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onOpen?: () => void;
  readonly selectionMode?: 'list' | 'external';
  readonly selectedIds?: ReadonlySet<string>;
  readonly onSelectionChange?: (ids: ReadonlySet<string>) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const id = useId();
  const [expanded, setExpanded] = useState(selectionMode === 'external');
  const [localSelected, setLocalSelected] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selected = selectedIds ?? localSelected;
  const setSelected = onSelectionChange ?? setLocalSelected;
  const [query, setQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const [values, setValues] = useState<BulkValues>({});
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<readonly AdminBulkOutcome[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    action: AdminBulkAction<Item>;
    items: readonly Item[];
    values: BulkValues;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const running = progress !== null;
  const action = actions.find(({ id: actionKey }) => actionKey === actionId);
  const visible = items.filter((item) => {
    const { label, detail } = identify(item);
    return `${label} ${detail ?? ''}`
      .toLocaleLowerCase('cs')
      .includes(query.trim().toLocaleLowerCase('cs'));
  });
  const chosen = visible.filter((item) => selected.has(identify(item).id));
  const eligible = chosen.filter(
    (item) => !action?.eligible || action.eligible(item, values),
  );
  const allSelected = visible.length > 0 && chosen.length === visible.length;

  useEffect(() => {
    if (allRef.current)
      allRef.current.indeterminate = chosen.length > 0 && !allSelected;
  }, [allSelected, chosen.length]);
  useEffect(() => () => controller.current?.abort(), []);

  const execute = async () => {
    if (!pending || controller.current || disabled) return;
    const batch = pending;
    const active = new AbortController();
    controller.current = active;
    setPending(null);
    setOutcomes([]);
    setProgress(0);
    onBusyChange?.(true);
    const results = await runAdminBulk(
      batch.items,
      identify,
      (item, index) =>
        batch.action.execute(item, batch.values, active.signal, index),
      active.signal,
      setProgress,
    );
    if (active.signal.aborted) return;
    controller.current = null;
    setOutcomes(results);
    setSelected(new Set());
    setProgress(null);
    onBusyChange?.(false);
    onCompleted();
  };

  return (
    <details
      className={styles.bulkPanel}
      open={expanded}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary>{title}</summary>
      {expanded ? (
        <div className={styles.stack}>
          <p className={styles.muted}>
            {selectionMode === 'external'
              ? 'Zaškrtněte přednášky v přehledu níže a zvolte společnou změnu.'
              : 'Vyberte položky a společnou změnu. Výběr platí pouze pro zobrazené, již načtené položky.'}
          </p>
          <fieldset
            disabled={disabled || running || pending !== null}
            className={styles.bulkFields}
          >
            {selectionMode === 'list' ? (
              <>
                <label className={styles.field}>
                  <span>Vyhledat ve výběru</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(new Set());
                    }}
                  />
                </label>
                <label className={styles.checkRow}>
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allSelected}
                    disabled={visible.length === 0}
                    onChange={(event) =>
                      setSelected(
                        new Set(
                          event.target.checked
                            ? visible.map((item) => identify(item).id)
                            : [],
                        ),
                      )
                    }
                  />
                  <span>Vybrat všechny zobrazené ({visible.length})</span>
                </label>
                <div
                  className={styles.bulkSelection}
                  role="group"
                  aria-label="Položky pro hromadnou úpravu"
                >
                  {visible.map((item) => {
                    const { id: itemId, label, detail } = identify(item);
                    return (
                      <label className={styles.checkRow} key={itemId}>
                        <input
                          type="checkbox"
                          checked={selected.has(itemId)}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(itemId);
                            else next.delete(itemId);
                            setSelected(next);
                          }}
                        />
                        <span>
                          {label}
                          {detail ? (
                            <small className={styles.muted}> · {detail}</small>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                  {visible.length === 0 ? <p>Žádné položky k výběru.</p> : null}
                </div>
              </>
            ) : null}
            <label className={styles.field}>
              <span>Hromadná akce</span>
              <select
                value={actionId}
                onChange={(event) => {
                  setActionId(event.target.value);
                  setValues({});
                  setError(null);
                }}
              >
                <option value="">Vyberte změnu</option>
                {actions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {action ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (eligible.length === 0 || disabled || running) return;
                  const validation = action.validate?.(eligible, values);
                  if (validation) {
                    setError(validation);
                    return;
                  }
                  setError(null);
                  setPending({
                    action,
                    items: action.order?.(eligible, values) ?? eligible,
                    values: {
                      ...Object.fromEntries(
                        (action.fields ?? []).map((field) => [
                          field.name,
                          values[field.name] ?? '',
                        ]),
                      ),
                      ...values,
                    },
                  });
                }}
                className={styles.stack}
              >
                <p>{action.description}</p>
                {(action.fields ?? []).map((field) => (
                  <label className={styles.field} key={field.name}>
                    <span>{field.label}</span>
                    {field.options ? (
                      <select
                        required={field.required !== false}
                        value={values[field.name] ?? ''}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.value,
                          })
                        }
                      >
                        <option value="">Vyberte hodnotu</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type ?? 'text'}
                        required={field.required !== false}
                        min={field.min}
                        max={field.max}
                        maxLength={500}
                        step={field.type === 'number' ? 1 : undefined}
                        value={values[field.name] ?? ''}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.value,
                          })
                        }
                      />
                    )}
                  </label>
                ))}
                {action.reasonRequired ? (
                  <label className={styles.field}>
                    <span>Důvod změny (8–500 znaků)</span>
                    <input
                      required
                      minLength={8}
                      maxLength={500}
                      value={values.reason ?? ''}
                      onChange={(event) =>
                        setValues({ ...values, reason: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <p id={`${id}-selection`} role="status">
                  Vybráno: {chosen.length}. Změna se provede u {eligible.length}{' '}
                  položek.
                  {eligible.length < chosen.length
                    ? ` Nevhodné položky budou přeskočeny (${chosen.length - eligible.length}).`
                    : ''}
                </p>
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  className={
                    action.danger ? styles.dangerButton : styles.button
                  }
                  disabled={
                    eligible.length === 0 ||
                    (action.reasonRequired &&
                      (values.reason ?? '').trim().length < 8)
                  }
                  type="submit"
                  aria-describedby={`${id}-selection`}
                >
                  Zkontrolovat změnu ({eligible.length})
                </button>
              </form>
            ) : null}
          </fieldset>
          {running ? (
            <p role="status">Zpracováno: {progress}. Hromadná změna probíhá…</p>
          ) : null}
          {outcomes.length > 0 ? (
            <div>
              <p role="status">
                Dokončeno:{' '}
                {outcomes.filter(({ status }) => status === 'succeeded').length}{' '}
                z {outcomes.length}. Chyby:{' '}
                {outcomes.filter(({ status }) => status === 'failed').length}.
                Neprovedeno:{' '}
                {outcomes.filter(({ status }) => status === 'skipped').length}.
              </p>
              <ul
                className={styles.bulkSelection}
                aria-label="Výsledky hromadné úpravy"
              >
                {outcomes.map((outcome) => (
                  <li key={outcome.id}>
                    {outcome.label}:{' '}
                    {outcome.status === 'succeeded'
                      ? 'Hotovo'
                      : outcome.status === 'skipped'
                        ? 'Neprovedeno'
                        : (outcome.message ?? 'Změna se nezdařila')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <AdminConfirmDialog
          title={`${pending.action.label}?`}
          description={`${pending.action.description} Počet položek: ${pending.items.length}. Každá položka se ukládá samostatně; případné chyby uvidíte ve výsledcích.`}
          impact={
            <div className={styles.bulkSelection}>
              <ul>
                {pending.items.map((item) => (
                  <li key={identify(item).id}>{identify(item).label}</li>
                ))}
              </ul>
              {Object.entries(pending.values).map(([name, value]) => (
                <p key={name}>
                  {name === 'reason'
                    ? 'Důvod'
                    : pending.action.fields?.find(
                        (field) => field.name === name,
                      )?.label}
                  :{' '}
                  {pending.action.fields
                    ?.find((field) => field.name === name)
                    ?.options?.find((option) => option.value === value)
                    ?.label ??
                    (value || 'Vymazat hodnotu')}
                </p>
              ))}
            </div>
          }
          acknowledgement="Zkontroloval/a jsem výběr i dopad a chci změnu provést."
          confirmLabel={`Provést změnu (${pending.items.length})`}
          danger={pending.action.danger ?? false}
          confirmDisabled={disabled}
          onConfirm={() => void execute()}
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </details>
  );
};
