'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getConferenceFeedbackRole,
  getConferenceFeedbackSteps,
  getVisibleConferenceFeedbackQuestions,
  type ConferenceFeedbackQuestion,
  type ConferenceFeedbackState,
} from '@/lib/conference-feedback';
import styles from './conference-feedback.module.css';

type Patch = { answers?: Record<string, string>; currentStep?: string };
type SaveStatus = 'saved' | 'saving' | 'error';
const DEMO_STORAGE = 'byzon-conference-feedback-demo-v1';
const mergePatch = (first: Patch, second: Patch): Patch => ({
  ...first,
  ...second,
  answers: { ...first.answers, ...second.answers },
});
const hasPatch = (patch: Patch) =>
  Boolean(patch.currentStep || Object.keys(patch.answers ?? {}).length);
const patchWouldChange = (patch: Patch, server: ConferenceFeedbackState) =>
  Object.entries(patch.answers ?? {}).some(
    ([id, value]) => (server.answers[id] ?? '') !== value,
  ) || Boolean(patch.currentStep && patch.currentStep !== server.currentStep);
const emptyDemo = (): ConferenceFeedbackState => ({
  answers: {},
  currentStep: 'intro',
  completedAt: null,
  eventName: 'BYZON 2026',
  suggestedRole: 'attendee',
  program: {
    version: 1,
    sessions: [
      {
        id: '01940000-0000-7000-8000-000000000011',
        title: 'Ukázková přednáška',
        stage: 'Ukázka programu',
        day: '2026-09-18',
        speakers: [],
        type: 'talk',
      },
      {
        id: '01940000-0000-7000-8000-000000000012',
        title: 'Ukázkový workshop',
        stage: 'Ukázka programu',
        day: '2026-09-18',
        speakers: [],
        type: 'workshop',
      },
    ],
  },
});

