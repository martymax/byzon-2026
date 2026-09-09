'use client';

import { Button, Card } from '@byzon/ui';
import { FormEvent, useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api/endpoint';

import { requestRatingStatus, submitRating } from '@/lib/b-interactions-api';

export { QuestionForm } from './participant-questions';

const RatingForm = ({
  sessionId,
  targetType,
  endsAt,
  explicit = false,
  api,
}: {
  sessionId?: string;
  targetType: 'event' | 'session';
  endsAt: string;
  explicit?: boolean;
  api?: ApiPort;
}) => {
  const [status, setStatus] = useState<
    'waiting' | 'loading' | 'ready' | 'completed' | 'error'
  >(() => (Date.parse(endsAt) > Date.now() ? 'waiting' : 'loading'));
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const remaining = Date.parse(endsAt) - Date.now();
      if (remaining > 0) {
        timer = setTimeout(load, Math.min(remaining + 100, 60_000));
        return;
      }
      void requestRatingStatus(targetType, sessionId, api).then((result) => {
        if (!active) return;
        if (result.ok && result.kind === 'success') {
          setStatus(result.data.completed ? 'completed' : 'ready');
        } else {
          setStatus('error');
        }
      });
    };
    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [endsAt, sessionId, targetType, retry, api]);
  if (status !== 'ready') {
    if (!explicit) return null;
    return (
      <Card>
        <h2>
          {targetType === 'event'
            ? 'Hodnocení konference'
            : 'Hodnocení přednášky'}
        </h2>
        <p role="status">
          {status === 'waiting'
            ? `Hodnocení se otevře po skončení ${targetType === 'event' ? 'konference' : 'přednášky'}. Tuto stránku můžete nechat otevřenou.`
            : status === 'completed'
              ? 'Děkujeme, vaše hodnocení už je uložené.'
              : status === 'error'
                ? 'Hodnocení nyní není dostupné. Ověřte připojení a zkuste to znovu.'
                : 'Načítám hodnocení…'}
        </p>
        {status === 'error' ? (
          <Button
            onClick={() => {
              setStatus('loading');
              setRetry((value) => value + 1);
            }}
          >
            Zkusit znovu
          </Button>
        ) : null}
      </Card>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setWorking(true);
    setMessage('');
    const data = new FormData(event.currentTarget);
    void submitRating(
      {
        ...(targetType === 'event'
          ? { targetType: 'event' as const }
          : { targetType: 'session' as const, sessionId: sessionId! }),
        score: Number(data.get('score')),
        comment: String(data.get('comment') ?? '').trim() || null,
      },
      globalThis.crypto.randomUUID(),
      api,
    ).then((result) => {
      locked.current = false;
      setWorking(false);
      if (
        (result.ok && result.kind === 'success') ||
        (!result.ok &&
          'problem' in result.failure &&
          result.failure.problem?.code === 'RATING_ALREADY_COMPLETED')
      )
        setStatus('completed');
      else setMessage('Hodnocení se nepodařilo uložit. Zkuste to znovu.');
    });
  };
  return (
    <Card>
      <h2>
        {targetType === 'event'
          ? 'Ohodnotit konferenci'
          : 'Ohodnotit přednášku'}
      </h2>
      <form onSubmit={submit}>
        <label>
          Hodnocení
          <select defaultValue="5" name="score" disabled={working}>
            <option value="5">5 – výborné</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1 – slabé</option>
          </select>
        </label>
        <label>
          Volitelný komentář
          <textarea maxLength={2000} name="comment" disabled={working} />
        </label>
        <Button type="submit" disabled={working}>
          {working ? 'Odesílám…' : 'Odeslat hodnocení'}
        </Button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </Card>
  );
};

export const SessionRating = (props: {
  sessionId: string;
  endsAt: string;
  explicit?: boolean;
  api?: ApiPort;
}) => <RatingForm {...props} targetType="session" />;
export const EventRating = (props: { endsAt: string; api?: ApiPort }) => (
  <RatingForm {...props} targetType="event" explicit />
);
