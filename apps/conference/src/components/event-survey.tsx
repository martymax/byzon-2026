'use client';

import { useParticipantSessionContext } from './participant-session-context';

import type { EventSurveyProgram } from '@byzon/domain/contracts';
import {
  ActionLink,
  Button,
  Card,
  FormField,
  Input,
  Textarea,
} from '@byzon/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiPort } from '@/lib/api/endpoint';
import { requestRatingStatus, submitRating } from '@/lib/b-interactions-api';
import {
  buildEventSurveySubmission,
  satisfactionOptions,
  surveySections,
  visibleSurveyQuestions,
  type SurveyAnswers,
  type SurveyQuestion,
} from '@/lib/event-survey';
import { subscribeToPrivateResourceInvalidation } from '@/lib/private-resource-events';
import styles from './event-survey.module.css';

function Question({
  question,
  value,
  change,
  error,
}: {
  question: SurveyQuestion;
  value: string;
  change: (value: string) => void;
  error: boolean;
}) {
  const { id, label } = question;
  if (question.kind === 'text')
    return (
      <div className={styles.question}>
        <FormField
          label={`${label} (volitelné)`}
          {...(question.hint ? { helperText: question.hint } : {})}
        >
          {question.maxLength && question.maxLength <= 256 ? (
            <Input
              value={value}
              onChange={(event) => change(event.target.value)}
              maxLength={question.maxLength}
            />
          ) : (
            <Textarea
              value={value}
              onChange={(event) => change(event.target.value)}
              maxLength={question.maxLength ?? 2000}
              rows={3}
            />
          )}
        </FormField>
      </div>
    );
  const options =
    question.kind === 'rating' ? satisfactionOptions : (question.options ?? []);
  return (
    <fieldset
      className={styles.question}
      aria-describedby={error ? `${id}-error` : undefined}
      aria-invalid={error || undefined}
    >
      <legend>
        {label}
        {question.required ? (
          <>
            <span aria-hidden="true"> *</span>
            <span className="ui-visually-hidden"> (povinné)</span>
          </>
        ) : (
          <small> (volitelné)</small>
        )}
      </legend>
      {question.hint ? <p className={styles.hint}>{question.hint}</p> : null}
      <div
        className={question.kind === 'rating' ? styles.rating : styles.choices}
      >
        {options.map(([option, text]) => (
          <label key={option} className={styles.option}>
            <input
              type="radio"
              name={id}
              value={option}
              checked={value === option}
              onChange={() => change(option)}
            />
            {question.kind === 'rating' ? (
              <strong aria-hidden="true">{option}</strong>
            ) : null}
            <span>{text}</span>
          </label>
        ))}
      </div>
      {question.skipLabel ? (
        <label className={`${styles.option} ${styles.skip}`}>
          <input
            type="radio"
            name={id}
            value="not_used"
            checked={value === 'not_used'}
            onChange={() => change('not_used')}
          />
          <span>{question.skipLabel}</span>
        </label>
      ) : null}
      {!question.required && value ? (
        <button
          type="button"
          className={styles.clear}
          onClick={() => change('')}
        >
          Zrušit výběr
        </button>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={styles.error}>
          Vyberte prosím jednu možnost.
        </p>
      ) : null}
    </fieldset>
  );
}

