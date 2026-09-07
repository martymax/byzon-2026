'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionLink, Button, Card } from '@byzon/ui';
import {
  moderatorQuestionFeedSchema,
  questionContextSchema,
  questionSessionListSchema,
  type ModeratorQuestionFeed,
  type QuestionContext,
  type QuestionSessionList,
} from '@byzon/domain/contracts';
import { ParticipantAccountBoundary } from './participant-account-state';
import { PrivateApiError, requestPrivateJson } from '@/lib/private-json';
import {
  invalidateParticipantPrivateResources,
  subscribeToPrivateResourceInvalidation,
} from '@/lib/private-resource-events';
import { questionTime } from './participant-questions';
import styles from './question-workspace.module.css';
export function HostQuestionPage({
  kind,
  sessionId,
}: {
  kind: 'moderator' | 'speaker';
  sessionId?: string;
}) {
  const base = kind === 'moderator' ? '/host/moderace' : '/host/dotazy';
  return (
    <ParticipantAccountBoundary
      loginReturnTo={sessionId ? `${base}/${sessionId}` : base}
    >
      {(identity) =>
        sessionId && kind === 'moderator' ? (
          <ModeratorFeed
            key={`${identity.event.id}:${identity.user.id}:${sessionId}`}
            eventId={identity.event.id}
            sessionId={sessionId}
          />
        ) : (
          <HostQuestionSessions
            key={`${identity.event.id}:${identity.user.id}:${kind}`}
            eventId={identity.event.id}
            kind={kind}
          />
        )
      }
    </ParticipantAccountBoundary>
  );
}
export function HostQuestionSessions({
  eventId,
  kind,
}: {
  eventId: string;
  kind: 'moderator' | 'speaker';
}) {
  const [data, setData] = useState<QuestionSessionList | null>(null),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      busy = false;
    const abort = new AbortController();
    const wipe = () => {
      active = false;
      abort.abort();
      setData(null);
      setBlocked(true);
    };
    const load = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const next = await requestPrivateJson(
          `/api/v1/${kind}/sessions`,
          questionSessionListSchema,
          { signal: abort.signal },
        );
        if (next.eventId !== eventId)
          throw new PrivateApiError(
            403,
            'EVENT_ACCESS_DENIED',
            'Účet se změnil.',
          );
        if (active) {
          setData(next);
          setError('');
        }
      } catch (e) {
        if (active) {
          if (
            e instanceof PrivateApiError &&
            [401, 403, 409].includes(e.status)
          ) {
            wipe();
          } else setError('Seznam se nepodařilo obnovit. Zkuste to znovu.');
        }
      } finally {
        busy = false;
      }
    };
    refresh.current = () => void load();
    void load();
    const timer = setInterval(() => void load(), 10000);
    const resume = () => void load();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeToPrivateResourceInvalidation(wipe);
    return () => {
      active = false;
      abort.abort();
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [eventId, kind]);
  return (
    <section className={styles.workspace}>
      <h1 data-route-heading tabIndex={-1}>
        {kind === 'moderator' ? 'Moderování' : 'Dotazy po vystoupení'}
      </h1>
      {blocked ? (
        <p role="alert">
          Přístup není dostupný. Ověřte přihlášení nebo přiřazení u
          organizátora.
        </p>
      ) : (
        <>
          <p>
            {kind === 'moderator'
              ? 'Vaše přiřazené přednášky. Dotazy zůstávají dostupné i po skončení sběru.'
              : 'Vaše ukončené přednášky. Odpověď vidí pouze autor dotazu.'}
          </p>
          <Button variant="secondary" onClick={() => refresh.current()}>
            Obnovit seznam
          </Button>
          {error ? <p role="alert">{error}</p> : null}
          {!data ? (
            <p role="status">Načítám přednášky…</p>
          ) : !data.sessions.length ? (
            <p>Žádná dostupná přednáška.</p>
          ) : (
            <ul className={styles.list}>
              {data.sessions.map((session) => (
                <li key={session.id}>
                  <Card>
                    <h2>
                      <ActionLink
                        variant="quiet"
                        href={`${kind === 'moderator' ? '/host/moderace' : '/host/dotazy'}/${session.id}`}
                      >
                        {session.title}
                      </ActionLink>
                    </h2>
                    <p>
                      {session.roomName} · {questionTime(session.startsAt)}
                    </p>
                    <p>
                      {session.questionCount} dotazů
                      {kind === 'speaker'
                        ? ` · ${session.unansweredCount} bez odpovědi`
                        : ''}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ActionLink variant="secondary" href="/app/vice">
        Zpět do mého účtu
      </ActionLink>
    </section>
  );
}
export function ModeratorFeed({
  eventId,
  sessionId,
}: {
  eventId: string;
  sessionId: string;
}) {
  const [items, setItems] = useState<ModeratorQuestionFeed['items']>([]),
    [context, setContext] = useState<QuestionContext | null>(null),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [newIds, setNewIds] = useState<string[]>([]);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      busy = false,
      initialized = false;
    let displayedIds = new Set<string>();
    const all = new Map<string, ModeratorQuestionFeed['items'][number]>();
    const abort = new AbortController();
    const wipe = () => {
      active = false;
      abort.abort();
      all.clear();
      setItems([]);
      setContext(null);
      setNewIds([]);
      setBlocked(true);
    };
    const load = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        let last = [...all.values()].at(-1);
        let more = true;
        while (more && active) {
          const params = new URLSearchParams({ limit: '100' });
          if (last) {
            params.set('after', last.submittedAt);
            params.set('cursor', last.questionId);
          }
          const data = await requestPrivateJson(
            `/api/v1/moderator/sessions/${sessionId}/questions?${params}`,
            moderatorQuestionFeedSchema,
            { signal: abort.signal },
          );
          if (data.eventId !== eventId || data.sessionId !== sessionId)
            throw new PrivateApiError(
              403,
              'EVENT_ACCESS_DENIED',
              'Účet se změnil.',
            );
          for (const item of data.items) {
            all.set(item.questionId, item);
          }
          const next = data.items.at(-1);
          more = Boolean(
            data.nextCursor && next && next.questionId !== last?.questionId,
          );
          if (next) last = next;
        }
        const nextContext = await requestPrivateJson(
          `/api/v1/sessions/${sessionId}/question-context`,
          questionContextSchema,
          { signal: abort.signal },
        );
        if (active) {
          const additions = [...all.keys()].filter(
            (id) => !displayedIds.has(id),
          );
          displayedIds = new Set(all.keys());
          setItems(
            [...all.values()].sort(
              (a, b) =>
                a.submittedAt.localeCompare(b.submittedAt) ||
                a.questionId.localeCompare(b.questionId),
            ),
          );
          setContext(nextContext);
          setLoaded(true);
          setError('');
          setSuccess(nextContext.serverTime);
          if (initialized && additions.length)
            setNewIds((previous) => [...new Set([...previous, ...additions])]);
          initialized = true;
        }
      } catch (e) {
        if (active) {
          if (
            e instanceof PrivateApiError &&
            [401, 403, 404, 409].includes(e.status)
          ) {
            wipe();
            if (e.status === 401 || e.status === 403)
              void invalidateParticipantPrivateResources(
                e.status === 401 ? 'session_expired' : 'permission',
              );
          } else
            setError(
              'Spojení je přerušené. Zobrazené dotazy mohou být neaktuální. Obnovuji spojení…',
            );
        }
      } finally {
        busy = false;
      }
    };
    refresh.current = () => void load();
    void load();
    const timer = setInterval(() => void load(), 5000),
      resume = () => void load();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeToPrivateResourceInvalidation(wipe);
    return () => {
      active = false;
      abort.abort();
      all.clear();
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [eventId, sessionId]);
  return (
    <section className={`${styles.workspace} ${styles.feed}`}>
      <header className={styles.sticky}>
        <p className="eyebrow">Moderátor · pouze pro čtení</p>
        <h1 data-route-heading tabIndex={-1}>
          {context?.session.title ?? 'Dotazy účastníků'}
        </h1>
        {context ? (
          <p>
            {context.session.roomName} ·{' '}
            {questionTime(context.session.startsAt)} ·{' '}
            {context.canSubmit ? 'Sběr probíhá' : 'Sběr neprobíhá'}
          </p>
        ) : null}
        {!blocked ? (
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => refresh.current()}>
              Obnovit dotazy
            </Button>
            {newIds.length ? (
              <Button
                onClick={() => {
                  document
                    .getElementById(`question-${newIds[0]}`)
                    ?.scrollIntoView({ block: 'center' });
                  setNewIds([]);
                }}
              >
                Přejít na nové ({newIds.length})
              </Button>
            ) : null}
            <span role="status">
              {items.length} dotazů
              {success ? ` · Aktualizováno ${questionTime(success)}` : ''}
            </span>
          </div>
        ) : null}
      </header>
      {blocked ? (
        <p role="alert">
          Přístup byl ukončen. Soukromé dotazy byly odstraněny.
        </p>
      ) : (
        <>
          {error ? <p role="alert">{error}</p> : null}
          {!loaded ? (
            <p role="status">Načítám dotazy…</p>
          ) : !items.length ? (
            <p>Zatím nebyl odeslán žádný dotaz.</p>
          ) : (
            <ol className={styles.list}>
              {items.map((item) => (
                <li id={`question-${item.questionId}`} key={item.questionId}>
                  <Card>
                    <strong>{item.authorName}</strong>
                    <p className={styles.meta}>
                      {questionTime(item.submittedAt)}
                    </p>
                    <p className={styles.text}>{item.text}</p>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <ActionLink variant="secondary" href="/host/moderace">
        Moje moderované přednášky
      </ActionLink>
    </section>
  );
}
