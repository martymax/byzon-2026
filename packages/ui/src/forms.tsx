import {
  cloneElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { joinClassNames } from './utils';

type FormControlAccessibilityProps = {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-required'?: boolean | undefined;
  required?: boolean | undefined;
};

export interface FormFieldProps {
  children: ReactElement<FormControlAccessibilityProps>;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

export const FormField = ({
  children,
  className,
  error,
  helperText,
  label,
  required = false,
}: FormFieldProps) => {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const helperId = helperText ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [children.props['aria-describedby'], helperId, errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      className={joinClassNames(
        'ui-field',
        error && 'ui-field--invalid',
        className,
      )}
    >
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
        {required && (
          <>
            <span aria-hidden="true"> *</span>
            <span className="ui-visually-hidden"> (povinné)</span>
          </>
        )}
      </label>
      {cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required ? true : children.props['aria-required'],
        required: required || children.props.required,
      })}
      {helperText && (
        <p className="ui-field__help" id={helperId}>
          {helperText}
        </p>
      )}
      {error && (
        <p className="ui-field__error" id={errorId} role="alert">
          <span aria-hidden="true">!</span> {error}
        </p>
      )}
    </div>
  );
};

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={joinClassNames('ui-control', className)} />
);

export const Select = ({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={joinClassNames('ui-control', className)} />
);

export const Textarea = ({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={joinClassNames('ui-control', 'ui-textarea', className)}
  />
);

export interface ChoiceFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  label: string;
  description?: string;
  type: 'checkbox' | 'radio';
}

export const ChoiceField = ({
  className,
  description,
  id,
  label,
  type,
  ...props
}: ChoiceFieldProps) => {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;

  return (
    <div className={joinClassNames('ui-choice', className)}>
      <input
        {...props}
        aria-describedby={descriptionId}
        className="ui-choice__control"
        id={controlId}
        type={type}
      />
      <div>
        <label className="ui-choice__label" htmlFor={controlId}>
          {label}
        </label>
        {description && (
          <p className="ui-choice__description" id={descriptionId}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
};

export interface ErrorSummaryItem {
  fieldId: string;
  message: string;
}

export const ErrorSummary = ({
  errors,
  heading = 'Zkontrolujte zadané údaje',
}: {
  errors: ErrorSummaryItem[];
  heading?: string;
}) => {
  const titleId = useId();
  if (errors.length === 0) return null;
  return (
    <section
      className="ui-error-summary"
      aria-labelledby={titleId}
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
