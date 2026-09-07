'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@byzon/ui';
import {
  programAccessMutationResponseSchema,
  programAccessOptionsSchema,
  programAccessPreviewSchema,
  programAccessSearchResponseSchema,
  type ProgramAccessOptions,
  type ProgramAccessPerson,
  type ProgramAccessPreview,
  type ProgramAccessSelection,
} from '@byzon/domain/contracts';
import { PrivateApiError, requestPrivateJson } from '@/lib/private-json';
import { useAdminWorkspace } from './admin-workspace-shell';
import styles from './admin-workspace.module.css';
import accessStyles from './program-access.module.css';
const sessionTime = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Prague',
});
const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
const roleNames = {
  speaker: 'Řečník',
  room_operator: 'Vedoucí aktivity',
  moderator: 'Moderátor',
};
export function AdminProgramAccess() {
  const { eventId, securityEpoch, invalidateSensitive } = useAdminWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.panel}>
      <h2>Programoví spolupracovníci</h2>
      <p>
        Kouči, vedoucí aktivit, řečníci a moderátoři používají běžný účastnický
        účet. Zde jim nastavíte nástroje pro jejich program.
      </p>
      <Button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? 'Zavřít nastavení' : 'Nastavit programového spolupracovníka'}
      </Button>
      {open ? (
        <ProgramAccessForm
          key={`${eventId}:${securityEpoch}`}
          eventId={eventId}
          invalidate={invalidateSensitive}
        />
      ) : null}
    </section>
  );
}
export function ProgramAccessForm({
  eventId,
  invalidate,
}: {
  eventId: string;
  invalidate: (message?: string) => void;
}) {
  const [options, setOptions] = useState<ProgramAccessOptions | null>(null);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ProgramAccessPerson[]>([]);
  const [person, setPerson] = useState<ProgramAccessPerson | null>(null);
  const [preset, setPreset] =
    useState<ProgramAccessSelection['preset']>('speaker');
  const [speakerId, setSpeakerId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [sessionQuery, setSessionQuery] = useState('');
  const visibleSessions =
    options?.sessions.filter((session) =>
      normalizeSearch(`${session.title} ${session.roomName ?? ''}`).includes(
        normalizeSearch(sessionQuery.trim()),
      ),
    ) ?? [];
  const [operation, setOperation] = useState<'apply' | 'revoke'>('apply');
  const [review, setReview] = useState<ProgramAccessPreview | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const pending = useRef<{ body: unknown; key: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const base = `/api/v1/admin/events/${eventId}/program-access`;
  const failure = (error: unknown) => {
    if (error instanceof PrivateApiError && [401, 403].includes(error.status)) {
      setPeople([]);
      setPerson(null);
      setReview(null);
      setOptions(null);
      pending.current = null;
      invalidate('Přístup se změnil. Načtěte administraci znovu.');
    } else if (!(error instanceof DOMException && error.name === 'AbortError'))
      setError(
        error instanceof Error
          ? error.message
          : 'Změnu se nepodařilo dokončit. Zkuste ji znovu.',
      );
  };
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void requestPrivateJson(`${base}/options`, programAccessOptionsSchema, {
      signal: abort.signal,
    }).then(setOptions, failure);
    return () => abort.abort();
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => {
    setReview(null);
    pending.current = null;
    setError('');
    setSuccess('');
  };
  const selection = (): ProgramAccessSelection =>
    preset === 'coach'
      ? { preset, roomId }
      : preset === 'moderator'
        ? { preset, sessionIds }
        : { preset, speakerProfileId: speakerId };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${styles.stack} ${accessStyles.form}`} aria-busy={busy}>
      <form
        className={accessStyles.search}
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            reset();
            setPerson(null);
            const result = await requestPrivateJson(
              `${base}/search`,
              programAccessSearchResponseSchema,
              { body: { query }, signal: controller.current?.signal },
            );
            setPeople(result.items);
          });
        }}
      >
        <label className={styles.field}>
          <span>1. Vyhledat existujícího účastníka</span>
          <input
            value={query}
            minLength={2}
            required
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jméno nebo e-mail"
          />
        </label>
        <Button type="submit" disabled={busy}>
          Vyhledat
        </Button>
      </form>
      <p>
        Chybějícího člověka{' '}
        <a className={styles.participantBackLink} href="/admin/ucastnici">
          přidejte v účastnících
        </a>{' '}
        nebo importujte ze SimpleShopu. Tady účet nevzniká.
      </p>
      {people.length ? (
        <ul className={accessStyles.people}>
          {people.map((item) => (
            <li key={item.participantId}>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  reset();
                  setPerson(item);
                }}
              >
                {item.displayName} · {item.maskedEmail}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {person ? (
        <>
          <div className={accessStyles.person}>
            <span className={accessStyles.avatar} aria-hidden="true">
              {person.displayName
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')}
            </span>
            <div>
              <strong>{person.displayName}</strong>
              <p>
                {person.source === 'manual' ? 'Ručně přidaný' : 'SimpleShop'} ·{' '}
                {person.membershipStatus === 'active'
                  ? 'Aktivní účast'
                  : 'Neaktivní účast'}{' '}
                ·{' '}
                {person.invitationStatus === 'not_sent'
                  ? 'Pozvánka neodeslána'
                  : person.invitationStatus === 'sent'
                    ? 'Pozvánka odeslána'
                    : 'Přihlášení ověřeno'}
              </p>
            </div>
          </div>
          {!person.baselineReady ? (
            <p role="alert">
              Účet nemá připravený participant přístup. Opravte jej ve správě
              účastníků.
            </p>
          ) : null}
          <form
            className={accessStyles.assignment}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                pending.current = null;
                setReview(
                  await requestPrivateJson(
                    `${base}/preview`,
                    programAccessPreviewSchema,
                    {
                      body: {
                        participantId: person.participantId,
                        selection: selection(),
                        operation,
                      },
                      signal: controller.current?.signal,
                    },
                  ),
                );
              });
            }}
          >
            <label className={styles.field}>
              <span>2. Spolupráce</span>
              <select
                value={preset}
                onChange={(event) => {
                  reset();
                  setPreset(
                    event.target.value as ProgramAccessSelection['preset'],
                  );
                }}
              >
                <option value="speaker">Řečník přednášky</option>
                <option value="activity_leader">
                  Vedoucí mastermindu, workshopu nebo networkingu
                </option>
                <option value="coach">Kouč</option>
                <option value="moderator">Moderátor</option>
              </select>
            </label>
            {preset === 'coach' ? (
              <label className={styles.field}>
                <span>Koučovací místnost</span>
                <select
                  value={roomId}
                  required
                  onChange={(event) => {
                    reset();
                    setRoomId(event.target.value);
                  }}
                >
                  <option value="">Vyberte místnost</option>
                  {options?.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : preset === 'moderator' ? (
              <fieldset className={accessStyles.sessions}>
                <legend>Přiřazené přednášky</legend>
                <div className={accessStyles.toolbar}>
                  <label className={styles.field}>
                    <span>Vyhledat přednášku</span>
                    <input
                      type="search"
                      placeholder="Název nebo stage"
                      value={sessionQuery}
                      onChange={(event) => setSessionQuery(event.target.value)}
                    />
                  </label>
                  <span className={accessStyles.count} role="status">
                    Vybráno {sessionIds.length} z{' '}
                    {options?.sessions.length ?? 0}
                  </span>
                </div>
                <div className={accessStyles.sessionList}>
                  {visibleSessions.map((session) => (
                    <label
                      className={accessStyles.sessionChoice}
                      data-selected={sessionIds.includes(session.id)}
                      key={session.id}
                    >
                      <input
                        type="checkbox"
                        aria-label={session.title}
                        disabled={busy}
                        checked={sessionIds.includes(session.id)}
                        onChange={(event) => {
                          reset();
                          setSessionIds((ids) =>
                            event.target.checked
                              ? [...ids, session.id]
                              : ids.filter((id) => id !== session.id),
                          );
                        }}
                      />
                      <span className={accessStyles.sessionText}>
                        <span className={accessStyles.sessionTitle}>
                          {session.title}
                        </span>
                        <span className={accessStyles.sessionDetails}>
                          <span>
                            {sessionTime.format(new Date(session.startsAt))}–
                            {new Intl.DateTimeFormat('cs-CZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Europe/Prague',
                            }).format(new Date(session.endsAt))}
                          </span>
                          <span>{session.roomName ?? 'Stage neurčena'}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                  {!visibleSessions.length ? (
                    <p className={accessStyles.empty}>
                      {options
                        ? 'Žádná přednáška neodpovídá hledání.'
                        : 'Načítám přednášky…'}
                    </p>
                  ) : null}
                </div>
              </fieldset>
            ) : (
              <label className={styles.field}>
                <span>Profil řečníka v programu</span>
                <select
                  value={speakerId}
                  required
                  onChange={(event) => {
                    reset();
                    setSpeakerId(event.target.value);
                  }}
                >
                  <option value="">Vyberte profil</option>
                  {options?.speakers.map((speaker) => (
                    <option
                      key={speaker.id}
                      value={speaker.id}
                      disabled={Boolean(
                        speaker.linkedUserId &&
                        speaker.linkedUserId !== person.participantId,
                      )}
                    >
                      {speaker.name}
                      {speaker.linkedUserId &&
                      speaker.linkedUserId !== person.participantId
                        ? ' — jiný účet'
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field}>
              <span>Operace</span>
              <select
                value={operation}
                onChange={(event) => {
                  reset();
                  setOperation(event.target.value as 'apply' | 'revoke');
                }}
              >
                <option value="apply">Přidat přístup</option>
                <option value="revoke">Odebrat vybraný přístup</option>
              </select>
            </label>
            <Button
              disabled={busy || !person.baselineReady || !options}
              type="submit"
            >
              Zobrazit náhled oprávnění
            </Button>
          </form>
        </>
      ) : null}
      {review ? (
        <section className={styles.panel}>
          <h3>3. Zkontrolujte a potvrďte</h3>
          <p>{review.participant.displayName}</p>
          <ul>
            {review.roles.map((role) => (
              <li key={role.role}>
                {roleNames[role.role]}:{' '}
                {role.revoke
                  ? 'odebrat roli'
                  : `ponechat / nastavit rozsah (${role.sessionIds.length} session, ${role.roomIds.length} místností)`}
              </li>
            ))}
          </ul>
          <ul>
            {review.sessions.map((session) => (
              <li key={session.id}>
                {session.title} · {session.roomName} ·{' '}
                {new Date(session.startsAt).toLocaleString('cs-CZ', {
                  timeZone: 'Europe/Prague',
                })}
              </li>
            ))}
          </ul>
          <p>
            Účastnický přístup zůstává zachovaný. Pozvánku odešlete samostatně
            ve{' '}
            <a className={styles.participantBackLink} href="/admin/ucastnici">
              správě účastníků
            </a>
            .
          </p>
          <label className={styles.field}>
            <span>Důvod změny</span>
            <input
              minLength={8}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                pending.current = null;
                setReason(event.target.value);
              }}
            />
          </label>
          <Button
            disabled={busy || reason.trim().length < 8}
            onClick={() =>
              void run(async () => {
                if (!person) return;
                pending.current ??= {
                  body: {
                    participantId: person.participantId,
                    selection: selection(),
                    operation,
                    expectedVersion: review.assignmentsVersion,
                    previewHash: review.previewHash,
                    reason,
                  },
                  key: crypto.randomUUID(),
                };
                await requestPrivateJson(
                  `${base}/apply`,
                  programAccessMutationResponseSchema,
                  {
                    body: pending.current.body,
                    key: pending.current.key,
                    signal: controller.current?.signal,
                  },
                );
                pending.current = null;
                setReview(null);
                setSuccess(
                  operation === 'apply'
                    ? 'Přístup byl nastaven. Pozvánka se automaticky neodesílá.'
                    : 'Vybraný přístup byl odebrán. Účast zůstává aktivní.',
                );
              })
            }
          >
            {busy
              ? 'Ukládám…'
              : operation === 'apply'
                ? 'Potvrdit nastavení přístupu'
                : 'Potvrdit odebrání přístupu'}
          </Button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
    </div>
  );
}
