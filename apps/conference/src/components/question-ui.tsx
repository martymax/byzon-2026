import { Button } from '@byzon/ui';
import styles from './question-workspace.module.css';

export function QuestionStatus({
  answeredAt,
  written = false,
}: {
  answeredAt?: string | null | undefined;
  written?: boolean;
}) {
  const answered = Boolean(answeredAt || written);
  return (
    <p className={answered ? styles.answeredStatus : styles.pendingStatus}>
      {answered ? (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
      ) : null}
      {written
        ? 'Písemně zodpovězeno'
        : answeredAt
          ? 'Zodpovězeno na konferenci'
          : 'Čeká na odpověď'}
    </p>
  );
}

export type QuestionFilter = 'all' | 'unanswered' | 'answered';
export function QuestionFilters({
  value,
  onChange,
  total,
  answered,
  written = false,
}: {
  value: QuestionFilter;
  onChange: (value: QuestionFilter) => void;
  total: number;
  answered: number;
  written?: boolean;
}) {
  return (
    <div className={styles.tabs} role="group" aria-label="Filtr dotazů">
      {(
        [
          ['all', 'Všechny', total],
          [
            'unanswered',
            written ? 'Bez písemné odpovědi' : 'Nezodpovězené',
            total - answered,
          ],
          [
            'answered',
            written ? 'S písemnou odpovědí' : 'Zodpovězené',
            answered,
          ],
        ] as const
      ).map(([key, label, count]) => (
        <Button
          key={key}
          variant="secondary"
          className={styles.filterButton}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {label} ({count})
        </Button>
      ))}
    </div>
  );
}

export function DeleteQuestionIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
    </svg>
  );
}
