'use client';

import type { ModeratorQuestionFeed } from '@byzon/domain/contracts';
import { Button, Card } from '@byzon/ui';
import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';

import {
  requestModeratorQuestions,
  requestRatingStatus,
  sendQuestion,
  submitRating,
} from '@/lib/b-interactions-api';

export const QuestionForm = ({ sessionId }: { sessionId: string }) => {
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    const form = event.currentTarget;
    const text = String(new FormData(form).get('text') ?? '').trim();
    setWorking(true);
    setError('');
    void sendQuestion(sessionId, { text }, globalThis.crypto.randomUUID()).then(
      (result) => {
        setWorking(false);
        if (result.ok && result.kind === 'success') {
          form.reset();
          setSent(true);
        } else if (!result.ok && result.failure.kind === 'offline') {
          setError(
            'Dotazy se neukládají offline. Zkuste to po obnovení připojení.',
          );
        } else {
          setError(
            'Dotaz se nepodařilo odeslat. Ověřte text a zkuste to znovu.',
          );
        }
      },
    );
  };
  return (
    <Card>
      <p className="eyebrow">Živá interakce</p>
      <h1 data-route-heading tabIndex={-1}>
        Položit dotaz
      </h1>
      <p>
        Dotaz uvidí pouze moderátor této session. Ostatní účastníci jej neuvidí.
      </p>
      <form onSubmit={submit}>
        <label>
          Váš dotaz
          <textarea maxLength={1000} minLength={1} name="text" required />
        </label>
        <Button disabled={working} type="submit">
          {working ? 'Odesílám…' : 'Odeslat dotaz'}
        </Button>
      </form>
      {sent ? <p role="status">Dotaz byl odeslán moderátorovi.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Link className="text-link" href={`/app/program/${sessionId}`}>
        ← Zpět na detail programu
      </Link>
    </Card>
  );
};

export const ModeratorQuestionList = ({ sessionId }: { sessionId: string }) => {
  const [feed, setFeed] = useState<ModeratorQuestionFeed | null>(null);
  const [error, setError] = useState('');
  const latest = useRef<ModeratorQuestionFeed | null>(null);
  const failures = useRef(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (canonical = false) => {
      const parameters = new URLSearchParams();
      const last = canonical ? undefined : latest.current?.items.at(-1);
      if (last) {
        parameters.set('after', last.submittedAt);
        parameters.set('cursor', last.questionId);
      }
      void requestModeratorQuestions(sessionId, parameters.toString()).then(
        (result) => {
          if (!active) return;
          if (result.ok && result.kind === 'success') {
            failures.current = 0;
            setError('');
            const next =
              canonical || !latest.current
                ? result.data
                : {
                    ...result.data,
                    items: [...latest.current.items, ...result.data.items],
                  };
            latest.current = next;
            setFeed(next);
            timer = setTimeout(() => load(false), result.data.pollAfterMs);
          } else {
            failures.current += 1;
            setError(
              'Spojení s feedem bylo přerušeno. Obnovuji canonical seznam…',
            );
            timer = setTimeout(
              () => load(true),
              Math.min(30_000, 5_000 * 2 ** failures.current),
            );
          }
        },
      );
    };
    const reconnect = () => load(true);
    window.addEventListener('online', reconnect);
    load(true);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', reconnect);
    };
  }, [sessionId]);
  return (
    <section className="app-page">
      <header>
        <p className="eyebrow">Moderátor · pouze pro čtení</p>
        <h1 data-route-heading tabIndex={-1}>
          Dotazy účastníků
        </h1>
        <p>
          Seznam je chronologický. Nelze jej skrývat, řadit ani označovat jako
          vyřízený.
        </p>
      </header>
      {error ? <p role="status">{error}</p> : null}
      {!feed ? (
        <p role="status">Načítám dotazy…</p>
      ) : feed.items.length === 0 ? (
        <Card>
          <p>Zatím nebyl odeslán žádný dotaz.</p>
        </Card>
      ) : (
        <ol>
          {feed.items.map((question) => (
            <li key={question.questionId}>
              <Card>
                <time dateTime={question.submittedAt}>
                  {new Intl.DateTimeFormat('cs-CZ', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(question.submittedAt))}
                </time>
                <p>{question.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export const SessionRating = ({
  sessionId,
  endsAt,
}: {
  sessionId: string;
  endsAt: string;
}) => {
  const [available, setAvailable] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (Date.parse(endsAt) > Date.now()) return;
    void requestRatingStatus('session', sessionId).then((result) => {
      if (result.ok && result.kind === 'success') {
        setAvailable(true);
        setCompleted(result.data.completed);
      }
    });
  }, [endsAt, sessionId]);
  if (!available || completed) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submitRating(
      {
        targetType: 'session',
        sessionId,
        score: Number(data.get('score')),
        comment: String(data.get('comment') ?? '').trim() || null,
      },
      globalThis.crypto.randomUUID(),
    ).then((result) => {
      if (result.ok) setCompleted(true);
      else setMessage('Hodnocení se nepodařilo uložit.');
    });
  };
  return (
    <Card>
      <h2>Ohodnotit session</h2>
      <form onSubmit={submit}>
        <label>
          Hodnocení
          <select defaultValue="5" name="score">
            <option value="5">5 – výborné</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1 – slabé</option>
          </select>
        </label>
        <label>
          Volitelný komentář
          <textarea maxLength={2000} name="comment" />
        </label>
        <Button type="submit">Odeslat hodnocení</Button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </Card>
  );
};
