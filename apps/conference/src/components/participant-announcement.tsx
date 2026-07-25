'use client';

import type {
  ApiFailure,
  ParticipantAnnouncementDetailResponse,
  ParticipantAnnouncementReadProblem,
  RequestId,
} from '@byzon/domain/contracts';
import { ActionLink, Button } from '@byzon/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserAnnouncementApi,
  markAnnouncementRead,
} from '@/lib/announcement-api';
import { clearAnnouncementReturnContext } from '@/lib/announcement-return-context';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import {
  AnnouncementReadLabel,
  AnnouncementResourceStatus,
  AnnouncementSeverity,
  formatAnnouncementDate,
  useParticipantAnnouncementDetail,
} from './announcement-state';

type ReadReceiptFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'authentication' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'permission' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

type ReadReceiptState =
  | { readonly status: 'idle' }
  | { readonly status: 'marking' }
  | {
      readonly status: 'read';
      readonly readAt: string;
      readonly confirmedNow: boolean;
    }
  | { readonly status: 'failure'; readonly failure: ReadReceiptFailure };

type AnnouncementRevocationStatus =
  'authentication' | 'disabled' | 'permission' | 'session_expired';

const createRuntimeIdempotencyKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `announcement-read:${suffix}`;
};

const mapReadFailure = (
  failure: ApiFailure<ParticipantAnnouncementReadProblem>,
): ReadReceiptFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      if (failure.problem.code === 'AUTHENTICATION_REQUIRED') {
        return { kind: 'authentication' };
      }
      if (failure.problem.code === 'AUTH_SESSION_EXPIRED') {
        return { kind: 'session_expired' };
      }
      if (
        failure.problem.code === 'EVENT_ACCESS_DENIED' ||
        failure.problem.code === 'ANNOUNCEMENT_NOT_FOUND'
      ) {
        return { kind: 'permission' };
      }
      if (failure.problem.code === 'ANNOUNCEMENTS_DISABLED') {
        return { kind: 'disabled' };
      }
      if (failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS') {
        return { kind: 'in_progress' };
      }
      if (
        failure.problem.code === 'IDEMPOTENCY_KEY_REUSED' ||
        failure.problem.code === 'VALIDATION_FAILED'
      ) {
        return { kind: 'rejected' };
      }
      return { kind: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        kind: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { kind: 'error' };
  }
};

const readReturnHref = (): string => {
  if (typeof window === 'undefined') return '/app/oznameni';
  const current = new URLSearchParams(window.location.search);
  const target = new URLSearchParams();
  if (current.get('returnView') === 'unread') {
    target.set('view', 'unread');
  }
  const rawPageCount = current.get('returnPages');
  if (rawPageCount && /^[1-9][0-9]?$/.test(rawPageCount)) {
    const pageCount = Number(rawPageCount);
    if (pageCount <= 20) target.set('restorePages', String(pageCount));
  }
  const search = target.toString();
  return search ? `/app/oznameni?${search}` : '/app/oznameni';
};

