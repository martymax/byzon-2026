'use client';

import { Button, Card } from '@byzon/ui';
import { FormEvent, useEffect, useState } from 'react';

import { requestRatingStatus, submitRating } from '@/lib/b-interactions-api';

export { QuestionForm } from './participant-questions';

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
