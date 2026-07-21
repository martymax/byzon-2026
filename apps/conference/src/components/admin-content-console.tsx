'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

const resources = [
  'days',
  'venues',
  'rooms',
  'sessions',
  'speakers',
  'partners',
  'pages',
  'faqs',
] as const;
type Resource = (typeof resources)[number];
type Item = Record<string, unknown> & { id: string; version?: number };
export const localInputValue = (value: unknown, timezone: string) => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(String(value)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};
export const zonedLocalToIso = (value: string, timezone: string) => {
  const [date, time] = value.split('T');
  const [year, month, day] = date!.split('-').map(Number);
  const [hour, minute] = time!.split(':').map(Number);
  const wallClockUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(wallClockUtc))
    .find(({ type }) => type === 'timeZoneName')?.value;
  const match = offsetName?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match && offsetName !== 'GMT')
    throw new Error('Timezone offset is unavailable');
  const offset = match
    ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1)
    : 0;
  return new Date(wallClockUtc - offset * 60_000).toISOString();
};
const labels: Record<Resource, string> = {
  days: 'Dny',
  venues: 'Místa',
  rooms: 'Místnosti',
  sessions: 'Program',
  speakers: 'Řečníci',
  partners: 'Partneři',
  pages: 'Stránky',
  faqs: 'FAQ',
};