function Arrow({ back = false }: { back?: boolean }) {
  return (
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
      style={back ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}
function Check() {
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
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function FeedbackQuestion({
  question,
  value,
  onChange,
  onBlur,
  suggestedRole,
}: {
  question: ConferenceFeedbackQuestion;
  value: string;
  onChange: (id: string, value: string, debounce?: boolean) => void;
  onBlur: () => void;
  suggestedRole?: string | undefined;
}) {
  const id = `feedback-${question.id}`;
  if (question.type === 'text') {
    const field = (
      <div className={styles.textField}>
        <label htmlFor={id}>
          {question.label} <span className={styles.optional}>Volitelné</span>
        </label>
        {question.hint ? (
          <p id={`${id}-hint`} className={styles.hint}>
            {question.hint}
          </p>
        ) : null}
        <textarea
          id={id}
          value={value}
          rows={3}
          maxLength={question.maxLength ?? 2000}
          aria-describedby={question.hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(question.id, event.target.value, true)}
          onBlur={onBlur}
          placeholder="Stačí i jedna věta…"
        />
        {value.length > (question.maxLength ?? 2000) * 0.8 ? (
          <small className={styles.characterCount}>
            {value.length} / {question.maxLength ?? 2000}
          </small>
        ) : null}
      </div>
    );
    if (
      question.id === 'comment' ||
      question.id === 'nextSpeaker' ||
      question.id === 'partners' ||
      question.id === 'city' ||
      question.id === 'genderOther'
    )
      return field;
    return (
      <details
        className={styles.commentDisclosure}
        open={value ? true : undefined}
      >
        <summary>
          {question.label} <span>Volitelné</span>
        </summary>
        {field}
      </details>
    );
  }
  const roleQuestion = question.id === 'participantRole';
  return (
    <fieldset
      className={`${styles.question} ${roleQuestion ? styles.roleQuestion : ''}`}
      aria-describedby={question.hint ? `${id}-hint` : undefined}
    >
      <legend>{question.label}</legend>
      {question.hint ? (
        <p className={styles.hint} id={`${id}-hint`}>
          {question.hint}
        </p>
      ) : null}
      <div className={roleQuestion ? styles.roleOptions : styles.options}>
        {question.options?.map((option) => (
          <label
            key={option.value}
            className={`${styles.option} ${option.value === 'skip' ? styles.skipOption : ''}`}
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(question.id, option.value)}
            />
            <span className={styles.optionText}>
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
              {roleQuestion && suggestedRole === option.value && !value ? (
                <small className={styles.suggested}>
                  Podle vaší registrace
                </small>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {value && !roleQuestion ? (
        <button
          className={styles.clear}
          type="button"
          onClick={() => onChange(question.id, '')}
        >
          Zrušit výběr
        </button>
      ) : null}
    </fieldset>
  );
}

export function ConferenceFeedback({
  token,
  demo = false,
  fetcher = fetch,
}: {
  token?: string;
  demo?: boolean;
  fetcher?: typeof fetch;
}) {
  const [state, setState] = useState<ConferenceFeedbackState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [roleError, setRoleError] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [draftConflict, setDraftConflict] = useState<Patch | null>(null);
  const draftConflictRef = useRef<Patch | null>(null);
  const baseUpdatedAt = useRef<string | undefined>(undefined);
  const revalidateBeforeRetry = useRef(false);
  const stateRef = useRef<ConferenceFeedbackState | null>(null);
  const pending = useRef<Patch>({});
  const inFlight = useRef<Promise<boolean> | null>(null);
  const sending = useRef<Patch>({});
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const endpoint = `/api/v1/feedback/${encodeURIComponent(token ?? '')}`;
  const storageKey = demo
    ? DEMO_STORAGE
    : `byzon-feedback-pending:${token?.slice(-16)}`;

  const persist = useCallback(
    (patch: Patch) => {
      try {
        if (demo && stateRef.current)
          localStorage.setItem(storageKey, JSON.stringify(stateRef.current));
        else if (hasPatch(patch))
          localStorage.setItem(
            storageKey,
            JSON.stringify({ ...patch, baseUpdatedAt: baseUpdatedAt.current }),
          );
        else localStorage.removeItem(storageKey);
      } catch {
        if (mounted.current) setStorageUnavailable(true);
      }
    },
    [demo, storageKey],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (draftConflictRef.current) return Promise.resolve(false);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (demo) {
      persist({});
      pending.current = {};
      if (mounted.current) setSaveStatus('saved');
      return Promise.resolve(true);
    }
    if (inFlight.current) return inFlight.current;
    if (!hasPatch(pending.current)) return Promise.resolve(true);
    if (mounted.current) setSaveStatus('saving');
    const task = (async () => {
      if (revalidateBeforeRetry.current) {
        try {
          const response = await fetcher(endpoint, {
            credentials: 'omit',
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('reload failed');
          const body = await response.json();
          const server = (body.data ?? body) as ConferenceFeedbackState;
          if (!server.answers) throw new Error('invalid reload');
          const hasNewerChanges =
            baseUpdatedAt.current &&
            server.updatedAt &&
            baseUpdatedAt.current !== server.updatedAt &&
            patchWouldChange(pending.current, server);
          revalidateBeforeRetry.current = false;
          baseUpdatedAt.current = server.updatedAt;
          if (hasNewerChanges) {
            draftConflictRef.current = pending.current;
            stateRef.current = server;
            if (mounted.current) {
              setState(server);
              setDraftConflict(pending.current);
            }
            return false;
          }
        } catch {
          if (mounted.current) setSaveStatus('error');
          return false;
        }
      }
      while (hasPatch(pending.current)) {
        const patch = pending.current;
        pending.current = {};
        sending.current = patch;
        try {
          const response = await fetcher(endpoint, {
            method: 'PATCH',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
            cache: 'no-store',
            keepalive: true,
          });
          if (!response.ok) throw new Error('save failed');
          const body = await response.json();
          const saved = (body.data ?? body) as ConferenceFeedbackState;
          baseUpdatedAt.current = saved.updatedAt;
          if (saved.answers && stateRef.current) {
            // The server restores answers when a previously selected role is
            // selected again. Never replace edits queued during this request.
            const next = {
              ...stateRef.current,
              answers: { ...saved.answers, ...pending.current.answers },
            };
            stateRef.current = next;
            if (mounted.current) setState(next);
          }
          sending.current = {};
          persist(pending.current);
        } catch {
          revalidateBeforeRetry.current = true;
          pending.current = mergePatch(patch, pending.current);
          sending.current = {};
          persist(pending.current);
          if (mounted.current) setSaveStatus('error');
          return false;
        }
      }
      if (mounted.current) setSaveStatus('saved');
      return true;
    })();
    inFlight.current = task;
    void task.finally(() => {
      inFlight.current = null;
    });
    return task;
  }, [demo, endpoint, fetcher, persist]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = async () => {
      let cached: unknown = null;
      try {
        cached = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      } catch {
        setStorageUnavailable(true);
      }
      if (demo) {
        const candidate = cached as ConferenceFeedbackState | null;
        const next =
          candidate &&
          typeof candidate.answers === 'object' &&
          typeof candidate.currentStep === 'string'
            ? { ...emptyDemo(), ...candidate }
            : emptyDemo();
        stateRef.current = next;
        setState(next);
        setResumed(Boolean(Object.keys(next.answers).length));
        return;
      }
      try {
        const response = await fetcher(endpoint, {
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setLoadError(
            response.status === 404 ||
              response.status === 401 ||
              response.status === 410
              ? 'Tento odkaz na hodnocení není platný. Otevřete prosím celý odkaz z e-mailu od BYZONu.'
              : 'Hodnocení se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.',
          );
          return;
        }
        const body = await response.json();
        const next = (body.data ?? body) as ConferenceFeedbackState;
        if (!next.answers || typeof next.currentStep !== 'string')
          throw new Error('Invalid response');
        if (controller.signal.aborted) return;
        baseUpdatedAt.current = next.updatedAt;
        const draft = cached as (Patch & { baseUpdatedAt?: string }) | null;
        if (draft && typeof draft === 'object' && hasPatch(draft)) {
          const patch: Patch = {
            ...(draft.answers ? { answers: draft.answers } : {}),
            ...(draft.currentStep ? { currentStep: draft.currentStep } : {}),
          };
          const wouldChangeServer = patchWouldChange(patch, next);
          if (
            draft.baseUpdatedAt &&
            next.updatedAt &&
            draft.baseUpdatedAt !== next.updatedAt &&
            wouldChangeServer
          ) {
            // An older offline draft must never overwrite a newer device's work
            // until the participant explicitly chooses to apply those changes.
            draftConflictRef.current = patch;
            setDraftConflict(patch);
          } else if (wouldChangeServer) {
            pending.current = patch;
            next.answers = { ...next.answers, ...patch.answers };
            if (patch.currentStep) next.currentStep = patch.currentStep;
          } else persist({});
        }
        if (controller.signal.aborted) return;
        stateRef.current = next;
        setState(next);
        setResumed(Boolean(Object.keys(next.answers).length));
        if (hasPatch(pending.current)) void flush();
      } catch {
        if (!controller.signal.aborted)
          setLoadError(
            'Hodnocení se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.',
          );
      }
    };
    void load();
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [demo, endpoint, fetcher, flush, loadAttempt, persist, storageKey]);

  useEffect(() => {
    const retry = () => {
      void flush();
    };
    const onHide = () => {
      if (draftConflictRef.current) return;
      const patch = mergePatch(sending.current, pending.current);
      persist(patch);
      // Keep requests serialized, including while the document is being hidden.
      // A parallel keepalive replay could overwrite a more recent answer.
      if (hasPatch(patch)) void flush();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('online', retry);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', visibility);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [demo, endpoint, fetcher, flush, persist]);

  const update = (patch: Patch, debounce = false) => {
    const current = stateRef.current;
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      answers: { ...current.answers, ...patch.answers },
    };
    stateRef.current = next;
    setState(next);
    pending.current = mergePatch(pending.current, patch);
    persist(mergePatch(sending.current, pending.current));
    setSaveStatus('saving');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (debounce)
      debounceTimer.current = setTimeout(() => {
        void flush();
      }, 450);
    else void flush();
  };
  const change = (id: string, value: string, debounce = false) => {
    if (id === 'participantRole') setRoleError(false);
    update({ answers: { [id]: value } }, debounce);
  };
  const goToStep = (id: string) => {
    setResumed(false);
    update({ currentStep: id });
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: 'start' });
    });
  };
  const complete = async () => {
    setCompletionError(false);
    setCompleting(true);
    if (!(await flush())) {
      setCompleting(false);
      return;
    }
    if (demo) {
      const next = {
        ...stateRef.current!,
        completedAt: new Date().toISOString(),
      };
      stateRef.current = next;
      setState(next);
      persist({});
      setEditing(false);
      setCompleting(false);
      requestAnimationFrame(() => headingRef.current?.focus());
      return;
    }
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('completion failed');
      const body = await response.json();
      const saved = (body.data ?? body) as ConferenceFeedbackState;
      const next = {
        ...stateRef.current!,
        completedAt: saved.completedAt ?? new Date().toISOString(),
      };
      stateRef.current = next;
      setState(next);
      setEditing(false);
      setSaveStatus('saved');
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setCompletionError(true);
    }
    setCompleting(false);
  };

  if (loadError)
    return (
      <section className={styles.message}>
        <h1>Odkaz se nepodařilo otevřít</h1>
        <p role="alert">{loadError}</p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            setLoadError('');
            setLoadAttempt((value) => value + 1);
          }}
        >
          Zkusit znovu
        </button>
      </section>
    );
  if (!state)
    return (
      <section className={styles.message} aria-busy="true">
        <h1>Otevíráme vaše hodnocení</h1>
        <p role="status">Načítáme uložené odpovědi…</p>
      </section>
    );

  if (draftConflict)
    return (
      <section className={styles.message}>
        <h1>Na serveru jsou novější odpovědi</h1>
        <p>
          V tomto prohlížeči zůstaly neodeslané změny. Mezitím se vaše hodnocení
          změnilo, například na jiném zařízení. Vyberte, s čím chcete
          pokračovat.
        </p>
        <div className={styles.conflictActions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              pending.current = {};
              draftConflictRef.current = null;
              setDraftConflict(null);
              persist({});
              setSaveStatus('saved');
            }}
          >
            Použít odpovědi ze serveru
          </button>
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              const patch = draftConflict;
              draftConflictRef.current = null;
              setDraftConflict(null);
              const next = {
                ...stateRef.current!,
                ...patch,
                answers: { ...stateRef.current!.answers, ...patch.answers },
              };
              stateRef.current = next;
              setState(next);
              pending.current = patch;
              persist(patch);
              void flush();
            }}
          >
            Použít mé neodeslané změny
          </button>
        </div>
      </section>
    );

  const steps = getConferenceFeedbackSteps(state.answers);
  const stepIndex = !state.answers.participantRole
    ? 0
    : Math.max(
        0,
        steps.findIndex((step) => step.id === state.currentStep),
      );
  const step = steps[stepIndex]!;
  const questions = getVisibleConferenceFeedbackQuestions(state.answers);
  const role = getConferenceFeedbackRole(state.answers);
  const finished = Boolean(state.completedAt) && !editing;
  const last = stepIndex === steps.length - 1;
  const renderQuestion = (question: ConferenceFeedbackQuestion) => (
    <FeedbackQuestion
      key={question.id}
      question={question}
      value={state.answers[question.id] ?? ''}
      onChange={change}
      onBlur={() => {
        void flush();
      }}
      suggestedRole={state.suggestedRole}
    />
  );
  const selectedCount = Object.entries(state.answers).filter(
    ([id, value]) =>
      value &&
      (questions.some((question) => question.id === id) ||
        id.startsWith('session:')),
  ).length;
  const programSessions =
    state.program?.sessions.filter(
      (session) =>
        !['workshop', 'mastermind'].includes(session.type) ||
        state.answers.workshopsAttended === 'yes',
    ) ?? [];
  const stages = Array.from(
    new Set(programSessions.map((session) => session.stage)),
  );

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* This small, local logo uses its original asset and has explicit dimensions. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo.png"
          alt="BYZON"
          width={2884}
          height={451}
          className={styles.logo}
          fetchPriority="high"
          decoding="async"
        />
        <div
          className={styles.saveState}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {saveStatus === 'saving' ? (
            <>
              <span className={styles.savingDot} />
              Ukládáme…
            </>
          ) : saveStatus === 'error' ? (
            <span className={styles.unsaved}>Čeká na uložení</span>
          ) : (
            <>
              <Check />
              {demo ? 'Uloženo v tomto prohlížeči' : 'Vše uloženo'}
            </>
          )}
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Průběh hodnocení">
          <div className={styles.sidebarIntro}>
            <h2>
              Každá zkušenost
              <br />
              posouvá BYZON dál.
            </h2>
            <p>Děkujeme za tu vaši.</p>
          </div>
          <div className={styles.progressText}>
            <span>
              {finished
                ? 'Hodnocení dokončeno'
                : `Část ${stepIndex + 1} z ${steps.length}`}
            </span>
            <span>
              {finished ? '100' : Math.round((stepIndex / steps.length) * 100)}{' '}
              %
            </span>
          </div>
          <progress
            className={styles.progress}
            value={finished ? steps.length : stepIndex}
            max={steps.length}
            aria-label="Postup hodnocením"
          />
          <ol className={styles.stepList}>
            {steps.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={
                    !finished && index === stepIndex ? 'step' : undefined
                  }
                  disabled={
                    finished || (!state.answers.participantRole && index > 0)
                  }
                  onClick={() => goToStep(item.id)}
                >
                  <span className={styles.stepNumber}>
                    {index < stepIndex || finished ? <Check /> : index + 1}
                  </span>
                  <span>
                    {item.id === 'intro'
                      ? 'Vaše role'
                      : item.id === 'overall'
                        ? 'Celkový dojem'
                        : item.id === 'program'
                          ? 'Program'
                          : item.id === 'organization'
                            ? 'Organizace'
                            : item.id === 'experience'
                              ? 'Zázemí a networking'
                              : item.id === 'digital'
                                ? 'Web a appka'
                                : item.id === 'music'
                                  ? 'Hudba a afterparty'
                                  : item.id === 'collaboration'
                                    ? 'Spolupráce s týmem'
                                    : item.id === 'role'
                                      ? 'Vaše role podrobněji'
                                      : item.id === 'future'
                                        ? 'Příští BYZON'
                                        : 'O vás'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className={styles.sidebarNote}>
            {demo
              ? 'Ukázkové odpovědi se do výsledků nezapočítají.'
              : 'Klidně si dejte pauzu. Stejný odkaz vás vrátí k uloženým odpovědím i na jiném zařízení.'}
          </p>
        </aside>
        <section className={styles.content} aria-label="Hodnocení konference">
          {completionError ? (
            <div className={styles.saveError} role="alert">
              <p>
                Odpovědi jsou uložené, ale dokončení se nepodařilo potvrdit.
              </p>
              <button
                type="button"
                disabled={completing}
                onClick={() => {
                  void complete();
                }}
              >
                Zkusit dokončit znovu
              </button>
            </div>
          ) : null}
          {saveStatus === 'error' ? (
            <div className={styles.saveError} role="alert">
              <p>
                Odpovědi se zatím nepodařilo uložit na server.{' '}
                {storageUnavailable
                  ? 'Nezavírejte prosím tuto stránku.'
                  : 'Máme je v tomto prohlížeči. Po obnovení připojení uložení zkusíme znovu.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  void flush();
                }}
              >
                Zkusit uložit znovu
              </button>
            </div>
          ) : null}
          {demo && storageUnavailable ? (
            <p className={styles.saveError}>
              Prohlížeč nedovoluje ukládání ukázky. Při zavření stránky se demo
              odpovědi ztratí.
            </p>
          ) : null}
          {finished ? (
            <div className={styles.complete}>
              <div className={styles.completeMark}>
                <Check />
              </div>
              <h1 ref={headingRef} tabIndex={-1}>
                Děkujeme.
                <br />
                Tohle má smysl.
              </h1>
              <p>
                {demo
                  ? 'Prošli jste ukázkou hodnocení. Žádná odpověď z dema se nezapočítá do výsledků konference.'
                  : 'Vaše zkušenost nám pomůže připravit lepší BYZON. Děkujeme za čas i otevřenost.'}
              </p>
              <p className={styles.completionDetail}>
                {selectedCount}{' '}
                {selectedCount === 1
                  ? 'uložená odpověď'
                  : selectedCount < 5
                    ? 'uložené odpovědi'
                    : 'uložených odpovědí'}{' '}
                · Kdykoliv se můžete vrátit přes stejný odkaz.
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  setEditing(true);
                  goToStep('intro');
                }}
              >
                Prohlédnout nebo upravit odpovědi
                <Arrow />
              </button>
            </div>
          ) : (
            <>
              <div className={styles.heading}>
                {resumed && step.id !== 'intro' ? (
                  <p className={styles.resume}>
                    <Check />
                    Pokračujete tam, kde jste skončili.
                  </p>
                ) : null}
                <h1 ref={headingRef} tabIndex={-1}>
                  {step.id === 'intro'
                    ? 'Váš BYZON. Vašima očima.'
                    : step.title}
                </h1>
                <p>
                  {step.id === 'intro'
                    ? 'Pár minut pro lepší příští ročník. Co si chcete zopakovat a co bychom měli změnit?'
                    : step.description}
                </p>
                {step.id === 'intro' ? (
                  <div className={styles.introFacts}>
                    <span>Maximálně 5 minut</span>
                    <span>Ukládáme každou odpověď</span>
                  </div>
                ) : (
                  <p className={styles.optionalNote}>
                    Odpovězte jen na to, co chcete. Otázky můžete přeskočit.
                  </p>
                )}
              </div>
              <div className={styles.questions}>
                {questions
                  .filter((question) => step.questionIds.includes(question.id))
                  .map(renderQuestion)}
              </div>
              {roleError ? (
                <p role="alert" className={styles.roleError}>
                  Vyberte prosím svou hlavní roli, abychom vám přizpůsobili
                  otázky.
                </p>
              ) : null}
              {step.id === 'intro' ? (
                <p className={styles.privacy}>
                  Hodnocení je spojené s vaší účastí a není anonymní. Odpovědi
                  zpracuje organizační tým BYZONu.{' '}
                  {demo
                    ? 'V demu zůstávají pouze ve vašem prohlížeči.'
                    : 'Váš osobní odkaz prosím nepřeposílejte.'}
                </p>
              ) : null}
              {step.id === 'program' && programSessions.length > 0 ? (
                <details className={styles.programDisclosure}>
                  <summary>
                    Ohodnotit konkrétní vystoupení <span>Volitelné</span>
                  </summary>
                  <p className={styles.hint}>
                    {demo
                      ? 'Ukázkový program pro vyzkoušení interakce. V ostrém hodnocení uvidíte skutečná vystoupení.'
                      : 'Otevřete navštívenou stage a vyberte vystoupení. Ostatní můžete nechat bez odpovědi.'}
                  </p>
                  {stages.map((stage) => (
                    <details key={stage} className={styles.stage}>
                      <summary>{stage}</summary>
                      {programSessions
                        .filter((session) => session.stage === stage)
                        .map((session) => (
                          <div key={session.id} className={styles.session}>
                            <p className={styles.sessionSpeaker}>
                              {session.speakers.join(', ')}
                            </p>
                            {renderQuestion({
                              id: `session:${session.id}`,
                              label: session.title,
                              type: 'choice',
                              options: [
                                { value: '4', label: 'Velmi spokojen/a' },
                                { value: '3', label: 'Spíše spokojen/a' },
                                { value: '2', label: 'Spíše nespokojen/a' },
                                { value: '1', label: 'Velmi nespokojen/a' },
                                {
                                  value: 'skip',
                                  label: 'Nezúčastnil/a jsem se',
                                },
                              ],
                            })}
                          </div>
                        ))}
                    </details>
                  ))}
                </details>
              ) : null}
              <footer className={styles.navigation}>
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    className={styles.back}
                    onClick={() => goToStep(steps[stepIndex - 1]!.id)}
                  >
                    <Arrow back />
                    Zpět
                  </button>
                ) : (
                  <span className={styles.startNote}>
                    Podle role upravíme další otázky.
                  </span>
                )}
                <button
                  type="button"
                  className={styles.primary}
                  disabled={completing}
                  onClick={() => {
                    if (step.id === 'intro' && !state.answers.participantRole) {
                      setRoleError(true);
                      document
                        .querySelector<HTMLInputElement>(
                          'input[name="feedback-participantRole"]',
                        )
                        ?.focus();
                      return;
                    }
                    if (last) {
                      void complete();
                    } else goToStep(steps[stepIndex + 1]!.id);
                  }}
                >
                  {completing
                    ? 'Dokončujeme…'
                    : last
                      ? 'Dokončit hodnocení'
                      : step.id === 'intro'
                        ? 'Začít hodnocení'
                        : 'Pokračovat'}
                  {!completing ? <Arrow /> : null}
                </button>
              </footer>
              <p className={styles.bottomNote}>
                {last
                  ? 'Do výsledků se počítají i odpovědi z nedokončených hodnocení.'
                  : role !== 'attendee' && step.id === 'intro'
                    ? 'Ke společným otázkám přidáme krátkou část o spolupráci.'
                    : 'Nemusíte vyplnit vše. I část odpovědí nám pomůže.'}
              </p>
            </>
          )}
        </section>
      </div>
      <footer className={styles.pageFooter}>
        <span>BYZON · Pro lepší další ročník</span>
        {demo ? (
          <button
            type="button"
            onClick={() => {
              const next = emptyDemo();
              stateRef.current = next;
              pending.current = {};
              setState(next);
              setEditing(false);
              setResumed(false);
              persist({});
            }}
          >
            Vymazat ukázku a začít znovu
          </button>
        ) : (
          <span>Osobní odkaz pouze pro hodnocení</span>
        )}
      </footer>
    </div>
  );
}

