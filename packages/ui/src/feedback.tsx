import type { HTMLAttributes, ReactNode } from 'react';
import { joinClassNames } from './utils';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  tone?: FeedbackTone;
  action?: ReactNode;
}

export const Alert = ({
  action,
  children,
  className,
  title,
  tone = 'info',
  ...props
}: AlertProps) => (
  <div
    {...props}
    className={joinClassNames('ui-alert', `ui-alert--${tone}`, className)}
    role={tone === 'danger' ? 'alert' : 'status'}
  >
    <span className="ui-alert__marker" aria-hidden="true" />
    <div className="ui-alert__content">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action && <div className="ui-alert__action">{action}</div>}
    </div>
  </div>
);

export const StatusBadge = ({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: FeedbackTone;
}) => (
  <span className={joinClassNames('ui-badge', `ui-badge--${tone}`)}>
    <span className="ui-badge__marker" aria-hidden="true" />
    {children}
  </span>
);

export const Skeleton = ({
  className,
  label = 'Načítání obsahu',
  lines = 3,
}: {
  className?: string;
  label?: string;
  lines?: number;
}) => (
  <div
    className={joinClassNames('ui-skeleton', className)}
    role="status"
    aria-label={label}
  >
    {Array.from({ length: lines }, (_, index) => (
      <span
        className="ui-skeleton__line"
        key={index}
        style={{ width: index === lines - 1 ? '62%' : undefined }}
      />
    ))}
  </div>
);

export type StatePanelKind =
  'empty' | 'error' | 'permission' | 'offline' | 'stale' | 'session-expired';

export const StatePanel = ({
  action,
  children,
  kind,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  kind: StatePanelKind;
  title: string;
}) => (
  <section
    className={joinClassNames('ui-state-panel', `ui-state-panel--${kind}`)}
    role={kind === 'error' ? 'alert' : 'status'}
  >
    <span className="ui-state-panel__symbol" aria-hidden="true">
      {kind === 'error' || kind === 'offline' ? '!' : 'i'}
    </span>
    <div>
      <h2>{title}</h2>
      <div className="ui-state-panel__body">{children}</div>
      {action && <div className="ui-state-panel__action">{action}</div>}
    </div>
  </section>
);

export const LiveRegion = ({
  children,
  atomic = true,
}: {
  children: ReactNode;
  atomic?: boolean;
}) => (
  <div className="ui-visually-hidden" aria-atomic={atomic} aria-live="polite">
    {children}
  </div>
);

export const ToastRegion = ({
  children,
  label = 'Oznámení',
}: {
  children: ReactNode;
  label?: string;
}) => (
  <section
    className="ui-toast-region"
    aria-label={label}
    aria-live="polite"
    aria-relevant="additions"
  >
    {children}
  </section>
);