export const AdminContentConsole = ({
  eventId,
  timezone,
}: {
  eventId: string;
  timezone: string;
}) => {
  const [resource, setResource] = useState<Resource>('sessions');
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [references, setReferences] = useState<{
    days: Item[];
    venues: Item[];
    rooms: Item[];
    speakers: Item[];
  }>({ days: [], venues: [], rooms: [], speakers: [] });
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
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      (['days', 'venues', 'rooms', 'speakers'] as const).map(
        async (reference) => {
          const response = await fetch(
            `/api/v1/admin/events/${eventId}/content/${reference}`,
            { cache: 'no-store', signal: controller.signal },
          );
          if (!response.ok) throw new Error('request failed');
          return [
            reference,
            ((await response.json()) as { items: Item[] }).items,
          ] as const;
        },
      ),
    )
      .then((entries) =>
        setReferences(Object.fromEntries(entries) as typeof references),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    let body: Record<string, unknown> = {
      sortOrder: Number(value('sortOrder') || 0),
    };
    if (resource === 'days')
      body = { ...body, localDate: value('localDate'), title: value('title') };
    if (resource === 'venues')
      body = {
        ...body,
        slug: value('slug'),
        name: value('title'),
        mapQuery: value('body') || null,
        navigationMarkdown: value('navigationMarkdown') || null,
      };
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
        startsAt: zonedLocalToIso(value('startsAt'), timezone),
        endsAt: zonedLocalToIso(value('endsAt'), timezone),
        summary: value('body') || null,
        description: value('description') || null,
        status: value('status') || undefined,
        speakerIds: form.getAll('speakerIds').map(String),
      };
    if (resource === 'speakers') {
      const names = value('title').split(/\s+/);
      body = {
        ...body,
        slug: value('slug'),
        firstName: names.slice(0, -1).join(' '),
        lastName: names.at(-1),
        jobTitle: value('body') || null,
        company: value('company') || null,
        bioMarkdown: value('bioMarkdown') || null,
        linkedinUrl: value('linkedinUrl') || null,
        websiteUrl: value('websiteUrl') || null,
      };
    }
    if (resource === 'partners')
      body = {
        ...body,
        slug: value('slug'),
        name: value('title'),
        descriptionMarkdown: value('body') || null,
        websiteUrl: value('websiteUrl') || null,
        category: value('category') || null,
        tier: value('tier') || null,
      };
    if (resource === 'pages')
      body = {
        ...body,
        slug: value('slug'),
        kind: value('kind') || 'practical',
        title: value('title'),
        summary: value('summary') || null,
        bodyMarkdown: value('body'),
      };
    if (resource === 'faqs')
      body = {
        ...body,
        question: value('title'),
        category: value('category') || null,
        answerMarkdown: value('body'),
      };
    if (resource !== 'days' && value('status')) body.status = value('status');
    if (editing?.version) body.version = editing.version;
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/content/${resource}${editing ? `/${editing.id}` : ''}`,
      {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    setMessage(
      response.ok
        ? editing
          ? 'Položka byla upravena.'
          : 'Položka byla vytvořena.'
        : 'Položku se nepodařilo uložit.',
    );
    if (response.ok) {
      event.currentTarget.reset();
      setEditing(null);
      await load();
    }
  };
  const archive = async (item: Item) => {
    if (
      !window.confirm('Opravdu chcete tuto položku archivovat nebo odstranit?')
    )
      return;
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
      <form
        key={editing?.id ?? `new-${resource}`}
        onSubmit={submit}
        className="admin-form"
      >
        <h2>{editing ? 'Upravit položku' : 'Nová položka'}</h2>
        {resource === 'days' && (
          <label>
            Datum
            <input
              required
              name="localDate"
              type="date"
              defaultValue={String(editing?.localDate ?? '')}
            />
          </label>
        )}
        {[
          'venues',
          'rooms',
          'sessions',
          'speakers',
          'partners',
          'pages',
        ].includes(resource) && (
          <label>
            Slug
            <input
              required
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              defaultValue={String(editing?.slug ?? '')}
            />
          </label>
        )}
        {resource === 'rooms' && (
          <label>
            Místo
            <select
              required
              name="venueId"
              defaultValue={String(editing?.venueId ?? '')}
            >
              <option value="">Vyberte místo</option>
              {references.venues.map((item) => (
                <option key={item.id} value={item.id}>
                  {String(item.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        {resource === 'sessions' && (
          <>
            <label>
              Den
              <select
                required
                name="dayId"
                defaultValue={String(editing?.dayId ?? '')}
              >
                <option value="">Vyberte den</option>
                {references.days.map((item) => (
                  <option key={item.id} value={item.id}>
                    {String(item.title)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Místnost
              <select
                name="roomId"
                defaultValue={String(editing?.roomId ?? '')}
              >
                <option value="">Bez místnosti</option>
                {references.rooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {String(item.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Začátek (Europe/Prague)
              <input
                required
                name="startsAt"
                type="datetime-local"
                defaultValue={localInputValue(editing?.startsAt, timezone)}
              />
            </label>
            <label>
              Konec (Europe/Prague)
              <input
                required
                name="endsAt"
                type="datetime-local"
                defaultValue={localInputValue(editing?.endsAt, timezone)}
              />
            </label>
            <label>
              Typ
              <select
                name="type"
                defaultValue={String(editing?.type ?? 'talk')}
              >
                <option value="talk">Přednáška</option>
                <option value="panel">Panel</option>
                <option value="workshop">Workshop</option>
                <option value="other">Jiné</option>
              </select>
            </label>
            <label>
              Řečníci
              <select
                name="speakerIds"
                multiple
                defaultValue={
                  (editing?.speakerIds as string[] | undefined) ?? []
                }
              >
                {references.speakers.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >{`${String(item.firstName)} ${String(item.lastName)}`}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {resource === 'rooms' && (
          <label>
            Kapacita
            <input
              min="1"
              name="capacity"
              type="number"
              defaultValue={
                editing?.capacity == null ? '' : String(editing.capacity)
              }
            />
          </label>
        )}
        <label>
          {resource === 'faqs'
            ? 'Otázka'
            : resource === 'speakers'
              ? 'Celé jméno'
              : 'Název'}
          <input
            required
            name="title"
            defaultValue={String(
              editing?.title ??
                editing?.name ??
                editing?.question ??
                (resource === 'speakers'
                  ? `${String(editing?.firstName ?? '')} ${String(editing?.lastName ?? '')}`.trim()
                  : ''),
            )}
          />
        </label>
        {['venues', 'speakers', 'partners', 'pages', 'faqs'].includes(
          resource,
        ) && (
          <label>
            {resource === 'faqs' ? 'Odpověď' : 'Text'}
            <textarea
              name="body"
              required={resource === 'pages' || resource === 'faqs'}
              defaultValue={String(
                editing?.bodyMarkdown ??
                  editing?.answerMarkdown ??
                  editing?.descriptionMarkdown ??
                  editing?.jobTitle ??
                  editing?.mapQuery ??
                  editing?.summary ??
                  '',
              )}
            />
          </label>
        )}
        {resource === 'venues' && (
          <label>
            Navigační pokyny
            <textarea
              name="navigationMarkdown"
              defaultValue={String(editing?.navigationMarkdown ?? '')}
            />
          </label>
        )}
        {resource === 'sessions' && (
          <label>
            Detail
            <textarea
              name="description"
              defaultValue={String(editing?.description ?? '')}
            />
          </label>
        )}
        {resource === 'speakers' && (
          <>
            <label>
              Firma
              <input
                name="company"
                defaultValue={String(editing?.company ?? '')}
              />
            </label>
            <label>
              Bio
              <textarea
                name="bioMarkdown"
                defaultValue={String(editing?.bioMarkdown ?? '')}
              />
            </label>
            <label>
              LinkedIn URL
              <input
                name="linkedinUrl"
                type="url"
                defaultValue={String(editing?.linkedinUrl ?? '')}
              />
            </label>
            <label>
              Web URL
              <input
                name="websiteUrl"
                type="url"
                defaultValue={String(editing?.websiteUrl ?? '')}
              />
            </label>
          </>
        )}
        {resource === 'partners' && (
          <>
            <label>
              Web URL
              <input
                name="websiteUrl"
                type="url"
                defaultValue={String(editing?.websiteUrl ?? '')}
              />
            </label>
            <label>
              Kategorie
              <input
                name="category"
                defaultValue={String(editing?.category ?? '')}
              />
            </label>
            <label>
              Úroveň
              <input name="tier" defaultValue={String(editing?.tier ?? '')} />
            </label>
          </>
        )}
        {resource === 'pages' && (
          <>
            <label>
              Druh
              <select
                name="kind"
                defaultValue={String(editing?.kind ?? 'practical')}
              >
                <option value="practical">Praktické</option>
                <option value="marketing">Marketing</option>
                <option value="other">Jiné</option>
              </select>
            </label>
            <label>
              Shrnutí
              <input
                name="summary"
                defaultValue={String(editing?.summary ?? '')}
              />
            </label>
          </>
        )}
        {resource === 'faqs' && (
          <label>
            Kategorie
            <input
              name="category"
              defaultValue={String(editing?.category ?? '')}
            />
          </label>
        )}
        {resource !== 'days' && (
          <label>
            Stav
            <select
              name="status"
              defaultValue={String(editing?.status ?? 'draft')}
            >
              <option value="draft">Draft</option>
              <option value="published">Publikováno</option>
              {resource === 'sessions' && (
                <option value="cancelled">Zrušeno</option>
              )}
              <option value="archived">Archivováno</option>
            </select>
          </label>
        )}
        <label>
          Pořadí
          <input
            min="0"
            name="sortOrder"
            type="number"
            defaultValue={String(editing?.sortOrder ?? 0)}
          />
        </label>
        <button className="button" type="submit">
          {editing ? 'Uložit změny' : 'Vytvořit'}
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(null)}>
            Zrušit úpravy
          </button>
        )}
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
            <span className="admin-actions">
              <button type="button" onClick={() => setEditing(item)}>
                Upravit
              </button>
              <button type="button" onClick={() => void archive(item)}>
                Archivovat
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
