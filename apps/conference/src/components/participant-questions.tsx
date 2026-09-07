'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionLink, Button, Card } from '@byzon/ui';
import {
  ownQuestionsSchema,
  questionContextSchema,
  questionSubmitResponseSchema,
  type OwnQuestions,
  type QuestionContext,
} from '@byzon/domain/contracts';
import { ParticipantAccountBoundary } from './participant-account-state';
import { PrivateApiError, requestPrivateJson } from '@/lib/private-json';
import {
  invalidateParticipantPrivateResources,
  subscribeToPrivateResourceInvalidation,
} from '@/lib/private-resource-events';
import styles from './question-workspace.module.css';
export const questionTime = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const stateLabels = {
  unsupported: 'Tento blok nepodporuje dotazy.',
  disabled: 'Sběr dotazů je nyní vypnutý.',
  scheduled: 'Dotazy se otevřou na začátku přednášky.',
  open: 'Právě přijímáme dotazy.',
  closed: 'Přednáška skončila. Nové dotazy už nepřijímáme.',
};
export const questionError = (error: unknown) =>
  error instanceof PrivateApiError
    ? error.code === 'VALIDATION_FAILED'
      ? 'Zkontrolujte délku textu a odstraňte nepovolené řídicí znaky.'
      : error.message
    : 'Spojení bylo přerušeno. Text zůstává rozepsaný; zkuste požadavek znovu.';
