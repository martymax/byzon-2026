import type {
  ApiFailure,
  ParticipantAgendaMutationProblem,
  ParticipantAgendaProblem,
  RequestId,
} from '@byzon/domain/contracts';

export type AgendaReadFailureState =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'authentication' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'permission' }
  | { readonly status: 'disabled' }
  | { readonly status: 'error'; readonly requestId?: RequestId };

export type AgendaMutationFeedbackKind =
  | 'capacity_full'
  | 'closed'
  | 'disabled'
  | 'error'
  | 'in_progress'
  | 'not_found'
  | 'offline'
  | 'offline_restricted'
  | 'queue_conflict'
  | 'queue_discarded'
  | 'queue_failed'
  | 'queued'
  | 'rate_limited'
  | 'rejected'
  | 'stale'
  | 'synced'
  | 'ticket_inactive';

export interface AgendaMutationFeedback {
  readonly kind: AgendaMutationFeedbackKind;
  readonly requestId?: RequestId;
  readonly retry: 'discard' | 'mutation' | 'read' | 'sync' | 'none';
}

export const mapParticipantAgendaReadFailure = (
  failure: ApiFailure<ParticipantAgendaProblem>,
): AgendaReadFailureState | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
      return { status: 'session_expired' };
    case 'problem':
      switch (failure.problem.code) {
        case 'AUTHENTICATION_REQUIRED':
          return { status: 'authentication' };
        case 'AUTH_SESSION_EXPIRED':
          return { status: 'session_expired' };
        case 'EVENT_ACCESS_DENIED':
          return { status: 'permission' };
        case 'AGENDA_DISABLED':
          return { status: 'disabled' };
        case 'RATE_LIMITED':
        case 'VALIDATION_FAILED':
        case 'INTERNAL_ERROR':
          return {
            status: 'error',
            requestId: failure.problem.requestId,
          };
      }
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

export const mapParticipantAgendaMutationFailure = (
  failure: ApiFailure<ParticipantAgendaMutationProblem>,
): AgendaMutationFeedback | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline', retry: 'mutation' };
    case 'session_expired':
      return null;
    case 'invalid_response':
      return {
        kind: 'error',
        retry: 'read',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'transport':
      return {
        kind: 'error',
        retry: 'mutation',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { kind: 'error', retry: 'mutation' };
    case 'problem':
      switch (failure.problem.code) {
        case 'RESERVATION_CONFLICT':
          return null;
        case 'CAPACITY_FULL':
          return {
            kind: 'capacity_full',
            requestId: failure.problem.requestId,
            retry: 'none',
          };
        case 'RESERVATION_CLOSED':
          return {
            kind: 'closed',
            requestId: failure.problem.requestId,
            retry: 'none',
          };
        case 'STALE_VERSION':
          return {
            kind: 'stale',
            requestId: failure.problem.requestId,
            retry: 'none',
          };
        case 'SESSION_NOT_FOUND':
          return {
            kind: 'not_found',
            requestId: failure.problem.requestId,
            retry: 'read',
          };
        case 'TICKET_INACTIVE':
          return {
            kind: 'ticket_inactive',
            requestId: failure.problem.requestId,
            retry: 'none',
          };
        case 'IDEMPOTENCY_IN_PROGRESS':
          return {
            kind: 'in_progress',
            requestId: failure.problem.requestId,
            retry: 'mutation',
          };
        case 'IDEMPOTENCY_KEY_REUSED':
        case 'VALIDATION_FAILED':
          return {
            kind: 'rejected',
            requestId: failure.problem.requestId,
            retry: 'none',
          };
        case 'INTERNAL_ERROR':
          return {
            kind: 'error',
            requestId: failure.problem.requestId,
            retry: 'mutation',
          };
        case 'RATE_LIMITED':
          return {
            kind: 'rate_limited',
            requestId: failure.problem.requestId,
            retry: 'mutation',
          };
        case 'AUTHENTICATION_REQUIRED':
        case 'AUTH_SESSION_EXPIRED':
        case 'EVENT_ACCESS_DENIED':
          return null;
        case 'AGENDA_DISABLED':
          return {
            kind: 'disabled',
            requestId: failure.problem.requestId,
            retry: 'read',
          };
      }
  }
};
