import { describe, expect, it } from 'vitest';

import {
  participantTicketCachePolicy,
  participantTicketProblemSchema,
  participantTicketResponseSchema,
  problemTypeForCode,
} from './index.js';

const response = {
  eventId: '01910000-0000-7000-8000-000000000101',
  ticket: {
    status: 'valid',
    holder: { displayName: 'Alex Novák' },
    referenceSuffix: 'TST6',
    presentation: {
      state: 'unavailable',
      reason: 'security_gate_pending',
    },
  },
} as const;

describe('CS-TICKET-01 status-only contract slice', () => {
  it('validates private ticket state without a presentation credential', () => {
    expect(participantTicketResponseSchema.parse(response)).toEqual(response);
    expect(participantTicketCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      offline: 'forbidden',
      presentation: 'blocked-by-tkt-05',
    });
  });

  it('rejects presentation values and unbounded or code-like references', () => {
    expect(
      participantTicketResponseSchema.safeParse({
        ...response,
        ticket: {
          ...response.ticket,
          presentation: {
            ...response.ticket.presentation,
            value: 'must-not-cross-before-tkt-05',
          },
        },
      }).success,
    ).toBe(false);
    expect(
      participantTicketResponseSchema.safeParse({
        ...response,
        ticket: {
          ...response.ticket,
          referenceSuffix: 'FULL-TICKET-CODE',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unsafe holder text and inconsistent presentation reasons', () => {
    expect(
      participantTicketResponseSchema.safeParse({
        ...response,
        ticket: {
          ...response.ticket,
          holder: { displayName: 'Alex\u202E spoof' },
        },
      }).success,
    ).toBe(false);
    expect(
      participantTicketResponseSchema.safeParse({
        ...response,
        ticket: {
          ...response.ticket,
          status: 'cancelled',
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only the participant-safe status and problem taxonomy', () => {
    expect(
      participantTicketResponseSchema.safeParse({
        ...response,
        ticket: { ...response.ticket, status: 'transferred' },
      }).success,
    ).toBe(false);

    const problem = {
      type: problemTypeForCode('TICKET_NOT_FOUND'),
      title: 'Ticket not found',
      status: 404,
      code: 'TICKET_NOT_FOUND',
      detail: 'Ticket is not available.',
      requestId: 'request-ticket-0001',
    };
    expect(participantTicketProblemSchema.parse(problem)).toEqual(problem);
    expect(
      participantTicketProblemSchema.safeParse({
        ...problem,
        type: problemTypeForCode('UNKNOWN_TICKET_ERROR'),
        code: 'UNKNOWN_TICKET_ERROR',
      }).success,
    ).toBe(false);
  });
});