export function ConferenceFeedbackDemo({
  emailHtml,
  emailSubject,
}: {
  emailHtml: string;
  emailSubject: string;
}) {
  const [tab, setTab] = useState<'email' | 'survey'>('email');
  const emailFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (tab !== 'email') return;
    const frame = emailFrame.current;
    if (!frame) return;
    const resize = () => {
      const body = frame.contentDocument?.body;
      if (body) frame.style.height = `${body.scrollHeight + 24}px`;
    };
    // srcDoc can finish loading before hydration attaches React's onLoad.
    resize();
    frame.addEventListener('load', resize);
    window.addEventListener('resize', resize);
    void frame.contentDocument?.fonts.ready.then(resize);
    return () => {
      frame.removeEventListener('load', resize);
      window.removeEventListener('resize', resize);
    };
  }, [tab, emailHtml]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active && window.location.hash === '#dotaznik') setTab('survey');
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className={styles.demoPage}>
      <div className={styles.demoBar}>
        <div>
          <strong>Ukázka pro organizační tým</strong>
          <p>
            Vyzkoušejte e-mail i celý dotazník. Demo se do výsledků
            nezapočítává.
          </p>
        </div>
        <div
          className={styles.demoTabs}
          role="tablist"
          aria-label="Ukázka hodnocení"
        >
          <button
            type="button"
            id="demo-email-tab"
            role="tab"
            aria-selected={tab === 'email'}
            aria-controls="demo-email-panel"
            tabIndex={tab === 'email' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                setTab('survey');
                document.getElementById('demo-survey-tab')?.focus();
              }
            }}
            onClick={() => setTab('email')}
          >
            Návrh e-mailu
          </button>
          <button
            type="button"
            id="demo-survey-tab"
            role="tab"
            aria-selected={tab === 'survey'}
            aria-controls="demo-survey-panel"
            tabIndex={tab === 'survey' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                setTab('email');
                document.getElementById('demo-email-tab')?.focus();
              }
            }}
            onClick={() => setTab('survey')}
          >
            Interaktivní dotazník
          </button>
        </div>
      </div>
      <div
        id="demo-email-panel"
        role="tabpanel"
        aria-labelledby="demo-email-tab"
        hidden={tab !== 'email'}
        className={styles.emailPanel}
      >
        <div className={styles.emailIntroduction}>
          <h1>Pozvání, které otevře dialog.</h1>
          <p>
            Takto pozveme účastníky k hodnocení. Tlačítko v ostrém e-mailu
            otevře jejich osobní dotazník bez přihlašování.
          </p>
        </div>
        <div className={styles.emailSubject}>
          <span>Předmět</span>
          <strong>{emailSubject}</strong>
        </div>
        <iframe
          ref={emailFrame}
          title="Návrh e-mailu s pozvánkou k hodnocení"
          sandbox="allow-same-origin"
          onLoad={(event) => {
            const frame = event.currentTarget;
            const document = frame.contentDocument;
            if (document)
              frame.style.height = `${document.body.scrollHeight + 24}px`;
          }}
          srcDoc={emailHtml.replace(
            '</head>',
            '<style>a{pointer-events:none!important;cursor:default!important}</style></head>',
          )}
          className={styles.emailFrame}
        />
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            setTab('survey');
            window.scrollTo({ top: 0 });
          }}
        >
          Vyzkoušet hodnocení
          <Arrow />
        </button>
      </div>
      <div
        id="demo-survey-panel"
        role="tabpanel"
        aria-labelledby="demo-survey-tab"
        hidden={tab !== 'survey'}
      >
        <ConferenceFeedback demo />
      </div>
    </div>
  );
}
