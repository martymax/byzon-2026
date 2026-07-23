import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { joinClassNames } from './utils';

export type ActionVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ActionSize = 'small' | 'medium';

type ActionStyleProps = {
  variant?: ActionVariant | undefined;
  size?: ActionSize | undefined;
  block?: boolean | undefined;
};

const actionClassName = ({
  variant = 'primary',
  size = 'medium',
  block = false,
}: ActionStyleProps) =>
  joinClassNames(
    'ui-action',
    `ui-action--${variant}`,
    `ui-action--${size}`,
    block && 'ui-action--block',
  );

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, ActionStyleProps {
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
}

export const Button = ({
  block,
  children,
  className,
  disabled,
  leadingIcon,
  loading = false,
  loadingLabel = 'Pracuji…',
  size,
  type = 'button',
  variant,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    aria-busy={loading || undefined}
    className={joinClassNames(
      actionClassName({ block, size, variant }),
      className,
    )}
    disabled={disabled || loading}
    type={type}
  >
    {loading ? (
      <span className="ui-spinner" aria-hidden="true" />
    ) : (
      leadingIcon && (
        <span className="ui-action__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      )
    )}
    <span>{loading ? loadingLabel : children}</span>
  </button>
);

export interface ActionLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>, ActionStyleProps {
  leadingIcon?: ReactNode;
}

export const ActionLink = ({
  block,
  children,
  className,
  leadingIcon,
  size,
  variant,
  ...props
}: ActionLinkProps) => (
  <a
    {...props}
    className={joinClassNames(
      actionClassName({ block, size, variant }),
      className,
    )}
  >
    {leadingIcon && (
      <span className="ui-action__icon" aria-hidden="true">
        {leadingIcon}
      </span>
    )}
    <span>{children}</span>
  </a>
);