function ProgramQuestions({
  program,
  workshops,
  answers,
  change,
}: {
  program: EventSurveyProgram | null;
  workshops: boolean;
  answers: SurveyAnswers;
  change: (id: string, value: string) => void;
}) {
  const sessions =
    program?.sessions.filter(
      (session) =>
        ['workshop', 'mastermind'].includes(session.type) === workshops,
    ) ?? [];
  const groups = [
    ...new Set(sessions.map((session) => `${session.day}|${session.stage}`)),
  ];
  if (!sessions.length)
    return (
      <p className={styles.hint}>
        V této části není k dispozici žádné vystoupení k hodnocení. Můžete
        pokračovat dál.
      </p>
    );
  return (
    <div className={styles.groups}>
      <p className={styles.hint}>
        4 = spokojen/a · 1 = nespokojen/a. Nevyplněná vystoupení přeskočíme.
      </p>
      {groups.map((group) => {
        const items = sessions.filter(
          (session) => `${session.day}|${session.stage}` === group,
        );
        const first = items[0]!;
        const count = items.filter(
          (item) =>
            answers[`session:${item.id}`] &&
            answers[`session:${item.id}`] !== 'not_used',
        ).length;
        return (
          <details key={group} className={styles.stage}>
            <summary>
              <span>
                {first.stage}
                <small>
                  {new Intl.DateTimeFormat('cs-CZ', {
                    day: 'numeric',
                    month: 'numeric',
                    timeZone: 'Europe/Prague',
                  }).format(new Date(`${first.day}T12:00:00Z`))}
                </small>
              </span>
              <span className={styles.count}>
                {count} / {items.length} hodnoceno
              </span>
            </summary>
            <div className={styles.stageBody}>
              {items.map((session) => (
                <Question
                  key={session.id}
                  question={{
                    id: `session:${session.id}`,
                    label: session.title,
                    kind: 'rating',
                    hint: session.speakers.join(', '),
                    skipLabel: 'Tohoto vystoupení jsem se nezúčastnil/a',
                  }}
                  value={answers[`session:${session.id}`] ?? ''}
                  change={(value) => change(`session:${session.id}`, value)}
                  error={false}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

type Status =
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'completed'
  | 'error'
  | 'login'
  | 'disabled'
  | 'denied';
export function EventRating({
  endsAt,
  api,
}: {
  endsAt: string;
  api?: ApiPort;
}) {
  const timelessTestMode =
    useParticipantSessionContext()?.timelessTestMode === true;
  const [status, setStatus] = useState<Status>(() =>
    !timelessTestMode && Date.parse(endsAt) > Date.now()
      ? 'waiting'
      : 'loading',
  );
  const [program, setProgram] = useState<EventSurveyProgram | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const locked = useRef(false);
  const epoch = useRef(0);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const sections = surveySections(new Date(endsAt).getUTCFullYear() + 1);
  const section = sections[step]!;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const remaining = Date.parse(endsAt) - Date.now();
      if (!timelessTestMode && remaining > 0) {
        timer = setTimeout(load, Math.min(remaining + 100, 60_000));
        return;
      }
      setStatus('loading');
      void requestRatingStatus('event', undefined, api).then((result) => {
        if (!active) return;
        if (result.ok && result.kind === 'success') {
          setProgram(result.data.surveyProgram ?? null);
          setStatus(result.data.completed ? 'completed' : 'ready');
        } else {
          const code =
            !result.ok && 'problem' in result.failure
              ? result.failure.problem?.code
              : '';
          setStatus(
            code === 'AUTHENTICATION_REQUIRED' ||
              code === 'AUTH_SESSION_EXPIRED'
              ? 'login'
              : code === 'RATINGS_DISABLED'
                ? 'disabled'
                : code === 'EVENT_ACCESS_DENIED'
                  ? 'denied'
                  : 'error',
          );
        }
      });
    };
    load();
    const unsubscribe = subscribeToPrivateResourceInvalidation(() => {
      active = false;
      epoch.current += 1;
      if (timer) clearTimeout(timer);
      setAnswers({});
      setProgram(null);
      setMessage('');
      setErrors([]);
      setWorking(false);
      setStatus('login');
      submission.current = null;
    });
    return () => {
      active = false;
      epoch.current += 1;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [endsAt, api, retry, timelessTestMode]);

  const dirty = status === 'ready' && Object.values(answers).some(Boolean);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (errors.length || message) errorSummary.current?.focus();
  }, [errors, message]);

  const change = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    setErrors((current) => current.filter((key) => key !== id));
    setMessage('');
  };
  const move = (next: number) => {
    setStep(next);
    setErrors([]);
    setMessage('');
    requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: 'start' });
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    const missing = visibleSurveyQuestions(section.questions, answers)
      .filter((question) => question.required && !answers[question.id])
      .map((question) => question.id);
    if (missing.length) {
      setErrors(missing);
      return;
    }
    if (step < sections.length - 1) {
      move(step + 1);
      return;
    }
    for (const [index, item] of sections.entries()) {
      const missingEarlier = visibleSurveyQuestions(item.questions, answers)
        .filter((question) => question.required && !answers[question.id])
        .map((question) => question.id);
      if (missingEarlier.length) {
        setStep(index);
        setErrors(missingEarlier);
        return;
      }
    }
    let body;
    try {
      body = buildEventSurveySubmission(answers, program);
    } catch {
      setMessage(
        'Některá odpověď má neplatný formát. Zkontrolujte prosím své odpovědi a délku komentářů.',
      );
      return;
    }
    const serialized = JSON.stringify(body);
    if (submission.current?.body !== serialized)
      submission.current = {
        body: serialized,
        key: globalThis.crypto.randomUUID(),
      };
    locked.current = true;
    setWorking(true);
    setMessage('');
    const currentEpoch = epoch.current;
    void submitRating(body, submission.current.key, api).then((result) => {
      if (epoch.current !== currentEpoch) return;
      locked.current = false;
      setWorking(false);
      const code =
        !result.ok && 'problem' in result.failure
          ? result.failure.problem?.code
          : '';
      if (
        (result.ok && result.kind === 'success') ||
        code === 'RATING_ALREADY_COMPLETED'
      ) {
        setStatus('completed');
        setAnswers({});
        submission.current = null;
      } else if (
        code === 'AUTHENTICATION_REQUIRED' ||
        code === 'AUTH_SESSION_EXPIRED' ||
        code === 'EVENT_ACCESS_DENIED'
      ) {
        setAnswers({});
        setProgram(null);
        submission.current = null;
        setStatus(code === 'EVENT_ACCESS_DENIED' ? 'denied' : 'login');
      } else {
        setMessage(
          code === 'RATINGS_DISABLED'
            ? 'Organizátor nyní příjem hodnocení pozastavil. Odpovědi zatím zůstávají na této stránce.'
            : 'Odeslání se nepodařilo potvrdit. Odpovědi zůstaly na této stránce. Zkontrolujte připojení a zkuste odeslání znovu.',
        );
      }
    });
  };

  if (status !== 'ready')
    return (
      <Card className={styles.state}>
        <p className="eyebrow">Hodnocení konference</p>
        <h2>
          {status === 'completed'
            ? 'Děkujeme, že tvoříte další BYZON s námi.'
            : status === 'waiting'
              ? 'Ještě nás čeká společný program'
              : status === 'login'
                ? 'Přihlaste se ke svému účtu'
                : 'Vaše zkušenost nás zajímá'}
        </h2>
        <p role="status">
          {status === 'completed'
            ? 'Děkujeme, vaše hodnocení už je uložené.'
            : status === 'waiting'
              ? 'Hodnocení se otevře po skončení konference. Tuto stránku můžete nechat otevřenou.'
              : status === 'loading'
                ? 'Načítám hodnocení…'
                : status === 'login'
                  ? 'Hodnocení je dostupné přihlášeným účastníkům konference.'
                  : status === 'disabled'
                    ? 'Organizátor zatím hodnocení nezpřístupnil. Zkuste to prosím později.'
                    : status === 'denied'
                      ? 'K hodnocení této konference nyní nemáte účastnický přístup.'
                      : 'Hodnocení nyní není dostupné. Ověřte připojení a zkuste to znovu.'}
        </p>
        {['error', 'disabled'].includes(status) ? (
          <Button
            onClick={() => {
              setStatus('loading');
              setRetry((value) => value + 1);
            }}
          >
            Zkusit znovu
          </Button>
        ) : null}
        {status === 'login' ? (
          <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fhodnoceni">
            Přihlásit se k hodnocení
          </ActionLink>
        ) : null}
        {status === 'completed' ? (
          <>
            <ActionLink href="/app/vice" variant="secondary">
              Zpět do appky
            </ActionLink>
            <p>
              Chcete svou zkušenost sdílet veřejně?{' '}
              <a
                className="text-link"
                href="https://www.facebook.com/byzoncz/reviews"
                target="_blank"
                rel="noreferrer"
              >
                Napsat recenzi na Facebooku
              </a>{' '}
              (volitelné)
            </p>
          </>
        ) : null}
      </Card>
    );

  return (
    <div className={styles.survey}>
      <div className={styles.intro}>
        <p>
          Vyplnění je dobrovolné. Otázky označené * potřebujeme k odeslání.
          Odpověď se ukládá k vašemu účtu a není anonymní.
        </p>
        <p>
          Rozpracované odpovědi zůstávají při přecházení mezi kroky na této
          stránce. Uloží se až po odeslání.
        </p>
      </div>
      <div className={styles.progress}>
        <div>
          <span>
            Krok {step + 1} ze {sections.length}
          </span>
          <span>{section.title}</span>
        </div>
        <progress
          aria-label="Postup dotazníkem"
          value={step + 1}
          max={sections.length}
        />
      </div>
      <Card className={styles.card}>
        <header>
          <p className="eyebrow">Vaše zpětná vazba</p>
          <h2 ref={heading} tabIndex={-1}>
            {section.title}
          </h2>
          <p>{section.description}</p>
        </header>
        <form onSubmit={submit} noValidate>
          <fieldset disabled={working} className={styles.form}>
            <legend className="ui-visually-hidden">{section.title}</legend>
            {errors.length || message ? (
              <div
                ref={errorSummary}
                tabIndex={-1}
                role="alert"
                className={styles.errorSummary}
              >
                {message ||
                  `Doplňte prosím označené otázky (${errors.length}).`}
              </div>
            ) : null}
            {step === 1 ? (
              <ProgramQuestions
                program={program}
                workshops={false}
                answers={answers}
                change={change}
              />
            ) : null}
            {visibleSurveyQuestions(section.questions, answers).map(
              (question) => (
                <Question
                  key={question.id}
                  question={question}
                  value={answers[question.id] ?? ''}
                  change={(value) => change(question.id, value)}
                  error={errors.includes(question.id)}
                />
              ),
            )}
            {step === 2 && answers.workshopsAttended === 'yes' ? (
              <ProgramQuestions
                program={program}
                workshops
                answers={answers}
                change={change}
              />
            ) : null}
            {step === sections.length - 1 ? (
              <p className={styles.hint}>
                Odeslané hodnocení už nelze upravit. Děkujeme za váš čas.
              </p>
            ) : null}
            <div className={styles.actions}>
              {step > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => move(step - 1)}
                >
                  Zpět
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit">
                {working
                  ? 'Odesílám…'
                  : step === sections.length - 1
                    ? 'Odeslat hodnocení'
                    : 'Pokračovat'}
              </Button>
            </div>
          </fieldset>
        </form>
      </Card>
    </div>
  );
}
