'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionLink, Button, Card, DestructiveConfirmation } from '@byzon/ui';
import {
  moderatorQuestionFeedSchema,
  questionModerationResponseSchema,
  type QuestionModerationRequest,
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
import {
  QuestionStatus,
  QuestionFilters,
  DeleteQuestionIcon,
  type QuestionFilter,
} from './question-ui';
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
    <section className={`app-page ${styles.workspace}`}>
      <header className="participant-account-heading">
        <p className="eyebrow">Moje role</p>
        <h1 data-route-heading tabIndex={-1}>
          {kind === 'moderator' ? 'Moderování' : 'Dotazy po vystoupení'}
        </h1>
        <p className="lead">
          {kind === 'moderator'
            ? 'Vaše přiřazené přednášky. Dotazy zůstávají dostupné i po skončení sběru.'
            : 'Vaše ukončené přednášky. Odpověď vidí pouze autor dotazu.'}
        </p>
      </header>
      <div className={styles.toolbar}>
        <ActionLink variant="quiet" href="/app/vice">
          Zpět do mého účtu
        </ActionLink>
        {!blocked ? (
          <Button variant="secondary" onClick={() => refresh.current()}>
            Obnovit seznam
          </Button>
        ) : null}
      </div>
      {blocked ? (
        <Card role="alert">
          Přístup není dostupný. Ověřte přihlášení nebo přiřazení u
          organizátora.
        </Card>
      ) : (
        <>
          {error ? <p role="alert">{error}</p> : null}
          {!data ? (
            <Card role="status">Načítám přednášky…</Card>
          ) : !data.sessions.length ? (
            <Card className={styles.empty}>
              <h2>Žádná dostupná přednáška</h2>
              <p>Přiřazené přednášky se zobrazí v tomto přehledu.</p>
            </Card>
          ) : (
            <ul className={styles.list}>
              {data.sessions.map((session) => (
                <li key={session.id}>
                  <a
                    className={styles.sessionCard}
                    href={`${kind === 'moderator' ? '/host/moderace' : '/host/dotazy'}/${session.id}`}
                  >
                    <div className={styles.sessionInfo}>
                      <h2>{session.title}</h2>
                      <p className={styles.meta}>
                        {session.roomName} · {questionTime(session.startsAt)}
                      </p>
                    </div>
                    <div className={styles.sessionSummary}>
                      <span className={styles.count}>
                        Dotazy: {session.questionCount}
                      </span>
                      {kind === 'speaker' ? (
                        <span className={styles.meta}>
                          Bez odpovědi: {session.unansweredCount}
                        </span>
                      ) : null}
                      <span className={styles.openSession}>
                        Otevřít dotazy <span aria-hidden="true">→</span>
                      </span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
export function ModeratorFeed({
  eventId,
  sessionId,
  embedded = false,
}: {
  eventId: string;
  sessionId: string;
  embedded?: boolean;
}) {
  const [items, setItems] = useState<ModeratorQuestionFeed['items']>([]),
    [context, setContext] = useState<QuestionContext | null>(null),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [newIds, setNewIds] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [pendingDelete, setPendingDelete] = useState<string | null>(null),
    [mutating, setMutating] = useState(false),
    [actionError, setActionError] = useState(''),
    [notice, setNotice] = useState(''),
    [filter, setFilter] = useState<QuestionFilter>('all');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (embedded) {
      headingRef.current?.scrollIntoView({ block: 'start' });
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [embedded]);
  const mutationFence = useRef(0);
  const mutationBusy = useRef(false);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      busy = false,
      initialized = false,
      reloadRequested = false;
    mutationFence.current += 1;
    let displayedIds = new Set<string>();
    const abort = new AbortController();
    const wipe = () => {
      active = false;
      abort.abort();
      mutationFence.current += 1;
      setSelected([]);
      setPendingDelete(null);
      setItems([]);
      setContext(null);
      setNewIds([]);
      setBlocked(true);
    };
    const load = async () => {
      if (!active || document.hidden) return;
      if (busy) {
        reloadRequested = true;
        return;
      }
      busy = true;
      try {
        const all = new Map<string, ModeratorQuestionFeed['items'][number]>();
        let last: ModeratorQuestionFeed['items'][number] | undefined;
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
          setSelected((previous) => previous.filter((id) => all.has(id)));
          setNewIds((previous) => previous.filter((id) => all.has(id)));
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
        if (reloadRequested && active) {
          reloadRequested = false;
          void load();
        }
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
      mutationFence.current += 1;
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [eventId, sessionId]);
  const mutate = async (body: QuestionModerationRequest) => {
    if (mutationBusy.current || blocked) return;
    const fence = mutationFence.current;
    mutationBusy.current = true;
    setMutating(true);
    setActionError('');
    setNotice('');
    try {
      await requestPrivateJson(
        `/api/v1/moderator/sessions/${sessionId}/questions`,
        questionModerationResponseSchema,
        {
          body,
          key: crypto.randomUUID(),
        },
      );
      if (fence !== mutationFence.current) return;
      setSelected([]);
      setPendingDelete(null);
      setNotice(
        body.action === 'delete'
          ? 'Otázka byla smazána.'
          : body.action === 'merge'
            ? 'Otázky byly sloučeny. Všechna původní znění zůstala zachována.'
            : body.answered
              ? 'Otázka byla označena jako zodpovězená.'
              : 'Otázka byla vrácena mezi nezodpovězené.',
      );
      refresh.current();
    } catch (e) {
      if (fence !== mutationFence.current) return;
      if (e instanceof PrivateApiError && [401, 403].includes(e.status)) {
        void invalidateParticipantPrivateResources(
          e.status === 401 ? 'session_expired' : 'permission',
        );
      } else {
        setActionError(
          e instanceof PrivateApiError
            ? e.message
            : 'Změnu se nepodařilo potvrdit. Obnovte dotazy a zkontrolujte výsledek.',
        );
        refresh.current();
      }
    } finally {
      mutationBusy.current = false;
      if (fence === mutationFence.current) setMutating(false);
    }
  };
  const answeredCount = items.filter((item) => item.answeredAt).length;
  const visibleItems = items.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'answered' ? Boolean(item.answeredAt) : !item.answeredAt),
  );
  const deleting = items.find((item) => item.questionId === pendingDelete);
  const Heading = embedded ? 'h3' : 'h1';
  return (
    <section
      className={`${embedded ? styles.embeddedFeed : 'app-page'} ${styles.workspace} ${styles.feed}`}
    >
      <header className={styles.sticky}>
        <Heading
          ref={headingRef}
          className={styles.feedHeading}
          data-route-heading={!embedded || undefined}
          tabIndex={-1}
        >
          {context?.session.title ?? 'Dotazy účastníků'}
        </Heading>
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
                  setFilter('all');
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`question-${newIds[0]}`)
                      ?.scrollIntoView({ block: 'center' }),
                  );
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
        {!blocked && loaded ? (
          <QuestionFilters
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setSelected([]);
            }}
            total={items.length}
            answered={answeredCount}
          />
        ) : null}
      </header>
      {!blocked && selected.length ? (
        <div
          className={styles.selectionBar}
          role="region"
          aria-label="Sloučení otázek"
        >
          <p>
            Vybráno {selected.length} ze 2 dotazů.{' '}
            {selected.length === 1
              ? 'Vyberte druhý dotaz ke sloučení.'
              : 'Připraveno ke sloučení.'}
          </p>
          {selected.length === 1 ? (
            <Button
              variant="quiet"
              disabled={mutating}
              onClick={() => setSelected([])}
            >
              Zrušit výběr
            </Button>
          ) : null}
        </div>
      ) : null}
      {!blocked && selected.length === 2 ? (
        <div className={styles.actions}>
          <p>
            Sloučení zachová všechna původní znění i autory. Pokud některý dotaz
            čeká na odpověď, bude čekat i sloučený dotaz.
          </p>
          <Button
            disabled={mutating}
            onClick={() => {
              const target = items.find(
                (item) => item.questionId === selected[0],
              );
              const source = items.find(
                (item) => item.questionId === selected[1],
              );
              if (target && source)
                void mutate({
                  action: 'merge',
                  questionId: target.questionId,
                  expectedVersion: target.moderationVersion,
                  sourceId: source.questionId,
                  sourceVersion: source.moderationVersion,
                });
            }}
          >
            Sloučit vybrané otázky
          </Button>
          <Button
            variant="quiet"
            disabled={mutating}
            onClick={() => setSelected([])}
          >
            Zrušit výběr
          </Button>
        </div>
      ) : null}
      {blocked ? (
        <p role="alert">
          Přístup byl ukončen. Soukromé dotazy byly odstraněny.
        </p>
      ) : (
        <>
          {error ? <p role="alert">{error}</p> : null}
          {actionError ? <p role="alert">{actionError}</p> : null}
          {notice ? (
            <p className={styles.successNotice} role="status">
              {notice}
            </p>
          ) : null}
          {!loaded ? (
            <p role="status">Načítám dotazy…</p>
          ) : !visibleItems.length ? (
            <p className={styles.empty}>
              {!items.length
                ? 'Zatím nebyl odeslán žádný dotaz.'
                : 'V tomto filtru nejsou žádné dotazy.'}
            </p>
          ) : (
            <ol className={styles.list}>
              {visibleItems.map((item) => (
                <li id={`question-${item.questionId}`} key={item.questionId}>
                  <Card
                    className={
                      item.answeredAt ? styles.answeredQuestion : undefined
                    }
                  >
                    <QuestionStatus answeredAt={item.answeredAt} />
                    <p className={styles.moderatorQuestion}>{item.text}</p>
                    <p className={styles.questionAuthor}>
                      {item.authorName} · {questionTime(item.submittedAt)}
                    </p>
                    {item.originals.map((original) => (
                      <div
                        className={styles.mergedOriginal}
                        key={original.questionId}
                      >
                        <p className={styles.moderatorQuestion}>
                          {original.text}
                        </p>
                        <p className={styles.questionAuthor}>
                          {original.authorName} ·{' '}
                          {questionTime(original.submittedAt)}
                        </p>
                      </div>
                    ))}
                    <div
                      className={`${styles.actions} ${styles.questionActions}`}
                    >
                      <Button
                        variant="secondary"
                        disabled={mutating}
                        onClick={() =>
                          void mutate({
                            action: 'answer',
                            questionId: item.questionId,
                            expectedVersion: item.moderationVersion,
                            answered: !item.answeredAt,
                          })
                        }
                      >
                        {item.answeredAt
                          ? 'Vrátit mezi nezodpovězené'
                          : 'Označit jako zodpovězenou'}
                      </Button>
                      <label className={styles.selection}>
                        <input
                          type="checkbox"
                          aria-label={`Vybrat ke sloučení: ${item.text}`}
                          checked={selected.includes(item.questionId)}
                          disabled={
                            mutating ||
                            (selected.length >= 2 &&
                              !selected.includes(item.questionId))
                          }
                          onChange={(event) =>
                            setSelected((previous) =>
                              event.target.checked
                                ? [...previous, item.questionId]
                                : previous.filter(
                                    (id) => id !== item.questionId,
                                  ),
                            )
                          }
                        />
                        Vybrat ke sloučení
                      </label>
                      <Button
                        variant="secondary"
                        className={styles.deleteAction}
                        leadingIcon={<DeleteQuestionIcon />}
                        disabled={mutating}
                        onClick={() => setPendingDelete(item.questionId)}
                      >
                        Smazat otázku
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <DestructiveConfirmation
        open={!blocked && Boolean(deleting)}
        title="Smazat otázku?"
        actionLabel="Potvrdit smazání"
        working={mutating}
        onCancel={() => {
          if (!mutating) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (deleting)
            void mutate({
              action: 'delete',
              questionId: deleting.questionId,
              expectedVersion: deleting.moderationVersion,
            });
        }}
      >
        {deleting ? (
          <div className={styles.deletePreview}>
            {actionError ? <p role="alert">{actionError}</p> : null}
            <p>
              Otázka zmizí z přehledů moderátorů, tazatelů i řečníků.{' '}
              {deleting.originals.length
                ? 'Smažou se také všechna sloučená znění.'
                : ''}
            </p>
            <blockquote>{deleting.text}</blockquote>
            {deleting.originals.map((original) => (
              <blockquote key={original.questionId}>{original.text}</blockquote>
            ))}
          </div>
        ) : null}
      </DestructiveConfirmation>
      {!embedded ? (
        <ActionLink
          className={styles.backLink}
          variant="secondary"
          href="/host/moderace"
        >
          Moje moderované přednášky
        </ActionLink>
      ) : null}
    </section>
  );
}
