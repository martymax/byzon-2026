'use client';

import {
  useEffect,
  useId,
  useRef,
  type DetailsHTMLAttributes,
  type FieldsetHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
} from 'react';

import { Button } from './actions';
import type { ErrorSummaryItem } from './forms';
import { Dialog } from './overlay';
import { Skeleton, type FeedbackTone } from './feedback';
import { joinClassNames } from './utils';

export const AdminPageHeader = ({
  action,
  className,
  description,
  meta,
  title,
  ...props
}: HTMLAttributes<HTMLElement> & {
  action?: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
  title: string;
}) => (
  <header
    {...props}
    className={joinClassNames('ui-admin-page-header', className)}
  >
    <div className="ui-admin-page-header__copy">
      <h1>{title}</h1>
      <div className="ui-admin-page-header__description">{description}</div>
      {meta && <div className="ui-admin-page-header__meta">{meta}</div>}
    </div>
    {action && <div className="ui-admin-page-header__action">{action}</div>}
  </header>
);

export interface AdminNavGroupItem {
  href: string;
  icon: ReactNode;
  id: string;
  label: string;
}

export const AdminNavGroup = ({
  activeItemId,
  items,
  label,
}: {
  activeItemId: string;
  items: readonly AdminNavGroupItem[];
  label?: string;
}) => {
  if (items.length === 0) return null;
  const list = (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <a
            aria-current={item.id === activeItemId ? 'page' : undefined}
            href={item.href}
          >
            <span className="ui-admin-nav-group__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
  return label ? (
    <section className="ui-admin-nav-group" aria-label={label}>
      <h2>{label}</h2>
      {list}
    </section>
  ) : (
    <div className="ui-admin-nav-group">{list}</div>
  );
};

export const AdminStatusBadge = ({
  children,
  icon,
  tone = 'info',
}: {
  children: ReactNode;
  icon: ReactNode;
  tone?: FeedbackTone;
}) => (
  <span
    className={joinClassNames('ui-admin-status', `ui-admin-status--${tone}`)}
  >
    <span className="ui-admin-status__icon" aria-hidden="true">
      {icon}
    </span>
    {children}
  </span>
);

export interface AdminAttentionItem {
  action?: ReactNode;
  description: ReactNode;
  id: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
}

const attentionPriority: Record<AdminAttentionItem['severity'], number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

export const AdminAttentionList = ({
  items,
  title = 'Co potřebuje pozornost',
}: {
  items: readonly AdminAttentionItem[];
  title?: string;
}) => {
  const titleId = useId();
  const sorted = [...items].sort(
    (left, right) =>
      attentionPriority[left.severity] - attentionPriority[right.severity],
  );
  return (
    <section className="ui-admin-attention" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <ol>
        {sorted.map((item, index) => (
          <li
            className={`ui-admin-attention__item ui-admin-attention__item--${item.severity}`}
            key={item.id}
          >
            <div>
              <strong>{item.title}</strong>
              <div>{item.description}</div>
            </div>
            {item.action && (
              <div
                className={
                  index === 0 ? 'ui-admin-attention__primary' : undefined
                }
              >
                {item.action}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};

export const AdminMetricCard = ({
  detail,
  label,
  updatedAt,
  value,
}: {
  detail: ReactNode;
  label: string;
  updatedAt?: ReactNode;
  value: ReactNode;
}) => (
  <article className="ui-admin-metric">
    <h2>{label}</h2>
    <strong className="ui-admin-metric__value">{value}</strong>
    <div className="ui-admin-metric__detail">{detail}</div>
    {updatedAt && <div className="ui-admin-metric__updated">{updatedAt}</div>}
  </article>
);

export const AdminDataTable = ({
  caption,
  children,
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption: string }) => (
  <div
    className="ui-admin-table-scroll"
    role="region"
    aria-label={caption}
    tabIndex={0}
  >
    <table {...props} className={joinClassNames('ui-admin-table', className)}>
      <caption>{caption}</caption>
      {children}
    </table>
  </div>
);

export const AdminMobileCardList = ({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) => (
  <ul className="ui-admin-mobile-list" aria-label={label}>
    {children}
  </ul>
);

export const AdminFilterBar = ({
  children,
  clearAction,
  label = 'Filtry',
}: {
  children: ReactNode;
  clearAction?: ReactNode;
  label?: string;
}) => (
  <section className="ui-admin-filter-bar" aria-label={label}>
    <div className="ui-admin-filter-bar__controls">{children}</div>
    {clearAction && <div>{clearAction}</div>}
  </section>
);

export const AdminFormSection = ({
  children,
  className,
  description,
  legend,
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement> & {
  description?: ReactNode;
  legend: string;
}) => {
  const descriptionId = useId();
  const describedBy =
    [props['aria-describedby'], description && descriptionId]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <fieldset
      {...props}
      aria-describedby={describedBy}
      className={joinClassNames('ui-admin-form-section', className)}
    >
      <legend>{legend}</legend>
      {description && (
        <div className="ui-admin-form-section__description" id={descriptionId}>
          {description}
        </div>
      )}
      <div className="ui-admin-form-section__fields">{children}</div>
    </fieldset>
  );
};

export const AdminErrorSummary = ({
  errors,
  focusOnMount = true,
  heading = 'Zkontrolujte zadané údaje',
}: {
  errors: readonly ErrorSummaryItem[];
  focusOnMount?: boolean;
  heading?: string;
}) => {
  const ref = useRef<HTMLElement>(null);
  const hadErrors = useRef(false);
  const titleId = useId();
  useEffect(() => {
    if (focusOnMount && errors.length > 0 && !hadErrors.current) {
      ref.current?.focus();
    }
    hadErrors.current = errors.length > 0;
  }, [errors, focusOnMount]);
  if (errors.length === 0) return null;
  return (
    <section
      className="ui-error-summary"
      aria-labelledby={titleId}
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      <h2 id={titleId}>{heading}</h2>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a href={`#${error.fieldId}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </section>
  );
};

export const AdminTechnicalDetails = ({
  children,
  className,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) => (
  <details
    {...props}
    className={joinClassNames('ui-admin-technical', className)}
  >
    <summary>Technické údaje</summary>
    <div className="ui-admin-technical__body">{children}</div>
  </details>
);

export const AdminUnsavedBar = ({
  discardLabel = 'Zahodit změny',
  onDiscard,
  onSave,
  saveLabel = 'Uložit změny',
  saving = false,
}: {
  discardLabel?: string;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  saving?: boolean;
}) => (
  <aside className="ui-admin-unsaved" aria-label="Neuložené změny">
    <strong>Máte neuložené změny</strong>
    <div className="ui-admin-unsaved__actions">
      <Button onClick={onDiscard} variant="quiet">
        {discardLabel}
      </Button>
      <Button loading={saving} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  </aside>
);

export const AdminConfirmDialog = ({
  actionLabel,
  cancelLabel = 'Zpět',
  children,
  danger = false,
  onCancel,
  onConfirm,
  open,
  title,
  working = false,
}: {
  actionLabel: string;
  cancelLabel?: string;
  children: ReactNode;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  working?: boolean;
}) => (
  <Dialog onClose={onCancel} open={open} title={title}>
    <div className="ui-confirmation">
      <div>{children}</div>
      <div className="ui-confirmation__actions">
        <Button onClick={onCancel} variant="secondary">
          {cancelLabel}
        </Button>
        <Button
          loading={working}
          onClick={onConfirm}
          variant={danger ? 'danger' : 'primary'}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  </Dialog>
);

export const AdminEmptyState = ({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) => (
  <section className="ui-admin-empty" role="status">
    <h2>{title}</h2>
    <div>{children}</div>
    {action && <div className="ui-admin-empty__action">{action}</div>}
  </section>
);

export const AdminSkeleton = ({
  label = 'Načítám administrační obsah',
}: {
  label?: string;
}) => (
  <div className="ui-admin-skeleton" aria-busy="true">
    <Skeleton label={label} lines={1} />
    <div className="ui-admin-skeleton__grid">
      <Skeleton label={label} lines={4} />
      <Skeleton label={label} lines={4} />
    </div>
  </div>
);
