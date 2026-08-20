'use client';

import { ActionLink, Button, Skeleton, StatePanel } from '@byzon/ui';
import { participantAnnouncementParamsSchema } from '@byzon/domain/contracts';
import type {
  ApiFailure,
  ApiProblem,
  AnnouncementInboxFilter,
  ParticipantAnnouncementDetailProblem,
  ParticipantAnnouncementDetailResponse,
  ParticipantAnnouncementInboxProblem,
  ParticipantAnnouncementInboxResponse,
  ParticipantAnnouncementSummary,
  RequestId,
} from '@byzon/domain/contracts';
import { useCallback, useEffect, useState } from 'react';

import type { ApiPort, ApiResult } from '@/lib/api';
import { resolveActivationReturnTo } from '@/lib/activation-return';
import {
  browserAnnouncementApi,
  requestAnnouncementDetail,
  requestAnnouncementInbox,
} from '@/lib/announcement-api';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
} from '@/lib/private-resource-events';

export type AnnouncementResourceState<Data> =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'authentication' }
  | { readonly status: 'disabled' }
  | { readonly status: 'permission' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'error'; readonly requestId?: RequestId }
  | { readonly status: 'ready'; readonly data: Data };

export type AnnouncementAuthoritativeFailureStatus =
  'authentication' | 'disabled' | 'permission' | 'session_expired';

type AnnouncementFailureState = Exclude<
  AnnouncementResourceState<never>,
  { readonly status: 'ready' }
>;

export const announcementAuthoritativeFailureStatus = <
  Problem extends ApiProblem,
>(
  failure: ApiFailure<Problem>,
): AnnouncementAuthoritativeFailureStatus | null => {
  if (failure.kind === 'session_expired') return 'session_expired';
  if (failure.kind !== 'problem') return null;
  if (failure.problem.code === 'AUTHENTICATION_REQUIRED') {
    return 'authentication';
  }
  if (failure.problem.code === 'AUTH_SESSION_EXPIRED') {
    return 'session_expired';
  }
  if (failure.problem.code === 'ANNOUNCEMENTS_DISABLED') {
    return 'disabled';
  }
  if (
    failure.problem.code === 'ANNOUNCEMENT_NOT_FOUND' ||
    failure.problem.code === 'EVENT_ACCESS_DENIED'
  ) {
    return 'permission';
  }
  return null;
};

const mapAnnouncementFailure = <Problem extends ApiProblem>(
  failure: ApiFailure<Problem>,
): AnnouncementFailureState | null => {
  const authoritativeStatus = announcementAuthoritativeFailureStatus(failure);
  if (authoritativeStatus) return { status: authoritativeStatus };

  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
      return { status: 'session_expired' };
    case 'problem':
      return { status: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        status: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { status: 'error' };
  }
};