const ReadReceipt = ({
  announcementId,
  api,
  createIdempotencyKey,
  eventId,
  initialReadAt,
  onRead,
  onRevoked,
}: {
  readonly announcementId: string;
  readonly api: ApiPort;
  readonly createIdempotencyKey: () => string;
  readonly eventId: string;
  readonly initialReadAt: string | null;
  readonly onRead: (readAt: string) => void;
  readonly onRevoked: (status: AnnouncementRevocationStatus) => void;
}) => {
  const [state, setState] = useState<ReadReceiptState>(
    initialReadAt
      ? { status: 'read', readAt: initialReadAt, confirmedNow: false }
      : { status: 'idle' },
  );
  const mounted = useRef(true);
  const activeRequest = useRef<symbol | undefined>(undefined);
  const failureAlert = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(initialReadAt !== null);
  const attempt = useRef<
    | {
        readonly announcementId: string;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const saveReadState = useCallback(
    async (signal?: AbortSignal) => {
      if (activeRequest.current) return;
      const requestToken = Symbol('announcement-read-request');
      activeRequest.current = requestToken;
      setState({ status: 'marking' });
      attempt.current =
        attempt.current?.announcementId === announcementId
          ? attempt.current
          : {
              announcementId,
              idempotencyKey: createIdempotencyKey(),
            };

      try {
        const result = await markAnnouncementRead(
          api,
          announcementId,
          attempt.current.idempotencyKey,
          signal,
        );
        if (!mounted.current || signal?.aborted) return;
        if (result.ok && result.kind === 'success') {
          if (
            result.data.eventId !== eventId ||
            result.data.announcementId !== announcementId ||
            result.data.state !== 'read'
          ) {
            setState({
              status: 'failure',
              failure: {
                kind: 'error',
                requestId: result.metadata.requestId,
              },
            });
            requestAnimationFrame(() => failureAlert.current?.focus());
            return;
          }
          attempt.current = undefined;
          onRead(result.data.readAt);
          setState({
            status: 'read',
            readAt: result.data.readAt,
            confirmedNow: true,
          });
          return;
        }
        if (!result.ok) {
          if (!shouldRetainMutationKey(result.failure)) {
            attempt.current = undefined;
          }
          const failure = mapReadFailure(result.failure);
          if (failure) {
            if (
              failure.kind === 'authentication' ||
              failure.kind === 'disabled' ||
              failure.kind === 'permission' ||
              failure.kind === 'session_expired'
            ) {
              onRevoked(failure.kind);
              return;
            }
            setState({ status: 'failure', failure });
            requestAnimationFrame(() => failureAlert.current?.focus());
          }
          return;
        }
        setState({ status: 'failure', failure: { kind: 'error' } });
        requestAnimationFrame(() => failureAlert.current?.focus());
      } catch {
        if (mounted.current && !signal?.aborted) {
          setState({ status: 'failure', failure: { kind: 'error' } });
          requestAnimationFrame(() => failureAlert.current?.focus());
        }
      } finally {
        if (activeRequest.current === requestToken) {
          activeRequest.current = undefined;
        }
      }
    },
    [announcementId, api, createIdempotencyKey, eventId, onRead, onRevoked],
  );

  useEffect(() => {
    if (initialReadAt || autoStarted.current) return;
    autoStarted.current = true;
    const controller = new AbortController();
    void saveReadState(controller.signal);
    return () => {
      controller.abort();
      activeRequest.current = undefined;
      autoStarted.current = false;
    };
  }, [initialReadAt, saveReadState]);

  if (state.status === 'read') {
    return (
      <div
        className="announcement-read-status"
        role="status"
        aria-live="polite"
      >
        <AnnouncementReadLabel unread={false} />
        <p>
          {state.confirmedNow
            ? 'Oznámení bylo označené jako přečtené až po bezpečném zobrazení.'
            : 'Toto oznámení už bylo označené jako přečtené.'}
        </p>
      </div>
    );
  }

  if (state.status === 'marking' || state.status === 'idle') {
    return (
      <div
        className="announcement-read-status"
        role="status"
        aria-live="polite"
      >
        <strong>Ukládám přečtení…</strong>
        <p>Požadavek je online a neukládá se do offline fronty.</p>
      </div>
    );
  }

  const { failure } = state;
  const retryable =
    failure.kind === 'offline' ||
    failure.kind === 'error' ||
    failure.kind === 'in_progress';
  const loginHref = `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
    `/app/oznameni/${announcementId}`,
  )}`;
  const copy =
    failure.kind === 'offline'
      ? {
          title: 'Přečtení zatím není uložené',
          detail:
            'Jste offline. Nic jsme nezařadili do fronty; po připojení zopakujte stejný požadavek.',
        }
      : failure.kind === 'authentication' || failure.kind === 'session_expired'
        ? {
            title: 'Přihlášení vypršelo',
            detail:
              'Pro pokračování je potřeba znovu bezpečně ověřit přihlášení.',
          }
        : failure.kind === 'in_progress'
          ? {
              title: 'Přečtení se ještě ověřuje',
              detail:
                'Chvíli počkejte a potom bezpečně zopakujte stejný požadavek.',
            }
          : failure.kind === 'disabled'
            ? {
                title: 'Ukládání přečtení není dostupné',
                detail:
                  'Oznámení byla pro tuto akci vypnutá. Obsah nepřenášíme do žádné místní cache.',
              }
            : failure.kind === 'permission'
              ? {
                  title: 'Stav přečtení nelze uložit',
                  detail:
                    'Oznámení už není dostupné pro tento účet. Další podrobnosti nezobrazujeme.',
                }
              : failure.kind === 'rejected'
                ? {
                    title: 'Požadavek nelze bezpečně zopakovat',
                    detail:
                      'Server požadavek odmítl jednoznačně. Načtěte seznam oznámení znovu.',
                  }
                : {
                    title: 'Přečtení se nepodařilo potvrdit',
                    detail:
                      'Výsledek může být neurčitý. Opakování použije stejnou referenci požadavku.',
                  };

  return (
    <div
      className="announcement-read-status announcement-read-status--error"
      ref={failureAlert}
      role="alert"
      tabIndex={-1}
    >
      <strong>{copy.title}</strong>
      <p>{copy.detail}</p>
      {failure.kind === 'error' && failure.requestId ? (
        <p className="request-reference">
          Reference požadavku: <code>{failure.requestId}</code>
        </p>
      ) : null}
      {retryable ? (
        <Button onClick={() => void saveReadState()}>Zkusit znovu</Button>
      ) : failure.kind === 'authentication' ||
        failure.kind === 'session_expired' ? (
        <ActionLink href={loginHref}>Přihlásit se znovu</ActionLink>
      ) : (
        <ActionLink href="/app/oznameni" variant="secondary">
          Načíst oznámení znovu
        </ActionLink>
      )}
    </div>
  );
};

const AnnouncementDetail = ({
  api,
  createIdempotencyKey,
  data,
  onRevoked,
}: {
  readonly api: ApiPort;
  readonly createIdempotencyKey: () => string;
  readonly data: ParticipantAnnouncementDetailResponse;
  readonly onRevoked: (status: AnnouncementRevocationStatus) => void;
}) => {
  const { announcement } = data;
  const [returnHref] = useState(readReturnHref);
  const [effectiveReadAt, setEffectiveReadAt] = useState(announcement.readAt);
  const contextHref =
    announcement.context.kind === 'session'
      ? `/app/program/${encodeURIComponent(announcement.context.session.id)}`
      : undefined;

  return (
    <>
      <Link className="announcement-back-link" href={returnHref}>
        ← Zpět na oznámení
      </Link>

      <article
        className="announcement-detail"
        aria-labelledby="announcement-title"
      >
        <div className="announcement-detail-topline">
          <AnnouncementReadLabel unread={effectiveReadAt === null} />
          <time dateTime={announcement.publishedAt}>
            {formatAnnouncementDate(announcement.publishedAt)}
          </time>
        </div>
        <AnnouncementSeverity severity={announcement.severity} />
        <h2 id="announcement-title">{announcement.title}</h2>
        <div className="announcement-detail-body">
          <p>{announcement.bodyText}</p>
        </div>

        {announcement.context.kind === 'session' && contextHref ? (
          <aside className="announcement-context" aria-label="Kontext programu">
            <strong>Týká se bodu programu</strong>
            <span>{announcement.context.session.title}</span>
            <Link className="announcement-context-link" href={contextHref}>
              Otevřít bod v programu
            </Link>
          </aside>
        ) : (
          <p className="announcement-result-count">
            Toto oznámení se týká celé akce.
          </p>
        )}

        <ReadReceipt
          announcementId={announcement.id}
          api={api}
          createIdempotencyKey={createIdempotencyKey}
          eventId={data.eventId}
          initialReadAt={effectiveReadAt}
          onRead={setEffectiveReadAt}
          onRevoked={onRevoked}
        />
      </article>
    </>
  );
};

export const ParticipantAnnouncement = ({
  announcementId,
  api = browserAnnouncementApi,
  createIdempotencyKey = createRuntimeIdempotencyKey,
  eventId,
}: {
  readonly announcementId: string;
  readonly api?: ApiPort;
  readonly createIdempotencyKey?: () => string;
  readonly eventId: string;
}) => {
  const state = useParticipantAnnouncementDetail(announcementId, eventId, api);
  const [revocation, setRevocation] = useState<{
    readonly announcementId: string;
    readonly api: ApiPort;
    readonly eventId: string;
    readonly status: AnnouncementRevocationStatus;
  } | null>(null);
  const activeRevocation =
    revocation?.announcementId === announcementId &&
    revocation.api === api &&
    revocation.eventId === eventId
      ? revocation.status
      : null;
  const handleRevocation = useCallback(
    (status: AnnouncementRevocationStatus) => {
      clearAnnouncementReturnContext();
      setRevocation({ announcementId, api, eventId, status });
    },
    [announcementId, api, eventId],
  );
  const failureState =
    activeRevocation !== null
      ? ({ status: activeRevocation } as const)
      : state.status === 'ready'
        ? null
        : state;
  const hasAuthoritativeFailure =
    failureState?.status === 'authentication' ||
    failureState?.status === 'disabled' ||
    failureState?.status === 'permission' ||
    failureState?.status === 'session_expired';

  useEffect(() => {
    if (hasAuthoritativeFailure) clearAnnouncementReturnContext();
  }, [hasAuthoritativeFailure]);

  return (
    <section className="app-page announcement-page">
      <header className="announcement-heading">
        <p className="eyebrow">Provozní zpráva</p>
        <h1 data-route-heading tabIndex={-1}>
          Oznámení
        </h1>
        <p className="lead">
          Obsah určený vašemu účtu se načítá bez ukládání do zařízení.
        </p>
      </header>

      {failureState ? (
        <AnnouncementResourceStatus
          loginReturnTo={`/app/oznameni/${encodeURIComponent(announcementId)}`}
          onRetry={state.retry}
          scope="detail"
          state={failureState}
        />
      ) : state.status === 'ready' ? (
        <AnnouncementDetail
          api={api}
          createIdempotencyKey={createIdempotencyKey}
          data={state.data}
          key={state.data.announcement.id}
          onRevoked={handleRevocation}
        />
      ) : null}
    </section>
  );
};