export function OwnQuestionItems({
  items,
  showSession = false,
}: {
  items: OwnQuestions['items'];
  showSession?: boolean;
}) {
  return (
    <section>
      <h2>Moje dotazy</h2>
      {!items.length ? (
        <p>Zatím jste neposlali žádný dotaz.</p>
      ) : (
        <ol className={styles.list}>
          {items.map((item) => (
            <li key={item.questionId}>
              <Card>
                {showSession ? (
                  <ActionLink
                    variant="quiet"
                    href={`/app/interakce/${item.sessionId}`}
                  >
                    {item.sessionTitle}
                  </ActionLink>
                ) : null}
                <p className={styles.meta}>
                  Odesláno {questionTime(item.submittedAt)}
                </p>
                <p className={styles.text}>{item.text}</p>
                {item.answer ? (
                  <div className={styles.answer}>
                    <h3>Písemná odpověď · {item.answer.speakerName}</h3>
                    <p className={styles.text}>{item.answer.text}</p>
                    <p className={styles.meta}>
                      {questionTime(item.answer.updatedAt)} · Odpověď vidíte jen
                      vy.
                    </p>
                  </div>
                ) : (
                  <p className={styles.meta}>Bez písemné odpovědi</p>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
export function QuestionForm({ sessionId }: { sessionId: string }) {
  return (
    <ParticipantAccountBoundary loginReturnTo={`/app/interakce/${sessionId}`}>
      {(identity) => (
        <ParticipantQuestionPanel
          key={`${identity.event.id}:${identity.user.id}:${sessionId}`}
          eventId={identity.event.id}
          sessionId={sessionId}
        />
      )}
    </ParticipantAccountBoundary>
  );
}
export function ParticipantOwnQuestions() {
  return (
    <ParticipantAccountBoundary loginReturnTo="/app/dotazy">
      {(identity) => (
        <ParticipantQuestionPanel
          key={`${identity.event.id}:${identity.user.id}`}
          eventId={identity.event.id}
        />
      )}
    </ParticipantAccountBoundary>
  );
}
export function ParticipantQuestionPanel({
  eventId,
  sessionId,
}: {
  eventId: string;
  sessionId?: string;
}) {
  const [context, setContext] = useState<QuestionContext | null>(null),
    [items, setItems] = useState<OwnQuestions['items']>([]),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [working, setWorking] = useState(false),
    [hasPending, setHasPending] = useState(false),
    [blocked, setBlocked] = useState(false),
    [loaded, setLoaded] = useState(false);
  const pending = useRef<{ text: string; key: string } | null>(null),
    abort = useRef<AbortController | null>(null),
    reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    abort.current = controller;
    const wipe = () => {
      active = false;
      controller.abort();
      setContext(null);
      setItems([]);
      setText('');
      pending.current = null;
      setHasPending(false);
      setBlocked(true);
    };
    const fail = (error: unknown) => {
      if (!active) return;
      if (
        error instanceof PrivateApiError &&
        [401, 403].includes(error.status)
      ) {
        wipe();
        void invalidateParticipantPrivateResources(
          error.status === 401 ? 'session_expired' : 'permission',
        );
      } else setError(questionError(error));
    };
    const load = async () => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const own: OwnQuestions['items'] = [];
        let next: string | null = null,
          after: string | undefined;
        do {
          const params = new URLSearchParams(sessionId ? { sessionId } : {});
          if (next && after) {
            params.set('cursor', next);
            params.set('after', after);
          }
          const data = await requestPrivateJson(
            `/api/v1/me/questions?${params}`,
            ownQuestionsSchema,
            { signal: controller.signal },
          );
          if (data.eventId !== eventId)
            throw new PrivateApiError(
              403,
              'EVENT_ACCESS_DENIED',
              'Účet se změnil.',
            );
          own.push(...data.items);
          next = data.nextCursor;
          after = data.items.at(-1)?.submittedAt;
        } while (next && after && active);
        if (active) {
          setItems(own);
          setLoaded(true);
        }
        if (sessionId) {
          const data = await requestPrivateJson(
            `/api/v1/sessions/${sessionId}/question-context`,
            questionContextSchema,
            { signal: controller.signal },
          );
          if (data.eventId !== eventId)
            throw new PrivateApiError(
              403,
              'EVENT_ACCESS_DENIED',
              'Event se změnil.',
            );
          if (active) setContext(data);
        }
      } catch (error) {
        fail(error);
      } finally {
        inFlight = false;
      }
    };
    reload.current = load;
    void load();
    const interval = setInterval(() => void load(), 10000);
    const resume = () => void load();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    const unsubscribe = subscribeToPrivateResourceInvalidation(wipe);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      unsubscribe();
    };
  }, [eventId, sessionId]);
  if (blocked)
    return (
      <Card>
        <h1>Přístup k dotazům není dostupný</h1>
        <p>Soukromý obsah byl odstraněn ze stránky.</p>
        <ActionLink
          href={`/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(sessionId ? `/app/interakce/${sessionId}` : '/app/dotazy')}`}
        >
          Obnovit přihlášení
        </ActionLink>
      </Card>
    );
  return (
    <div className={styles.workspace}>
      <header>
        <p className="eyebrow">Soukromé Q&A</p>
        <h1 data-route-heading tabIndex={-1}>
          {context?.session.title ??
            (sessionId ? 'Dotazy k přednášce' : 'Moje dotazy a odpovědi')}
        </h1>
        {context ? (
          <>
            <p>
              {context.session.roomName} ·{' '}
              {questionTime(context.session.startsAt)}–
              {new Intl.DateTimeFormat('cs-CZ', {
                timeZone: 'Europe/Prague',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(context.session.endsAt))}
            </p>
            <p role="status">{stateLabels[context.state]}</p>
          </>
        ) : null}
      </header>
      {sessionId && context && context.state !== 'unsupported' ? (
        <Card>
          <h2>Položit dotaz</h2>
          <p id="question-privacy">
            Během vystoupení dotaz uvidí pouze moderátor. Po skončení jej mohou
            bez údajů o autorovi vidět řečníci a případně na něj písemně
            odpovědět. Odpověď uvidíte jen vy.
          </p>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (working || !text.trim()) return;
              const canonical = text.trim();
              if (!pending.current || pending.current.text !== canonical)
                pending.current = { text: canonical, key: crypto.randomUUID() };
              setHasPending(true);
              const request = pending.current;
              setWorking(true);
              setError('');
              setMessage('');
              void requestPrivateJson(
                `/api/v1/sessions/${sessionId}/questions`,
                questionSubmitResponseSchema,
                {
                  body: { text: request.text },
                  key: request.key,
                  signal: abort.current?.signal,
                },
              )
                .then(
                  async () => {
                    if (abort.current?.signal.aborted) return;
                    pending.current = null;
                    setHasPending(false);
                    setText('');
                    setMessage('Dotaz byl odeslán moderátorovi.');
                    await reload.current();
                  },
                  (error) => {
                    if (abort.current?.signal.aborted) return;
                    if (
                      error instanceof PrivateApiError &&
                      [401, 403].includes(error.status)
                    ) {
                      setText('');
                      setItems([]);
                      setContext(null);
                      setBlocked(true);
                      pending.current = null;
                      setHasPending(false);
                      void invalidateParticipantPrivateResources(
                        error.status === 401 ? 'session_expired' : 'permission',
                      );
                    } else setError(questionError(error));
                  },
                )
                .finally(() => setWorking(false));
            }}
          >
            <label className={styles.label} htmlFor="participant-question">
              Váš dotaz
            </label>
            <textarea
              id="participant-question"
              name="text"
              value={text}
              maxLength={1000}
              required
              disabled={working}
              aria-describedby="question-privacy question-count"
              onChange={(event) => {
                setText(event.target.value);
                if (pending.current?.text !== event.target.value.trim()) {
                  pending.current = null;
                  setHasPending(false);
                }
              }}
            />
            <span id="question-count">{text.length} / 1000 znaků</span>
            <Button
              type="submit"
              disabled={
                working || (!context.canSubmit && !hasPending) || !text.trim()
              }
            >
              {working
                ? 'Odesílám…'
                : hasPending && !context.canSubmit
                  ? 'Ověřit odeslání znovu'
                  : 'Odeslat dotaz'}
            </Button>
          </form>
        </Card>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <div>
          <p role="alert" className={styles.error}>
            {error}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setError('');
              void reload.current();
            }}
          >
            Obnovit dotazy
          </Button>
        </div>
      ) : null}
      {loaded ? (
        <OwnQuestionItems items={items} showSession={!sessionId} />
      ) : (
        <p role="status">Načítám vaše dotazy…</p>
      )}
      <ActionLink
        variant="secondary"
        href={sessionId ? `/app/program/${sessionId}` : '/app/vice'}
      >
        {sessionId ? 'Zpět na přednášku' : 'Zpět do mého účtu'}
      </ActionLink>
    </div>
  );
}
export function QuestionSessionAction({
  eventId,
  sessionId,
}: {
  eventId: string;
  sessionId: string;
}) {
  const [context, setContext] = useState<QuestionContext | null>(null);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const load = () => {
      if (document.hidden) return;
      void requestPrivateJson(
        `/api/v1/sessions/${sessionId}/question-context`,
        questionContextSchema,
        { signal: abort.signal },
      ).then(
        (data) => {
          if (active && data.eventId === eventId) setContext(data);
        },
        () => {
          if (active) setContext(null);
        },
      );
    };
    load();
    const interval = setInterval(load, 10000);
    const unsubscribe = subscribeToPrivateResourceInvalidation(() => {
      active = false;
      abort.abort();
      setContext(null);
    });
    return () => {
      active = false;
      abort.abort();
      clearInterval(interval);
      unsubscribe();
    };
  }, [eventId, sessionId]);
  if (!context || context.state === 'unsupported') return null;
  return (
    <ActionLink href={`/app/interakce/${sessionId}`} variant="secondary">
      {context.canSubmit
        ? 'Položit dotaz moderátorovi'
        : context.state === 'closed'
          ? 'Moje dotazy a odpovědi'
          : 'Dotazy k přednášce'}
    </ActionLink>
  );
}
