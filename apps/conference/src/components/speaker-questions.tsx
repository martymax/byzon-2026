'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionLink, Button, Card } from '@byzon/ui';
import {
  questionAnswerMutationResponseSchema,
  speakerQuestionFeedSchema,
  type SpeakerQuestionFeed,
} from '@byzon/domain/contracts';
import { ParticipantAccountBoundary } from './participant-account-state';
import { PrivateApiError, requestPrivateJson } from '@/lib/private-json';
import { subscribeToPrivateResourceInvalidation } from '@/lib/private-resource-events';
import { questionError, questionTime } from './participant-questions';
import styles from './question-workspace.module.css';
import { QuestionStatus, QuestionFilters } from './question-ui';
export function SpeakerQuestionPage({ sessionId }: { sessionId: string }) {
  return (
    <ParticipantAccountBoundary loginReturnTo={`/host/dotazy/${sessionId}`}>
      {(identity) => (
        <SpeakerQuestionPanel
          key={`${identity.event.id}:${identity.user.id}:${sessionId}`}
          eventId={identity.event.id}
          sessionId={sessionId}
        />
      )}
    </ParticipantAccountBoundary>
  );
}
export function SpeakerAnswerEditor({
  item,
  onSaved,
  onDenied,
  signal,
}: {
  item: SpeakerQuestionFeed['items'][number];
  onSaved: () => Promise<void>;
  onDenied: () => void;
  signal?: AbortSignal;
}) {
  const [text, setText] = useState(item.answer?.text ?? ''),
    [version, setVersion] = useState(item.answer?.version ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [savedMessage, setSavedMessage] = useState('');
  const pending = useRef<{
    text: string;
    expectedVersion: number;
    key: string;
  } | null>(null);
  if (
    item.answer &&
    !item.canEdit &&
    !conflict &&
    (!text.trim() || text === item.answer.text)
  )
    return <p>Na tento dotaz již odpověděl jiný řečník.</p>;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || conflict || (item.answer && !item.canEdit) || !text.trim())
          return;
        if (
          !pending.current ||
          pending.current.text !== text.trim() ||
          pending.current.expectedVersion !== version
        )
          pending.current = {
            text: text.trim(),
            expectedVersion: version,
            key: crypto.randomUUID(),
          };
        const request = pending.current;
        setBusy(true);
        setError('');
        setSavedMessage('');
        void requestPrivateJson(
          `/api/v1/speaker/questions/${item.questionId}/answer`,
          questionAnswerMutationResponseSchema,
          {
            method: version === 0 ? 'PUT' : 'PATCH',
            body: {
              text: request.text,
              expectedVersion: request.expectedVersion,
            },
            key: request.key,
            signal,
          },
        )
          .then(
            async (result) => {
              if (signal?.aborted) return;
              pending.current = null;
              setVersion(result.version);
              setSavedMessage(
                'Odpověď byla uložena. Vidí ji pouze autor dotazu.',
              );
              await onSaved();
            },
            async (e) => {
              if (signal?.aborted) return;
              if (
                e instanceof PrivateApiError &&
                ([401, 403].includes(e.status) ||
                  e.code === 'QUESTION_FOLLOW_UPS_DISABLED')
              ) {
                onDenied();
                return;
              }
              if (
                e instanceof PrivateApiError &&
                e.code === 'QUESTION_ANSWER_CONFLICT'
              ) {
                setConflict(true);
                await onSaved();
              }
              setError(questionError(e));
            },
          )
          .finally(() => setBusy(false));
      }}
    >
      <label className={styles.label} htmlFor={`answer-${item.questionId}`}>
        {item.answer ? 'Upravit vlastní odpověď' : 'Vaše písemná odpověď'}
      </label>
      <textarea
        id={`answer-${item.questionId}`}
        value={text}
        disabled={busy}
        maxLength={4000}
        required
        onChange={(e) => {
          setText(e.target.value);
          pending.current = null;
        }}
        aria-describedby={`privacy-${item.questionId}`}
      />
      <p id={`privacy-${item.questionId}`}>
        {text.length} / 4000 znaků · Odpověď uvidí pouze autor dotazu.
      </p>
      {savedMessage ? (
        <p className={styles.successNotice} role="status">
          {savedMessage}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {conflict || (item.answer && !item.canEdit) ? (
        <>
          <p>
            Rozepsaný text zůstal zachován. Porovnejte jej s aktuální odpovědí
            výše.
          </p>
          {item.canEdit ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setVersion(item.answer?.version ?? 0);
                setConflict(false);
                setError('');
                pending.current = null;
              }}
            >
              Pokračovat s aktuální verzí
            </Button>
          ) : null}
        </>
      ) : (
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy
            ? 'Ukládám…'
            : version
              ? 'Uložit úpravu odpovědi'
              : 'Odeslat soukromou odpověď'}
        </Button>
      )}
    </form>
  );
}
export function SpeakerQuestionPanel({
  eventId,
  sessionId,
}: {
  eventId: string;
  sessionId: string;
}) {
  const [feed, setFeed] = useState<SpeakerQuestionFeed | null>(null),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false),
    [filter, setFilter] = useState<'unanswered' | 'answered' | 'all'>(
      'unanswered',
    ),
    [signal, setSignal] = useState<AbortSignal>();
  const reload = useRef<() => Promise<void>>(async () => {}),
    wipeRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      busy = false;
    const controller = new AbortController();
    const wipe = () => {
      active = false;
      controller.abort();
      setFeed(null);
      setBlocked(true);
    };
    wipeRef.current = wipe;
    const load = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const items: SpeakerQuestionFeed['items'] = [];
        let cursor: string | null = null,
          after: string | undefined,
          last: SpeakerQuestionFeed | null = null;
        do {
          const params = new URLSearchParams({ status: 'all', limit: '100' });
          if (cursor && after) {
            params.set('cursor', cursor);
            params.set('after', after);
          }
          last = await requestPrivateJson(
            `/api/v1/speaker/sessions/${sessionId}/questions?${params}`,
            speakerQuestionFeedSchema,
            { signal: controller.signal },
          );
          if (last.eventId !== eventId || last.session.id !== sessionId)
            throw new PrivateApiError(
              403,
              'EVENT_ACCESS_DENIED',
              'Účet se změnil.',
            );
          items.push(...last.items);
          cursor = last.nextCursor;
          after = last.items.at(-1)?.submittedAt;
        } while (cursor && after && active);
        if (active && last) {
          setSignal(controller.signal);
          setFeed({ ...last, items });
          setError('');
        }
      } catch (e) {
        if (active) {
          if (
            e instanceof PrivateApiError &&
            [401, 403, 404, 409].includes(e.status)
          )
            wipe();
          else setError('Dotazy se nepodařilo obnovit. Zkuste to znovu.');
        }
      } finally {
        busy = false;
      }
    };
    reload.current = load;
    void load();
    const timer = setInterval(() => void load(), 10000),
      resume = () => void load();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeToPrivateResourceInvalidation(wipe);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [eventId, sessionId]);
  return (
    <section className={styles.workspace}>
      <header>
        <ActionLink variant="quiet" href="/host/dotazy">
          Moje přednášky
        </ActionLink>
        <h1 data-route-heading tabIndex={-1}>
          {feed?.session.title ?? 'Dotazy po vystoupení'}
        </h1>
        {feed ? (
          <p>
            {feed.session.roomName} · {questionTime(feed.session.startsAt)}
          </p>
        ) : null}
      </header>
      {blocked ? (
        <p role="alert">
          Přístup k odpovědím není dostupný. Soukromý obsah byl odstraněn.
          Ověřte přihlášení nebo přiřazení u organizátora.
        </p>
      ) : (
        <>
          <p>
            Dotazy neobsahují údaje o autorovi. Na panelu může odpovědět
            kterýkoli přiřazený řečník; upravovat odpověď může pouze ten, kdo ji
            napsal.
          </p>
          <div className={styles.toolbar}>
            <QuestionFilters
              value={filter}
              onChange={setFilter}
              total={feed?.items.length ?? 0}
              answered={feed?.items.filter((item) => item.answer).length ?? 0}
              written
            />
            <Button variant="quiet" onClick={() => void reload.current()}>
              Obnovit dotazy
            </Button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          {!feed ? (
            <p role="status">Načítám dotazy…</p>
          ) : (
            <>
              <p role="status">
                {feed.items.filter((i) => !i.answer).length} bez písemné
                odpovědi · {feed.items.filter((i) => i.answer).length} písemně
                zodpovězených
              </p>
              {!feed.items.some(
                (item) =>
                  filter === 'all' ||
                  (filter === 'answered' ? Boolean(item.answer) : !item.answer),
              ) ? (
                <p className={styles.empty}>
                  {!feed.items.length
                    ? 'Zatím nejsou žádné dotazy.'
                    : 'V tomto filtru nejsou žádné dotazy.'}
                </p>
              ) : null}
              {feed.items.length ? (
                <ol className={styles.list}>
                  {feed.items.map((item) => (
                    <li
                      key={item.questionId}
                      hidden={
                        filter === 'unanswered'
                          ? Boolean(item.answer)
                          : filter === 'answered'
                            ? !item.answer
                            : false
                      }
                    >
                      <Card
                        className={
                          item.answer || item.answeredAt
                            ? styles.answeredQuestion
                            : undefined
                        }
                      >
                        <QuestionStatus
                          answeredAt={item.answeredAt}
                          written={Boolean(item.answer)}
                        />
                        <p className={styles.questionText}>{item.text}</p>
                        <p className={styles.questionAuthor}>
                          {questionTime(item.submittedAt)}
                        </p>
                        {item.answeredAt && !item.answer ? (
                          <p className={styles.questionAuthor}>
                            Písemnou odpověď můžete doplnit i po zodpovězení na
                            konferenci.
                          </p>
                        ) : null}
                        {item.answer ? (
                          <div className={styles.answer}>
                            <h2>Odpověď · {item.answer.speakerName}</h2>
                            <p className={styles.text}>{item.answer.text}</p>
                            <p>{questionTime(item.answer.updatedAt)}</p>
                          </div>
                        ) : null}
                        <details className={styles.answerEditor}>
                          <summary>
                            {item.answer
                              ? item.canEdit
                                ? 'Upravit vlastní odpověď'
                                : 'Informace o odpovědi'
                              : 'Napsat soukromou odpověď'}
                          </summary>
                          <SpeakerAnswerEditor
                            item={item}
                            onSaved={async () => {
                              setFilter('all');
                              await reload.current();
                            }}
                            onDenied={() => wipeRef.current()}
                            {...(signal ? { signal } : {})}
                          />
                        </details>
                      </Card>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
