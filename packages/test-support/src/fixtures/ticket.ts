import {
  participantTicketProblemSchema,
  participantTicketResponseSchema,
  problemTypeForCode,
  type ParticipantTicketStatus,
  type TicketPresentationUnavailableReason,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const ticketFixtureEventId = '019f7e6f-62ed-7c87-bce7-b742be58ce0b';

const ticket = (
  status: ParticipantTicketStatus,
  reason: TicketPresentationUnavailableReason,
) => ({
  eventId: ticketFixtureEventId,
  ticket: {
    status,
    holder: { displayName: 'Alex Novák' },
    referenceSuffix: 'TST6',
    presentation: {
      state: 'unavailable' as const,
      reason,
    },
  },
});

export const participantTicketFixtures = defineFixtureSet({
  name: 'ticket.participant',
  schema: participantTicketResponseSchema,
  fixtures: {
    valid: ticket('valid', 'security_gate_pending'),
    cancelled: ticket('cancelled', 'ticket_inactive'),
    refunded: ticket('refunded', 'ticket_inactive'),
    blocked: ticket('blocked', 'ticket_inactive'),
  },
});

interface TicketProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly TICKET_NOT_FOUND: 404;
  readonly INTERNAL_ERROR: 500;
}

const problem = <Code extends keyof TicketProblemStatus>(
  code: Code,
  status: TicketProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Ticket fixture problem',
  status,
  code,
  detail: 'Synthetic ticket fixture failure.',
  requestId: 'fixture-ticket-0001',
});

export const participantTicketProblemFixtures = defineFixtureSet({
  name: 'ticket.participant-problem',
  schema: participantTicketProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('TICKET_NOT_FOUND', 404),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});
