'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { runAdminBulk, type AdminBulkOutcome } from './admin-bulk';
import type { AdminBulkResult } from './admin-bulk';
import { AdminModal } from './admin-modal';
import { formatCzechCount } from './admin-copy';
import type { AdminBulkSelection } from './admin-bulk-selection';
import styles from './admin-bulk.module.css';

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

const affectedItems = (count: number) =>
  formatCzechCount(count, { one: 'položky', few: 'položek', other: 'položek' });

const BulkIcon = ({
  kind,
}: {
  readonly kind: 'edit' | 'close' | 'check' | 'chevron' | 'warning';
}) => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {kind === 'edit' ? (
      <>
        <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" />
        <path d="M13 20h7" />
      </>
    ) : kind === 'close' ? (
      <path d="m6 6 12 12M6 18 18 6" />
    ) : kind === 'warning' ? (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5m0 3v.01" />
      </>
    ) : kind === 'check' ? (
      <path d="m5 12 4 4L19 6" />
    ) : (
      <path d="m6 9 6 6 6-6" />
    )}
  </svg>
);

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
  inlineEditor = false,
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
  readonly inlineEditor?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onCompleted: () => void;
} & AdminBulkSelection) => {
  const id = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const [editor, setEditor] = useState<{
    action: AdminBulkAction<Item>;
    items: readonly Item[];
  } | null>(null);
  const [values, setValues] = useState<BulkValues>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<readonly AdminBulkOutcome[]>([]);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const running = progress !== null;
  const chosen = items.filter((item) => selectedIds.has(identify(item).id));
  const eligible =
    editor?.items.filter(
      (item) => !editor.action.eligible || editor.action.eligible(item, values),
    ) ?? [];
  const skipped = (editor?.items.length ?? 0) - eligible.length;
  const failures = outcomes.filter(({ status }) => status !== 'succeeded');
  const succeeded = outcomes.length - failures.length;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  const closeEditor = () => {
    setEditor(null);
    setError(null);
    triggerRef.current?.focus();
  };
  const execute = async () => {
    if (
      !editor ||
      controller.current ||
      disabled ||
      eligible.length === 0 ||
      (editor.action.danger && !acknowledged)
    )
      return;
    const validation = editor.action.validate?.(eligible, values);
    if (validation) {
      setError(validation);
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const batch = {
      ...editor,
      items: editor.action.order?.(eligible, values) ?? eligible,
      values: { ...values },
    };
    const active = new AbortController();
    controller.current = active;
    setEditor(null);
    setMenuOpen(false);
    setOutcomes([]);
    setError(null);
    setProgress({ completed: 0, total: batch.items.length });
    onBusyChange?.(true);
    const results = await runAdminBulk(
      batch.items,
      identify,
      (item, index) =>
        batch.action.execute(item, batch.values, active.signal, index),
      active.signal,
      (completed) => setProgress({ completed, total: batch.items.length }),
    );
    if (active.signal.aborted) return;
    controller.current = null;
    setOutcomes(results);
    onSelectionChange(new Set());
    setProgress(null);
    onBusyChange?.(false);
    onCompleted();
  };

  const editorForm = editor ? (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        void execute();
      }}
    >
      <header className={styles.editorHeader}>
        <div>
          <p className={styles.eyebrow}>{title}</p>
          <h2 id={`${id}-title`} tabIndex={-1} data-modal-initial-focus="true">
            {editor.action.label}
          </h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zavřít úpravu"
          onClick={closeEditor}
        >
          <BulkIcon kind="close" />
        </button>
      </header>
      <p id={`${id}-description`} className={styles.description}>
        {editor.action.description}
      </p>
      <details className={styles.targets}>
        <summary>
          <span className={styles.count}>{editor.items.length}</span> ve výběru{' '}
          <span className={styles.targetHint}>Zobrazit výběr</span>
        </summary>
        <ul>
          {editor.items.map((item) => (
            <li
              key={identify(item).id}
              data-skipped={!eligible.includes(item) || undefined}
            >
              {identify(item).label}
              {!eligible.includes(item) ? (
                <small>Pro tuto akci se přeskočí</small>
              ) : null}
              {identify(item).detail ? (
                <small>{identify(item).detail}</small>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      <fieldset className={styles.fields} disabled={disabled}>
        {(editor.action.fields ?? []).map((field, index) => (
          <label className={styles.field} key={field.name}>
            <span>{field.label}</span>
            {field.options ? (
              <select
                required={field.required !== false}
                value={values[field.name] ?? ''}
                onChange={(event) => {
                  setValues({ ...values, [field.name]: event.target.value });
                  setError(null);
                }}
              >
                <option value="">Vyberte…</option>
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
                onChange={(event) => {
                  setValues({ ...values, [field.name]: event.target.value });
                  setError(null);
                }}
                data-first-field={index === 0 || undefined}
              />
            )}
            {field.required === false && !values[field.name] ? (
              <small>Tato hodnota se u vybraných položek vymaže.</small>
            ) : null}
          </label>
        ))}
        {editor.action.reasonRequired ? (
          <label className={styles.field}>
            <span id={`${id}-reason-label`}>Důvod změny</span>
            <textarea
              aria-labelledby={`${id}-reason-label`}
              aria-describedby={`${id}-reason-hint`}
              rows={2}
              required
              minLength={8}
              maxLength={500}
              placeholder="Popište důvod společné změny"
              value={values.reason ?? ''}
              onChange={(event) => {
                setValues({ ...values, reason: event.target.value });
                setError(null);
              }}
            />
            <small id={`${id}-reason-hint`}>
              Alespoň 8 znaků. Uloží se do historie změn.
            </small>
          </label>
        ) : null}
        {skipped > 0 ? (
          <p className={styles.notice} role="status">
            Mimo podmínky akce: {skipped}. Ke změně: {eligible.length}.
          </p>
        ) : null}
        {editor.action.danger ? (
          <label className={styles.acknowledgement}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Potvrzuji změnu u {affectedItems(eligible.length)}.
          </label>
        ) : null}
      </fieldset>
      {error ? (
        <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      ) : null}
      <footer className={styles.editorFooter}>
        <span>Ke změně: {eligible.length}</span>
        <div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={closeEditor}
          >
            Zrušit
          </button>
          <button
            className={
              editor.action.danger ? styles.dangerButton : styles.primaryButton
            }
            disabled={
              disabled ||
              eligible.length === 0 ||
              (editor.action.danger && !acknowledged) ||
              (editor.action.reasonRequired &&
                (values.reason ?? '').trim().length < 8)
            }
            type="submit"
          >
            Provést změnu ({eligible.length})
          </button>
        </div>
      </footer>
    </form>
  ) : null;

  if (chosen.length === 0 && !running && outcomes.length === 0 && !editor)
    return null;
  return (
    <div className={styles.root}>
      {chosen.length > 0 || running ? (
        <section
          className={styles.toolbar}
          aria-label={title}
          aria-busy={running}
        >
          <div className={styles.selectionInfo}>
            <span className={styles.count}>
              {running ? progress.completed : chosen.length}
            </span>
            <span>
              {running ? `z ${progress.total} zpracováno` : 'vybráno'}
            </span>
          </div>
          {running ? (
            <div className={styles.progress}>
              <span role="status">Ukládám změny…</span>
              <progress
                max={progress.total}
                value={progress.completed}
                aria-label="Průběh hromadné úpravy"
              />
            </div>
          ) : (
            <div className={styles.toolbarActions}>
              <button
                className={styles.clearButton}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelectionChange(new Set());
                  setMenuOpen(false);
                }}
              >
                Zrušit výběr
              </button>
              <div className={styles.menuAnchor}>
                <button
                  ref={triggerRef}
                  type="button"
                  className={styles.primaryButton}
                  disabled={disabled}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={`${id}-menu`}
                  onClick={() => {
                    const bounds = triggerRef.current?.getBoundingClientRect();
                    setMenuAbove(
                      Boolean(
                        bounds &&
                        window.innerHeight - bounds.bottom < 360 &&
                        bounds.top > window.innerHeight - bounds.bottom,
                      ),
                    );
                    setMenuOpen(!menuOpen);
                    if (!menuOpen) onOpen?.();
                  }}
                >
                  <BulkIcon kind="edit" />
                  Upravit vybrané
                  <BulkIcon kind="chevron" />
                </button>
                {menuOpen ? (
                  <>
                    <div className={styles.menuScrim} aria-hidden="true" />
                    <div
                      data-placement={menuAbove ? 'above' : 'below'}
                      id={`${id}-menu`}
                      className={styles.menu}
                      role="menu"
                      aria-label="Dostupné hromadné akce"
                      ref={menuRef}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setMenuOpen(false);
                          triggerRef.current?.focus();
                        }
                        if (event.key === 'Tab') {
                          setMenuOpen(false);
                          return;
                        }
                        if (
                          !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const buttons = Array.from(
                          menuRef.current?.querySelectorAll<HTMLButtonElement>(
                            'button:not(:disabled)',
                          ) ?? [],
                        );
                        const current = buttons.indexOf(
                          document.activeElement as HTMLButtonElement,
                        );
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? buttons.length - 1
                              : (current +
                                  (event.key === 'ArrowDown' ? 1 : -1) +
                                  buttons.length) %
                                buttons.length;
                        buttons[next]?.focus();
                      }}
                    >
                      <p className={styles.menuHeading}>
                        Změnit vybrané položky
                      </p>
                      {[
                        ...actions.filter((action) => !action.danger),
                        ...actions.filter((action) => action.danger),
                      ].map((action, index, all) => {
                        const noEligible =
                          !action.fields?.length &&
                          action.eligible &&
                          chosen.every((item) => !action.eligible!(item, {}));
                        return (
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.menuItem}
                            data-danger={action.danger || undefined}
                            data-divider={
                              (action.danger && !all[index - 1]?.danger) ||
                              undefined
                            }
                            key={action.id}
                            disabled={Boolean(noEligible)}
                            onClick={() => {
                              setMenuOpen(false);
                              setValues(
                                Object.fromEntries(
                                  (action.fields ?? []).map((field) => [
                                    field.name,
                                    '',
                                  ]),
                                ),
                              );
                              setAcknowledged(false);
                              setError(null);
                              setEditor({ action, items: chosen });
                            }}
                          >
                            {action.label}
                            {noEligible ? (
                              <small>Pro tento výběr není dostupné</small>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}
      {outcomes.length > 0 ? (
        <section
          className={styles.result}
          data-failed={failures.length > 0 || undefined}
          aria-label="Výsledek hromadné úpravy"
        >
          <div className={styles.resultHeader}>
            <BulkIcon kind={failures.length ? 'warning' : 'check'} />
            <p role="status">
              {failures.length
                ? `Uloženo ${succeeded} z ${outcomes.length} položek.`
                : `Hotovo. Změna provedena u ${affectedItems(succeeded)}.`}
            </p>
            <button
              type="button"
              aria-label="Zavřít výsledek"
              className={styles.iconButton}
              onClick={() => setOutcomes([])}
            >
              <BulkIcon kind="close" />
            </button>
          </div>
          {failures.length > 0 ? (
            <details>
              <summary>Neprovedené změny ({failures.length})</summary>
              <ul>
                {failures.map((outcome) => (
                  <li key={outcome.id}>
                    <strong>{outcome.label}</strong>
                    <span>
                      {outcome.status === 'skipped'
                        ? 'Neprovedeno po zastavení dávky.'
                        : (outcome.message ?? 'Změna se nezdařila.')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      {editor ? (
        inlineEditor ? (
          <section
            className={styles.inlineEditor}
            aria-labelledby={`${id}-title`}
          >
            {editorForm}
          </section>
        ) : (
          <AdminModal
            labelledBy={`${id}-title`}
            describedBy={`${id}-description`}
            onDismiss={closeEditor}
          >
            {editorForm}
          </AdminModal>
        )
      ) : null}
    </div>
  );
};
