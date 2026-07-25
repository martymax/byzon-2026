'use client';

import type {
  ApiFailure,
  ParticipantTicketProblem,
  ParticipantTicketResponse,
  RequestId,
} from '@byzon/domain/contracts';
import { useCallback, useEffect, useState } from 'react';

import type { ApiPort, ApiResult } from '@/lib/api';
import { browserTicketApi, requestParticipantTicket } from '@/lib/ticket-api';

export type TicketResourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'authentication' }
  | { readonly status: 'permission' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'error'; readonly requestId?: RequestId }
  | {
      readonly status: 'ready';
      readonly data: ParticipantTicketResponse;
    };

type TicketFailureState = Exclude<
  TicketResourceState,
  { readonly status: 'ready' }
>;

const mapTicketFailure = (
  failure: ApiFailure<ParticipantTicketProblem>,
): TicketFailureState | null => {
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
      if (failure.problem.code === 'TICKET_NOT_FOUND') {
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

export const useParticipantTicket = (
  api: ApiPort = browserTicketApi,
): TicketResourceState & { readonly retry: () => void } => {
  const [attempt, setAttempt] = useState(0);
  const [resultState, setResultState] = useState<
    TicketResourceState & { readonly attempt: number }
  >({ status: 'loading', attempt: 0 });
  const load = useCallback(
    (signal: AbortSignal) => requestParticipantTicket(api, signal),
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then(
        (
          result: ApiResult<
            ParticipantTicketResponse,
            ParticipantTicketProblem
          >,
        ) => {
          if (controller.signal.aborted) return;
          if (result.ok) {
            setResultState(
              result.kind === 'success'
                ? {
                    status: 'ready',
                    data: result.data,
                    attempt,
                  }
                : { status: 'error', attempt },
            );
            return;
          }
          const failure = mapTicketFailure(result.failure);
          if (failure) setResultState({ ...failure, attempt });
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setResultState({ status: 'error', attempt });
        }
      });
    return () => controller.abort();
  }, [attempt, load]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const state: TicketResourceState =
    resultState.attempt === attempt ? resultState : { status: 'loading' };
  return { ...state, retry };
};

const failureCopy: Record<
  Exclude<TicketFailureState['status'], 'loading' | 'error'>,
  { readonly detail: string; readonly title: string }
> = {
  offline: {
    title: 'Jste offline',
    detail:
      'Vstupenka se z bezpečnostních důvodů neukládá pro offline zobrazení. Připojte se a zkuste to znovu.',
  },
  authentication: {
    title: 'Je potřeba se přihlásit',
    detail: 'Po přihlášení zkuste svou vstupenku načíst znovu.',
  },
  permission: {
    title: 'Vstupenka není dostupná',
    detail:
      'Vstupenka buď není přiřazená k tomuto účtu, nebo k ní nemáte přístup.',
  },
  session_expired: {
    title: 'Přihlášení vypršelo',
    detail: 'Obnovte přihlášení a potom vstupenku načtěte znovu.',
  },
};

export const TicketResourceStatus = ({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: TicketFailureState;
}) => {
  if (state.status === 'loading') {
    return (
      <div className="resource-status" role="status" aria-live="polite">
        <strong>Načítám stav vstupenky…</strong>
        <span className="resource-progress" aria-hidden="true" />
      </div>
    );
  }

  const copy =
    state.status === 'error'
      ? {
          title: 'Vstupenku se nepodařilo načíst',
          detail:
            'Zkontrolujte připojení a zkuste požadavek znovu. Pokud potíže trvají, předejte podpoře referenci požadavku.',
        }
      : failureCopy[state.status];

  return (
    <section className="resource-status" role="alert">
      <strong>{copy.title}</strong>
      <p>{copy.detail}</p>
      {state.status === 'error' && state.requestId ? (
        <p className="request-reference">
          Reference požadavku: <code>{state.requestId}</code>
        </p>
      ) : null}
      <button className="resource-action" type="button" onClick={onRetry}>
        Zkusit znovu
      </button>
    </section>
  );
};