const useAnnouncementResource = <Data, Problem extends ApiProblem>(
  load: (signal: AbortSignal) => Promise<ApiResult<Data, Problem>>,
  localFailureStatus?: Exclude<
    AnnouncementFailureState['status'],
    'loading' | 'error'
  >,
): AnnouncementResourceState<Data> & {
  readonly discard: (status: AnnouncementAuthoritativeFailureStatus) => void;
  readonly retry: () => void;
} => {
  const [attempt, setAttempt] = useState(0);
  const [resultState, setResultState] = useState<
    AnnouncementResourceState<Data> & {
      readonly attempt: number;
      readonly load: typeof load;
    }
  >({ status: 'loading', attempt: 0, load });

  useEffect(() => {
    if (localFailureStatus) return;
    const controller = new AbortController();
    const unsubscribe = subscribeToPrivateResourceInvalidation((reason) => {
      controller.abort();
      setResultState({ status: reason, attempt, load });
    });
    void Promise.resolve()
      .then(() => load(controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setResultState(
            result.kind === 'success'
              ? { status: 'ready', data: result.data, attempt, load }
              : { status: 'error', attempt, load },
          );
          return;
        }
        const mapped = mapAnnouncementFailure(result.failure);
        if (mapped) {
          const invalidation = privateResourceInvalidationReason(
            result.failure,
            result.status,
          );
          if (invalidation) {
            invalidateParticipantPrivateResources(invalidation);
            setResultState({
              ...(mapped.status === 'authentication' ||
              mapped.status === 'permission' ||
              mapped.status === 'session_expired'
                ? mapped
                : { status: invalidation }),
              attempt,
              load,
            });
            return;
          }
          setResultState({ ...mapped, attempt, load });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResultState({ status: 'error', attempt, load });
        }
      });
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, [attempt, load, localFailureStatus]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const discard = useCallback(
    (status: AnnouncementAuthoritativeFailureStatus) => {
      setResultState({ status, attempt, load });
    },
    [attempt, load],
  );
  const state: AnnouncementResourceState<Data> =
    localFailureStatus !== undefined
      ? { status: localFailureStatus }
      : resultState.attempt === attempt && resultState.load === load
        ? resultState
        : { status: 'loading' };
  return { ...state, discard, retry };
};

const rejectMismatchedAnnouncementScope = <Data, Problem extends ApiProblem>(
  result: ApiResult<Data, Problem>,
  matchesExpectedScope: (data: Data) => boolean,
): ApiResult<Data, Problem> => {
  if (
    !result.ok ||
    result.kind !== 'success' ||
    matchesExpectedScope(result.data)
  ) {
    return result;
  }
  return {
    ok: false,
    kind: 'failure',
    status: result.status,
    failure: {
      kind: 'invalid_response',
      requestId: result.metadata.requestId,
    },
    metadata: result.metadata,
  };
};

export const useParticipantAnnouncementInbox = (
  filter: AnnouncementInboxFilter,
  expectedEventId: string,
  api: ApiPort = browserAnnouncementApi,
) => {
  const load = useCallback(
    (signal: AbortSignal) =>
      loadParticipantAnnouncementInboxPage(
        api,
        filter,
        expectedEventId,
        undefined,
        signal,
      ),
    [api, expectedEventId, filter],
  );
  return useAnnouncementResource<
    ParticipantAnnouncementInboxResponse,
    ParticipantAnnouncementInboxProblem
  >(load);
};

export const loadParticipantAnnouncementInboxPage = async (
  api: ApiPort,
  filter: AnnouncementInboxFilter,
  expectedEventId: string,
  cursor?: string,
  signal?: AbortSignal,
) =>
  rejectMismatchedAnnouncementScope(
    await requestAnnouncementInbox(
      api,
      {
        filter,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
      signal,
    ),
    (data) =>
      data.eventId === expectedEventId &&
      (filter === 'all' ||
        data.items.every((announcement) => announcement.readAt === null)),
  );

export const useParticipantAnnouncementDetail = (
  announcementId: string,
  expectedEventId: string,
  api: ApiPort = browserAnnouncementApi,
) => {
  const validAnnouncementId = participantAnnouncementParamsSchema.safeParse({
    announcementId,
  }).success;
  const load = useCallback(
    async (signal: AbortSignal) =>
      rejectMismatchedAnnouncementScope(
        await requestAnnouncementDetail(api, announcementId, signal),
        (data) =>
          data.eventId === expectedEventId &&
          data.announcement.id === announcementId,
      ),
    [announcementId, api, expectedEventId],
  );
  return useAnnouncementResource<
    ParticipantAnnouncementDetailResponse,
    ParticipantAnnouncementDetailProblem
  >(load, validAnnouncementId ? undefined : 'permission');
};

const stateCopy: Record<
  Exclude<AnnouncementFailureState['status'], 'loading' | 'error'>,
  {
    readonly detail: string;
    readonly title: string;
  }
> = {
  offline: {
    title: 'Jste offline',
    detail:
      'Soukromý seznam oznámení se v této verzi neukládá do zařízení. Připojte se a zkuste ho načíst znovu.',
  },
  authentication: {
    title: 'Je potřeba se přihlásit',
    detail: 'Po přihlášení se můžete bezpečně vrátit k oznámením.',
  },
  disabled: {
    title: 'Oznámení nejsou pro tuto akci zapnutá',
    detail:
      'Organizátoři tuto funkci nepoužívají. Důležité informace najdete také v programu a praktických informacích.',
  },
  permission: {
    title: 'Oznámení není dostupné',
    detail:
      'Mohlo být odebráno nebo není určené pro tento účet. Jeho existenci ani publikum dále nerozlišujeme.',
  },
  session_expired: {
    title: 'Přihlášení vypršelo',
    detail: 'Obnovte přihlášení a potom oznámení načtěte znovu.',
  },
};

export const AnnouncementResourceStatus = ({
  loginReturnTo,
  onRetry,
  scope,
  state,
}: {
  readonly loginReturnTo: string;
  readonly onRetry: () => void;
  readonly scope: 'detail' | 'inbox';
  readonly state: AnnouncementFailureState;
}) => {
  const safeLoginReturnTo = resolveActivationReturnTo(loginReturnTo, '/app');
  if (state.status === 'loading') {
    return (
      <Skeleton
        className="announcement-loading"
        label={
          scope === 'detail' ? 'Načítám oznámení' : 'Načítám seznam oznámení'
        }
        lines={scope === 'detail' ? 6 : 8}
      />
    );
  }

  const copy =
    state.status === 'error'
      ? {
          title:
            scope === 'detail'
              ? 'Oznámení se nepodařilo načíst'
              : 'Seznam oznámení se nepodařilo načíst',
          detail:
            'Zkontrolujte připojení a zkuste požadavek znovu. Pokud potíže trvají, předejte podpoře pouze referenci požadavku.',
        }
      : stateCopy[state.status];

  const canRetry = state.status === 'offline' || state.status === 'error';
  const needsLogin =
    state.status === 'authentication' || state.status === 'session_expired';

  return (
    <StatePanel
      action={
        canRetry ? (
          <Button onClick={onRetry}>Zkusit znovu</Button>
        ) : needsLogin ? (
          <ActionLink
            href={`/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
              safeLoginReturnTo,
            )}`}
          >
            Přihlásit se znovu
          </ActionLink>
        ) : (
          <ActionLink href="/app" variant="secondary">
            Zpět na přehled
          </ActionLink>
        )
      }
      kind={
        state.status === 'offline'
          ? 'offline'
          : state.status === 'authentication' ||
              state.status === 'session_expired'
            ? 'session-expired'
            : state.status === 'disabled' || state.status === 'permission'
              ? 'permission'
              : 'error'
      }
      title={copy.title}
    >
      <p>{copy.detail}</p>
      {state.status === 'error' && state.requestId ? (
        <p className="request-reference">
          Reference požadavku: <code>{state.requestId}</code>
        </p>
      ) : null}
    </StatePanel>
  );
};

const announcementDateFormatter = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const formatAnnouncementDate = (publishedAt: string): string =>
  announcementDateFormatter.format(new Date(publishedAt));

const ReadStateIcon = ({ unread }: { readonly unread: boolean }) => (
  <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 20 20"
  >
    {unread ? (
      <>
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" fill="currentColor" r="2.5" stroke="none" />
      </>
    ) : (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m6.8 10.2 2 2 4.5-4.5" />
      </>
    )}
  </svg>
);

export const AnnouncementReadLabel = ({
  unread,
}: {
  readonly unread: boolean;
}) => (
  <span
    className={`announcement-read-label${
      unread ? ' announcement-read-label--unread' : ''
    }`}
  >
    <ReadStateIcon unread={unread} />
    {unread ? 'Nepřečtené' : 'Přečtené'}
  </span>
);

const severityCopy: Record<ParticipantAnnouncementSummary['severity'], string> =
  {
    critical: 'Kritické',
  };

export const AnnouncementSeverity = ({
  severity,
}: {
  readonly severity: ParticipantAnnouncementSummary['severity'];
}) => (
  <span className={`announcement-severity announcement-severity--${severity}`}>
    {severityCopy[severity]}
  </span>
);
