'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

const resources = [
  'days',
  'rooms',
  'sessions',
  'speakers',
  'partners',
  'pages',
  'faqs',
] as const;
type Resource = (typeof resources)[number];
type Item = Record<string, unknown> & { id: string; version?: number };
const labels: Record<Resource, string> = {
  days: 'Dny',
  rooms: 'Místnosti',
  sessions: 'Program',
  speakers: 'Řečníci',
  partners: 'Partneři',
  pages: 'Stránky',
  faqs: 'FAQ',
};

export const AdminContentConsole = ({ eventId }: { eventId: string }) => {
  const [resource, setResource] = useState<Resource>('sessions');
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/content/${resource}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      setMessage('Obsah se nepodařilo načíst.');
      return;
    }
    setItems((await response.json()).items as Item[]);
  }, [eventId, resource]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/admin/events/${eventId}/content/${resource}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('request failed');
        return (await response.json()) as { items: Item[] };
      })
      .then(({ items: loadedItems }) => setItems(loadedItems))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setMessage('Obsah se nepodařilo načíst.');
      });
    return () => controller.abort();
  }, [eventId, resource]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    let body: Record<string, unknown> = {
      sortOrder: Number(value('sortOrder') || 0),
    };
    if (resource === 'days')
      body = { ...body, localDate: value('localDate'), title: value('title') };
    if (resource === 'rooms')
      body = {
        ...body,
        venueId: value('venueId'),
        slug: value('slug'),
        name: value('title'),
        capacity: value('capacity') ? Number(value('capacity')) : null,
      };
    if (resource === 'sessions')
      body = {
        ...body,
        dayId: value('dayId'),
        roomId: value('roomId') || null,
        slug: value('slug'),
        title: value('title'),
        type: value('type') || 'other',
        startsAt: value('startsAt'),
        endsAt: value('endsAt'),
      };
    if (resource === 'speakers') {
      const names = value('title').split(/\s+/);
      body = {
        ...body,
        slug: value('slug'),
        firstName: names.slice(0, -1).join(' '),
        lastName: names.at(-1),
        jobTitle: value('body') || null,
      };
    }
    if (resource === 'partners')
      body = {
        ...body,
        slug: value('slug'),
        name: value('title'),
        descriptionMarkdown: value('body') || null,
      };
    if (resource === 'pages')
      body = {
        ...body,
        slug: value('slug'),
        kind: 'practical',
        title: value('title'),
        bodyMarkdown: value('body'),
      };
    if (resource === 'faqs')
      body = {
        ...body,
        question: value('title'),
        answerMarkdown: value('body'),
      };
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/content/${resource}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    setMessage(
      response.ok ? 'Položka byla vytvořena.' : 'Položku se nepodařilo uložit.',
    );
    if (response.ok) {
      event.currentTarget.reset();
      await load();
    }
  };
  const archive = async (item: Item) => {
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/content/${resource}/${item.id}`,
      {
        method: 'DELETE',
        headers: item.version ? { 'if-match': `"${item.version}"` } : {},
      },
    );
    setMessage(
      response.ok
        ? 'Položka byla archivována.'
        : 'Položku se nepodařilo archivovat.',
    );
    if (response.ok) await load();
  };
  return (
    <div className="admin-console">
      <label>
        Oblast
        <select
          value={resource}
          onChange={(event) => setResource(event.target.value as Resource)}
        >
          {resources.map((item) => (
            <option key={item} value={item}>
              {labels[item]}
            </option>
          ))}
        </select>
      </label>
      <form onSubmit={submit} className="admin-form">
        <h2>Nová položka</h2>
        {resource === 'days' && (
          <label>
            Datum
            <input required name="localDate" type="date" />
          </label>
        )}
        {['rooms', 'sessions', 'speakers', 'partners', 'pages'].includes(
          resource,
        ) && (
          <label>
            Slug
            <input required name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
          </label>
        )}
        {resource === 'rooms' && (
          <label>
            ID místa
            <input required name="venueId" />
          </label>
        )}
        {resource === 'sessions' && (
          <>
            <label>
              ID dne
              <input required name="dayId" />
            </label>
            <label>
              ID místnosti
              <input name="roomId" />
            </label>
            <label>
              Začátek
              <input required name="startsAt" type="datetime-local" />
            </label>
            <label>
              Konec
              <input required name="endsAt" type="datetime-local" />
            </label>
            <label>
              Typ
              <select name="type">
                <option value="talk">Přednáška</option>
                <option value="panel">Panel</option>
                <option value="workshop">Workshop</option>
                <option value="other">Jiné</option>
              </select>
            </label>
          </>
        )}
        {resource === 'rooms' && (
          <label>
            Kapacita
            <input min="1" name="capacity" type="number" />
          </label>
        )}
        <label>
          {resource === 'faqs'
            ? 'Otázka'
            : resource === 'speakers'
              ? 'Celé jméno'
              : 'Název'}
          <input required name="title" />
        </label>
        {['speakers', 'partners', 'pages', 'faqs'].includes(resource) && (
          <label>
            {resource === 'faqs' ? 'Odpověď' : 'Text'}
            <textarea
              name="body"
              required={resource === 'pages' || resource === 'faqs'}
            />
          </label>
        )}
        <label>
          Pořadí
          <input min="0" name="sortOrder" type="number" defaultValue="0" />
        </label>
        <button className="button" type="submit">
          Vytvořit
        </button>
      </form>
      <p aria-live="polite">{message}</p>
      <ul className="admin-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>
                {String(
                  item.title ??
                    item.name ??
                    item.question ??
                    item.localDate ??
                    item.id,
                )}
              </strong>
              <small>{String(item.status ?? '')}</small>
            </span>
            <button type="button" onClick={() => void archive(item)}>
              Archivovat
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
