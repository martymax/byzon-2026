'use client';

import {
  useEffect,
  useId,
  useRef,
  type DialogHTMLAttributes,
  type ReactNode,
} from 'react';
import { Button } from './actions';
import { joinClassNames } from './utils';

export interface DialogProps extends Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  'open'
> {
  children: ReactNode;
  title: string;
  open: boolean;
  onClose: () => void;
  variant?: 'dialog' | 'sheet';
}

export const Dialog = ({
  children,
  className,
  onClose,
  open,
  title,
  variant = 'dialog',
  ...props
}: DialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      {...props}
      aria-labelledby={props['aria-labelledby'] ?? titleId}
      className={joinClassNames(
        'ui-dialog',
        variant === 'sheet' && 'ui-dialog--sheet',
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      ref={ref}
    >
      <div className="ui-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <Button
          aria-label="Zavřít"
          className="ui-dialog__close"
          onClick={onClose}
          size="small"
          variant="quiet"
        >
          Zavřít
        </Button>
      </div>
      <div className="ui-dialog__body">{children}</div>
    </dialog>
  );
};

export const DestructiveConfirmation = ({
  actionLabel,
  cancelLabel = 'Zrušit',
  children,
  onCancel,
  onConfirm,
  open,
  title,
  working = false,
}: {
  actionLabel: string;
  cancelLabel?: string;
  children: ReactNode;
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
          loadingLabel="Provádím…"
          onClick={onConfirm}
          variant="danger"
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  </Dialog>
);
