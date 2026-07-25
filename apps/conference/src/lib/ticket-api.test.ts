import { participantTicketFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createFetchApiClient } from './api/fetch-client';
import {
  participantTicketEndpoint,
  requestParticipantTicket,
} from './ticket-api';

describe('participant ticket API', () => {
  it('uses a private no-store read endpoint and validates the response', async () => {
    const fetch = vi.fn(async () =>
      Response.json(participantTicketFixtures.valid, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-ticket-0001',
        },
      }),
    );
    const result = await requestParticipantTicket(
      createFetchApiClient({ fetch, maxRetries: 0 }),
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/ticket',
      expect.objectContaining({ cache: 'no-store', method: 'GET' }),
    );
    expect(participantTicketEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'TICKET_NOT_FOUND',
      'INTERNAL_ERROR',
    ]);
  });

  it('rejects an unexpected presentation value instead of exposing it', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ...participantTicketFixtures.valid,
          ticket: {
            ...participantTicketFixtures.valid!.ticket,
            presentation: {
              state: 'unavailable',
              reason: 'security_gate_pending',
              value: 'not-approved',
            },
          },
        },
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'request-ticket-0002',
          },
        },
      ),
    );
    const result = await requestParticipantTicket(
      createFetchApiClient({ fetch, maxRetries: 0 }),
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'request-ticket-0002',
      },
    });
  });
});
