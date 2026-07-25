'use client';

import type {
  ApiFailure,
  ApiProblem,
  ParticipantContentResponse,
  ParticipantProgramResponse,
  RequestId,
} from '@byzon/domain/contracts';
import { ActionLink } from '@byzon/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  browserContentApi,
  requestParticipantContent,
  requestParticipantProgram,
} from '@/lib/content-api';
import type { ApiPort, ApiResult } from '@/lib/api';
import { resolveActivationReturnTo } from '@/lib/activation-return';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
} from '@/lib/private-resource-events';

export type ContentResourceState<Data> =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'authentication' }
  | { readonly status: 'permission' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'error'; readonly requestId?: RequestId }
  | { readonly status: 'ready'; readonly data: Data };

type ContentFailureState = Exclude<
  ContentResourceState<never>,
  { status: 'ready' }
>;

const mapFailure = <Problem extends ApiProblem>(
  failure: ApiFailure<Problem>,
): ContentFailureState | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
      return { status: 'session_expired' };
    case 'problem':
      if (failure.problem.code === 'AUTHENTICATION_REQUIRED') {
        return { status: 'authentication' };
      }
      if (
        failure.problem.code === 'PROGRAM_NOT_FOUND' ||
        failure.problem.code === 'CONTENT_NOT_FOUND'
      ) {
        return { status: 'permission' };
      }
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

const useContentResource = <
  Data extends { readonly eventId: string },
  Problem extends ApiProblem,
>(
  load: (signal: AbortSignal) => Promise<ApiResult<Data, Problem>>,
  expectedEventId: string,
): ContentResourceState<Data> & { readonly retry: () => void } => {
  const [attempt, setAttempt] = useState(0);
  const [resultState, setResultState] = useState<
    ContentResourceState<Data> & {
      readonly attempt: number;
      readonly eventId: string;
    }
  >({ status: 'loading', attempt: 0, eventId: expectedEventId });

  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = subscribeToPrivateResourceInvalidation((reason) => {
      controller.abort();
      setResultState({
        status: reason,
        attempt,
        eventId: expectedEventId,
      });
    });
    void load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          if (result.kind === 'success') {
            if (result.data.eventId !== expectedEventId) {
              setResultState({
                status: 'error',
                attempt,
                eventId: expectedEventId,
              });
              return;
            }
            setResultState({
              status: 'ready',
              data: result.data,
              attempt,
              eventId: expectedEventId,
            });
          } else {
            setResultState({
              status: 'error',
              attempt,
              eventId: expectedEventId,
            });
          }
          return;
        }
        const failure = mapFailure(result.failure);
        if (failure) {
          const invalidation = privateResourceInvalidationReason(
            result.failure,
            result.status,
          );
          if (invalidation) {
            invalidateParticipantPrivateResources(invalidation);
            setResultState({
              ...(failure.status === 'authentication' ||
              failure.status === 'permission' ||
              failure.status === 'session_expired'
                ? failure
                : { status: invalidation }),
              attempt,
              eventId: expectedEventId,
            });
            return;
          }
          setResultState({
            ...failure,
            attempt,
            eventId: expectedEventId,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResultState({
            status: 'error',
            attempt,
            eventId: expectedEventId,
          });
        }
      });
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, [attempt, expectedEventId, load]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const state: ContentResourceState<Data> =
    resultState.attempt === attempt && resultState.eventId === expectedEventId
      ? resultState
      : { status: 'loading' };
  return { ...state, retry };
};

export const useParticipantProgram = (
  eventId: string,
  api: ApiPort = browserContentApi,
) => {
  const load = useCallback(
    (signal: AbortSignal) => requestParticipantProgram(api, eventId, signal),
    [api, eventId],
  );
  return useContentResource<ParticipantProgramResponse, ApiProblem>(
    load,
    eventId,
  );
};

export const useParticipantContent = (
  eventId: string,
  api: ApiPort = browserContentApi,
) => {
  const load = useCallback(
    (signal: AbortSignal) => requestParticipantContent(api, eventId, signal),
    [api, eventId],
  );
  return useContentResource<ParticipantContentResponse, ApiProblem>(
    load,
    eventId,
  );
};

const statusCopy: Record<
  Exclude<ContentFailureState['status'], 'loading' | 'error'>,
  { readonly title: string; readonly detail: string }
> = {
  offline: {
    title: 'Jste offline',
    detail:
      'Tento obsah zatím není uložený pro čtení bez připojení. Připojte se a zkuste to znovu.',
  },
  authentication: {
    title: 'Je potřeba se přihlásit',
    detail: 'Po přihlášení zkuste obsah načíst znovu.',
  },
  permission: {
    title: 'Obsah není dostupný',
    detail:
      'Program buď ještě nebyl publikovaný, nebo k této akci nemáte přístup.',
  },
  session_expired: {
    title: 'Přihlášení vypršelo',
    detail: 'Obnovte přihlášení a potom obsah načtěte znovu.',
  },
};

export const ResourceStatus = ({
  loginReturnTo = '/app',
  state,
  onRetry,
}: {
  loginReturnTo?: string;
  state: ContentFailureState;
  onRetry: () => void;
}) => {
  const safeLoginReturnTo = resolveActivationReturnTo(loginReturnTo, '/app');
  if (state.status === 'loading') {
    return (
      <div className="resource-status" role="status" aria-live="polite">
        <strong>Načítám publikovaný obsah…</strong>
        <span className="resource-progress" aria-hidden="true" />
      </div>
    );
  }

  const copy =
    state.status === 'error'
      ? {
          title: 'Obsah se nepodařilo načíst',
          detail:
            'Zkontrolujte připojení a zkuste požadavek znovu. Pokud potíže trvají, předejte podpoře referenci požadavku.',
        }
      : statusCopy[state.status];

  return (
    <section className="resource-status" role="alert">
      <strong>{copy.title}</strong>
      <p>{copy.detail}</p>
      {state.status === 'error' && state.requestId ? (
        <p className="request-reference">
          Reference požadavku: <code>{state.requestId}</code>
        </p>
      ) : null}
      {state.status === 'authentication' ||
      state.status === 'session_expired' ? (
        <ActionLink
          href={`/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
            safeLoginReturnTo,
          )}`}
        >
          Přihlásit se znovu
        </ActionLink>
      ) : state.status === 'permission' ? (
        <ActionLink href="/app" variant="secondary">
          Zpět na přehled
        </ActionLink>
      ) : (
        <button className="resource-action" type="button" onClick={onRetry}>
          Zkusit znovu
        </button>
      )}
    </section>
  );
};

export const EmptyContent = ({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { readonly label: string; readonly onClick: () => void };
}) => (
  <section className="resource-status resource-empty" role="status">
    <strong>{title}</strong>
    <p>{detail}</p>
    {action ? (
      <button
        className="resource-action"
        type="button"
        onClick={action.onClick}
      >
        {action.label}
      </button>
    ) : null}
  </section>
);

export type { ParticipantContentResponse, ParticipantProgramResponse };
